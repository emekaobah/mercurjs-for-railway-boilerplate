import crypto from "crypto"
import {
  ShipbubbleSyncAction,
  ShipbubbleWebhookStatus,
} from "./types"

type JsonRecord = Record<string, unknown>

export type ShipbubbleWebhookEnvelope = {
  status_raw: string | null
  status: ShipbubbleWebhookStatus | null
  order_reference: string | null
  shipment_id: string | null
  tracking_number: string | null
  occurred_at: Date | null
  event_id: string | null
}

const STATUS_ACTION_MAP = {
  pending: "noop",
  confirmed: "noop",
  picked_up: "set_shipped",
  in_transit: "set_shipped",
  completed: "set_delivered",
  cancelled: "cancel_if_unshipped",
} as const satisfies Record<ShipbubbleWebhookStatus, ShipbubbleSyncAction>

const toRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}

const isShipbubbleId = (value: string | null): boolean =>
  Boolean(value && /^SB-/i.test(value))

const pickFirstString = (values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length) {
      return value.trim()
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }

  return null
}

const parseDateLike = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  if (typeof value === "string" && value.trim().length) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}

const normalizeStatus = (value: string | null): ShipbubbleWebhookStatus | null => {
  if (!value) {
    return null
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")

  const aliases: Record<string, ShipbubbleWebhookStatus> = {
    pending: "pending",
    queued: "pending",
    processing: "pending",
    confirmed: "confirmed",
    accepted: "confirmed",
    pickup_scheduled: "confirmed",
    picked_up: "picked_up",
    pickedup: "picked_up",
    in_transit: "in_transit",
    intransit: "in_transit",
    out_for_delivery: "in_transit",
    outfordelivery: "in_transit",
    completed: "completed",
    complete: "completed",
    delivered: "completed",
    cancelled: "cancelled",
    canceled: "cancelled",
    rejected: "cancelled",
  }

  return aliases[normalized] ?? null
}

export const extractShipbubbleWebhookEnvelope = (
  payload: Record<string, unknown>
): ShipbubbleWebhookEnvelope => {
  const root = toRecord(payload)
  const data = toRecord(root.data)
  const shipment = toRecord(
    root.shipment || data.shipment || root.order || data.order
  )
  const courier = toRecord(root.courier || data.courier || shipment.courier)

  const statusRaw = pickFirstString([
    root.status,
    root.event,
    root.type,
    data.status,
    data.event,
    data.type,
    shipment.status,
  ])

  const orderReference = pickFirstString([
    root.order_id,
    root.order_reference,
    root.reference,
    root.order,
    data.order_id,
    data.order_reference,
    data.reference,
    shipment.order_id,
    shipment.order_reference,
    shipment.reference,
  ])

  const shipmentId = pickFirstString([
    root.shipment_id,
    data.shipment_id,
    shipment.shipment_id,
    shipment.id,
    ...(isShipbubbleId(pickFirstString([root.order_id])) ? [root.order_id] : []),
    ...(isShipbubbleId(pickFirstString([data.order_id])) ? [data.order_id] : []),
    root.id,
  ])

  const trackingNumber = pickFirstString([
    root.tracking_number,
    root.tracking_code,
    data.tracking_number,
    data.tracking_code,
    shipment.tracking_number,
    shipment.tracking_no,
    shipment.waybill,
    shipment.awb,
    courier.tracking_number,
    courier.tracking_code,
    courier.waybill,
    courier.awb,
  ])

  const occurredAt = parseDateLike(
    pickFirstString([
      root.occurred_at,
      root.timestamp,
      root.date,
      root.created_at,
      root.updated_at,
      data.occurred_at,
      data.timestamp,
      data.date,
      data.created_at,
      data.updated_at,
      shipment.occurred_at,
      shipment.updated_at,
      shipment.created_at,
    ])
  )

  const eventId = pickFirstString([
    root.event_id,
    data.event_id,
    root.id,
    data.id,
  ])

  return {
    status_raw: statusRaw,
    status: normalizeStatus(statusRaw),
    order_reference: orderReference,
    shipment_id: shipmentId,
    tracking_number: trackingNumber,
    occurred_at: occurredAt,
    event_id: eventId,
  }
}

export const resolveShipbubbleSyncAction = (
  status: ShipbubbleWebhookStatus | null
): ShipbubbleSyncAction => {
  if (!status) {
    return "flag_exception"
  }

  return STATUS_ACTION_MAP[status]
}

export const createShipbubbleEventKey = (
  envelope: ShipbubbleWebhookEnvelope,
  orderId: string,
  fulfillmentId: string
): string => {
  const raw = JSON.stringify({
    orderId,
    fulfillmentId,
    status: envelope.status ?? envelope.status_raw ?? "unknown",
    eventId: envelope.event_id ?? "",
    shipmentId: envelope.shipment_id ?? "",
    trackingNumber: envelope.tracking_number ?? "",
    occurredAt: envelope.occurred_at?.toISOString() ?? "",
  })

  return crypto.createHash("sha256").update(raw).digest("hex")
}
