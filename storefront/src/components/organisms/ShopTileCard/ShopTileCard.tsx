"use client"

import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import Image from "next/image"
import { useState } from "react"

type ShopTileCardProps = {
  href: string
  name: string
  imageSrc: string
  imageAlt: string
  imageClassName?: string
}

export function ShopTileCard({
  href,
  name,
  imageSrc,
  imageAlt,
  imageClassName = "object-contain scale-90 rounded-full",
}: ShopTileCardProps) {
  const [resolvedImageSrc, setResolvedImageSrc] = useState(imageSrc)

  return (
    <LocalizedClientLink
      href={href}
      className="relative flex flex-col items-center border rounded-sm bg-component transition-all hover:rounded-full w-[233px] aspect-square"
    >
      <div className="flex relative aspect-square overflow-hidden w-[200px]">
        <Image
          loading="lazy"
          src={resolvedImageSrc}
          alt={imageAlt}
          width={200}
          height={200}
          sizes="(min-width: 1024px) 200px, 40vw"
          className={imageClassName}
          onError={() => {
            if (resolvedImageSrc !== "/images/placeholder.svg") {
              setResolvedImageSrc("/images/placeholder.svg")
            }
          }}
        />
      </div>
      <h3 className="w-full text-center label-lg text-primary">{name}</h3>
    </LocalizedClientLink>
  )
}
