export type ShipbubbleMode = "delivery" | "pickup"

export interface ShipbubbleShippingOptionData {
  carrier_code: string
  service_code: string
  service_name: string
  mode: ShipbubbleMode
  insurance_enabled: boolean
}

export interface ShipbubbleAddress {
  name?: string
  phone?: string
  email?: string
  address_line_1: string
  address_line_2?: string
  city: string
  state?: string
  postal_code?: string
  country_code: string
  latitude?: number
  longitude?: number
}

export interface ShipbubblePackage {
  weight_kg: number
  length_cm: number
  width_cm: number
  height_cm: number
  items_count: number
}

export interface ShipbubblePackageItem {
  name: string
  description: string
  unit_weight: number
  weight?: number
  quantity: number
  unit_quantity?: number
  amount: number
  unit_amount?: number
  value?: number
}

export interface ShipbubbleRate {
  quote_id?: string
  courier_id?: string
  courier_name?: string
  carrier_code: string
  service_code: string
  service_name: string
  mode: ShipbubbleMode
  insurance_enabled: boolean
  amount: number
  currency_code: string
  eta_days?: number
  delivery_eta?: string
  delivery_eta_time?: string
  pickup_eta?: string
  pickup_eta_time?: string
  request_token?: string
  is_cheapest?: boolean
  is_fastest?: boolean
  is_best_value?: boolean
  raw?: Record<string, unknown>
}

export interface ShipbubbleAddressValidationResult {
  valid: boolean
  serviceable?: boolean
  address_code?: string | number
  message?: string
  raw?: Record<string, unknown>
}

export interface ShipbubbleShipmentResult {
  shipbubble_shipment_id: string
  tracking_number: string
  tracking_url?: string
  label_url?: string
  raw?: Record<string, unknown>
}

export interface ShipbubbleBookShipmentInput {
  sender: ShipbubbleAddress
  receiver: ShipbubbleAddress
  sender_address_code?: string | number
  receiver_address_code?: string | number
  parcel: ShipbubblePackage
  package_items?: ShipbubblePackageItem[]
  carrier_code: string
  courier_id?: string
  service_code: string
  service_name: string
  mode: ShipbubbleMode
  insurance_enabled: boolean
  category_id?: number
  request_token?: string
  order_reference: string
}

export interface ShipbubbleRatesInput {
  sender: ShipbubbleAddress
  receiver: ShipbubbleAddress
  sender_address_code?: string | number
  receiver_address_code?: string | number
  parcel: ShipbubblePackage
  package_items?: ShipbubblePackageItem[]
  currency_code: string
  mode: ShipbubbleMode
  insurance_enabled: boolean
  category_id?: number
  carrier_code?: string
  service_code?: string
}

export interface ShipbubbleRuntimeConfig {
  enabled: boolean
  apiBaseUrl: string
  apiKey: string
  timeoutMs: number
  defaultCategoryId: number
  defaultSenderName: string
  defaultSenderEmail: string
  defaultSenderPhone: string
  defaultReceiverName: string
  defaultReceiverEmail: string
  defaultReceiverPhone: string
  overrideSenderAddress?: string
  overrideSenderLatitude?: number
  overrideSenderLongitude?: number
  overrideReceiverAddress?: string
  overrideReceiverLatitude?: number
  overrideReceiverLongitude?: number
  defaultWeightKg: number
  defaultLengthCm: number
  defaultWidthCm: number
  defaultHeightCm: number
  checkoutStrategy: "best_value" | "cheapest" | "fastest" | "all"
}

export interface ShipbubbleProviderOptions {
  enabled?: boolean | string
  api_base_url?: string
  api_key?: string
  timeout_ms?: number | string
  default_category_id?: number | string
  default_sender_name?: string
  default_sender_email?: string
  default_sender_phone?: string
  default_receiver_name?: string
  default_receiver_email?: string
  default_receiver_phone?: string
  override_sender_address?: string
  override_sender_latitude?: number | string
  override_sender_longitude?: number | string
  override_receiver_address?: string
  override_receiver_latitude?: number | string
  override_receiver_longitude?: number | string
  default_weight_kg?: number | string
  default_length_cm?: number | string
  default_width_cm?: number | string
  default_height_cm?: number | string
  checkout_strategy?: "best_value" | "cheapest" | "fastest" | "all" | string
}
