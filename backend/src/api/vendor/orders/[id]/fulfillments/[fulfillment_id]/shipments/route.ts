import { createOrderShipmentWorkflow } from "@medusajs/medusa/core-flows"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import ShipbubbleFulfillmentProviderService, {
  getShipbubbleRuntimeConfig,
} from "../../../../../../../modules/shipbubble/service"
import {
  isAddressComplete,
  normalizeAddress,
} from "../../../../../../../modules/shipbubble/utils/address"
import { buildPackageFromItems } from "../../../../../../../modules/shipbubble/utils/package"
import {
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

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const body = req.validatedBody as VendorOrderCreateShipmentBody

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
  const fulfillmentProviderId = String(fulfillment?.provider_id || "")
  const shouldUseShipbubble = isShipbubbleProvider(fulfillmentProviderId)

  let labels = body.labels ?? []
  let metadata: Record<string, unknown> | undefined

  if (shouldUseShipbubble) {
    const shipbubbleConfig = getShipbubbleRuntimeConfig()
    const shipbubbleService = new ShipbubbleFulfillmentProviderService(
      { logger },
      shipbubbleConfig
    )

    const shippingOptionId =
      fulfillment?.shipping_option_id ||
      (order.shipping_methods as Array<Record<string, unknown>> | undefined)?.[0]
        ?.shipping_option_id

    let shippingOptionData: ShipbubbleShippingOptionData = {
      carrier_code: "auto",
      service_code: "auto",
      service_name: "Auto Select",
      mode: "delivery",
      insurance_enabled: false,
    }
    let selectedQuote: ShipbubbleSelectedQuote | undefined

    if (shippingOptionId) {
      const {
        data: [shippingOption],
      } = await query.graph({
        entity: "shipping_option",
        fields: ["id", "provider_id", "data"],
        filters: {
          id: shippingOptionId,
        },
      })

      if (shippingOption?.data) {
        shippingOptionData = normalizeShipbubbleOptionData(
          shippingOption.data as Record<string, unknown>
        )
      }
    }

    const shippingMethods =
      (order.shipping_methods as Array<Record<string, unknown>> | undefined) || []
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

      if (!isAddressComplete(senderAddress) || !isAddressComplete(receiverAddress)) {
        throw new Error(
          "ShipBubble requires complete stock-location and delivery addresses"
        )
      }

      const sender = senderAddress as NonNullable<typeof senderAddress>
      const receiver = receiverAddress as NonNullable<typeof receiverAddress>

      const itemQtyMap = new Map(
        body.items.map((item) => [item.id, Number(item.quantity) || 0])
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
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      logger.warn(
        `ShipBubble booking failed for fulfillment ${req.params.fulfillment_id}: ${message}`
      )
      labels = body.labels ?? []
    }
  }

  await createOrderShipmentWorkflow.run({
    container: req.scope,
    input: {
      ...body,
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
