"use client"

import useEmblaCarousel from "embla-carousel-react"

import { Indicator } from "@/components/atoms"
import { ArrowLeftIcon, ArrowRightIcon } from "@/icons"
import { useCallback, useEffect, useState } from "react"
import { EmblaCarouselType } from "embla-carousel"
import tailwindConfig from "../../../../tailwind.config"

export const CustomCarousel = ({
  variant = "light",
  items,
  align = "start",
  showDesktopArrows = false,
  desktopArrowBackground = "none",
  showDesktopIndicator = false,
}: {
  variant?: "light" | "dark"
  items: React.ReactNode[]
  align?: "center" | "start" | "end"
  showDesktopArrows?: boolean
  desktopArrowBackground?: "none" | "circle" | "square"
  showDesktopIndicator?: boolean
}) => {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    align,
  })

  const [selectedIndex, setSelectedIndex] = useState(0)
  const [hoveredDesktopArrow, setHoveredDesktopArrow] = useState<
    "prev" | "next" | null
  >(null)

  const maxStep = items.length
  const normalizedIndex = maxStep
    ? ((selectedIndex % maxStep) + maxStep) % maxStep
    : 0

  const onSelect = useCallback((emblaApi: EmblaCarouselType) => {
    setSelectedIndex(emblaApi.selectedScrollSnap())
  }, [])

  useEffect(() => {
    if (!emblaApi) return

    onSelect(emblaApi)
    emblaApi.on("reInit", onSelect).on("select", onSelect)
  }, [emblaApi, onSelect])

  const changeSlideHandler = useCallback(
    (index: number) => {
      if (!emblaApi) return
      emblaApi.scrollTo(index)
    },
    [emblaApi]
  )

  const arrowColor = {
    light: tailwindConfig.theme.extend.colors.primary,
    dark: tailwindConfig.theme.extend.colors.tertiary,
  }

  const desktopArrowHoverIconColor =
    tailwindConfig.theme.extend.colors.action.on.primary

  const desktopArrowButtonClass =
    desktopArrowBackground === "none"
      ? ""
      : [
          "h-10 w-10 flex items-center justify-center border border-secondary transition-colors duration-200",
          desktopArrowBackground === "circle" ? "rounded-full" : "rounded-sm",
          "bg-transparent hover:bg-action hover:border-action",
        ].join(" ")

  return (
    <div className="embla relative w-full">
      {(showDesktopArrows || showDesktopIndicator) && (
        <div className="hidden sm:flex items-center gap-4 absolute right-0 -top-16 z-10">
          {showDesktopIndicator && maxStep > 1 && (
            <div
              className={[
                "w-40 h-1 rounded-md relative overflow-hidden",
                variant === "light" ? "bg-tertiary/10" : "bg-primary/10",
              ].join(" ")}
            >
              <div
                className={[
                  "h-full rounded-sm absolute transition-all duration-300",
                  variant === "light" ? "bg-tertiary" : "bg-white",
                ].join(" ")}
                style={{
                  width: `${100 / maxStep}%`,
                  left: `${(100 / maxStep) * normalizedIndex}%`,
                }}
              />
            </div>
          )}

          {showDesktopArrows && (
            <div className="flex items-center gap-2">
              <button
                className={desktopArrowButtonClass}
                aria-label="Previous slide"
                onClick={() => changeSlideHandler(selectedIndex - 1)}
                onMouseEnter={() => setHoveredDesktopArrow("prev")}
                onMouseLeave={() => setHoveredDesktopArrow(null)}
              >
                <ArrowLeftIcon
                  color={
                    hoveredDesktopArrow === "prev" &&
                    desktopArrowBackground !== "none"
                      ? desktopArrowHoverIconColor
                      : arrowColor[variant]
                  }
                />
              </button>
              <button
                className={desktopArrowButtonClass}
                aria-label="Next slide"
                onClick={() => changeSlideHandler(selectedIndex + 1)}
                onMouseEnter={() => setHoveredDesktopArrow("next")}
                onMouseLeave={() => setHoveredDesktopArrow(null)}
              >
                <ArrowRightIcon
                  color={
                    hoveredDesktopArrow === "next" &&
                    desktopArrowBackground !== "none"
                      ? desktopArrowHoverIconColor
                      : arrowColor[variant]
                  }
                />
              </button>
            </div>
          )}
        </div>
      )}

      <div
        className="embla__viewport overflow-hidden rounded-xs w-full"
        ref={emblaRef}
      >
        <div className="embla__container flex gap-2 sm:gap-4">
          {items.map((slide) => slide)}
        </div>

        <div className="flex justify-between items-center mt-4 sm:hidden">
          <div className="w-1/2">
            <Indicator
              variant={variant}
              maxStep={maxStep}
              step={normalizedIndex + 1}
            />
          </div>
          <div>
            <button onClick={() => changeSlideHandler(selectedIndex - 1)}>
              <ArrowLeftIcon color={arrowColor[variant]} />
            </button>
            <button onClick={() => changeSlideHandler(selectedIndex + 1)}>
              <ArrowRightIcon color={arrowColor[variant]} />
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}
