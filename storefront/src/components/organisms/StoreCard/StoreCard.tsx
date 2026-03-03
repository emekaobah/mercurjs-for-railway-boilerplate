import { SellerProps } from "@/types/seller"
import { ShopTileCard } from "../ShopTileCard/ShopTileCard"

const decodeImagePath = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function StoreCard({ seller }: { seller: SellerProps }) {
  const imageSrc = seller.photo
    ? decodeImagePath(seller.photo)
    : "/images/placeholder.svg"

  return (
    <ShopTileCard
      href={`/sellers/${seller.handle}`}
      name={seller.name}
      imageSrc={imageSrc}
      imageAlt={`store - ${seller.name}`}
      imageClassName={
        seller.photo
          ? "object-cover rounded-full"
          : "object-contain scale-90 rounded-full opacity-30"
      }
    />
  )
}
