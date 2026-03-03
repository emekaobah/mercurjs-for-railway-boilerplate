import { Carousel } from "@/components/cells"
import { CategoryCard } from "@/components/organisms"
import { listCategories } from "@/lib/data/categories"

export const HomeCategories = async ({ heading }: { heading: string }) => {
  const { categories } = await listCategories()

  if (!categories.length) return null

  const displayCategories = [...categories].sort((a, b) => {
    const rankA = typeof a.rank === "number" ? a.rank : Number.MAX_SAFE_INTEGER
    const rankB = typeof b.rank === "number" ? b.rank : Number.MAX_SAFE_INTEGER

    if (rankA !== rankB) {
      return rankA - rankB
    }

    return a.name.localeCompare(b.name)
  })

  return (
    <section className="bg-primary py-8 w-full">
      <div className="mb-6">
        <h2 className="heading-lg text-primary uppercase">{heading}</h2>
      </div>
      <Carousel
        showDesktopArrows
        desktopArrowBackground="circle"
        showDesktopIndicator
        items={displayCategories.map((category) => (
          <CategoryCard key={category.id} category={category} />
        ))}
      />
    </section>
  )
}
