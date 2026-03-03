import type { Metadata } from "next"
import { headers } from "next/headers"
import { Breadcrumbs } from "@/components/atoms"
import { ProductsPagination, SellerCard } from "@/components/organisms"
import { PRODUCT_LIMIT } from "@/const"
import { listRegions } from "@/lib/data/regions"
import { listSellers } from "@/lib/data/seller"
import { toHreflang } from "@/lib/helpers/hreflang"

export const revalidate = 60

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params

  const headersList = await headers()
  const host = headersList.get("host")
  const protocol = headersList.get("x-forwarded-proto") || "https"
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${protocol}://${host}`

  let languages: Record<string, string> = {}

  try {
    const regions = await listRegions()
    const locales = Array.from(
      new Set(
        (regions || []).flatMap((r) =>
          r.countries?.map((country: { iso_2?: string }) => country.iso_2) || []
        )
      )
    ) as string[]

    languages = locales.reduce<Record<string, string>>((acc, code) => {
      acc[toHreflang(code)] = `${baseUrl}/${code}/sellers`
      return acc
    }, {})
  } catch {
    languages = { [toHreflang(locale)]: `${baseUrl}/${locale}/sellers` }
  }

  const title = "All Sellers"
  const description = `Browse stores and sellers on ${
    process.env.NEXT_PUBLIC_SITE_NAME || "our store"
  }`
  const canonical = `${baseUrl}/${locale}/sellers`

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: { ...languages, "x-default": `${baseUrl}/sellers` },
    },
    robots: { index: true, follow: true },
    openGraph: {
      title: `${title} | ${process.env.NEXT_PUBLIC_SITE_NAME || "Storefront"}`,
      description,
      url: canonical,
      siteName: process.env.NEXT_PUBLIC_SITE_NAME || "Storefront",
      type: "website",
    },
  }
}

export default async function SellersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page } = await searchParams

  const currentPage = Math.max(Number(page || "1") || 1, 1)
  const offset = (currentPage - 1) * PRODUCT_LIMIT

  const { sellers, count } = await listSellers({
    query: {
      limit: PRODUCT_LIMIT,
      offset,
    },
  })

  const pages = Math.ceil(count / PRODUCT_LIMIT) || 1

  return (
    <main className="container">
      <div className="hidden md:block mb-2">
        <Breadcrumbs items={[{ path: "/sellers", label: "All Sellers" }]} />
      </div>

      <h1 className="heading-xl uppercase">All Sellers</h1>
      <p className="label-md text-secondary mt-2">
        {count} {count === 1 ? "seller" : "sellers"}
      </p>

      {!sellers.length ? (
        <div className="border rounded-sm p-6 mt-6 label-lg">
          No sellers available right now.
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {sellers.map((seller) => (
            <SellerCard key={seller.id} seller={seller} />
          ))}
        </section>
      )}

      {pages > 1 && <ProductsPagination pages={pages} />}
    </main>
  )
}
