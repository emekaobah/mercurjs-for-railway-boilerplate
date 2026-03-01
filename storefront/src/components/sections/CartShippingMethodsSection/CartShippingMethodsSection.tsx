"use client"

import ErrorMessage from "@/components/molecules/ErrorMessage/ErrorMessage"
import { removeShippingMethod, setShippingMethod } from "@/lib/data/cart"
import {
  calculatePriceForShippingOption,
  listCartShippingMethods,
  listShipbubbleQuotes,
  ShipbubbleQuote,
  ShipbubbleQuotesResponse,
} from "@/lib/data/fulfillment"
import { convertToLocale } from "@/lib/helpers/money"
import { CheckCircleSolid } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import { Heading, Text } from "@medusajs/ui"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/atoms"

// Extended cart item product type to include seller
type ExtendedStoreProduct = HttpTypes.StoreProduct & {
  seller?: {
    id: string
    name: string
  }
}

// Cart item type definition
type CartItem = {
  product?: ExtendedStoreProduct
  // Include other cart item properties as needed
}

export type StoreCardShippingMethod = HttpTypes.StoreCartShippingOption & {
  seller_id?: string
  seller_name?: string
  service_zone?: {
    fulfillment_set: {
      type: string
    }
  }
}

type ShippingProps = {
  cart: Omit<HttpTypes.StoreCart, "items"> & {
    items?: CartItem[]
  }
  availableShippingMethods:
    | (StoreCardShippingMethod & {
        rules: any
        seller_id: string
        price_type: string
        id: string
        amount?: number
      })[]
    | null
}

type DeliveryListOption = {
  value: string
  optionId: string
  name: string
  amount?: number
  priceType: string
  quote?: ShipbubbleQuote
  quoteId?: string
  recommended?: boolean
}

const isShipbubbleOption = (option: StoreCardShippingMethod) =>
  String((option as any).provider_id || "")
    .toLowerCase()
    .includes("shipbubble")

const SHIPBUBBLE_QUOTES_STRATEGY: "best_value" | "cheapest" | "fastest" | "all" =
  "all"
const SHIPPING_METHODS_CACHE_PREFIX = "checkout:shipping-methods:"
const SHIPBUBBLE_QUOTES_CACHE_PREFIX = "checkout:shipbubble-quotes:"

const parseDateLike = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed.length) {
    return null
  }

  const normalized = trimmed.includes("T")
    ? trimmed
    : trimmed.replace(" ", "T")
  const parsed = new Date(normalized)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed
}

const getQuoteTimelineLabel = (quote?: ShipbubbleQuote) => {
  if (!quote) {
    return null
  }

  const etaCandidate = quote.delivery_eta_time || quote.delivery_eta
  if (etaCandidate) {
    const parsed = parseDateLike(etaCandidate)
    if (parsed) {
      const timeText = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(parsed)
      const dateText = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(parsed)

      return `Expected delivery - ${timeText}, ${dateText}`
    }
  }

  if (quote.eta_days !== undefined && quote.eta_days !== null) {
    const dayLabel = quote.eta_days === 1 ? "day" : "days"
    return `Expected delivery - in ${quote.eta_days} ${dayLabel}`
  }

  return null
}

const CartShippingMethodsSection: React.FC<ShippingProps> = ({
  cart,
  availableShippingMethods,
}) => {
  const [liveShippingMethods, setLiveShippingMethods] = useState<
    StoreCardShippingMethod[] | null
  >(availableShippingMethods as StoreCardShippingMethod[] | null)
  const [isLoadingPrices, setIsLoadingPrices] = useState(false)
  const [calculatedPricesMap, setCalculatedPricesMap] = useState<
    Record<string, number>
  >({})
  const [shipbubbleQuotesMap, setShipbubbleQuotesMap] = useState<
    Record<string, ShipbubbleQuotesResponse>
  >({})
  const [selectedDeliveryValueMap, setSelectedDeliveryValueMap] = useState<
    Record<string, string>
  >({})
  const [isSubmittingBySeller, setIsSubmittingBySeller] = useState<
    Record<string, boolean>
  >({})
  const [error, setError] = useState<string | null>(null)
  const [missingModal, setMissingModal] = useState(false)
  const [missingShippingSellers, setMissingShippingSellers] = useState<
    string[]
  >([])

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const isOpen = searchParams.get("step") === "delivery"
  const isDeliveryComplete = (cart.shipping_methods?.length ?? 0) > 0

  const handleEdit = () => {
    router.push(pathname + "?step=delivery", { scroll: false })
  }

  const lastRequestValueBySellerRef = useRef<Record<string, string>>({})
  const hasAutoSelectedBySellerRef = useRef<Record<string, boolean>>({})

  const shippingMethods = useMemo(
    () =>
      (liveShippingMethods || []).filter(
        (sm) =>
          sm.rules?.find((rule: any) => rule.attribute === "is_return")
            ?.value !== "true"
      ),
    [liveShippingMethods]
  )

  useEffect(() => {
    if (typeof window === "undefined" || !cart.id || !shippingMethods.length) {
      return
    }

    window.localStorage.setItem(
      `${SHIPPING_METHODS_CACHE_PREFIX}${cart.id}`,
      JSON.stringify(shippingMethods)
    )
  }, [cart.id, shippingMethods])

  useEffect(() => {
    if (typeof window === "undefined" || !cart.id || shippingMethods.length) {
      return
    }

    const raw = window.localStorage.getItem(
      `${SHIPPING_METHODS_CACHE_PREFIX}${cart.id}`
    )
    if (!raw) {
      return
    }

    try {
      const cached = JSON.parse(raw) as StoreCardShippingMethod[]
      if (Array.isArray(cached) && cached.length) {
        setLiveShippingMethods(cached)
      }
    } catch {
      // Ignore malformed cache.
    }
  }, [cart.id, shippingMethods.length])

  useEffect(() => {
    if (availableShippingMethods?.length) {
      setLiveShippingMethods(availableShippingMethods as StoreCardShippingMethod[])
      return
    }

    if (!cart.id) {
      return
    }

    listCartShippingMethods(cart.id, false).then((methods) => {
      if (methods?.length) {
        setLiveShippingMethods(methods as StoreCardShippingMethod[])
      }
    })
  }, [availableShippingMethods, cart.id])

  const shipbubbleCalculatedOptions = useMemo(
    () =>
      (shippingMethods || []).filter(
        (sm) => sm.price_type === "calculated" && isShipbubbleOption(sm)
      ),
    [shippingMethods]
  )

  const appliedShippingOptionIds = useMemo(() => {
    return ((cart.shipping_methods || []) as Array<Record<string, unknown>>)
      .map((method) =>
        String(
          method.shipping_option_id ||
            (method.shipping_option as Record<string, unknown> | undefined)?.id ||
            ""
        )
      )
      .filter(Boolean)
  }, [cart.shipping_methods])

  const shipbubbleOptionsKey = useMemo(
    () =>
      shipbubbleCalculatedOptions
        .map((option) => option.id)
        .sort()
        .join("|"),
    [shipbubbleCalculatedOptions]
  )
  const appliedShippingOptionIdsKey = useMemo(
    () => [...new Set(appliedShippingOptionIds)].sort().join("|"),
    [appliedShippingOptionIds]
  )

  const shipbubbleQuotesKey = useMemo(
    () => Object.keys(shipbubbleQuotesMap).sort().join("|"),
    [shipbubbleQuotesMap]
  )

  useEffect(() => {
    const set = new Set<string>()
    cart.items?.forEach((item) => {
      if (item?.product?.seller?.id) {
        set.add(item.product.seller.id)
      }
    })

    const sellerMethods = shippingMethods?.map(({ seller_id }) => seller_id)

    const missingSellerIds = [...set].filter(
      (sellerId) => !sellerMethods?.includes(sellerId)
    )

    setMissingShippingSellers(Array.from(missingSellerIds))

    if (missingSellerIds.length > 0 && !cart.shipping_methods?.length) {
      setMissingModal(true)
    }
  }, [cart, shippingMethods])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    if (shippingMethods?.length) {
      const promises = shippingMethods
        .filter((sm) => sm.price_type === "calculated" && !isShipbubbleOption(sm))
        .map((sm) => calculatePriceForShippingOption(sm.id, cart.id))

      if (promises.length) {
        setIsLoadingPrices(true)
        Promise.allSettled(promises).then((res) => {
          const pricesMap: Record<string, number> = {}
          res
            .filter((r) => r.status === "fulfilled")
            .forEach((p) => (pricesMap[p.value?.id || ""] = p.value?.amount!))

          setCalculatedPricesMap(pricesMap)
          setIsLoadingPrices(false)
        })
      } else {
        setIsLoadingPrices(false)
      }
    }
  }, [isOpen, shippingMethods, cart.id])

  useEffect(() => {
    if (!isOpen || !shipbubbleCalculatedOptions.length) {
      return
    }

    Promise.allSettled(
      shipbubbleCalculatedOptions.map((option) =>
        listShipbubbleQuotes(cart.id, option.id, SHIPBUBBLE_QUOTES_STRATEGY)
      )
    ).then((results) => {
      setShipbubbleQuotesMap((previous) => {
        const next: Record<string, ShipbubbleQuotesResponse> = {}
        const activeOptionIds = new Set(
          shipbubbleCalculatedOptions.map((option) => option.id)
        )

        Object.entries(previous).forEach(([optionId, payload]) => {
          if (activeOptionIds.has(optionId)) {
            next[optionId] = payload
          }
        })

        results.forEach((result, index) => {
          if (result.status !== "fulfilled" || !result.value?.quotes?.length) {
            return
          }

          next[shipbubbleCalculatedOptions[index].id] = result.value
        })

        return next
      })
    })
  }, [isOpen, shipbubbleOptionsKey, cart.id])

  useEffect(() => {
    if (
      !isOpen ||
      shipbubbleCalculatedOptions.length ||
      !appliedShippingOptionIds.length
    ) {
      return
    }

    const uniqueOptionIds = [...new Set(appliedShippingOptionIds)]
    const missingOptionIds = uniqueOptionIds.filter(
      (optionId) => !shipbubbleQuotesMap[optionId]
    )

    if (!missingOptionIds.length) {
      return
    }

    Promise.allSettled(
      missingOptionIds.map((optionId) =>
        listShipbubbleQuotes(cart.id, optionId, SHIPBUBBLE_QUOTES_STRATEGY)
      )
    ).then((results) => {
      setShipbubbleQuotesMap((previous) => {
        const next = { ...previous }

        results.forEach((result, index) => {
          if (result.status !== "fulfilled" || !result.value?.quotes?.length) {
            return
          }

          next[missingOptionIds[index]] = result.value
        })

        return next
      })
    })
  }, [
    isOpen,
    shipbubbleCalculatedOptions.length,
    appliedShippingOptionIdsKey,
    cart.id,
    shipbubbleQuotesMap,
  ])

  useEffect(() => {
    if (typeof window === "undefined" || !cart.id) {
      return
    }

    if (Object.keys(shipbubbleQuotesMap).length) {
      window.localStorage.setItem(
        `${SHIPBUBBLE_QUOTES_CACHE_PREFIX}${cart.id}`,
        JSON.stringify(shipbubbleQuotesMap)
      )
      return
    }

    const raw = window.localStorage.getItem(
      `${SHIPBUBBLE_QUOTES_CACHE_PREFIX}${cart.id}`
    )
    if (!raw) {
      return
    }

    try {
      const cached = JSON.parse(raw) as Record<string, ShipbubbleQuotesResponse>
      if (cached && Object.keys(cached).length) {
        setShipbubbleQuotesMap(cached)
      }
    } catch {
      // Ignore malformed cache.
    }
  }, [cart.id, shipbubbleQuotesMap])

  // Auto-select the recommended ShipBubble quote when quotes first load and no option is
  // visually selected (e.g. because the stored quote_id from a previous session no longer
  // matches the fresh ephemeral IDs returned by the ShipBubble API).
  useEffect(() => {
    if (!isOpen || !shipbubbleQuotesKey) {
      return
    }

    groupedSellerEntries.forEach(([sellerId, methods]) => {
      // Only attempt once per seller per component mount.
      if (hasAutoSelectedBySellerRef.current[sellerId]) {
        return
      }

      // User already made a successful manual selection this session.
      if (selectedDeliveryValueMap[sellerId]) {
        return
      }

      // Build the delivery options list the same way the render does.
      const deliveryOptions = methods.reduce((acc: DeliveryListOption[], option) => {
        if (
          isShipbubbleOption(option) &&
          shipbubbleQuotesMap[option.id]?.quotes?.length
        ) {
          const quotesPayload = shipbubbleQuotesMap[option.id]
          quotesPayload.quotes.forEach((quote) => {
            acc.push({
              value: `${option.id}::${quote.quote_id}`,
              optionId: option.id,
              name:
                quote.courier_name ||
                quote.service_name ||
                option.name ||
                "Delivery",
              amount: quote.amount,
              priceType: "calculated",
              quote,
              quoteId: quote.quote_id,
              recommended:
                quotesPayload.recommended_quote_id === quote.quote_id,
            })
          })
        }
        return acc
      }, [])

      if (!deliveryOptions.length) {
        return
      }

      // If the cart already has a method whose quote_id matches a current option, the
      // radio will resolve correctly — no auto-selection needed.
      const resolvedValue = resolveSelectedDeliveryValue(sellerId, deliveryOptions, methods)
      if (resolvedValue) {
        return
      }

      // Pick the recommended option, or fall back to the first available.
      const optionToSelect =
        deliveryOptions.find((opt) => opt.recommended) || deliveryOptions[0]

      if (!optionToSelect) {
        return
      }

      hasAutoSelectedBySellerRef.current[sellerId] = true
      handleSetShippingMethod(sellerId, optionToSelect.value, methods)
    })
  }, [shipbubbleQuotesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = () => {
    router.push(pathname + "?step=payment", { scroll: false })
  }

  const handleSetShippingMethod = async (
    sellerId: string,
    selectedValue: string | null,
    methods: StoreCardShippingMethod[]
  ) => {
    if (!selectedValue) {
      return
    }

    if (lastRequestValueBySellerRef.current[sellerId] === selectedValue) {
      return
    }

    if (isSubmittingBySeller[sellerId]) {
      return
    }

    if (selectedDeliveryValueMap[sellerId] === selectedValue) {
      return
    }

    const [optionId, quoteId] = selectedValue.split("::")
    const selectedMethod = methods.find((method) => method.id === optionId)

    const payloadData: Record<string, unknown> = {}

    if (selectedMethod && isShipbubbleOption(selectedMethod) && quoteId) {
      const quotesPayload = shipbubbleQuotesMap[selectedMethod.id]
      const selectedQuote = quotesPayload?.quotes?.find(
        (quote) => quote.quote_id === quoteId
      )

      payloadData.shipbubble_quote_id = quoteId
      payloadData.shipbubble_strategy = quotesPayload?.strategy || "best_value"

      if (selectedQuote) {
        payloadData.shipbubble_quote = {
          quote_id: selectedQuote.quote_id,
          courier_id: selectedQuote.courier_id,
          carrier_code: selectedQuote.carrier_code,
          service_code: selectedQuote.service_code,
          service_name: selectedQuote.service_name,
          amount: selectedQuote.amount,
          request_token: selectedQuote.request_token,
        }
      }
    }

    try {
      setError(null)
      setIsLoadingPrices(true)
      setIsSubmittingBySeller((prev) => ({ ...prev, [sellerId]: true }))
      lastRequestValueBySellerRef.current[sellerId] = selectedValue

      // Remove any existing method with the same option_id before adding the new one.
      // MercurJS validates that option_ids (existing + new) have no duplicates, so if the
      // user is switching quotes within the same ShipBubble option this would otherwise 400.
      const existingCartMethod = (
        (cart.shipping_methods || []) as Array<Record<string, unknown>>
      ).find((method) => {
        const appliedOptionId = String(
          method.shipping_option_id ||
            (method.shipping_option as Record<string, unknown> | undefined)?.id ||
            ""
        )
        return appliedOptionId === optionId
      })
      if (existingCartMethod) {
        const existingMethodId = String(existingCartMethod.id || "")
        if (existingMethodId) {
          await removeShippingMethod(existingMethodId)
        }
      }

      const res = await setShippingMethod({
        cartId: cart.id,
        shippingMethodId: optionId,
        data: Object.keys(payloadData).length ? payloadData : undefined,
      })
      if (!res.ok) {
        return setError(res.error?.message)
      }

      setSelectedDeliveryValueMap((prev) => ({
        ...prev,
        [sellerId]: selectedValue,
      }))
    } catch (error: any) {
      setError(
        error?.message?.replace("Error setting up the request: ", "") ||
          "An error occurred"
      )
    } finally {
      setIsLoadingPrices(false)
      setIsSubmittingBySeller((prev) => ({ ...prev, [sellerId]: false }))
      if (lastRequestValueBySellerRef.current[sellerId] === selectedValue) {
        delete lastRequestValueBySellerRef.current[sellerId]
      }
    }
  }

  const groupedBySellerId = (shippingMethods || []).reduce(
    (acc: Record<string, StoreCardShippingMethod[]>, method) => {
      const sellerId = method.seller_id || "unknown-seller"

      if (!acc[sellerId]) {
        acc[sellerId] = []
      }

      // Keep method even when calculated price is pending/unavailable.
      acc[sellerId].push(method)

      return acc
    },
    {}
  )

  const effectiveGroupedBySellerId = useMemo(() => {
    if (Object.keys(groupedBySellerId).length) {
      return groupedBySellerId
    }

    const shipbubbleOptionIds = Object.keys(shipbubbleQuotesMap)
    if (!shipbubbleOptionIds.length) {
      return groupedBySellerId
    }

    const fallbackSellerId =
      cart.items?.find((item) => item?.product?.seller?.id)?.product?.seller?.id ||
      "unknown-seller"
    const fallbackSellerName =
      cart.items?.find((item) => item?.product?.seller?.name)?.product?.seller?.name ||
      "Seller"

    return {
      [fallbackSellerId]: shipbubbleOptionIds.map((optionId) => {
        return {
          id: optionId,
          name: "ShipBubble Delivery",
          provider_id: "shipbubble",
          price_type: "calculated",
          seller_id: fallbackSellerId,
          seller_name: fallbackSellerName,
          rules: [],
        } as StoreCardShippingMethod
      }),
    }
  }, [groupedBySellerId, shipbubbleQuotesMap, cart.items])

  const groupedSellerEntries: [string, StoreCardShippingMethod[]][] =
    Object.entries(effectiveGroupedBySellerId)
      .map(([sellerId, methods]) => [sellerId, methods] as [string, StoreCardShippingMethod[]])
      .filter(([, methods]) => methods.length > 0)

  const missingSellers = cart.items
    ?.filter((item) =>
      missingShippingSellers.includes(item.product?.seller?.id!)
    )
    .map((item) => item.product?.seller?.name)

  const resolveSelectedDeliveryValue = (
    sellerId: string,
    deliveryOptions: DeliveryListOption[],
    methods: StoreCardShippingMethod[]
  ) => {
    const localSelected = selectedDeliveryValueMap[sellerId]
    if (
      localSelected &&
      deliveryOptions.some((option) => option.value === localSelected)
    ) {
      return localSelected
    }

    const appliedMethods = (cart.shipping_methods || []) as Array<
      Record<string, unknown>
    >
    for (const applied of appliedMethods) {
      const shippingOptionId =
        String(
          applied.shipping_option_id ||
            (applied.shipping_option as Record<string, unknown> | undefined)?.id ||
            ""
        ) || ""

      if (!shippingOptionId || !methods.some((method) => method.id === shippingOptionId)) {
        continue
      }

      const appliedData = (applied.data || {}) as Record<string, unknown>
      const quoteId =
        typeof appliedData.shipbubble_quote_id === "string"
          ? appliedData.shipbubble_quote_id
          : undefined

      const selectedValue = quoteId
        ? `${shippingOptionId}::${quoteId}`
        : shippingOptionId

      if (deliveryOptions.some((option) => option.value === selectedValue)) {
        return selectedValue
      }
    }

    return undefined
  }

  return (
    <div className="border p-4 rounded-sm bg-ui-bg-interactive">
      {/* Header — always visible */}
      <div className="flex flex-row items-center justify-between mb-6">
        <Heading
          level="h2"
          className="flex flex-row text-3xl-regular gap-x-2 items-baseline items-center"
        >
          {!isOpen && isDeliveryComplete && <CheckCircleSolid />}
          Delivery
        </Heading>
        {!isOpen && isDeliveryComplete && (
          <Text>
            <Button onClick={handleEdit} variant="tonal">
              Edit
            </Button>
          </Text>
        )}
      </div>

      {/* ── Open state: full interactive options list ── */}
      <div className={isOpen ? "block" : "hidden"}>
        <div className="grid">
          <div data-testid="delivery-options-container">
            <div className="pb-8 md:pt-0 pt-2">
              {!groupedSellerEntries.length && (
                <div className="border rounded-lg p-3 mb-4">
                  <Text className="txt-small text-ui-fg-subtle">
                    No delivery options are loaded yet. Please refresh this page.
                  </Text>
                </div>
              )}
              {groupedSellerEntries.map(([key, methods]) => {
                if (!methods.length) {
                  return null
                }

                const firstMethod = methods[0]
                const hasShipbubbleOption = methods.some((option) =>
                  isShipbubbleOption(option)
                )
                const deliveryOptions = methods.reduce(
                  (acc: DeliveryListOption[], option) => {
                    if (
                      isShipbubbleOption(option) &&
                      shipbubbleQuotesMap[option.id]?.quotes?.length
                    ) {
                      const quotesPayload = shipbubbleQuotesMap[option.id]
                      const quotes = quotesPayload.quotes || []

                      quotes.forEach((quote) => {
                        acc.push({
                          value: `${option.id}::${quote.quote_id}`,
                          optionId: option.id,
                          name:
                            quote.courier_name ||
                            quote.service_name ||
                            option.name ||
                            "Delivery",
                          amount: quote.amount,
                          priceType: "calculated",
                          quote,
                          quoteId: quote.quote_id,
                          recommended:
                            quotesPayload.recommended_quote_id === quote.quote_id,
                        })
                      })

                      return acc
                    }

                    if (!isShipbubbleOption(option)) {
                      acc.push({
                        value: option.id,
                        optionId: option.id,
                        name: option.name || "Delivery",
                        amount: option.amount,
                        priceType: option.price_type || "flat",
                      })
                    }

                    return acc
                  },
                  []
                )

                const selectedValue = resolveSelectedDeliveryValue(
                  key,
                  deliveryOptions,
                  methods
                )
                const getDeliveryAmountLabel = (option: DeliveryListOption) => {
                  if (option.amount !== undefined) {
                    return convertToLocale({
                      amount: option.amount,
                      currency_code: cart?.currency_code,
                    })
                  }

                  const calculatedAmount = calculatedPricesMap[option.optionId]
                  if (calculatedAmount !== undefined) {
                    return convertToLocale({
                      amount: calculatedAmount,
                      currency_code: cart?.currency_code,
                    })
                  }

                  return isLoadingPrices ? "Loading..." : "-"
                }

                return (
                  <div key={key} className="mb-4">
                    <Heading level="h3" className="mb-2">
                      {firstMethod?.seller_name || "Seller"}
                    </Heading>
                    {!deliveryOptions.length ? (
                      <div className="border rounded-lg p-3">
                        <Text className="txt-small text-ui-fg-subtle">
                          {hasShipbubbleOption
                            ? "Live ShipBubble rates are unavailable. Please choose a manual shipping option for this seller."
                            : "No delivery options available for this seller."}
                        </Text>
                      </div>
                    ) : (
                      <div
                        className="border rounded-lg divide-y"
                        data-testid="shipping-address-options"
                      >
                        {deliveryOptions.map((option) => {
                          const etaLabel = getQuoteTimelineLabel(option.quote)

                          return (
                            <label
                              key={option.value}
                              className="flex items-start gap-3 p-3 cursor-pointer"
                            >
                              <input
                                type="radio"
                                name={`delivery-${key}`}
                                value={option.value}
                                checked={selectedValue === option.value}
                                disabled={Boolean(isSubmittingBySeller[key])}
                                onChange={() =>
                                  handleSetShippingMethod(
                                    key,
                                    option.value,
                                    methods
                                  )
                                }
                                className="mt-1"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <Text className="txt-compact-medium text-ui-fg-base">
                                    {option.name}
                                  </Text>
                                  {option.recommended && (
                                    <span className="text-[11px] px-2 py-0.5 rounded bg-ui-tag-blue-bg text-ui-tag-blue-text">
                                      Best value
                                    </span>
                                  )}
                                </div>
                                <Text className="txt-small text-ui-fg-subtle">
                                  {getDeliveryAmountLabel(option)}
                                </Text>
                                {etaLabel && (
                                  <Text className="txt-small text-ui-fg-muted mt-1">
                                    {etaLabel}
                                  </Text>
                                )}
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <div>
          <ErrorMessage
            error={error}
            data-testid="delivery-option-error-message"
          />
          <Button
            onClick={handleSubmit}
            variant="tonal"
            disabled={!cart.shipping_methods?.[0]}
            loading={isLoadingPrices}
          >
            Continue to payment
          </Button>
        </div>
      </div>

      {/* ── Closed + complete: summary of the chosen method(s) ── */}
      <div className={!isOpen && isDeliveryComplete ? "block" : "hidden"}>
        {((cart.shipping_methods || []) as Array<any>).map((method, index) => {
          const courierName =
            (method.data as any)?.shipbubble_quote?.service_name ||
            (method.data as any)?.shipbubble_quote?.courier_name ||
            method.name ||
            "Delivery"
          const priceLabel =
            method.amount !== undefined
              ? convertToLocale({
                  amount: method.amount,
                  currency_code: cart.currency_code,
                })
              : "-"

          return (
            <div
              key={method.id ?? index}
              className="flex items-start gap-x-1 w-full"
            >
              <div className="flex flex-col w-1/3">
                <Text className="txt-medium-plus text-ui-fg-base mb-1">
                  Delivery method
                </Text>
                <Text className="txt-medium text-ui-fg-subtle">
                  {courierName}
                </Text>
              </div>
              <div className="flex flex-col w-1/3">
                <Text className="txt-medium-plus text-ui-fg-base mb-1">
                  Delivery cost
                </Text>
                <Text className="txt-medium text-ui-fg-subtle">
                  {priceLabel}
                </Text>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default CartShippingMethodsSection
