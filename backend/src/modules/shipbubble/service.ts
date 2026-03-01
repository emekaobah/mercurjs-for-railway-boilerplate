import {
  AbstractFulfillmentProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  CalculateShippingOptionPriceContext,
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  FulfillmentOption,
  Logger,
  ValidateFulfillmentDataContext,
} from "@medusajs/framework/types"
import { ShipbubbleClient } from "./client"
import {
  ShipbubbleBookShipmentInput,
  ShipbubbleAddress,
  ShipbubblePackageItem,
  ShipbubbleProviderOptions,
  ShipbubbleRate,
  ShipbubbleRuntimeConfig,
  ShipbubbleShippingOptionData,
} from "./types"
import { isAddressComplete, normalizeAddress } from "./utils/address"
import { buildPackageFromItems } from "./utils/package"

type InjectedDependencies = {
  logger: Logger
}

type AddressContactFallback = {
  name: string
  email: string
  phone: string
}

type ShipbubbleCheckoutStrategy = "best_value" | "cheapest" | "fastest" | "all"

const toBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") {
    return value
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true
    }

    if (["false", "0", "no", "off"].includes(normalized)) {
      return false
    }
  }

  return fallback
}

const toPositiveNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

const toStringOr = (value: unknown, fallback: string): string => {
  if (value === null || value === undefined) {
    return fallback
  }

  const parsed = String(value).trim()

  return parsed.length ? parsed : fallback
}

const toOptionalString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }

  const parsed = String(value).trim()
  return parsed.length ? parsed : undefined
}

const toOptionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return undefined
  }

  return parsed
}

const toAddressCode = (value: unknown): number | null => {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

const toPositiveOrNull = (value: unknown): number | null => {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

const normalizeStrategy = (value: unknown): ShipbubbleCheckoutStrategy => {
  const parsed = String(value || "").trim().toLowerCase()

  if (parsed === "cheapest") {
    return "cheapest"
  }

  if (parsed === "fastest") {
    return "fastest"
  }

  if (parsed === "all") {
    return "all"
  }

  return "best_value"
}

export const getShipbubbleRuntimeConfig = (
  options: ShipbubbleProviderOptions = {}
): ShipbubbleRuntimeConfig => {
  const enabled = toBoolean(options.enabled, toBoolean(process.env.SHIPBUBBLE_ENABLED, false))

  return {
    enabled,
    apiBaseUrl: toStringOr(
      options.api_base_url ?? process.env.SHIPBUBBLE_API_BASE_URL,
      "https://api.shipbubble.com"
    ),
    apiKey: toStringOr(options.api_key ?? process.env.SHIPBUBBLE_API_KEY, ""),
    timeoutMs: toPositiveNumber(
      options.timeout_ms ?? process.env.SHIPBUBBLE_TIMEOUT_MS,
      15000
    ),
    defaultCategoryId: toPositiveNumber(
      options.default_category_id ?? process.env.SHIPBUBBLE_DEFAULT_CATEGORY_ID,
      1
    ),
    defaultSenderName: toStringOr(
      options.default_sender_name ?? process.env.SHIPBUBBLE_DEFAULT_SENDER_NAME,
      "Store Sender"
    ),
    defaultSenderEmail: toStringOr(
      options.default_sender_email ?? process.env.SHIPBUBBLE_DEFAULT_SENDER_EMAIL,
      "sender@example.com"
    ),
    defaultSenderPhone: toStringOr(
      options.default_sender_phone ?? process.env.SHIPBUBBLE_DEFAULT_SENDER_PHONE,
      "+2348000000000"
    ),
    defaultReceiverName: toStringOr(
      options.default_receiver_name ??
        process.env.SHIPBUBBLE_DEFAULT_RECEIVER_NAME,
      "Checkout Customer"
    ),
    defaultReceiverEmail: toStringOr(
      options.default_receiver_email ??
        process.env.SHIPBUBBLE_DEFAULT_RECEIVER_EMAIL,
      "customer@example.com"
    ),
    defaultReceiverPhone: toStringOr(
      options.default_receiver_phone ??
        process.env.SHIPBUBBLE_DEFAULT_RECEIVER_PHONE,
      "+2348000000000"
    ),
    overrideSenderAddress: toOptionalString(
      options.override_sender_address ??
        process.env.SHIPBUBBLE_OVERRIDE_SENDER_ADDRESS
    ),
    overrideSenderLatitude: toOptionalNumber(
      options.override_sender_latitude ??
        process.env.SHIPBUBBLE_OVERRIDE_SENDER_LATITUDE
    ),
    overrideSenderLongitude: toOptionalNumber(
      options.override_sender_longitude ??
        process.env.SHIPBUBBLE_OVERRIDE_SENDER_LONGITUDE
    ),
    overrideReceiverAddress: toOptionalString(
      options.override_receiver_address ??
        process.env.SHIPBUBBLE_OVERRIDE_RECEIVER_ADDRESS
    ),
    overrideReceiverLatitude: toOptionalNumber(
      options.override_receiver_latitude ??
        process.env.SHIPBUBBLE_OVERRIDE_RECEIVER_LATITUDE
    ),
    overrideReceiverLongitude: toOptionalNumber(
      options.override_receiver_longitude ??
        process.env.SHIPBUBBLE_OVERRIDE_RECEIVER_LONGITUDE
    ),
    defaultWeightKg: toPositiveNumber(
      options.default_weight_kg ?? process.env.SHIPBUBBLE_DEFAULT_WEIGHT_KG,
      1
    ),
    defaultLengthCm: toPositiveNumber(
      options.default_length_cm ?? process.env.SHIPBUBBLE_DEFAULT_LENGTH_CM,
      20
    ),
    defaultWidthCm: toPositiveNumber(
      options.default_width_cm ?? process.env.SHIPBUBBLE_DEFAULT_WIDTH_CM,
      20
    ),
    defaultHeightCm: toPositiveNumber(
      options.default_height_cm ?? process.env.SHIPBUBBLE_DEFAULT_HEIGHT_CM,
      10
    ),
    checkoutStrategy: normalizeStrategy(
      options.checkout_strategy ?? process.env.SHIPBUBBLE_CHECKOUT_STRATEGY
    ),
  }
}

const getDefaultOptionData = (
  optionData: Record<string, unknown> = {}
): ShipbubbleShippingOptionData => {
  return {
    carrier_code: toStringOr(optionData.carrier_code, "auto"),
    service_code: toStringOr(optionData.service_code, "auto"),
    service_name: toStringOr(optionData.service_name, "ShipBubble"),
    mode: optionData.mode === "pickup" ? "pickup" : "delivery",
    insurance_enabled: Boolean(optionData.insurance_enabled),
  }
}

class ShipbubbleFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = "shipbubble"

  protected readonly logger_: Logger
  protected readonly config_: ShipbubbleRuntimeConfig
  protected readonly client_: ShipbubbleClient
  protected categoryCache_: { ids: number[]; fetchedAt: number } | null = null

  constructor({ logger }: InjectedDependencies, options: ShipbubbleProviderOptions = {}) {
    super()

    this.logger_ = logger
    this.config_ = getShipbubbleRuntimeConfig(options)
    this.client_ = new ShipbubbleClient(this.config_)
  }

  static validateOptions(options: Record<string, unknown>) {
    const config = getShipbubbleRuntimeConfig(options as ShipbubbleProviderOptions)

    if (!config.enabled) {
      return
    }

    if (!config.apiKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "SHIPBUBBLE_API_KEY is required when ShipBubble is enabled"
      )
    }

    if (!config.apiBaseUrl) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "SHIPBUBBLE_API_BASE_URL is required when ShipBubble is enabled"
      )
    }
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      {
        id: "shipbubble-delivery-auto",
        name: "ShipBubble Delivery",
        carrier_code: "auto",
        service_code: "auto",
        service_name: "Auto Select",
        mode: "delivery",
        insurance_enabled: false,
      },
      {
        id: "shipbubble-pickup-auto",
        name: "ShipBubble Pickup",
        carrier_code: "auto",
        service_code: "auto",
        service_name: "Auto Select",
        mode: "pickup",
        insurance_enabled: false,
      },
    ]
  }

  async validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: ValidateFulfillmentDataContext
  ): Promise<Record<string, unknown>> {
    return data
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    const normalized = getDefaultOptionData(data)

    return Boolean(
      normalized.carrier_code &&
        normalized.service_code &&
        normalized.service_name &&
        ["delivery", "pickup"].includes(normalized.mode)
    )
  }

  async canCalculate(): Promise<boolean> {
    return this.config_.enabled && Boolean(this.config_.apiKey)
  }

  private resolveRate(
    rates: ShipbubbleRate[],
    optionData: ShipbubbleShippingOptionData
  ): ShipbubbleRate {
    const matched = rates.find((rate) => {
      const carrierMatches =
        optionData.carrier_code === "auto" ||
        rate.carrier_code === optionData.carrier_code
      const serviceMatches =
        optionData.service_code === "auto" ||
        rate.service_code === optionData.service_code

      return carrierMatches && serviceMatches
    })

    return matched ?? rates[0]
  }

  private buildQuoteId(rate: ShipbubbleRate): string {
    return [
      rate.courier_id || "auto",
      rate.carrier_code || "auto",
      rate.service_code || "auto",
      rate.mode || "delivery",
    ].join(":")
  }

  private resolveRateByStrategy(
    rates: ShipbubbleRate[],
    strategy: ShipbubbleCheckoutStrategy
  ): ShipbubbleRate {
    if (!rates.length) {
      throw new Error("No ShipBubble rates available")
    }

    if (strategy === "fastest") {
      const flagged = rates.find((rate) => rate.is_fastest)
      if (flagged) {
        return flagged
      }

      return [...rates].sort((a, b) => {
        const etaA = toPositiveOrNull(a.eta_days) ?? Number.MAX_SAFE_INTEGER
        const etaB = toPositiveOrNull(b.eta_days) ?? Number.MAX_SAFE_INTEGER

        if (etaA !== etaB) {
          return etaA - etaB
        }

        return a.amount - b.amount
      })[0]
    }

    if (strategy === "cheapest") {
      return rates.find((rate) => rate.is_cheapest) ?? rates[0]
    }

    return rates.find((rate) => rate.is_best_value) ?? rates[0]
  }

  private sortRatesByStrategy(
    rates: ShipbubbleRate[],
    strategy: ShipbubbleCheckoutStrategy
  ): ShipbubbleRate[] {
    const sorted = [...rates]

    if (strategy === "fastest") {
      sorted.sort((a, b) => {
        const etaA = toPositiveOrNull(a.eta_days) ?? Number.MAX_SAFE_INTEGER
        const etaB = toPositiveOrNull(b.eta_days) ?? Number.MAX_SAFE_INTEGER

        if (etaA !== etaB) {
          return etaA - etaB
        }

        return a.amount - b.amount
      })

      return sorted
    }

    if (strategy === "cheapest" || strategy === "best_value" || strategy === "all") {
      sorted.sort((a, b) => a.amount - b.amount)
      return sorted
    }

    return sorted
  }

  private resolveRateFromSelection(
    rates: ShipbubbleRate[],
    optionData: ShipbubbleShippingOptionData,
    selectionData: Record<string, unknown>
  ): ShipbubbleRate {
    const hasExplicitCarrier =
      optionData.carrier_code && optionData.carrier_code !== "auto"
    const hasExplicitService =
      optionData.service_code && optionData.service_code !== "auto"

    if (hasExplicitCarrier || hasExplicitService) {
      return this.resolveRate(rates, optionData)
    }

    const quote =
      (selectionData.shipbubble_quote as Record<string, unknown>) || {}
    const selectedQuoteId =
      typeof selectionData.shipbubble_quote_id === "string"
        ? selectionData.shipbubble_quote_id
        : typeof quote.quote_id === "string"
          ? String(quote.quote_id)
          : ""

    if (selectedQuoteId) {
      const selected = rates.find((rate) => {
        return (rate.quote_id || this.buildQuoteId(rate)) === selectedQuoteId
      })

      if (selected) {
        return selected
      }
    }

    const strategy = normalizeStrategy(
      selectionData.shipbubble_strategy || this.config_.checkoutStrategy
    )

    return this.resolveRateByStrategy(rates, strategy)
  }

  private resolveUnitWeightKg(item: Record<string, unknown>, fallback: number): number {
    const variant = (item.variant ?? {}) as Record<string, unknown>
    const rawWeight = toPositiveOrNull(variant.weight)

    if (!rawWeight) {
      return fallback
    }

    // Medusa variant weight is commonly stored in grams.
    return rawWeight > 200 ? rawWeight / 1000 : rawWeight
  }

  private resolveUnitAmount(item: Record<string, unknown>, quantity: number): number {
    const total = toPositiveOrNull(item.total)
    const subtotal = toPositiveOrNull(item.subtotal)
    const unitPrice = toPositiveOrNull(item.unit_price)
    const candidates = [
      unitPrice,
      total && quantity ? total / quantity : null,
      subtotal && quantity ? subtotal / quantity : null,
    ].filter(Boolean) as number[]

    let amount = candidates[0] ?? 1000

    // Heuristic: Medusa prices are usually in minor units.
    if (amount > 10000) {
      amount = amount / 100
    }

    return Math.max(1, Math.round(amount))
  }

  private buildPackageItems(
    items: Array<Record<string, unknown>>,
    defaultWeightKg: number
  ): ShipbubblePackageItem[] {
    const packageItems: ShipbubblePackageItem[] = []

    for (const item of items) {
      const quantity = Math.max(1, Math.round(toPositiveOrNull(item.quantity) ?? 1))
      const name = toStringOr(
        item.title ?? item.product_title ?? item.variant_title,
        "Order item"
      )
      const description = toStringOr(item.subtitle ?? item.product_title, name)
      const unitWeight = Number(
        this.resolveUnitWeightKg(item, defaultWeightKg).toFixed(3)
      )
      const amount = this.resolveUnitAmount(item, quantity)

      packageItems.push({
        name,
        description,
        unit_weight: unitWeight,
        weight: unitWeight,
        quantity,
        unit_quantity: quantity,
        amount,
        unit_amount: amount,
        value: amount,
      })
    }

    if (!packageItems.length) {
      const fallbackAmount = 1000
      return [
        {
          name: "Order package",
          description: "Checkout order package",
          unit_weight: defaultWeightKg,
          weight: defaultWeightKg,
          quantity: 1,
          unit_quantity: 1,
          amount: fallbackAmount,
          unit_amount: fallbackAmount,
          value: fallbackAmount,
        },
      ]
    }

    return packageItems
  }

  private ensureAddressContact(
    address: ShipbubbleAddress,
    fallback: AddressContactFallback
  ): ShipbubbleAddress {
    return {
      ...address,
      name: (address.name || "").trim() || fallback.name,
      email: (address.email || "").trim() || fallback.email,
      phone: (address.phone || "").trim() || fallback.phone,
    }
  }

  private async resolveCategoryId(forceRefresh = false): Promise<number> {
    const now = Date.now()
    const cacheValid =
      !forceRefresh &&
      this.categoryCache_ &&
      now - this.categoryCache_.fetchedAt < 15 * 60 * 1000

    if (!cacheValid) {
      try {
        const ids = await this.client_.getPackageCategories()
        if (ids.length) {
          this.categoryCache_ = {
            ids,
            fetchedAt: now,
          }
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to fetch ShipBubble package categories"
        this.logger_.warn(`[shipbubble] category lookup failed: ${message}`)
      }
    }

    const cachedIds = this.categoryCache_?.ids || []

    if (cachedIds.includes(this.config_.defaultCategoryId)) {
      return this.config_.defaultCategoryId
    }

    if (cachedIds.length) {
      return cachedIds[0]
    }

    return this.config_.defaultCategoryId
  }

  private inferCityFromAddress(addressText: string): string {
    const segments = addressText
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)

    if (segments.length >= 2) {
      return segments[segments.length - 2]
    }

    return "Lagos"
  }

  private buildOverrideAddress(
    kind: "sender" | "receiver",
    fallback: AddressContactFallback
  ): ShipbubbleAddress | null {
    const isSender = kind === "sender"
    const addressText = isSender
      ? this.config_.overrideSenderAddress
      : this.config_.overrideReceiverAddress

    if (!addressText) {
      return null
    }

    const city = this.inferCityFromAddress(addressText)
    const latitude = isSender
      ? this.config_.overrideSenderLatitude
      : this.config_.overrideReceiverLatitude
    const longitude = isSender
      ? this.config_.overrideSenderLongitude
      : this.config_.overrideReceiverLongitude

    return {
      name: fallback.name,
      email: fallback.email,
      phone: fallback.phone,
      address_line_1: addressText,
      city,
      state: city,
      country_code: "NG",
      latitude,
      longitude,
    }
  }

  private resolveRuntimeAddresses(context: CalculateShippingOptionPriceContext): {
    sender: ShipbubbleAddress | null
    receiver: ShipbubbleAddress | null
  } {
    const senderOverride = this.buildOverrideAddress("sender", {
      name: this.config_.defaultSenderName,
      email: this.config_.defaultSenderEmail,
      phone: this.config_.defaultSenderPhone,
    })
    const receiverOverride = this.buildOverrideAddress("receiver", {
      name: this.config_.defaultReceiverName,
      email: this.config_.defaultReceiverEmail,
      phone: this.config_.defaultReceiverPhone,
    })

    return {
      sender:
        senderOverride ??
        normalizeAddress((context as Record<string, any>).from_location?.address),
      receiver:
        receiverOverride ??
        normalizeAddress((context as Record<string, any>).shipping_address),
    }
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: CalculateShippingOptionPriceContext
  ): Promise<CalculatedShippingOptionPrice> {
    try {
      if (!this.config_.enabled) {
        throw new Error("ShipBubble is disabled")
      }

      if (!this.config_.apiKey) {
        throw new Error("ShipBubble API key is missing")
      }

      const currencyCode = String(
        (context as Record<string, unknown>).currency_code || ""
      ).toLowerCase()

      if (currencyCode && currencyCode !== "ngn") {
        throw new Error("ShipBubble is only available for NGN carts")
      }

      const { sender: senderAddress, receiver: receiverAddress } =
        this.resolveRuntimeAddresses(context)

      if (!isAddressComplete(senderAddress) || !isAddressComplete(receiverAddress)) {
        throw new Error("ShipBubble requires complete sender and receiver addresses")
      }

      const sender = this.ensureAddressContact(
        senderAddress as ShipbubbleAddress,
        {
          name: this.config_.defaultSenderName,
          email: this.config_.defaultSenderEmail,
          phone: this.config_.defaultSenderPhone,
        }
      )
      const receiver = this.ensureAddressContact(
        receiverAddress as ShipbubbleAddress,
        {
          name: this.config_.defaultReceiverName,
          email: this.config_.defaultReceiverEmail,
          phone: this.config_.defaultReceiverPhone,
        }
      )

      const senderValidation = await this.client_.validateAddress(sender)
      const receiverValidation = await this.client_.validateAddress(receiver)

      if (!senderValidation.valid || senderValidation.serviceable === false) {
        throw new Error(
          senderValidation.message || "Sender address is not serviceable"
        )
      }

      if (!receiverValidation.valid || receiverValidation.serviceable === false) {
        throw new Error(
          receiverValidation.message || "Receiver address is not serviceable"
        )
      }

      const senderAddressCode = toAddressCode(senderValidation.address_code)
      const receiverAddressCode = toAddressCode(receiverValidation.address_code)

      if (!senderAddressCode || !receiverAddressCode) {
        this.logger_.warn(
          `[shipbubble] missing address_code sender=${String(
            senderValidation.address_code ?? ""
          )} receiver=${String(receiverValidation.address_code ?? "")}`
        )
        throw new Error(
          "ShipBubble could not resolve sender/receiver address code. Please provide clearer city/state/country details for seller and customer addresses."
        )
      }

      const packageData = buildPackageFromItems(
        ((context as Record<string, any>).items || []) as Array<Record<string, unknown>>,
        {
          weightKg: this.config_.defaultWeightKg,
          lengthCm: this.config_.defaultLengthCm,
          widthCm: this.config_.defaultWidthCm,
          heightCm: this.config_.defaultHeightCm,
        }
      )
      const contextItems = ((context as Record<string, any>).items || []) as Array<
        Record<string, unknown>
      >
      const defaultUnitWeight = Number(
        (packageData.weight_kg / Math.max(packageData.items_count, 1)).toFixed(3)
      )
      const packageItems = this.buildPackageItems(contextItems, defaultUnitWeight)

      const normalizedOptionData = getDefaultOptionData(optionData)
      const categoryId = await this.resolveCategoryId()
      this.logger_.info(
        `[shipbubble] using address_code sender=${senderAddressCode} receiver=${receiverAddressCode} category=${categoryId} package_items=${packageItems.length}`
      )
      let rates: ShipbubbleRate[]
      try {
        rates = await this.client_.getRates({
          sender,
          receiver,
          sender_address_code: senderAddressCode,
          receiver_address_code: receiverAddressCode,
          category_id: categoryId,
          parcel: packageData,
          package_items: packageItems,
          currency_code: (currencyCode || "ngn").toUpperCase(),
          mode: normalizedOptionData.mode,
          insurance_enabled: normalizedOptionData.insurance_enabled,
          carrier_code: normalizedOptionData.carrier_code,
          service_code: normalizedOptionData.service_code,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : ""
        const invalidCategory = message.toLowerCase().includes(
          "invalid package category selected"
        )

        if (!invalidCategory) {
          throw error
        }

        const fallbackCategoryId = await this.resolveCategoryId(true)
        if (fallbackCategoryId === categoryId) {
          throw error
        }

        this.logger_.warn(
          `[shipbubble] retrying rates with fallback category=${fallbackCategoryId} (previous=${categoryId})`
        )

        rates = await this.client_.getRates({
          sender,
          receiver,
          sender_address_code: senderAddressCode,
          receiver_address_code: receiverAddressCode,
          category_id: fallbackCategoryId,
          parcel: packageData,
          package_items: packageItems,
          currency_code: (currencyCode || "ngn").toUpperCase(),
          mode: normalizedOptionData.mode,
          insurance_enabled: normalizedOptionData.insurance_enabled,
          carrier_code: normalizedOptionData.carrier_code,
          service_code: normalizedOptionData.service_code,
        })
      }

      const selectedRate = this.resolveRateFromSelection(
        rates,
        normalizedOptionData,
        data || {}
      )

      return {
        calculated_amount: Number(selectedRate.amount.toFixed(2)),
        is_calculated_price_tax_inclusive: false,
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to calculate ShipBubble shipping price"

      this.logger_.warn(`[shipbubble] calculatePrice failed: ${message}`)

      const normalizedMessage = message.toLowerCase()
      const isValidationError =
        normalizedMessage.includes("ngn carts") ||
        normalizedMessage.includes("complete sender and receiver addresses") ||
        normalizedMessage.includes("serviceable") ||
        normalizedMessage.includes("required") ||
        normalizedMessage.includes("invalid") ||
        normalizedMessage.includes("couldn't validate the provided address") ||
        normalizedMessage.includes("clear and accurate address") ||
        normalizedMessage.includes("address code") ||
        normalizedMessage.includes("insufficient wallet balance") ||
        normalizedMessage.includes("fund your wallet")

      if (isValidationError) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
      }

      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ShipBubble is temporarily unavailable. Please choose another delivery option."
      )
    }
  }

  async getDynamicQuotes(
    optionData: Record<string, unknown>,
    context: CalculateShippingOptionPriceContext,
    selectionData: Record<string, unknown> = {}
  ): Promise<{
    quotes: ShipbubbleRate[]
    strategy: ShipbubbleCheckoutStrategy
    recommended_quote_id: string
  }> {
    if (!this.config_.enabled) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "ShipBubble is disabled")
    }

    if (!this.config_.apiKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ShipBubble API key is missing"
      )
    }

    const currencyCode = String(
      (context as Record<string, unknown>).currency_code || ""
    ).toLowerCase()

    if (currencyCode && currencyCode !== "ngn") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ShipBubble is only available for NGN carts"
      )
    }

    const { sender: senderAddress, receiver: receiverAddress } =
      this.resolveRuntimeAddresses(context)

    if (!isAddressComplete(senderAddress) || !isAddressComplete(receiverAddress)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ShipBubble requires complete sender and receiver addresses"
      )
    }

    const sender = this.ensureAddressContact(senderAddress as ShipbubbleAddress, {
      name: this.config_.defaultSenderName,
      email: this.config_.defaultSenderEmail,
      phone: this.config_.defaultSenderPhone,
    })
    const receiver = this.ensureAddressContact(receiverAddress as ShipbubbleAddress, {
      name: this.config_.defaultReceiverName,
      email: this.config_.defaultReceiverEmail,
      phone: this.config_.defaultReceiverPhone,
    })

    const senderValidation = await this.client_.validateAddress(sender)
    const receiverValidation = await this.client_.validateAddress(receiver)

    if (!senderValidation.valid || senderValidation.serviceable === false) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        senderValidation.message || "Sender address is not serviceable"
      )
    }

    if (!receiverValidation.valid || receiverValidation.serviceable === false) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        receiverValidation.message || "Receiver address is not serviceable"
      )
    }

    const senderAddressCode = toAddressCode(senderValidation.address_code)
    const receiverAddressCode = toAddressCode(receiverValidation.address_code)

    if (!senderAddressCode || !receiverAddressCode) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ShipBubble could not resolve sender/receiver address code."
      )
    }

    const packageData = buildPackageFromItems(
      ((context as Record<string, any>).items || []) as Array<Record<string, unknown>>,
      {
        weightKg: this.config_.defaultWeightKg,
        lengthCm: this.config_.defaultLengthCm,
        widthCm: this.config_.defaultWidthCm,
        heightCm: this.config_.defaultHeightCm,
      }
    )
    const contextItems = ((context as Record<string, any>).items || []) as Array<
      Record<string, unknown>
    >
    const defaultUnitWeight = Number(
      (packageData.weight_kg / Math.max(packageData.items_count, 1)).toFixed(3)
    )
    const packageItems = this.buildPackageItems(contextItems, defaultUnitWeight)

    const normalizedOptionData = getDefaultOptionData(optionData)
    const categoryId = await this.resolveCategoryId()

    let rates: ShipbubbleRate[]
    try {
      rates = await this.client_.getRates({
        sender,
        receiver,
        sender_address_code: senderAddressCode,
        receiver_address_code: receiverAddressCode,
        category_id: categoryId,
        parcel: packageData,
        package_items: packageItems,
        currency_code: (currencyCode || "ngn").toUpperCase(),
        mode: normalizedOptionData.mode,
        insurance_enabled: normalizedOptionData.insurance_enabled,
        carrier_code: normalizedOptionData.carrier_code,
        service_code: normalizedOptionData.service_code,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      const invalidCategory = message.toLowerCase().includes(
        "invalid package category selected"
      )

      if (!invalidCategory) {
        throw error
      }

      const fallbackCategoryId = await this.resolveCategoryId(true)
      rates = await this.client_.getRates({
        sender,
        receiver,
        sender_address_code: senderAddressCode,
        receiver_address_code: receiverAddressCode,
        category_id: fallbackCategoryId,
        parcel: packageData,
        package_items: packageItems,
        currency_code: (currencyCode || "ngn").toUpperCase(),
        mode: normalizedOptionData.mode,
        insurance_enabled: normalizedOptionData.insurance_enabled,
        carrier_code: normalizedOptionData.carrier_code,
        service_code: normalizedOptionData.service_code,
      })
    }

    const quotes = rates.map((rate) => ({
      ...rate,
      quote_id: rate.quote_id || this.buildQuoteId(rate),
    }))

    const strategy = normalizeStrategy(
      selectionData.shipbubble_strategy || this.config_.checkoutStrategy
    )
    const sortedQuotes = this.sortRatesByStrategy(quotes, strategy)
    const selected = this.resolveRateFromSelection(
      sortedQuotes,
      normalizedOptionData,
      selectionData
    )

    return {
      quotes: sortedQuotes,
      strategy,
      recommended_quote_id: selected.quote_id || this.buildQuoteId(selected),
    }
  }

  async createFulfillment(
    data: Record<string, unknown>
  ): Promise<CreateFulfillmentResult> {
    return {
      data,
      labels: [],
    }
  }

  async cancelFulfillment(): Promise<Record<string, never>> {
    return {}
  }

  async createReturnFulfillment(
    data: Record<string, unknown>
  ): Promise<CreateFulfillmentResult> {
    return {
      data,
      labels: [],
    }
  }

  async bookShipment(
    input: ShipbubbleBookShipmentInput
  ): Promise<{
    shipbubble_shipment_id: string
    tracking_number: string
    tracking_url?: string
    label_url?: string
    raw?: Record<string, unknown>
  }> {
    try {
      if (!this.config_.enabled) {
        throw new Error("ShipBubble is disabled")
      }

      if (!this.config_.apiKey) {
        throw new Error("ShipBubble API key is missing")
      }

      const sender = this.ensureAddressContact(input.sender, {
        name: this.config_.defaultSenderName,
        email: this.config_.defaultSenderEmail,
        phone: this.config_.defaultSenderPhone,
      })
      const receiver = this.ensureAddressContact(input.receiver, {
        name: this.config_.defaultReceiverName,
        email: this.config_.defaultReceiverEmail,
        phone: this.config_.defaultReceiverPhone,
      })
      const senderOverride = this.buildOverrideAddress("sender", {
        name: this.config_.defaultSenderName,
        email: this.config_.defaultSenderEmail,
        phone: this.config_.defaultSenderPhone,
      })
      const receiverOverride = this.buildOverrideAddress("receiver", {
        name: this.config_.defaultReceiverName,
        email: this.config_.defaultReceiverEmail,
        phone: this.config_.defaultReceiverPhone,
      })
      const resolvedSender = senderOverride ?? sender
      const resolvedReceiver = receiverOverride ?? receiver

      const senderValidation = await this.client_.validateAddress(resolvedSender)
      const receiverValidation = await this.client_.validateAddress(resolvedReceiver)

      if (!senderValidation.valid || senderValidation.serviceable === false) {
        throw new Error(
          senderValidation.message || "Sender address is not serviceable"
        )
      }

      if (!receiverValidation.valid || receiverValidation.serviceable === false) {
        throw new Error(
          receiverValidation.message || "Receiver address is not serviceable"
        )
      }

      const senderAddressCode = toAddressCode(senderValidation.address_code)
      const receiverAddressCode = toAddressCode(receiverValidation.address_code)

      if (!senderAddressCode || !receiverAddressCode) {
        this.logger_.warn(
          `[shipbubble] missing address_code (booking) sender=${String(
            senderValidation.address_code ?? ""
          )} receiver=${String(receiverValidation.address_code ?? "")}`
        )
        throw new Error(
          "ShipBubble could not resolve sender/receiver address code for shipment booking."
        )
      }

      return this.client_.createShipment({
        ...input,
        sender: resolvedSender,
        receiver: resolvedReceiver,
        sender_address_code:
          input.sender_address_code ?? senderAddressCode,
        receiver_address_code:
          input.receiver_address_code ?? receiverAddressCode,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to book ShipBubble shipment"

      this.logger_.error(`[shipbubble] bookShipment failed: ${message}`)

      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        message || "ShipBubble shipment booking failed"
      )
    }
  }
}

export default ShipbubbleFulfillmentProviderService
