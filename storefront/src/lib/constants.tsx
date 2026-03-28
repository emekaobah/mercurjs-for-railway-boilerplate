import React from "react"
import { Cash, CreditCard } from "@medusajs/icons"

/* Map of payment provider_id to their title and icon. Add in any payment providers you want to use. */
export const paymentInfoMap: Record<
  string,
  { title: string; icon: React.JSX.Element }
> = {
  "pp_card_stripe-connect": {
    title: "Credit card",
    icon: <CreditCard />,
  },
  pp_stripe_stripe: {
    title: "Credit card",
    icon: <CreditCard />,
  },
  "pp_stripe-ideal_stripe": {
    title: "iDeal",
    icon: <CreditCard />,
  },
  "pp_stripe-bancontact_stripe": {
    title: "Bancontact",
    icon: <CreditCard />,
  },
  pp_paypal_paypal: {
    title: "PayPal",
    icon: <CreditCard />,
  },
  pp_system_default: {
    title: "Manual Payment",
    icon: <Cash />,
  },
  pp_virtualpay_retail: {
    title: "VirtualPay Transfer",
    icon: <Cash />,
  },
  // Add more payment providers here
}

// This only checks if it is native stripe for card payments, it ignores the other stripe-based providers
export const isStripe = (providerId?: string) => {
  return providerId?.startsWith("pp_card_stripe-connect")
}
export const isPaypal = (providerId?: string) => {
  return providerId?.startsWith("pp_paypal")
}
export const isManual = (providerId?: string) => {
  return providerId?.startsWith("pp_system_default")
}
export const isVirtualPay = (providerId?: string) => {
  return providerId?.startsWith("pp_virtualpay_")
}
export const isAsyncPaymentProvider = (providerId?: string) => {
  return isVirtualPay(providerId)
}
export const getPaymentProviderTitle = (providerId?: string) => {
  if (!providerId) {
    return "Payment"
  }

  const mapped = paymentInfoMap[providerId]?.title
  if (mapped) {
    return mapped
  }

  const id = providerId.toLowerCase()
  if (id.includes("virtualpay")) return "VirtualPay Transfer"
  if (id.includes("stripe")) return "Credit card"
  if (id.includes("system_default")) return "Manual Payment"
  return providerId
}

// Add currencies that don't need to be divided by 100
export const noDivisionCurrencies = [
  "krw",
  "jpy",
  "vnd",
  "clp",
  "pyg",
  "xaf",
  "xof",
  "bif",
  "djf",
  "gnf",
  "kmf",
  "mga",
  "rwf",
  "xpf",
  "htg",
  "vuv",
  "xag",
  "xdr",
  "xau",
]
