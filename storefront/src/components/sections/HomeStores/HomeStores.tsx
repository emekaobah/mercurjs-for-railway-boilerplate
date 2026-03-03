import { Carousel } from "@/components/cells"
import { StoreCard } from "@/components/organisms"
import { listSellers } from "@/lib/data/seller"

export const HomeStores = async ({ heading }: { heading: string }) => {
  const { sellers } = await listSellers({
    query: {
      limit: 8,
    },
  })

  if (!sellers.length) return null

  return (
    <section className="bg-primary py-8 w-full">
      <div className="mb-6">
        <h2 className="heading-lg text-primary uppercase">{heading}</h2>
      </div>
      <Carousel
        showDesktopArrows
        desktopArrowBackground="circle"
        showDesktopIndicator
        items={sellers.map((seller) => (
          <StoreCard key={seller.id} seller={seller} />
        ))}
      />
    </section>
  )
}
