import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslation } from "react-i18next"
import * as zod from "zod"

import { Button, Heading, Input, Text, toast } from "@medusajs/ui"
import { useFieldArray, useForm } from "react-hook-form"
import { useState } from "react"

import { Form } from "../../../../../components/common/form"
import {
  RouteFocusModal,
  useRouteModal,
} from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import { useCreateOrderShipment } from "../../../../../hooks/api"
import {
  ExtendedAdminOrder,
  ExtendedAdminOrderFulfillment,
} from "../../../../../types/order"
import { CreateShipmentSchema } from "./constants"

type OrderCreateFulfillmentFormProps = {
  order: ExtendedAdminOrder
  fulfillment: ExtendedAdminOrderFulfillment
}

type ShipmentLabel = {
  tracking_number: string
  tracking_url?: string
  label_url?: string
}

export function OrderCreateShipmentForm({
  order,
  fulfillment,
}: OrderCreateFulfillmentFormProps) {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()

  const { mutateAsync: createShipment, isPending: isMutating } =
    useCreateOrderShipment(order.id, fulfillment?.id)

  const isShipbubbleFulfillment = fulfillment.provider_id
    .toLowerCase()
    .includes("shipbubble")

  const form = useForm<zod.infer<typeof CreateShipmentSchema>>({
    defaultValues: {
      labels: [
        {
          tracking_number: "",
          tracking_url: "",
          label_url: "",
        },
      ],
    },
    resolver: zodResolver(CreateShipmentSchema),
  })

  const { fields: labels, append, remove } = useFieldArray({
    name: "labels",
    control: form.control,
  })

  const [shipbubbleResult, setShipbubbleResult] =
    useState<ShipmentLabel | null>(null)

  const handleSubmit = form.handleSubmit(async (data) => {
    const fallbackLabels = data.labels
      .filter((label) => label.tracking_number.trim().length)
      .map((label) => ({
        tracking_number: label.tracking_number.trim(),
        tracking_url: label.tracking_url?.trim() || "",
        label_url: label.label_url?.trim() || "",
      }))

    try {
      const response = await createShipment({
        items:
          fulfillment?.items
            ?.map((item) => ({ id: item?.line_item_id, quantity: item.quantity }))
            .filter((item) => !!item.id) ?? [],
        labels: fallbackLabels,
      })

      const responseOrder = response.order as ExtendedAdminOrder
      const updatedFulfillment = (responseOrder.fulfillments || []).find(
        (item) => item.id === fulfillment.id
      ) as ExtendedAdminOrderFulfillment | undefined

      const latestLabel = updatedFulfillment?.labels?.[0]

      if (isShipbubbleFulfillment && latestLabel?.tracking_number) {
        form.reset()
        setShipbubbleResult(latestLabel)
        toast.success("Shipment booked with ShipBubble")
        return
      }

      toast.success(t("orders.shipment.toastCreated"))
      handleSuccess(`/orders/${order.id}`)
    } catch (error: any) {
      toast.error(error.message)
    }
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex h-full flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                {shipbubbleResult ? "Done" : t("actions.cancel")}
              </Button>
            </RouteFocusModal.Close>
            {!shipbubbleResult && (
              <Button size="small" type="submit" isLoading={isMutating}>
                {t("actions.save")}
              </Button>
            )}
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex h-full w-full flex-col items-center divide-y overflow-y-auto">
          <div className="flex size-full flex-col items-center overflow-auto p-16">
            <div className="flex w-full max-w-[736px] flex-col justify-center px-2 pb-2">
              <div className="flex flex-col divide-y">
                <div className="flex flex-1 flex-col">
                  <Heading className="mb-4">
                    {shipbubbleResult ? "ShipBubble Booking Result" : t("orders.shipment.title")}
                  </Heading>

                  {shipbubbleResult ? (
                    <div className="space-y-3">
                      <div>
                        <Text className="txt-compact-small-plus">Tracking Number</Text>
                        <Text>{shipbubbleResult.tracking_number}</Text>
                      </div>

                      {shipbubbleResult.tracking_url && (
                        <div>
                          <Text className="txt-compact-small-plus">Tracking URL</Text>
                          <a
                            href={shipbubbleResult.tracking_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                          >
                            {shipbubbleResult.tracking_url}
                          </a>
                        </div>
                      )}

                      {shipbubbleResult.label_url && (
                        <div>
                          <Text className="txt-compact-small-plus">Label URL</Text>
                          <a
                            href={shipbubbleResult.label_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                          >
                            {shipbubbleResult.label_url}
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {isShipbubbleFulfillment && (
                        <Text className="mb-4 text-ui-fg-subtle">
                          ShipBubble booking runs automatically. Add fallback label details only if you want to force manual shipment labels.
                        </Text>
                      )}

                      {labels.map((label, index) => (
                        <div key={label.id} className="mb-4 rounded-md border p-4">
                          <Form.Field
                            control={form.control}
                            name={`labels.${index}.tracking_number`}
                            render={({ field }) => {
                              return (
                                <Form.Item className="mb-3">
                                  <Form.Label>Tracking Number</Form.Label>
                                  <Form.Control>
                                    <Input {...field} placeholder="TRACK123456" />
                                  </Form.Control>
                                  <Form.ErrorMessage />
                                </Form.Item>
                              )
                            }}
                          />

                          <Form.Field
                            control={form.control}
                            name={`labels.${index}.tracking_url`}
                            render={({ field }) => {
                              return (
                                <Form.Item className="mb-3">
                                  <Form.Label>Tracking URL</Form.Label>
                                  <Form.Control>
                                    <Input
                                      {...field}
                                      placeholder="https://courier.example/track/TRACK123456"
                                    />
                                  </Form.Control>
                                  <Form.ErrorMessage />
                                </Form.Item>
                              )
                            }}
                          />

                          <Form.Field
                            control={form.control}
                            name={`labels.${index}.label_url`}
                            render={({ field }) => {
                              return (
                                <Form.Item>
                                  <Form.Label>Label URL</Form.Label>
                                  <Form.Control>
                                    <Input
                                      {...field}
                                      placeholder="https://courier.example/labels/TRACK123456.pdf"
                                    />
                                  </Form.Control>
                                  <Form.ErrorMessage />
                                </Form.Item>
                              )
                            }}
                          />

                          {labels.length > 1 && (
                            <Button
                              type="button"
                              onClick={() => remove(index)}
                              className="mt-3"
                              variant="secondary"
                              size="small"
                            >
                              Remove label
                            </Button>
                          )}
                        </div>
                      ))}

                      <Button
                        type="button"
                        onClick={() =>
                          append({
                            tracking_number: "",
                            tracking_url: "",
                            label_url: "",
                          })
                        }
                        className="self-end"
                        variant="secondary"
                      >
                        Add label
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
