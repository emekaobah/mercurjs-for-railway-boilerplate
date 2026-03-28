import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

type InjectedDependencies = {
  logger: Logger
}

type VirtualPaySessionData = Record<string, unknown> & {
  id?: string
  request_id?: string
  session_id?: string
  customer_id?: string
  expected_amount?: string | number
  currency_code?: string
}

type VirtualPayApiResponse = {
  response_code?: string
  response_message?: string
  response_data?: unknown
  [key: string]: unknown
}

export interface VirtualPayRetailProviderOptions {
  baseUrl: string
  secretKey: string
  merchantId: string
  channelCode: string
  requestAuthorizer?: string
  timeoutMs?: number | string
  accountDetailsEndpoint?: string
  accountDetailsChannelCode?: string
  accountDetailsAuthKey?: string
}

const DEFAULT_TIMEOUT_MS = 15000
const STATUS_PENDING = new Set([
  "PENDING",
  "PROCESSING",
  "IN_PROGRESS",
  "INITIATED",
  "QUEUED",
])
const STATUS_SUCCESS = new Set([
  "COMPLETED",
  "COMPLETE",
  "SUCCESS",
  "SUCCESSFUL",
  "PAID",
])
const STATUS_FAILED = new Set(["FAILED", "ERROR", "DECLINED", "UNSUCCESSFUL"])
const STATUS_CANCELED = new Set(["CANCELLED", "CANCELED", "EXPIRED"])

const toRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

const toStringOrUndefined = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  return undefined
}

const toNumberOrUndefined = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim()
    if (!normalized) {
      return undefined
    }
    const parsed = Number(normalized)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

const normalizeUpper = (value: unknown): string => {
  const resolved = toStringOrUndefined(value)
  return resolved ? resolved.toUpperCase() : ""
}

const toRecordArray = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => toRecord(entry))
    .filter((entry) => Object.keys(entry).length > 0)
}

const tryParseJson = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value
  }

  const normalized = value.trim()
  if (!normalized) {
    return value
  }

  if (
    (!normalized.startsWith("{") || !normalized.endsWith("}")) &&
    (!normalized.startsWith("[") || !normalized.endsWith("]"))
  ) {
    return value
  }

  try {
    return JSON.parse(normalized)
  } catch {
    return value
  }
}

class VirtualPayRetailProviderService extends AbstractPaymentProvider<VirtualPayRetailProviderOptions> {
  static identifier = "virtualpay"

  protected readonly logger_: Logger
  protected readonly options_: Required<
    Pick<
      VirtualPayRetailProviderOptions,
      "baseUrl" | "secretKey" | "merchantId" | "channelCode" | "timeoutMs"
    >
  > &
    Omit<
      VirtualPayRetailProviderOptions,
      "baseUrl" | "secretKey" | "merchantId" | "channelCode" | "timeoutMs"
    >

  static validateOptions(options: Record<string, unknown>) {
    const requiredFields = ["baseUrl", "secretKey", "merchantId", "channelCode"]
    for (const field of requiredFields) {
      if (!toStringOrUndefined(options[field])) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Missing required VirtualPay option: ${field}`
        )
      }
    }
  }

  constructor(
    container: InjectedDependencies,
    options: VirtualPayRetailProviderOptions
  ) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = {
      ...options,
      baseUrl: options.baseUrl.replace(/\/+$/, ""),
      secretKey: options.secretKey,
      merchantId: options.merchantId,
      channelCode: options.channelCode,
      timeoutMs: Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS,
    }
  }

  private buildProviderError(message: string, error: unknown): MedusaError {
    const details =
      error instanceof Error ? error.message : JSON.stringify(error ?? {})
    return new MedusaError(
      MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
      `${message}: ${details}`
    )
  }

  private getResponseDataCandidates(
    response: VirtualPayApiResponse
  ): Record<string, unknown>[] {
    const direct = toRecord(response)
    const responseDataValue =
      tryParseJson(response.response_data) ??
      direct.responseData ??
      direct.data ??
      direct.result ??
      direct.payload

    const candidates: Record<string, unknown>[] = []
    const directData = toRecord(responseDataValue)
    if (Object.keys(directData).length) {
      candidates.push(directData)
    }

    candidates.push(...toRecordArray(responseDataValue))
    candidates.push(direct)

    const nestedInDirect =
      direct.response_data ??
      direct.responseData ??
      direct.data ??
      direct.result ??
      direct.payload
    if (nestedInDirect !== responseDataValue) {
      const nestedData = toRecord(nestedInDirect)
      if (Object.keys(nestedData).length) {
        candidates.push(nestedData)
      }
      candidates.push(...toRecordArray(nestedInDirect))
    }

    return candidates
  }

  private pickStringFromCandidates(
    candidates: Record<string, unknown>[],
    keys: string[]
  ): string | undefined {
    for (const candidate of candidates) {
      for (const key of keys) {
        const resolved = toStringOrUndefined(candidate[key])
        if (resolved) {
          return resolved
        }
      }
    }
    return undefined
  }

  private pickNumberFromCandidates(
    candidates: Record<string, unknown>[],
    keys: string[]
  ): number | undefined {
    for (const candidate of candidates) {
      for (const key of keys) {
        const resolved = toNumberOrUndefined(candidate[key])
        if (typeof resolved === "number") {
          return resolved
        }
      }
    }
    return undefined
  }

  private resolveAmountString(value: unknown): string {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }

    const record = toRecord(value)
    const nestedValue =
      toStringOrUndefined(record.value) ??
      toStringOrUndefined(record.amount) ??
      toStringOrUndefined(record.raw)

    if (nestedValue) {
      return nestedValue
    }

    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "VirtualPay received an invalid amount format"
    )
  }

  private async postJson(
    path: string,
    payload: Record<string, unknown>
  ): Promise<VirtualPayApiResponse> {
    const target = path.startsWith("http")
      ? path
      : `${this.options_.baseUrl}/${path.replace(/^\/+/, "")}`

    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      Number(this.options_.timeoutMs)
    )

    try {
      const response = await fetch(target, {
        method: "POST",
        headers: {
          Authorization: this.options_.secretKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      const rawText = await response.text()
      let body: VirtualPayApiResponse = {}
      if (rawText.trim()) {
        try {
          body = JSON.parse(rawText) as VirtualPayApiResponse
        } catch (error) {
          throw new Error(`VirtualPay returned non-JSON body: ${rawText}`)
        }
      }

      if (!response.ok) {
        throw new Error(
          `VirtualPay request failed with HTTP ${response.status} (${response.statusText})`
        )
      }

      return body
    } catch (error) {
      throw this.buildProviderError(`VirtualPay request failed for ${path}`, error)
    } finally {
      clearTimeout(timeout)
    }
  }

  private buildCheckStatusPayload(data: VirtualPaySessionData) {
    const requestId = toStringOrUndefined(data.request_id) ?? toStringOrUndefined(data.id)
    const sessionId = toStringOrUndefined(data.session_id)

    return {
      channel_code: this.options_.channelCode,
      merchant_id: this.options_.merchantId,
      ...(requestId ? { request_id: requestId } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
    }
  }

  private mapStatusFromResponse(
    response: VirtualPayApiResponse,
    data: VirtualPaySessionData
  ): PaymentSessionStatus {
    const candidates = this.getResponseDataCandidates(response)
    const responseData = candidates[0] || {}
    const transactionStatus = normalizeUpper(
      this.pickStringFromCandidates(candidates, [
        "transaction_status",
        "transactionStatus",
        "status",
      ])
    )
    const paymentStatus = normalizeUpper(
      this.pickStringFromCandidates(candidates, [
        "payment_status",
        "paymentStatus",
        "payment_status_desc",
        "paymentStatusDesc",
      ]) ?? response.payment_status
    )
    const transactionCode = normalizeUpper(
      this.pickStringFromCandidates(candidates, [
        "tran_response_code",
        "tranResponseCode",
        "response_code",
        "responseCode",
        "status_code",
        "statusCode",
      ]) ??
        response.tran_response_code ??
        response.response_code
    )
    const amountPaid = this.pickNumberFromCandidates(candidates, [
      "amount_paid",
      "amountPaid",
      "transaction_amount",
      "transactionAmount",
      "amount",
    ])
    const expectedAmount = toNumberOrUndefined(data.expected_amount)

    if (paymentStatus === "AMOUNT MISMATCH") {
      return PaymentSessionStatus.REQUIRES_MORE
    }

    if (
      transactionCode === "00" &&
      (STATUS_SUCCESS.has(transactionStatus) ||
        paymentStatus === "COMPLETE" ||
        paymentStatus === "SUCCESSFUL" ||
        paymentStatus === "SUCCESS")
    ) {
      if (
        typeof expectedAmount === "number" &&
        typeof amountPaid === "number" &&
        amountPaid + 0.000001 < expectedAmount
      ) {
        return PaymentSessionStatus.REQUIRES_MORE
      }

      return PaymentSessionStatus.CAPTURED
    }

    if (STATUS_CANCELED.has(transactionStatus)) {
      return PaymentSessionStatus.CANCELED
    }

    if (transactionCode === "99" || STATUS_FAILED.has(transactionStatus)) {
      return PaymentSessionStatus.ERROR
    }

    if (STATUS_PENDING.has(transactionStatus) || transactionCode === "01") {
      return PaymentSessionStatus.PENDING
    }

    return PaymentSessionStatus.PENDING
  }

  private resolveCallbackSessionId(payload: Record<string, unknown>): string | undefined {
    const customerId = toStringOrUndefined(payload.customer_id)
    if (customerId?.startsWith("payses_")) {
      return customerId
    }
    return (
      toStringOrUndefined(payload.session_id) ??
      customerId ??
      toStringOrUndefined(payload.request_id)
    )
  }

  private resolveFullNameFromRecord(record: Record<string, unknown>): string | undefined {
    const directName =
      toStringOrUndefined(record.customer_name) ??
      toStringOrUndefined(record.customerName) ??
      toStringOrUndefined(record.full_name) ??
      toStringOrUndefined(record.fullName) ??
      toStringOrUndefined(record.name)

    if (directName) {
      return directName
    }

    const firstName =
      toStringOrUndefined(record.first_name) ??
      toStringOrUndefined(record.firstName)
    const lastName =
      toStringOrUndefined(record.last_name) ??
      toStringOrUndefined(record.lastName)

    const merged = [firstName, lastName].filter(Boolean).join(" ").trim()
    return merged || undefined
  }

  private resolveEmailFromRecords(
    ...records: Record<string, unknown>[]
  ): string | undefined {
    for (const record of records) {
      const email =
        toStringOrUndefined(record.email) ??
        toStringOrUndefined(record.customer_email) ??
        toStringOrUndefined(record.customerEmail)
      if (email) {
        return email
      }
    }
    return undefined
  }

  private resolvePhoneFromRecords(
    ...records: Record<string, unknown>[]
  ): string | undefined {
    for (const record of records) {
      const phone =
        toStringOrUndefined(record.phone) ??
        toStringOrUndefined(record.customer_phone) ??
        toStringOrUndefined(record.customerPhone)
      if (phone) {
        return phone
      }
    }
    return undefined
  }

  private resolveFallbackCustomerName(
    customerEmail: string | undefined,
    customerId: string
  ): string {
    const emailLocalPart = customerEmail?.split("@")[0]?.replace(/[._-]+/g, " ").trim()
    if (emailLocalPart) {
      return emailLocalPart
    }

    const idLocalPart = customerId.replace(/^customer-?/i, "").trim()
    if (idLocalPart) {
      return `Customer ${idLocalPart}`
    }

    return "Guest Customer"
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const sessionData = toRecord(input.data) as VirtualPaySessionData
    const context = toRecord(input.context)
    const contextCustomer = toRecord(context.customer)
    const contextBilling = toRecord(
      context.billing_address ?? context.billingAddress
    )
    const contextShipping = toRecord(
      context.shipping_address ?? context.shippingAddress
    )
    const sessionId = toStringOrUndefined(sessionData.session_id)
    const amount = this.resolveAmountString(input.amount)
    const customerEmail = this.resolveEmailFromRecords(
      contextCustomer,
      context,
      contextBilling,
      contextShipping
    )
    const customerPhone = this.resolvePhoneFromRecords(
      contextCustomer,
      context,
      contextBilling,
      contextShipping
    )
    const customerId =
      sessionId ??
      toStringOrUndefined(sessionData.customer_id) ??
      toStringOrUndefined(contextCustomer.id) ??
      customerEmail ??
      `customer-${Date.now()}`
    const customerName =
      this.resolveFullNameFromRecord(contextCustomer) ??
      this.resolveFullNameFromRecord(contextBilling) ??
      this.resolveFullNameFromRecord(contextShipping) ??
      this.resolveFallbackCustomerName(customerEmail, customerId)

    const payload: Record<string, unknown> = {
      channel_code: this.options_.channelCode,
      merchant_id: this.options_.merchantId,
      transaction_amount: amount,
      customer_id: customerId,
      customer_name: customerName,
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      ...(customerPhone ? { customer_phone: customerPhone } : {}),
      ...(toStringOrUndefined(this.options_.requestAuthorizer)
        ? { request_authorizer: this.options_.requestAuthorizer }
        : {}),
    }

    const response = await this.postJson("GenerateVirtualAccountNumber", payload)
    const responseCandidates = this.getResponseDataCandidates(response)
    const responseData = responseCandidates[0] || {}

    const requestId =
      this.pickStringFromCandidates(responseCandidates, [
        "request_id",
        "requestId",
        "requestID",
        "req_id",
        "transaction_ref",
        "transactionRef",
      ])
    const virtualAccountNumber =
      this.pickStringFromCandidates(responseCandidates, [
        "virtual_acct_no",
        "virtual_account_no",
        "virtualAcctNo",
        "virtualAccountNo",
        "account_number",
        "accountNumber",
      ])

    if (!requestId && !virtualAccountNumber) {
      throw new MedusaError(
        MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
        `VirtualPay did not return a request_id or virtual account number (response_code=${toStringOrUndefined(
          response.response_code ?? response.responseCode
        ) ?? "unknown"}, response_message=${toStringOrUndefined(
          response.response_message ?? response.responseMessage
        ) ?? "unknown"})`
      )
    }

    return {
      id: requestId || virtualAccountNumber || customerId,
      status: PaymentSessionStatus.PENDING,
      data: {
        ...sessionData,
        id: requestId || virtualAccountNumber || customerId,
        session_id: sessionId,
        customer_id: customerId,
        request_id: requestId,
        virtual_acct_no: virtualAccountNumber,
        virtual_acct_name:
          this.pickStringFromCandidates(responseCandidates, [
            "virtual_acct_name",
            "virtual_account_name",
            "virtualAcctName",
            "virtualAccountName",
            "account_name",
            "accountName",
          ]),
        expiry_datetime:
          this.pickStringFromCandidates(responseCandidates, [
            "expiry_datetime",
            "expiry_date",
            "expiryDateTime",
            "expiryDate",
            "expires_at",
            "expiresAt",
          ]),
        expected_amount: amount,
        currency_code: input.currency_code,
        provider: "virtualpay-retail",
        initiate_response_code: toStringOrUndefined(response.response_code),
        initiate_response_message: toStringOrUndefined(response.response_message),
        raw_initiate_response: response,
      },
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const statusResult = await this.getPaymentStatus(input)
    if (statusResult.status === PaymentSessionStatus.CAPTURED) {
      return {
        status: PaymentSessionStatus.AUTHORIZED,
        data: statusResult.data,
      }
    }
    return statusResult
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const data = toRecord(input.data) as VirtualPaySessionData
    const payload = this.buildCheckStatusPayload(data)

    if (!payload.request_id && !payload.session_id) {
      return {
        status: PaymentSessionStatus.PENDING,
        data,
      }
    }

    const response = await this.postJson("CheckTransactionStatus", payload)
    const status = this.mapStatusFromResponse(response, data)

    return {
      status,
      data: {
        ...data,
        last_status_checked_at: new Date().toISOString(),
        last_status_response: response,
      },
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const status = await this.getPaymentStatus({
      data: input.data,
      context: input.context,
    })

    if (
      status.status === PaymentSessionStatus.CAPTURED ||
      status.status === PaymentSessionStatus.AUTHORIZED
    ) {
      return { data: status.data }
    }

    throw new MedusaError(
      MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
      "VirtualPay payment is not yet completed and cannot be captured"
    )
  }

  async refundPayment(_: RefundPaymentInput): Promise<RefundPaymentOutput> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "VirtualPay refunds are not supported through this provider"
    )
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = toRecord(input.data) as VirtualPaySessionData
    return {
      data: {
        ...data,
        canceled_at: new Date().toISOString(),
      },
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return this.cancelPayment(input)
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const result = await this.getPaymentStatus({
      data: input.data,
      context: input.context,
    })

    return { data: result.data }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const currentData = toRecord(input.data) as VirtualPaySessionData
    const nextAmount = this.resolveAmountString(input.amount)
    const currentAmount = toStringOrUndefined(currentData.expected_amount)

    if (
      currentAmount === nextAmount &&
      normalizeUpper(currentData.currency_code) === normalizeUpper(input.currency_code)
    ) {
      return {
        status: PaymentSessionStatus.PENDING,
        data: currentData,
      }
    }

    const initiated = await this.initiatePayment({
      amount: input.amount,
      currency_code: input.currency_code,
      context: input.context,
      data: {
        ...currentData,
        session_id: toStringOrUndefined(currentData.session_id),
      },
    })

    return {
      status: initiated.status,
      data: initiated.data,
    }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const parsedPayload = toRecord(payload.data)
    const sessionId = this.resolveCallbackSessionId(parsedPayload)

    if (!sessionId) {
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    const paymentStatus = normalizeUpper(parsedPayload.payment_status)
    const transactionStatus = normalizeUpper(parsedPayload.transaction_status)
    const responseCode = normalizeUpper(parsedPayload.tran_response_code)
    const amount = toNumberOrUndefined(
      parsedPayload.transaction_amount ??
        parsedPayload.amount_paid ??
        parsedPayload.expected_amount ??
        parsedPayload.amount
    )
    const toWebhookResult = (action: PaymentActions): WebhookActionResult => {
      if (typeof amount !== "number") {
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      return {
        action,
        data: {
          session_id: sessionId,
          amount,
        },
      }
    }

    if (paymentStatus === "AMOUNT MISMATCH") {
      return toWebhookResult(PaymentActions.REQUIRES_MORE)
    }

    if (
      responseCode === "00" &&
      (paymentStatus === "COMPLETE" ||
        paymentStatus === "SUCCESSFUL" ||
        STATUS_SUCCESS.has(transactionStatus))
    ) {
      return toWebhookResult(PaymentActions.SUCCESSFUL)
    }

    if (STATUS_PENDING.has(transactionStatus)) {
      return toWebhookResult(PaymentActions.PENDING)
    }

    if (STATUS_CANCELED.has(transactionStatus)) {
      return toWebhookResult(PaymentActions.CANCELED)
    }

    if (responseCode === "99" || STATUS_FAILED.has(transactionStatus)) {
      return toWebhookResult(PaymentActions.FAILED)
    }

    return { action: PaymentActions.NOT_SUPPORTED }
  }
}

export default VirtualPayRetailProviderService
