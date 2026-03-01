import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import ShipbubbleFulfillmentProviderService, {
  getShipbubbleRuntimeConfig,
} from "../../../../modules/shipbubble/service"
import { ShipbubbleShippingOptionData } from "../../../../modules/shipbubble/types"

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

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const cartId = String(req.query.cart_id || "").trim()
  const shippingOptionId = String(req.query.shipping_option_id || "").trim()
  const strategy = String(req.query.strategy || "").trim()

  if (!cartId || !shippingOptionId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "cart_id and shipping_option_id are required"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const {
    data: [cart],
  } = await query.graph(
    {
      entity: "cart",
      fields: [
        "id",
        "currency_code",
        "shipping_address.*",
        "items.*",
        "items.variant.*",
      ],
      filters: {
        id: cartId,
      },
    },
    {
      throwIfKeyNotFound: true,
    }
  )

  const {
    data: [shippingOption],
  } = await query.graph(
    {
      entity: "shipping_option",
      fields: [
        "id",
        "name",
        "provider_id",
        "data",
        "service_zone.fulfillment_set.location.address.*",
      ],
      filters: {
        id: shippingOptionId,
      },
    },
    {
      throwIfKeyNotFound: true,
    }
  )

  if (!isShipbubbleProvider(shippingOption?.provider_id)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "shipping_option_id is not a ShipBubble option"
    )
  }

  const shipbubbleService = new ShipbubbleFulfillmentProviderService(
    { logger },
    getShipbubbleRuntimeConfig()
  )
  const optionData = normalizeShipbubbleOptionData(
    (shippingOption?.data || {}) as Record<string, unknown>
  )

  const context = {
    currency_code: cart.currency_code,
    from_location: {
      address: shippingOption?.service_zone?.fulfillment_set?.location?.address,
    },
    shipping_address: cart.shipping_address,
    items: cart.items,
  }

  const { quotes, recommended_quote_id, strategy: resolvedStrategy } =
    await shipbubbleService.getDynamicQuotes(optionData as any, context as any, {
      shipbubble_strategy: strategy || undefined,
    })

  res.json({
    shipping_option_id: shippingOptionId,
    strategy: resolvedStrategy,
    recommended_quote_id,
    quotes,
  })
}
