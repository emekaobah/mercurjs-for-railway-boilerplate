import { createOrderShipmentWorkflow } from "@medusajs/medusa/core-flows"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import ShipbubbleFulfillmentProviderService, {
  getShipbubbleRuntimeConfig,
} from "../../../../../../../modules/shipbubble/service"
import {
  normalizeAddress,
} from "../../../../../../../modules/shipbubble/utils/address"
import { buildPackageFromItems } from "../../../../../../../modules/shipbubble/utils/package"
import {
  ShipbubbleFulfillmentMetadata,
  ShipbubbleShippingOptionData,
} from "../../../../../../../modules/shipbubble/types"

type VendorShipmentLabel = {
  tracking_number: string
  tracking_url: string
  label_url: string
}

type ShipbubbleSelectedQuote = {
  quote_id?: string
  courier_id?: string
  carrier_code?: string
  service_code?: string
  service_name?: string
  request_token?: string
}

type VendorOrderCreateShipmentBody = {
  items: Array<{
    id: string
    quantity: number
  }>
  labels?: VendorShipmentLabel[]
}

type VendorShipmentItemInput = {
  id: string
  quantity: number
}

const isShipbubbleProvider = (providerId: string | undefined) =>
  providerId?.toLowerCase().includes("shipbubble")

const normalizeShipbubbleOptionData = (
  data: Record<string, unknown> = {}
): ShipbubbleShippingOptionData => {
  return {
    carrier_code:
      typeof data.carrier_code === "string" && data.carrier_code.trim().length
        ? data.carrier_code
        : "auto",
    service_code:
      typeof data.service_code === "string" && data.service_code.trim().length
        ? data.service_code
        : "auto",
    service_name:
      typeof data.service_name === "string" && data.service_name.trim().length
        ? data.service_name
        : "Auto Select",
    mode: data.mode === "pickup" ? "pickup" : "delivery",
    insurance_enabled: Boolean(data.insurance_enabled),
  }
}

const getFulfillmentById = (
  order: Record<string, any>,
  fulfillmentId: string
): Record<string, any> | null => {
  return (
    ((order.fulfillments as Array<Record<string, any>> | undefined) || []).find(
      (fulfillment) => fulfillment.id === fulfillmentId
    ) ?? null
  )
}

const toNonEmptyString = (value: unknown): string => {
  if (typeof value !== "string") {
    return ""
  }

  return value.trim()
}

const toPositiveIntegerOrNull = (value: unknown): number | null => {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

const normalizeShipmentLabels = (
  labels: unknown
): VendorShipmentLabel[] => {
  if (!Array.isArray(labels)) {
    return []
  }

  const normalized: VendorShipmentLabel[] = []

  for (const label of labels) {
    const entry = (label || {}) as Record<string, unknown>
    const trackingNumber = toNonEmptyString(entry.tracking_number)
    const trackingUrl = toNonEmptyString(entry.tracking_url)
    const labelUrl = toNonEmptyString(entry.label_url)

    if (!trackingNumber) {
      continue
    }

    normalized.push({
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      label_url: labelUrl,
    })
  }

  return normalized
}

const normalizeShipmentItems = (
  items: unknown
): VendorShipmentItemInput[] => {
  if (!Array.isArray(items)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "`items` must be a non-empty array."
    )
  }

  const normalized: VendorShipmentItemInput[] = []

  for (const item of items) {
    const entry = (item || {}) as Record<string, unknown>
    const id = toNonEmptyString(entry.id)
    const quantity = toPositiveIntegerOrNull(entry.quantity)

    if (!id || !quantity) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Each shipment item must include a valid `id` and positive integer `quantity`."
      )
    }

    normalized.push({
      id,
      quantity,
    })
  }

  if (!normalized.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "At least one shipment item is required."
    )
  }

  return normalized
}

const assertShipmentItemsMatchFulfillment = (
  requestedItems: VendorShipmentItemInput[],
  fulfillment: Record<string, any> | null
) => {
  const fulfillmentItems = Array.isArray(fulfillment?.items)
    ? (fulfillment?.items as Array<Record<string, unknown>>)
    : []

  if (!fulfillmentItems.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The selected fulfillment has no items to ship."
    )
  }

  const fulfillmentQtyByLineItemId = new Map<string, number>()

  for (const item of fulfillmentItems) {
    const lineItemId = toNonEmptyString((item as any)?.line_item_id)
    const quantity = Number((item as any)?.quantity || 0)

    if (!lineItemId || !Number.isFinite(quantity) || quantity <= 0) {
      continue
    }

    fulfillmentQtyByLineItemId.set(lineItemId, quantity)
  }

  if (!fulfillmentQtyByLineItemId.size) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Unable to resolve line items for the selected fulfillment."
    )
  }

  for (const item of requestedItems) {
    const maxQty = fulfillmentQtyByLineItemId.get(item.id)

    if (!maxQty) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Line item ${item.id} does not belong to the selected fulfillment.`
      )
    }

    if (item.quantity > maxQty) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Line item ${item.id} quantity exceeds the fulfillment quantity.`
      )
    }
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const body = ((req.validatedBody as any) ?? (req.body as any) ?? {}) as VendorOrderCreateShipmentBody
  const normalizedItems = normalizeShipmentItems(body.items)
  const fallbackLabels = normalizeShipmentLabels(body.labels)

  const {
    data: [order],
  } = await query.graph(
    {
      entity: "order",
      fields: [
        "id",
        "display_id",
        "currency_code",
        "shipping_address.*",
        "items.*",
        "items.variant.*",
        "fulfillments.*",
        "fulfillments.items.*",
        "fulfillments.labels.*",
        "shipping_methods.*",
      ],
      filters: {
        id: req.params.id,
      },
    },
    {
      throwIfKeyNotFound: true,
    }
  )

  const fulfillment = getFulfillmentById(order, req.params.fulfillment_id)
  if (!fulfillment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Fulfillment not found on order."
    )
  }

  if (fulfillment.shipped_at || fulfillment.delivered_at) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This fulfillment has already been shipped."
    )
  }

  assertShipmentItemsMatchFulfillment(normalizedItems, fulfillment)

  const fulfillmentProviderId = String(fulfillment?.provider_id || "")
  const shouldUseShipbubble = isShipbubbleProvider(fulfillmentProviderId)

  let labels = fallbackLabels
  let metadata: ShipbubbleFulfillmentMetadata | undefined

  if (shouldUseShipbubble) {
    const existingMetadata = (fulfillment.metadata || {}) as Record<
      string,
      unknown
    >
    const existingShipmentId = toNonEmptyString(
      existingMetadata.shipbubble_shipment_id
    )

    if (existingShipmentId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A ShipBubble shipment is already linked to this fulfillment."
      )
    }

    const shipbubbleConfig = getShipbubbleRuntimeConfig()
    const shipbubbleService = new ShipbubbleFulfillmentProviderService(
      { logger },
      shipbubbleConfig
    )

    const shippingMethods =
      (order.shipping_methods as Array<Record<string, unknown>> | undefined) || []
    const shippingOptionIds = [...new Set(
      shippingMethods
        .map((method) => toNonEmptyString(method.shipping_option_id))
        .filter(Boolean)
    )]

    const shippingOptionsById = new Map<string, Record<string, unknown>>()

    if (shippingOptionIds.length) {
      const { data: shippingOptions } = await query.graph({
        entity: "shipping_option",
        fields: [
          "id",
          "provider_id",
          "data",
          "service_zone.fulfillment_set.location.id",
        ],
        filters: {
          id: shippingOptionIds as any,
        },
      })

      for (const option of shippingOptions || []) {
        const optionId = toNonEmptyString((option as any)?.id)
        if (!optionId) {
          continue
        }

        shippingOptionsById.set(optionId, option as Record<string, unknown>)
      }
    }

    const fulfillmentLocationId = toNonEmptyString(fulfillment?.location_id)
    let shippingOptionId = toNonEmptyString(fulfillment?.shipping_option_id)

    if (!shippingOptionId && shippingOptionIds.length) {
      const shipbubbleLocationMatchedOptionId = shippingOptionIds.find((optionId) => {
        const option = shippingOptionsById.get(optionId) || {}
        const providerId = toNonEmptyString(option.provider_id)
        const optionLocationId = toNonEmptyString(
          (option as any)?.service_zone?.fulfillment_set?.location?.id
        )

        return (
          isShipbubbleProvider(providerId) &&
          !!fulfillmentLocationId &&
          optionLocationId === fulfillmentLocationId
        )
      })

      const firstShipbubbleOptionId = shippingOptionIds.find((optionId) => {
        const option = shippingOptionsById.get(optionId) || {}
        return isShipbubbleProvider(toNonEmptyString(option.provider_id))
      })

      shippingOptionId =
        shipbubbleLocationMatchedOptionId ||
        firstShipbubbleOptionId ||
        shippingOptionIds[0] ||
        ""
    }

    let shippingOptionData: ShipbubbleShippingOptionData = {
      carrier_code: "auto",
      service_code: "auto",
      service_name: "Auto Select",
      mode: "delivery",
      insurance_enabled: false,
    }
    let selectedQuote: ShipbubbleSelectedQuote | undefined

    if (shippingOptionId) {
      const shippingOption =
        shippingOptionsById.get(shippingOptionId) ||
        (
          await query.graph({
            entity: "shipping_option",
            fields: ["id", "provider_id", "data"],
            filters: {
              id: shippingOptionId,
            },
          })
        ).data?.[0]

      if (shippingOption?.data) {
        shippingOptionData = normalizeShipbubbleOptionData(
          shippingOption.data as Record<string, unknown>
        )
      }
    }

    const selectedShippingMethod =
      shippingMethods.find(
        (method) => String(method.shipping_option_id || "") === String(shippingOptionId || "")
      ) || shippingMethods[0]
    const shippingMethodData = (selectedShippingMethod?.data || {}) as Record<
      string,
      unknown
    >

    if (shippingMethodData.shipbubble_quote) {
      selectedQuote = shippingMethodData.shipbubble_quote as ShipbubbleSelectedQuote
    }

    if (selectedQuote) {
      shippingOptionData = {
        ...shippingOptionData,
        carrier_code:
          selectedQuote.courier_id ||
          selectedQuote.carrier_code ||
          shippingOptionData.carrier_code,
        service_code: selectedQuote.service_code || shippingOptionData.service_code,
        service_name: selectedQuote.service_name || shippingOptionData.service_name,
      }
    }

    if (shippingOptionData.mode === "pickup") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "ShipBubble pickup fulfillments must be completed with 'Mark as picked up', not shipment booking."
      )
    }

    try {
      if ((order.currency_code || "").toLowerCase() !== "ngn") {
        throw new Error("ShipBubble shipment booking is only supported for NGN")
      }

      const {
        data: [stockLocation],
      } = await query.graph({
        entity: "stock_location",
        fields: ["id", "name", "*address"],
        filters: {
          id: fulfillment?.location_id,
        },
      })

      const senderAddress = normalizeAddress(
        (stockLocation?.address || null) as Record<string, unknown> | null
      )
      const receiverAddress = normalizeAddress(
        (order.shipping_address || null) as Record<string, unknown> | null
      )

      const sender = (senderAddress || {}) as NonNullable<typeof senderAddress>
      const receiver = (receiverAddress || {}) as NonNullable<typeof receiverAddress>

      const itemQtyMap = new Map(
        normalizedItems.map((item) => [item.id, Number(item.quantity) || 0])
      )

      const packageItems = ((order.items as Array<Record<string, unknown>>) || [])
        .filter((item) => itemQtyMap.has(String(item.id)))
        .map((item) => {
          return {
            ...item,
            quantity: itemQtyMap.get(String(item.id)) || 0,
          }
        })

      const parcel = buildPackageFromItems(packageItems, {
        weightKg: shipbubbleConfig.defaultWeightKg,
        lengthCm: shipbubbleConfig.defaultLengthCm,
        widthCm: shipbubbleConfig.defaultWidthCm,
        heightCm: shipbubbleConfig.defaultHeightCm,
      })

      const shipment = await shipbubbleService.bookShipment({
        sender,
        receiver,
        parcel,
        carrier_code: shippingOptionData.carrier_code,
        service_code: shippingOptionData.service_code,
        service_name: shippingOptionData.service_name,
        mode: shippingOptionData.mode,
        insurance_enabled: shippingOptionData.insurance_enabled,
        order_reference: String(order.id),
        ...(selectedQuote?.request_token
          ? { request_token: selectedQuote.request_token }
          : {}),
      })

      labels = [
        {
          tracking_number: shipment.tracking_number,
          tracking_url: shipment.tracking_url || "",
          label_url: shipment.label_url || "",
        },
      ]

      metadata = {
        shipbubble_shipment_id: shipment.shipbubble_shipment_id,
        tracking_number: shipment.tracking_number,
        tracking_url: shipment.tracking_url || null,
        label_url: shipment.label_url || null,
        shipbubble_mode: shippingOptionData.mode,
        shipbubble_booking_failed: false,
        shipbubble_booking_failed_at: null,
        shipbubble_booking_error: null,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      logger.warn(
        `ShipBubble booking failed for fulfillment ${req.params.fulfillment_id}: ${message}`
      )

      if (!fallbackLabels.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `ShipBubble booking failed: ${message}`
        )
      }

      labels = fallbackLabels
      metadata = {
        shipbubble_booking_failed: true,
        shipbubble_booking_failed_at: new Date().toISOString(),
        shipbubble_booking_error: message,
      }
    }
  }

  await createOrderShipmentWorkflow.run({
    container: req.scope,
    input: {
      ...body,
      items: normalizedItems,
      order_id: req.params.id,
      fulfillment_id: req.params.fulfillment_id,
      labels,
      ...(metadata ? { metadata } : {}),
    },
  })

  const {
    data: [updatedOrder],
  } = await query.graph({
    entity: "order",
    fields: req.queryConfig.fields,
    filters: {
      id: req.params.id,
    },
  })

  res.json({ order: updatedOrder })
}
