import {
  ShipbubbleAddress,
  ShipbubbleAddressValidationResult,
  ShipbubbleBookShipmentInput,
  ShipbubblePackageItem,
  ShipbubbleRate,
  ShipbubbleRatesInput,
  ShipbubbleRuntimeConfig,
  ShipbubbleShipmentResult,
} from "./types"
import { toShipbubbleAddressPayload } from "./utils/address"

type JsonRecord = Record<string, any>

const SHIPBUBBLE_RATE_PATHS = ["/v1/shipping/fetch_rates"]

const SHIPBUBBLE_ADDRESS_VALIDATION_PATHS = ["/v1/shipping/address/validate"]

const SHIPBUBBLE_SHIPMENT_PATHS = ["/v1/shipping/labels"]

const SHIPBUBBLE_PACKAGE_CATEGORY_PATHS = ["/v1/shipping/labels/categories"]

const toArray = <T>(value: unknown): T[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value as T[]
}

const toRecord = (value: unknown): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  return value as JsonRecord
}

const pickFirstString = (values: unknown[]): string | undefined => {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue
    }

    const parsed = String(value).trim()

    if (parsed.length) {
      return parsed
    }
  }

  return undefined
}

const pickFirstNumber = (values: unknown[]): number | undefined => {
  for (const value of values) {
    const parsed = Number(value)

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

const pickFirstBoolean = (values: unknown[]): boolean | undefined => {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase()

      if (["true", "yes", "1", "ok", "success"].includes(normalized)) {
        return true
      }

      if (["false", "no", "0", "failed", "error"].includes(normalized)) {
        return false
      }
    }
  }

  return undefined
}

const buildQuoteId = (rate: {
  courier_id?: string
  carrier_code?: string
  service_code?: string
  mode?: string
}) => {
  return [
    rate.courier_id || "auto",
    rate.carrier_code || "auto",
    rate.service_code || "auto",
    rate.mode || "delivery",
  ].join(":")
}

const markerMatchesRate = (marker: JsonRecord | undefined, rate: ShipbubbleRate) => {
  if (!marker) {
    return false
  }

  const markerServiceCode = pickFirstString([
    marker.service_code,
    marker.shipment_code,
    marker.code,
  ])
  const markerCourierId = pickFirstString([
    marker.courier_id,
    marker.carrier_code,
    marker.courier_code,
    marker.provider_id,
  ])

  const serviceMatches = markerServiceCode
    ? markerServiceCode === rate.service_code
    : true
  const courierMatches = markerCourierId
    ? markerCourierId === (rate.courier_id || rate.carrier_code)
    : true

  return serviceMatches && courierMatches
}

const buildFallbackPackageItems = (input: {
  weight_kg: number
  items_count: number
}): ShipbubblePackageItem[] => {
  const unitWeight = Number.isFinite(input.weight_kg) && input.weight_kg > 0
    ? Number(input.weight_kg.toFixed(3))
    : 0.5
  const quantity =
    Number.isFinite(input.items_count) && input.items_count > 0
      ? Math.round(input.items_count)
      : 1
  const amount = 1000

  return [
    {
      name: "Order package",
      description: "Checkout order package",
      unit_weight: unitWeight,
      weight: unitWeight,
      quantity,
      unit_quantity: quantity,
      amount,
      unit_amount: amount,
      value: amount,
    },
  ]
}

const collectShipmentCandidates = (response: JsonRecord): JsonRecord[] => {
  const root = toRecord(response)
  const data = toRecord(root.data)
  const nestedData = toRecord(data.data)

  const recordCandidates = [
    root,
    data,
    nestedData,
    toRecord(root.shipment),
    toRecord(data.shipment),
    toRecord(nestedData.shipment),
    toRecord(root.order),
    toRecord(data.order),
    toRecord(nestedData.order),
    toRecord(root.label),
    toRecord(data.label),
  ]

  const arrayCandidates = [
    ...toArray<JsonRecord>(root.results),
    ...toArray<JsonRecord>(root.shipments),
    ...toArray<JsonRecord>(root.labels),
    ...toArray<JsonRecord>(data.results),
    ...toArray<JsonRecord>(data.shipments),
    ...toArray<JsonRecord>(data.labels),
    ...toArray<JsonRecord>(data.data),
    ...toArray<JsonRecord>(nestedData.results),
    ...toArray<JsonRecord>(nestedData.shipments),
    ...toArray<JsonRecord>(nestedData.labels),
  ]

  return [...recordCandidates, ...arrayCandidates].filter(
    (entry) => Object.keys(entry).length > 0
  )
}

export class ShipbubbleClient {
  constructor(private readonly config: ShipbubbleRuntimeConfig) {}

  get isEnabled() {
    return this.config.enabled
  }

  private getHeaders() {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.config.apiKey}`,
      "x-api-key": this.config.apiKey,
    }
  }

  private async parseJson(response: Response): Promise<JsonRecord> {
    try {
      const payload = (await response.json()) as JsonRecord
      return payload ?? {}
    } catch {
      return {}
    }
  }

  private async requestWithFallback(
    paths: string[],
    payloadOrPayloads: JsonRecord | JsonRecord[]
  ): Promise<JsonRecord> {
    const payloads = Array.isArray(payloadOrPayloads)
      ? payloadOrPayloads
      : [payloadOrPayloads]
    let lastError: Error | null = null

    for (const payload of payloads) {
      for (const path of paths) {
        const controller = new AbortController()
        const timeout = setTimeout(() => {
          controller.abort()
        }, this.config.timeoutMs)

        try {
          const endpoint = new URL(path, this.config.apiBaseUrl).toString()
          const response = await fetch(endpoint, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(payload),
            signal: controller.signal,
          })

          clearTimeout(timeout)

          const data = await this.parseJson(response)

          if (!response.ok) {
            const details = pickFirstString([
              data.message,
              data.error,
              data.details,
              data.status_message,
              data.data?.message,
              response.statusText,
            ])

            const errorMessage = `ShipBubble request failed (${response.status}) [${endpoint}]: ${details ?? "Unknown error"}`

            // Only fallback for not-found/method mismatch endpoints.
            // For auth/validation/server errors, fail fast with the real reason.
            if (response.status !== 404 && response.status !== 405) {
              throw new Error(errorMessage)
            }

            lastError = new Error(errorMessage)
            continue
          }

          return data
        } catch (error) {
          clearTimeout(timeout)
          lastError =
            error instanceof Error
              ? error
              : new Error("ShipBubble request failed")
        }
      }
    }

    throw lastError ?? new Error("Unable to reach ShipBubble API")
  }

  private async requestGet(path: string): Promise<JsonRecord> {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, this.config.timeoutMs)

    try {
      const endpoint = new URL(path, this.config.apiBaseUrl).toString()
      const response = await fetch(endpoint, {
        method: "GET",
        headers: this.getHeaders(),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      const data = await this.parseJson(response)

      if (!response.ok) {
        const details = pickFirstString([
          data.message,
          data.error,
          data.details,
          data.status_message,
          data.data?.message,
          response.statusText,
        ])

        throw new Error(
          `ShipBubble request failed (${response.status}) [${endpoint}]: ${details ?? "Unknown error"}`
        )
      }

      return data
    } catch (error) {
      clearTimeout(timeout)
      throw error instanceof Error ? error : new Error("ShipBubble request failed")
    }
  }

  async validateAddress(
    address: ShipbubbleAddress
  ): Promise<ShipbubbleAddressValidationResult> {
    const normalizedAddress = toShipbubbleAddressPayload(address)
    const payload = {
      ...normalizedAddress,
      // Official endpoint expects a flattened address payload.
      address:
        normalizedAddress.address ||
        normalizedAddress.address_1 ||
        address.address_line_1,
      destination: normalizedAddress,
      receiver_address: normalizedAddress,
    }

    const response = await this.requestWithFallback(
      SHIPBUBBLE_ADDRESS_VALIDATION_PATHS,
      payload
    )

    const valid =
      pickFirstBoolean([
        response.valid,
        response.is_valid,
        response.data?.valid,
        response.data?.is_valid,
        response.status,
      ]) ?? true

    const serviceable =
      pickFirstBoolean([
        response.serviceable,
        response.is_serviceable,
        response.data?.serviceable,
        response.data?.is_serviceable,
      ]) ?? valid

    const addressCode = pickFirstNumber([
      response.address_code,
      response.data?.address_code,
      response.data?.data?.address_code,
      response.data?.results?.[0]?.address_code,
      response.results?.[0]?.address_code,
    ])

    return {
      valid,
      serviceable,
      address_code: addressCode,
      message: pickFirstString([
        response.message,
        response.data?.message,
        response.error,
      ]),
      raw: response,
    }
  }

  async getRates(input: ShipbubbleRatesInput): Promise<ShipbubbleRate[]> {
    const packageItems =
      input.package_items && input.package_items.length
        ? input.package_items
        : buildFallbackPackageItems({
            weight_kg: input.parcel.weight_kg,
            items_count: input.parcel.items_count,
          })

    const payload = {
      sender_address_code: input.sender_address_code,
      reciever_address_code: input.receiver_address_code,
      receiver_address_code: input.receiver_address_code,
      pickup_date: new Date().toISOString().slice(0, 10),
      category_id: input.category_id ?? 1,
      package_items: packageItems,
      package_dimension: {
        length: input.parcel.length_cm,
        width: input.parcel.width_cm,
        height: input.parcel.height_cm,
      },
      mode: input.mode,
      currency_code: input.currency_code,
      insurance_enabled: input.insurance_enabled,
      service_code:
        input.service_code && input.service_code !== "auto"
          ? input.service_code
          : undefined,
      courier_id:
        input.carrier_code && input.carrier_code !== "auto"
          ? input.carrier_code
          : undefined,
    }

    const response = await this.requestWithFallback(
      SHIPBUBBLE_RATE_PATHS,
      payload
    )

    const topLevelData = response.data as JsonRecord | undefined
    const nestedData = (topLevelData?.data as JsonRecord | undefined) ?? {}
    const shippingData = (topLevelData?.shipping as JsonRecord | undefined) ?? {}
    const cheapestCourier =
      (response.cheapest_courier as JsonRecord | undefined) ??
      (topLevelData?.cheapest_courier as JsonRecord | undefined) ??
      (nestedData?.cheapest_courier as JsonRecord | undefined) ??
      (shippingData?.cheapest_courier as JsonRecord | undefined)
    const fastestCourier =
      (response.fastest_courier as JsonRecord | undefined) ??
      (topLevelData?.fastest_courier as JsonRecord | undefined) ??
      (nestedData?.fastest_courier as JsonRecord | undefined) ??
      (shippingData?.fastest_courier as JsonRecord | undefined)
    const bestValueCourier =
      (response.best_value_courier as JsonRecord | undefined) ??
      (topLevelData?.best_value_courier as JsonRecord | undefined) ??
      (nestedData?.best_value_courier as JsonRecord | undefined) ??
      (shippingData?.best_value_courier as JsonRecord | undefined)
    const requestToken = pickFirstString([
      response.request_token,
      topLevelData?.request_token,
      nestedData?.request_token,
      shippingData?.request_token,
    ])

    const candidates = [
      ...toArray<JsonRecord>(response.rates),
      ...toArray<JsonRecord>(response.couriers),
      ...toArray<JsonRecord>(response.shipping_options),
      ...toArray<JsonRecord>(topLevelData?.rates),
      ...toArray<JsonRecord>(topLevelData?.couriers),
      ...toArray<JsonRecord>(topLevelData?.shipping_options),
      ...toArray<JsonRecord>(topLevelData?.shipments),
      ...toArray<JsonRecord>(nestedData?.rates),
      ...toArray<JsonRecord>(nestedData?.couriers),
      ...toArray<JsonRecord>(shippingData?.rates),
      ...toArray<JsonRecord>(shippingData?.couriers),
      ...toArray<JsonRecord>(shippingData?.shipments),
    ]

    const rates: ShipbubbleRate[] = []

    for (const rate of candidates) {
      const amount = pickFirstNumber([
        rate.amount,
        rate.price,
        rate.total,
        rate.fee,
        rate.cost,
        rate.total_amount,
        rate.amount_charged,
      ])

      if (amount === undefined) {
        continue
      }

      rates.push({
        courier_id: pickFirstString([
          rate.courier_id,
          rate.courier?.id,
          rate.provider_id,
          rate.carrier_code,
          rate.courier_code,
        ]),
        courier_name: pickFirstString([
          rate.courier_name,
          rate.courier?.name,
          rate.provider_name,
        ]),
        carrier_code:
          pickFirstString([
            rate.carrier_code,
            rate.courier_code,
            rate.provider_code,
            rate.courier?.code,
            rate.courier?.id,
            rate.courier_id,
            rate.provider_id,
          ]) ?? "auto",
        service_code:
          pickFirstString([
            rate.service_code,
            rate.code,
            rate.service?.code,
            rate.shipment_code,
          ]) ?? "auto",
        service_name:
          pickFirstString([
            rate.service_name,
            rate.name,
            rate.service?.name,
            rate.courier_name,
            rate.courier?.name,
          ]) ?? "ShipBubble",
        mode:
          (pickFirstString([rate.mode]) as ShipbubbleRate["mode"]) ?? input.mode,
        insurance_enabled:
          pickFirstBoolean([rate.insurance_enabled]) ?? input.insurance_enabled,
        amount,
        currency_code:
          pickFirstString([
            rate.currency_code,
            rate.currency,
            topLevelData?.currency_code,
          ]) ?? input.currency_code,
        eta_days: pickFirstNumber([rate.eta_days, rate.eta, rate.duration]),
        delivery_eta: pickFirstString([rate.delivery_eta, rate.eta_text]),
        delivery_eta_time: pickFirstString([
          rate.delivery_eta_time,
          rate.delivery_time,
          rate.eta_timestamp,
        ]),
        pickup_eta: pickFirstString([rate.pickup_eta]),
        pickup_eta_time: pickFirstString([rate.pickup_eta_time]),
        request_token: requestToken,
        raw: {
          ...rate,
          request_token: requestToken,
        },
      })
    }

    rates.sort((a, b) => a.amount - b.amount)

    if (!rates.length) {
      throw new Error("ShipBubble did not return any rates")
    }

    for (const rate of rates) {
      rate.quote_id = buildQuoteId(rate)
      rate.is_cheapest = markerMatchesRate(cheapestCourier, rate)
      rate.is_fastest = markerMatchesRate(fastestCourier, rate)
      rate.is_best_value = markerMatchesRate(bestValueCourier, rate)
    }

    return rates
  }

  async getPackageCategories(): Promise<number[]> {
    const categories: number[] = []

    for (const path of SHIPBUBBLE_PACKAGE_CATEGORY_PATHS) {
      try {
        const response = await this.requestGet(path)
        const candidates = [
          ...toArray<JsonRecord>(response.data),
          ...toArray<JsonRecord>(response.data?.data),
          ...toArray<JsonRecord>(response.categories),
        ]

        for (const category of candidates) {
          const categoryId = pickFirstNumber([
            category.category_id,
            category.id,
          ])

          if (categoryId && categoryId > 0) {
            categories.push(categoryId)
          }
        }

        if (categories.length) {
          break
        }
      } catch {
        continue
      }
    }

    return [...new Set(categories)]
  }

  async createShipment(
    input: ShipbubbleBookShipmentInput
  ): Promise<ShipbubbleShipmentResult> {
    const senderAddress = toShipbubbleAddressPayload(input.sender)
    const receiverAddress = toShipbubbleAddressPayload(input.receiver)
    const packageItems =
      input.package_items && input.package_items.length
        ? input.package_items
        : buildFallbackPackageItems({
            weight_kg: input.parcel.weight_kg,
            items_count: input.parcel.items_count,
          })

    const payloads = [
      {
        sender_address_code: input.sender_address_code,
        reciever_address_code: input.receiver_address_code,
        receiver_address_code: input.receiver_address_code,
        pickup_date: new Date().toISOString().slice(0, 10),
        category_id: input.category_id ?? 1,
        package_items: packageItems,
        package_dimension: {
          length: input.parcel.length_cm,
          width: input.parcel.width_cm,
          height: input.parcel.height_cm,
        },
        service_code: input.service_code,
        courier_id: input.courier_id || input.carrier_code,
        request_token: input.request_token,
        insurance_enabled: input.insurance_enabled,
        order_reference: input.order_reference,
        reference: input.order_reference,
      },
      {
        from: senderAddress,
        sender_address: senderAddress,
        pickup_address: senderAddress,
        to: receiverAddress,
        receiver_address: receiverAddress,
        delivery_address: receiverAddress,
        parcel: {
          weight: input.parcel.weight_kg,
          weight_kg: input.parcel.weight_kg,
          length: input.parcel.length_cm,
          length_cm: input.parcel.length_cm,
          width: input.parcel.width_cm,
          width_cm: input.parcel.width_cm,
          height: input.parcel.height_cm,
          height_cm: input.parcel.height_cm,
          quantity: input.parcel.items_count,
        },
        carrier_code: input.carrier_code,
        service_code: input.service_code,
        service_name: input.service_name,
        mode: input.mode,
        insurance_enabled: input.insurance_enabled,
        order_reference: input.order_reference,
        reference: input.order_reference,
      },
    ]

    const response = await this.requestWithFallback(
      SHIPBUBBLE_SHIPMENT_PATHS,
      payloads
    )

    const candidates = collectShipmentCandidates(response)
    const valuesFromCandidates = (keys: string[]) =>
      candidates.flatMap((candidate) => keys.map((key) => candidate[key]))

    let shipbubbleShipmentId = pickFirstString([
      response.shipment_id,
      response.id,
      response.reference,
      response.order_reference,
      response.data?.shipment_id,
      response.data?.id,
      ...valuesFromCandidates([
        "shipment_id",
        "id",
        "reference",
        "order_reference",
        "order_id",
        "label_id",
        "waybill",
        "awb",
      ]),
    ])

    let trackingNumber = pickFirstString([
      response.tracking_number,
      response.tracking_no,
      response.waybill,
      response.awb,
      response.data?.tracking_number,
      response.data?.tracking_no,
      response.data?.waybill,
      response.data?.awb,
      ...valuesFromCandidates([
        "tracking_number",
        "tracking_no",
        "tracking",
        "tracking_id",
        "waybill",
        "awb",
      ]),
    ])

    // Some successful label bookings return only one of these fields.
    if (!shipbubbleShipmentId && trackingNumber) {
      shipbubbleShipmentId = trackingNumber
    }

    if (!trackingNumber && shipbubbleShipmentId) {
      trackingNumber = shipbubbleShipmentId
    }

    if (!shipbubbleShipmentId || !trackingNumber) {
      const rootKeys = Object.keys(toRecord(response)).slice(0, 15).join(", ")
      const dataKeys = Object.keys(toRecord(response.data)).slice(0, 15).join(", ")
      throw new Error(
        `ShipBubble shipment booking returned incomplete data (root keys: ${rootKeys || "none"}; data keys: ${dataKeys || "none"})`
      )
    }

    return {
      shipbubble_shipment_id: shipbubbleShipmentId,
      tracking_number: trackingNumber,
      tracking_url: pickFirstString([
        response.tracking_url,
        response.tracking_link,
        response.data?.tracking_url,
        response.data?.tracking_link,
        ...valuesFromCandidates([
          "tracking_url",
          "tracking_link",
          "tracking_page",
          "tracking_page_url",
        ]),
      ]),
      label_url: pickFirstString([
        response.label_url,
        response.label,
        response.data?.label_url,
        response.data?.label,
        ...valuesFromCandidates([
          "label_url",
          "label",
          "label_link",
          "label_download_url",
          "label_pdf_url",
          "waybill_url",
        ]),
      ]),
      raw: response,
    }
  }
}
