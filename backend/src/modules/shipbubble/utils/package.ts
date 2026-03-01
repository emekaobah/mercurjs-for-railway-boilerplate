import { ShipbubblePackage } from "../types"

type PackageDefaults = {
  weightKg: number
  lengthCm: number
  widthCm: number
  heightCm: number
}

const toPositiveNumber = (value: unknown): number | null => {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

const resolveVariantWeightKg = (weight: unknown): number | null => {
  const parsed = toPositiveNumber(weight)

  if (!parsed) {
    return null
  }

  // Medusa variant weight is commonly stored in grams.
  return parsed > 200 ? parsed / 1000 : parsed
}

const resolveVariantDimensionCm = (dimension: unknown): number | null => {
  return toPositiveNumber(dimension)
}

export const buildPackageFromItems = (
  items: Array<Record<string, unknown>>,
  defaults: PackageDefaults
): ShipbubblePackage => {
  let totalWeightKg = 0
  let maxLengthCm = defaults.lengthCm
  let maxWidthCm = defaults.widthCm
  let maxHeightCm = defaults.heightCm
  let itemsCount = 0

  for (const item of items) {
    const quantity = toPositiveNumber(item.quantity) ?? 0

    if (!quantity) {
      continue
    }

    const variant = (item.variant ?? {}) as Record<string, unknown>
    const weightKg = resolveVariantWeightKg(variant.weight) ?? defaults.weightKg
    const lengthCm =
      resolveVariantDimensionCm(variant.length) ?? defaults.lengthCm
    const widthCm = resolveVariantDimensionCm(variant.width) ?? defaults.widthCm
    const heightCm =
      resolveVariantDimensionCm(variant.height) ?? defaults.heightCm

    totalWeightKg += weightKg * quantity
    maxLengthCm = Math.max(maxLengthCm, lengthCm)
    maxWidthCm = Math.max(maxWidthCm, widthCm)
    maxHeightCm = Math.max(maxHeightCm, heightCm)
    itemsCount += quantity
  }

  if (totalWeightKg <= 0) {
    totalWeightKg = defaults.weightKg
  }

  return {
    weight_kg: Number(totalWeightKg.toFixed(3)),
    length_cm: Number(maxLengthCm.toFixed(2)),
    width_cm: Number(maxWidthCm.toFixed(2)),
    height_cm: Number(maxHeightCm.toFixed(2)),
    items_count: Math.max(itemsCount, 1),
  }
}
