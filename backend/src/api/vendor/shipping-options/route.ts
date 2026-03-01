import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { IntermediateEvents } from "@mercurjs/framework"

type VendorCreateShippingOptionBody = {
  name: string
  service_zone_id: string
  shipping_profile_id: string
  provider_id: string
  prices: Array<Record<string, unknown>>
  type: Record<string, unknown>
  data?: Record<string, unknown>
  rules?: Array<Record<string, unknown>>
  price_type?: "flat" | "calculated"
}

const isShipbubbleProvider = (providerId: string | undefined) =>
  providerId?.toLowerCase().includes("shipbubble")

const normalizeShipbubbleOptionData = (
  data: Record<string, unknown> = {}
): Record<string, unknown> => {
  return {
    ...data,
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

const fetchSellerByAuthActorId = async (
  authActorId: string | undefined,
  scope: MedusaRequest["scope"]
): Promise<{ id: string }> => {
  if (!authActorId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Missing vendor actor context"
    )
  }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const {
    data: [seller],
  } = await query.graph({
    entity: "seller",
    fields: ["id"],
    filters: {
      members: {
        id: authActorId,
      },
    },
  })

  if (!seller?.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Unable to resolve seller for current vendor"
    )
  }

  return seller
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK)
  const seller = await fetchSellerByAuthActorId(
    (req as any).auth_context?.actor_id,
    req.scope
  )

  const body = req.validatedBody as VendorCreateShippingOptionBody
  const isShipbubble = isShipbubbleProvider(body.provider_id)

  const priceType =
    body.price_type ?? (isShipbubble ? "calculated" : "flat")

  const {
    result: [created],
  } = await createShippingOptionsWorkflow(req.scope).run({
    input: [
      {
        ...body,
        price_type: priceType,
        data: isShipbubble
          ? normalizeShipbubbleOptionData(body.data)
          : body.data,
      } as any,
    ],
  })

  await remoteLink.create({
    seller: {
      seller_id: seller.id,
    },
    [Modules.FULFILLMENT]: {
      shipping_option_id: created.id,
    },
  })

  const eventBus = req.scope.resolve(Modules.EVENT_BUS)
  await eventBus.emit({
    name: IntermediateEvents.SHIPPING_OPTION_CHANGED,
    data: { id: created.id },
  })

  const {
    data: [shipping_option],
  } = await query.graph(
    {
      entity: "shipping_option",
      fields: req.queryConfig.fields,
      filters: { id: created.id },
    },
    {
      throwIfKeyNotFound: true,
    }
  )

  res.status(201).json({ shipping_option })
}
