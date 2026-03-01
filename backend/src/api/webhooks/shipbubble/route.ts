import crypto from "crypto"
import {
  cancelOrderFulfillmentWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
  updateFulfillmentWorkflow,
} from "@medusajs/medusa/core-flows"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createShipbubbleEventKey,
  extractShipbubbleWebhookEnvelope,
  resolveShipbubbleSyncAction,
} from "../../../modules/shipbubble/status-sync"
import {
  ShipbubbleFulfillmentMetadata,
  ShipbubbleSyncAction,
} from "../../../modules/shipbubble/types"

type JsonRecord = Record<string, unknown>

type FulfillmentLike = {
  id: string
  metadata?: Record<string, unknown> | null
  labels?: Array<Record<string, unknown>> | null
  shipped_at?: string | Date | null
  delivered_at?: string | Date | null
  canceled_at?: string | Date | null
}

const SHIPBUBBLE_HISTORY_KEY = "shipbubble_status_history"
const SHIPBUBBLE_LAST_EVENT_KEY = "shipbubble_last_event_key"
const SHIPBUBBLE_LAST_STATUS = "shipbubble_last_status"
const SHIPBUBBLE_LAST_STATUS_AT = "shipbubble_last_status_at"
const SHIPBUBBLE_LAST_ACTION = "shipbubble_last_action"
const SHIPBUBBLE_SYNC_EXCEPTION = "shipbubble_sync_exception"
const MAX_STATUS_HISTORY = 50
const ORDER_QUERY_FIELDS = [
  "id",
  "display_id",
  "fulfillments.*",
  "fulfillments.labels.*",
] as const

const toRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length) {
    return value.trim()
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

const toIsoStringOrNull = (value: unknown): string | null => {
  if (!value) {
    return null
  }

  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const equalsIgnoreCase = (left: string | null, right: string | null): boolean =>
  Boolean(
    left &&
      right &&
      left.trim().toLowerCase() === right.trim().toLowerCase()
  )

const getTrackingNumbersFromLabels = (
  labels: Array<Record<string, unknown>> | null | undefined
): string[] => {
  if (!Array.isArray(labels)) {
    return []
  }

  return labels
    .map((label) => toStringOrNull(label?.tracking_number))
    .filter((value): value is string => Boolean(value))
}

const getRawBodyString = (req: MedusaRequest): string => {
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.toString("utf8")
  }

  if (typeof req.rawBody === "string") {
    return req.rawBody
  }

  if (typeof req.body === "string") {
    return req.body
  }

  return JSON.stringify(req.body ?? {})
}

const isValidHmacSignature = (
  rawBody: string,
  signature: string,
  secret: string
): boolean => {
  const computed = crypto
    .createHmac("sha512", secret)
    .update(rawBody, "utf8")
    .digest("hex")

  const computedBuffer = Buffer.from(computed, "utf8")
  const incomingBuffer = Buffer.from(signature.trim(), "utf8")

  if (computedBuffer.length !== incomingBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(computedBuffer, incomingBuffer)
}

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null) {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false
  }

  return fallback
}

const parseDisplayIdFromReference = (reference: string): number | null => {
  const normalized = reference.replace(/^#/, "").trim()
  if (!/^\d+$/.test(normalized)) {
    return null
  }

  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

const findOrderByReference = async (
  query: any,
  reference: string
): Promise<Record<string, unknown> | null> => {
  const normalizedReference = reference.trim()
  if (!normalizedReference) {
    return null
  }

  const filtersToTry: Array<Record<string, unknown>> = [{ id: normalizedReference }]
  const displayId = parseDisplayIdFromReference(normalizedReference)

  if (displayId !== null) {
    filtersToTry.push({ display_id: displayId })
  }

  for (const filters of filtersToTry) {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [...ORDER_QUERY_FIELDS],
      filters,
    })

    const order = (orders || [])[0] as Record<string, unknown> | undefined
    if (order) {
      return order
    }
  }

  return null
}

const findOrderByShipmentSignals = async (
  query: any,
  pgConnection: any,
  input: {
    shipmentId: string | null
    trackingNumber: string | null
  }
): Promise<Record<string, unknown> | null> => {
  const shipmentId = (input.shipmentId || "").trim()
  const trackingNumber = (input.trackingNumber || "").trim()

  if (!shipmentId && !trackingNumber) {
    return null
  }

  const rows = await pgConnection("fulfillment as f")
    .leftJoin("fulfillment_label as fl", "fl.fulfillment_id", "f.id")
    .innerJoin("order_fulfillment as of", "of.fulfillment_id", "f.id")
    .whereNull("f.deleted_at")
    .whereNull("of.deleted_at")
    .andWhere(function applySignals() {
      if (shipmentId) {
        this.orWhereRaw(
          "lower(coalesce(f.metadata->>'shipbubble_shipment_id', '')) = lower(?)",
          [shipmentId]
        )
      }

      if (trackingNumber) {
        this.orWhereRaw(
          "lower(coalesce(f.metadata->>'tracking_number', '')) = lower(?)",
          [trackingNumber]
        ).orWhereRaw("lower(coalesce(fl.tracking_number, '')) = lower(?)", [
          trackingNumber,
        ])
      }
    })
    .distinct("of.order_id")

  const orderIds = (rows || [])
    .map((row: Record<string, unknown>) => toStringOrNull(row.order_id))
    .filter((id): id is string => Boolean(id))

  if (orderIds.length !== 1) {
    return null
  }

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [...ORDER_QUERY_FIELDS],
    filters: {
      id: orderIds[0],
    },
  })

  return ((orders || [])[0] as Record<string, unknown> | undefined) ?? null
}

const wasEventProcessed = (
  metadata: Record<string, unknown> | null | undefined,
  eventKey: string
): boolean => {
  const data = toRecord(metadata)

  if (data[SHIPBUBBLE_LAST_EVENT_KEY] === eventKey) {
    return true
  }

  const history = Array.isArray(data[SHIPBUBBLE_HISTORY_KEY])
    ? (data[SHIPBUBBLE_HISTORY_KEY] as unknown[])
    : []

  return history.some((entry) => {
    const item = toRecord(entry)
    return item.event_key === eventKey
  })
}

const resolveFulfillmentCandidate = (
  fulfillments: FulfillmentLike[],
  shipmentId: string | null,
  trackingNumber: string | null
): FulfillmentLike | null => {
  if (!fulfillments.length) {
    return null
  }

  const matched = fulfillments.filter((fulfillment) => {
    const metadata = toRecord(fulfillment.metadata)
    const metadataShipmentId = toStringOrNull(metadata.shipbubble_shipment_id)
    const metadataTracking = toStringOrNull(metadata.tracking_number)
    const labelTracking = getTrackingNumbersFromLabels(fulfillment.labels)

    const shipmentMatch =
      !!shipmentId && equalsIgnoreCase(metadataShipmentId, shipmentId)
    const trackingMatch =
      !!trackingNumber &&
      (equalsIgnoreCase(metadataTracking, trackingNumber) ||
        labelTracking.some((value) => equalsIgnoreCase(value, trackingNumber)))

    return shipmentMatch || trackingMatch
  })

  if (matched.length === 1) {
    return matched[0]
  }

  if (matched.length > 1) {
    return null
  }

  if (fulfillments.length === 1) {
    return fulfillments[0]
  }

  return null
}

const buildUpdatedMetadata = ({
  currentMetadata,
  eventKey,
  action,
  status,
  statusRaw,
  occurredAt,
  trackingNumber,
  shipmentId,
  errorMessage,
}: {
  currentMetadata: Record<string, unknown> | null | undefined
  eventKey: string
  action: ShipbubbleSyncAction
  status: string
  statusRaw: string | null
  occurredAt: Date | null
  trackingNumber: string | null
  shipmentId: string | null
  errorMessage?: string
}): Record<string, unknown> => {
  const metadata = toRecord(currentMetadata) as ShipbubbleFulfillmentMetadata &
    JsonRecord
  const existingHistory = Array.isArray(metadata[SHIPBUBBLE_HISTORY_KEY])
    ? (metadata[SHIPBUBBLE_HISTORY_KEY] as unknown[])
    : []
  const resolvedTrackingNumber =
    trackingNumber ?? toStringOrNull(metadata.tracking_number)
  const resolvedShipmentId =
    shipmentId ?? toStringOrNull(metadata.shipbubble_shipment_id)

  const nextEntry: Record<string, unknown> = {
    event_key: eventKey,
    status,
    raw_status: statusRaw,
    action,
    tracking_number: trackingNumber,
    shipbubble_shipment_id: shipmentId,
    occurred_at: occurredAt?.toISOString() ?? null,
    synced_at: new Date().toISOString(),
  }

  if (errorMessage) {
    nextEntry.error = errorMessage
  }

  const history = [...existingHistory, nextEntry].slice(-MAX_STATUS_HISTORY)

  return {
    ...metadata,
    ...(resolvedShipmentId
      ? { shipbubble_shipment_id: resolvedShipmentId }
      : {}),
    ...(resolvedTrackingNumber
      ? { tracking_number: resolvedTrackingNumber }
      : {}),
    [SHIPBUBBLE_LAST_EVENT_KEY]: eventKey,
    [SHIPBUBBLE_LAST_STATUS]: status,
    [SHIPBUBBLE_LAST_STATUS_AT]:
      occurredAt?.toISOString() ?? new Date().toISOString(),
    [SHIPBUBBLE_LAST_ACTION]: action,
    [SHIPBUBBLE_HISTORY_KEY]: history,
    [SHIPBUBBLE_SYNC_EXCEPTION]: errorMessage || null,
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const requireSignature = parseBooleanEnv(
    process.env.SHIPBUBBLE_WEBHOOK_REQUIRE_SIGNATURE,
    true
  )
  const webhookSecret = process.env.SHIPBUBBLE_WEBHOOK_SECRET || ""
  const signatureHeader = toStringOrNull(
    req.get("x-ship-signature") ||
      req.get("x-shipbubble-signature") ||
      req.headers["x-ship-signature"] ||
      req.headers["x-shipbubble-signature"]
  )

  if (requireSignature) {
    if (!webhookSecret) {
      logger.error(
        "[shipbubble-webhook] SHIPBUBBLE_WEBHOOK_SECRET is required when signature verification is enabled"
      )
      res.status(500).json({
        message: "ShipBubble webhook secret is not configured",
      })
      return
    }

    if (!signatureHeader) {
      res.status(401).json({ message: "Missing x-ship-signature header" })
      return
    }

    const rawBody = getRawBodyString(req)
    const isValid = isValidHmacSignature(rawBody, signatureHeader, webhookSecret)

    if (!isValid) {
      res.status(401).json({ message: "Invalid webhook signature" })
      return
    }
  }

  const payload = toRecord(req.body)
  const envelope = extractShipbubbleWebhookEnvelope(payload)

  if (!envelope.status_raw) {
    res.status(200).json({
      received: true,
      ignored: true,
      reason: "missing_status",
    })
    return
  }

  if (!envelope.order_reference) {
    logger.warn("[shipbubble-webhook] missing order reference in payload")
    res.status(200).json({
      received: true,
      ignored: true,
      reason: "missing_order_reference",
    })
    return
  }

  let order = await findOrderByReference(query, envelope.order_reference)

  if (!order) {
    order = await findOrderByShipmentSignals(query, pgConnection, {
      shipmentId: envelope.shipment_id,
      trackingNumber: envelope.tracking_number,
    })
  }

  if (!order) {
    logger.warn(
      `[shipbubble-webhook] order not found for reference=${envelope.order_reference}`
    )
    res.status(200).json({
      received: true,
      ignored: true,
      reason: "order_not_found",
    })
    return
  }

  const fulfillments = Array.isArray(order.fulfillments)
    ? (order.fulfillments as FulfillmentLike[])
    : []

  const targetFulfillment = resolveFulfillmentCandidate(
    fulfillments,
    envelope.shipment_id,
    envelope.tracking_number
  )

  if (!targetFulfillment) {
    logger.warn(
      `[shipbubble-webhook] unable to resolve fulfillment for order=${String(
        order.id
      )} shipment_id=${String(envelope.shipment_id ?? "")} tracking=${String(
        envelope.tracking_number ?? ""
      )}`
    )
    res.status(200).json({
      received: true,
      ignored: true,
      reason: "fulfillment_not_resolved",
    })
    return
  }

  const eventKey = createShipbubbleEventKey(
    envelope,
    String(order.id),
    targetFulfillment.id
  )

  if (wasEventProcessed(targetFulfillment.metadata, eventKey)) {
    res.status(200).json({
      received: true,
      processed: true,
      duplicate: true,
    })
    return
  }

  const action = resolveShipbubbleSyncAction(envelope.status)
  const statusForMetadata = envelope.status ?? envelope.status_raw

  let actionError: string | undefined
  let appliedAction: ShipbubbleSyncAction = action

  try {
    if (action === "set_shipped") {
      if (
        !targetFulfillment.shipped_at &&
        !targetFulfillment.delivered_at &&
        !targetFulfillment.canceled_at
      ) {
        await updateFulfillmentWorkflow.run({
          container: req.scope,
          input: {
            id: targetFulfillment.id,
            shipped_at: envelope.occurred_at ?? new Date(),
          },
        })
      } else {
        appliedAction = "noop"
      }
    } else if (action === "set_delivered") {
      if (!targetFulfillment.delivered_at && !targetFulfillment.canceled_at) {
        await markOrderFulfillmentAsDeliveredWorkflow.run({
          container: req.scope,
          input: {
            orderId: String(order.id),
            fulfillmentId: targetFulfillment.id,
          },
        })
      } else {
        appliedAction = "noop"
      }
    } else if (action === "cancel_if_unshipped") {
      if (
        !targetFulfillment.canceled_at &&
        !targetFulfillment.shipped_at &&
        !targetFulfillment.delivered_at
      ) {
        await cancelOrderFulfillmentWorkflow.run({
          container: req.scope,
          input: {
            order_id: String(order.id),
            fulfillment_id: targetFulfillment.id,
            no_notification: true,
          },
        })
      } else {
        appliedAction = "flag_exception"
        actionError =
          "Received cancelled status for a fulfillment that is already shipped/delivered."
      }
    }
  } catch (error) {
    appliedAction = "flag_exception"
    actionError = error instanceof Error ? error.message : "Unknown sync error"
    logger.error(
      `[shipbubble-webhook] action failed order=${String(order.id)} fulfillment=${
        targetFulfillment.id
      } status=${statusForMetadata} error=${actionError}`
    )
  }

  const metadata = buildUpdatedMetadata({
    currentMetadata: targetFulfillment.metadata,
    eventKey,
    action: appliedAction,
    status: statusForMetadata,
    statusRaw: envelope.status_raw,
    occurredAt: envelope.occurred_at,
    trackingNumber: envelope.tracking_number,
    shipmentId: envelope.shipment_id,
    errorMessage: actionError,
  })

  await updateFulfillmentWorkflow.run({
    container: req.scope,
    input: {
      id: targetFulfillment.id,
      metadata,
    },
  })

  res.status(200).json({
    received: true,
    processed: true,
    action: appliedAction,
    status: statusForMetadata,
  })
}
