import { ShopTileCard } from "../ShopTileCard/ShopTileCard"

export function CategoryCard({
  category,
}: {
  category: { name: string; handle: string }
}) {
  return (
    <ShopTileCard
      href={`/categories/${category.handle}`}
      name={category.name}
      imageSrc={`/images/categories/${category.handle}.png`}
      imageAlt={`category - ${category.name}`}
    />
  )
}
