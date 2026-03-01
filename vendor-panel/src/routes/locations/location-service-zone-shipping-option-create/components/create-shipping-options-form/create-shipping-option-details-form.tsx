import { Heading, Input, RadioGroup, Select, Text } from "@medusajs/ui"
import { UseFormReturn, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { useEffect } from "react"
import { VendorExtendedAdminServiceZone } from "../../../../../types/stock-location"

import { Form } from "../../../../../components/common/form"
import { Combobox } from "../../../../../components/inputs/combobox"
import { useComboboxData } from "../../../../../hooks/use-combobox-data"
import { useFulfillmentProviderOptions } from "../../../../../hooks/api"
import { fetchQuery } from "../../../../../lib/client"
import { formatProvider } from "../../../../../lib/format-provider"
import {
  FulfillmentSetType,
  ShippingOptionPriceType,
} from "../../../common/constants"
import { CreateShippingOptionSchema } from "./schema"

type CreateShippingOptionDetailsFormProps = {
  form: UseFormReturn<CreateShippingOptionSchema>
  isReturn?: boolean
  zone: VendorExtendedAdminServiceZone
  type: FulfillmentSetType
}

export const CreateShippingOptionDetailsForm = ({
  form,
  isReturn = false,
  zone,
  type,
}: CreateShippingOptionDetailsFormProps) => {
  const { t } = useTranslation()

  const isPickup = type === FulfillmentSetType.Pickup

  const shippingProfiles = useComboboxData({
    queryFn: (params) =>
      fetchQuery(`/vendor/shipping-profiles`, {
        method: "GET",
        query: params,
      }),
    queryKey: ["shipping_profiles_create_shipping_option"],
    getOptions: (data) =>
      (data.shipping_profiles || []).map((profile: any) => ({
        label: profile.shipping_profile.name.includes(":")
          ? profile.shipping_profile.name.split(":")[1]
          : profile.shipping_profile.name,
        value: profile.shipping_profile.id,
      })),
  })

  const fulfillmentProviders = useComboboxData({
    queryFn: (params) =>
      fetchQuery(`/vendor/fulfillment-providers`, {
        method: "GET",
        query: params,
      }),
    queryKey: ["fulfillment_providers_create_shipping_option"],
    getOptions: (data) =>
      (data.fulfillment_providers || []).map((provider: any) => ({
        label: formatProvider(provider.id),
        value: provider.id,
      })),
  })

  const selectedProviderId = useWatch({
    control: form.control,
    name: "provider_id",
  })

  const isShipbubbleProvider = selectedProviderId
    ?.toLowerCase()
    .includes("shipbubble")

  const { fulfillment_options: fulfillmentProviderOptions = [] } =
    useFulfillmentProviderOptions(selectedProviderId || "", {
      enabled: !!selectedProviderId,
    })

  useEffect(() => {
    if (
      isShipbubbleProvider &&
      form.getValues("price_type") !== ShippingOptionPriceType.Calculated
    ) {
      form.setValue("price_type", ShippingOptionPriceType.Calculated)
    }
  }, [isShipbubbleProvider, form])

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto">
      <div className="flex w-full max-w-[720px] flex-col gap-y-8 px-6 py-16">
        <div>
          <Heading>
            {t(
              `stockLocations.shippingOptions.create.${
                isPickup ? "pickup" : isReturn ? "returns" : "shipping"
              }.header`,
              {
                zone: zone.name,
              }
            )}
          </Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t(
              `stockLocations.shippingOptions.create.${
                isReturn ? "returns" : isPickup ? "pickup" : "shipping"
              }.hint`
            )}
          </Text>
        </div>

        {!isPickup && (
          <Form.Field
            control={form.control}
            name="price_type"
            render={({ field }) => {
              return (
                <Form.Item>
                  <Form.Label>
                    {t("stockLocations.shippingOptions.fields.priceType.label")}
                  </Form.Label>
                  <Form.Control>
                    <RadioGroup
                      className="grid grid-cols-1 gap-4 md:grid-cols-2"
                      {...field}
                      onValueChange={field.onChange}
                    >
                      <RadioGroup.ChoiceBox
                        className="flex-1"
                        value={ShippingOptionPriceType.FlatRate}
                        label={t(
                          "stockLocations.shippingOptions.fields.priceType.options.fixed.label"
                        )}
                        description={t(
                          "stockLocations.shippingOptions.fields.priceType.options.fixed.hint"
                        )}
                        disabled={isShipbubbleProvider}
                      />
                      <RadioGroup.ChoiceBox
                        className="flex-1"
                        value={ShippingOptionPriceType.Calculated}
                        label={t(
                          "stockLocations.shippingOptions.fields.priceType.options.calculated.label"
                        )}
                        description={t(
                          "stockLocations.shippingOptions.fields.priceType.options.calculated.hint"
                        )}
                      />
                    </RadioGroup>
                  </Form.Control>
                  {isShipbubbleProvider && (
                    <Form.Hint>
                      ShipBubble shipping options must use calculated pricing.
                    </Form.Hint>
                  )}
                  <Form.ErrorMessage />
                </Form.Item>
              )
            }}
          />
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Form.Field
            control={form.control}
            name="name"
            render={({ field }) => {
              return (
                <Form.Item>
                  <Form.Label>{t("fields.name")}</Form.Label>
                  <Form.Control>
                    <Input {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )
            }}
          />
          <Form.Field
            control={form.control}
            name="shipping_profile_id"
            render={({ field }) => {
              return (
                <Form.Item>
                  <Form.Label>
                    {t("stockLocations.shippingOptions.fields.profile")}
                  </Form.Label>
                  <Form.Control>
                    <Combobox
                      {...field}
                      options={shippingProfiles.options}
                      searchValue={shippingProfiles.searchValue}
                      onSearchValueChange={shippingProfiles.onSearchValueChange}
                      disabled={shippingProfiles.disabled}
                    />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )
            }}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Form.Field
            control={form.control}
            name="provider_id"
            render={({ field }) => {
              return (
                <Form.Item>
                  <Form.Label
                    tooltip={t(
                      "stockLocations.fulfillmentProviders.shippingOptionsTooltip"
                    )}
                  >
                    {t("stockLocations.shippingOptions.fields.provider")}
                  </Form.Label>
                  <Form.Control>
                    <Combobox
                      {...field}
                      onChange={(value) => {
                        field.onChange(value)
                        form.setValue("fulfillment_option_id", "")

                        if (String(value).toLowerCase().includes("shipbubble")) {
                          form.setValue(
                            "price_type",
                            ShippingOptionPriceType.Calculated
                          )
                        }
                      }}
                      options={fulfillmentProviders.options}
                      searchValue={fulfillmentProviders.searchValue}
                      onSearchValueChange={
                        fulfillmentProviders.onSearchValueChange
                      }
                      disabled={fulfillmentProviders.disabled}
                    />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )
            }}
          />

          <Form.Field
            control={form.control}
            name="fulfillment_option_id"
            render={({ field }) => {
              return (
                <Form.Item>
                  <Form.Label>
                    {t(
                      "stockLocations.shippingOptions.fields.fulfillmentOption"
                    )}
                  </Form.Label>
                  <Form.Control>
                    <Select
                      {...field}
                      onValueChange={field.onChange}
                      disabled={!selectedProviderId}
                      key={selectedProviderId}
                    >
                      <Select.Trigger ref={field.ref}>
                        <Select.Value />
                      </Select.Trigger>

                      <Select.Content>
                        {fulfillmentProviderOptions
                          .filter((option: any) =>
                            isReturn
                              ? Boolean(option.is_return)
                              : !Boolean(option.is_return)
                          )
                          .map((option: any) => (
                            <Select.Item value={option.id} key={option.id}>
                              {String(option.name || option.service_name || option.id)}
                            </Select.Item>
                          ))}
                      </Select.Content>
                    </Select>
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )
            }}
          />
        </div>
      </div>
    </div>
  )
}
