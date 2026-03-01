import { ShipbubbleAddress } from "../types"

const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  NG: "Nigeria",
  US: "United States",
  GB: "United Kingdom",
}

const toNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") {
    return undefined
  }

  const parsed = Number(value)

  if (Number.isNaN(parsed)) {
    return undefined
  }

  return parsed
}

const asString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }

  const parsed = String(value).trim()
  return parsed.length ? parsed : undefined
}

export const normalizeAddress = (
  source: Record<string, unknown> | null | undefined
): ShipbubbleAddress | null => {
  if (!source) {
    return null
  }

  const firstName = asString(source.first_name)
  const lastName = asString(source.last_name)
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim()

  const addressLine1 =
    asString(source.address_1) ??
    asString(source.address1) ??
    asString(source.address_line_1) ??
    asString(source.street)

  const city = asString(source.city)
  const countryCode =
    asString(source.country_code)?.toUpperCase() ??
    asString(source.country)?.toUpperCase()

  if (!addressLine1 || !city || !countryCode) {
    return null
  }

  const state =
    asString(source.province) ??
    asString(source.state) ??
    asString(source.region) ??
    city

  return {
    name: fullName || asString(source.company),
    phone: asString(source.phone),
    email: asString(source.email),
    address_line_1: addressLine1,
    address_line_2:
      asString(source.address_2) ??
      asString(source.address2) ??
      asString(source.address_line_2),
    city,
    state,
    postal_code:
      asString(source.postal_code) ??
      asString(source.zip) ??
      asString(source.zip_code),
    country_code: countryCode,
    latitude:
      toNumber(source.latitude) ??
      toNumber(source.lat) ??
      toNumber(source.geo_latitude),
    longitude:
      toNumber(source.longitude) ??
      toNumber(source.lng) ??
      toNumber(source.geo_longitude),
  }
}

export const isAddressComplete = (address: ShipbubbleAddress | null): boolean => {
  if (!address) {
    return false
  }

  return Boolean(
    address.address_line_1?.trim() &&
      address.city?.trim() &&
      address.country_code?.trim()
  )
}

export const toShipbubbleAddressPayload = (
  address: ShipbubbleAddress
): Record<string, unknown> => {
  const countryCode = (address.country_code || "").toUpperCase()
  const countryName = COUNTRY_CODE_TO_NAME[countryCode] || countryCode
  const state = address.state || address.city
  const addressText = [
    address.address_line_1,
    address.address_line_2,
    address.city,
    state,
    countryName,
  ]
    .filter(Boolean)
    .join(", ")

  return {
    name: address.name,
    phone: address.phone,
    email: address.email,
    address: addressText,
    address_1: address.address_line_1,
    address_2: address.address_line_2,
    city: address.city,
    state,
    country: countryName,
    country_code: countryCode,
    postal_code: address.postal_code,
    postcode: address.postal_code,
    latitude: address.latitude,
    longitude: address.longitude,
    lat: address.latitude,
    lng: address.longitude,
  }
}
