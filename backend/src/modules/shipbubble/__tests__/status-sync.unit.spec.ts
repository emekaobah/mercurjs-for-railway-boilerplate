import {
  createShipbubbleEventKey,
  extractShipbubbleWebhookEnvelope,
  resolveShipbubbleSyncAction,
} from "../status-sync"

describe("shipbubble status sync", () => {
  it("normalizes common webhook payload variants", () => {
    const envelope = extractShipbubbleWebhookEnvelope({
      status: "Out for delivery",
      order_reference: "order_123",
      shipment: {
        id: "ship_abc",
        tracking_no: "TRK001",
      },
      event_id: "evt_1",
      timestamp: "2026-02-28T10:00:00.000Z",
    })

    expect(envelope.status).toBe("in_transit")
    expect(envelope.order_reference).toBe("order_123")
    expect(envelope.shipment_id).toBe("ship_abc")
    expect(envelope.tracking_number).toBe("TRK001")
    expect(envelope.event_id).toBe("evt_1")
    expect(envelope.occurred_at?.toISOString()).toBe("2026-02-28T10:00:00.000Z")
  })

  it("maps shipbubble statuses to medusa sync actions", () => {
    expect(resolveShipbubbleSyncAction("pending")).toBe("noop")
    expect(resolveShipbubbleSyncAction("confirmed")).toBe("noop")
    expect(resolveShipbubbleSyncAction("picked_up")).toBe("set_shipped")
    expect(resolveShipbubbleSyncAction("in_transit")).toBe("set_shipped")
    expect(resolveShipbubbleSyncAction("completed")).toBe("set_delivered")
    expect(resolveShipbubbleSyncAction("cancelled")).toBe("cancel_if_unshipped")
    expect(resolveShipbubbleSyncAction(null)).toBe("flag_exception")
  })

  it("generates deterministic but unique event keys by fulfillment", () => {
    const envelope = extractShipbubbleWebhookEnvelope({
      status: "completed",
      order_reference: "order_123",
      shipment_id: "ship_123",
      tracking_number: "TRK123",
      event_id: "evt_done_1",
      occurred_at: "2026-02-28T12:00:00.000Z",
    })

    const keyA = createShipbubbleEventKey(envelope, "order_123", "ful_1")
    const keyB = createShipbubbleEventKey(envelope, "order_123", "ful_1")
    const keyC = createShipbubbleEventKey(envelope, "order_123", "ful_2")

    expect(keyA).toEqual(keyB)
    expect(keyA).not.toEqual(keyC)
  })
})

