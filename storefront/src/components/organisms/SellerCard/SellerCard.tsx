import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { SellerInfo } from "@/components/molecules"
import { SellerProps } from "@/types/seller"
import { format } from "date-fns"

const getJoinedDate = (created_at?: string) => {
  if (!created_at) {
    return null
  }

  const parsedDate = new Date(created_at)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  return format(parsedDate, "yyyy-MM-dd")
}

export const SellerCard = ({ seller }: { seller: SellerProps }) => {
  const joinedDate = getJoinedDate(seller.created_at)
  const location = [seller.city, seller.country_code]
    .filter(Boolean)
    .join(", ")
    .toUpperCase()

  return (
    <LocalizedClientLink href={`/sellers/${seller.handle}`}>
      <article className="border rounded-sm p-4 h-full">
        <SellerInfo seller={seller} header />

        {(location || joinedDate) && (
          <div className="pt-4 flex flex-wrap gap-2 label-sm text-secondary">
            {location && <span>{location}</span>}
            {location && joinedDate && <span>|</span>}
            {joinedDate && <span>Joined {joinedDate}</span>}
          </div>
        )}
      </article>
    </LocalizedClientLink>
  )
}
