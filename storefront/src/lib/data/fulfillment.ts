"use server"

import { sdk } from "@/lib/config"
import { HttpTypes } from "@medusajs/types"
import { getAuthHeaders, getCacheOptions } from "./cookies"
import { StoreCardShippingMethod } from "@/components/sections/CartShippingMethodsSection/CartShippingMethodsSection"

export type ShipbubbleQuote = {
  quote_id: string
  courier_id?: string
  courier_name?: string
  carrier_code: string
  service_code: string
  service_name: string
  amount: number
  currency_code: string
  eta_days?: number
  delivery_eta?: string
  delivery_eta_time?: string
  is_cheapest?: boolean
  is_fastest?: boolean
  is_best_value?: boolean
  request_token?: string
}

export type ShipbubbleQuotesResponse = {
  shipping_option_id: string
  strategy: "best_value" | "cheapest" | "fastest" | "all"
  recommended_quote_id: string
  quotes: ShipbubbleQuote[]
}

export const listCartShippingMethods = async (
  cartId: string,
  is_return: boolean = false
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("fulfillment")),
  }

  return sdk.client
    .fetch<{ shipping_options: StoreCardShippingMethod[] | null }>(
      `/store/shipping-options`,
      {
        method: "GET",
        query: {
          cart_id: cartId,
          fields:
            "+service_zone.fulfllment_set.type,*service_zone.fulfillment_set.location.address",
        },
        headers,
        next,
        cache: "no-cache",
      }
    )
    .then(({ shipping_options }) => shipping_options)
    .catch(() => {
      return null
    })
}

export const calculatePriceForShippingOption = async (
  optionId: string,
  cartId: string,
  data?: Record<string, unknown>
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("fulfillment")),
  }

  const body = { cart_id: cartId, data }

  if (data) {
    body.data = data
  }

  return sdk.client
    .fetch<{ shipping_option: HttpTypes.StoreCartShippingOption }>(
      `/store/shipping-options/${optionId}/calculate`,
      {
        method: "POST",
        body,
        headers,
        next,
      }
    )
    .then(({ shipping_option }) => shipping_option)
    .catch((e) => {
      return null
    })
}

export const listShipbubbleQuotes = async (
  cartId: string,
  shippingOptionId: string,
  strategy?: "best_value" | "cheapest" | "fastest" | "all"
) => {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const next = {
    ...(await getCacheOptions("fulfillment")),
  }

  return sdk.client
    .fetch<ShipbubbleQuotesResponse>("/store/shipbubble/quotes", {
      method: "GET",
      query: {
        cart_id: cartId,
        shipping_option_id: shippingOptionId,
        ...(strategy ? { strategy } : {}),
      },
      headers,
      next,
      cache: "no-cache",
    })
    .catch(() => null)
}
