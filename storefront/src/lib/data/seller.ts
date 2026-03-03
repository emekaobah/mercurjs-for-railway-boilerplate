import { SellerProps } from "@/types/seller"
import { sdk } from "../config"

export const listSellers = async ({
  query = {},
  forceCache = true,
}: {
  query?: Record<string, string | number | boolean | undefined>
  forceCache?: boolean
} = {}) => {
  const limit = Number(query.limit || 12)
  const offset = Number(query.offset || 0)

  return sdk.client
    .fetch<{
      sellers: SellerProps[]
      count: number
      offset: number
      limit: number
    }>(`/store/seller`, {
      method: "GET",
      query: {
        limit,
        offset,
        fields:
          "id,name,handle,photo,description,city,country_code,created_at,store_status,+reviews.rating",
        ...query,
      },
      next: forceCache ? { revalidate: 60 } : undefined,
      cache: forceCache ? "force-cache" : "no-cache",
    })
    .then(({ sellers, count, limit, offset }) => ({
      sellers: sellers.filter((seller) => seller.store_status !== "SUSPENDED"),
      count,
      limit,
      offset,
    }))
    .catch(() => ({
      sellers: [],
      count: 0,
      limit,
      offset,
    }))
}

export const getSellerByHandle = async (handle: string) => {
  return sdk.client
    .fetch<{ seller: SellerProps }>(`/store/seller/${handle}`, {
      query: {
        fields:
          "+created_at,+email,+reviews.seller.name,+reviews.rating,+reviews.customer_note,+reviews.seller_note,+reviews.created_at,+reviews.updated_at,+reviews.customer.first_name,+reviews.customer.last_name",
      },
      cache: "no-cache",
    })
    .then(({ seller }) => {
      const response = {
        ...seller,
        reviews:
          seller.reviews
            ?.filter((item) => item !== null)
            .sort((a, b) => b.created_at.localeCompare(a.created_at)) ?? [],
      }

      return response as SellerProps
    })
    .catch(() => [])
}
