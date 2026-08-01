import * as crypto from "node:crypto";

const DEFAULT_API_URL = "https://api.nowpayments.io/v1";
const DEFAULT_CURRENCIES = ["btc", "eth", "ltc", "usdttrc20", "usdtbsc"];

type JsonObject = Record<string, unknown>;

export interface NowPayment {
  paymentId: string;
  status: string;
  priceAmount: number;
  priceCurrency: string;
  payAmount: number;
  payCurrency: string;
  payAddress: string;
  payinExtraId: string;
  network: string;
  expiresAt: string;
  raw: JsonObject;
}

function configuredCurrencies(): string[] {
  const currencies = (process.env.NOWPAYMENTS_PAY_CURRENCIES ?? DEFAULT_CURRENCIES.join(","))
    .split(",")
    .map((currency) => currency.trim().toLowerCase())
    .filter((currency) => /^[a-z0-9]{2,40}$/.test(currency));
  return [...new Set(currencies)];
}

function configuration() {
  const pkrPerUsd = Number(process.env.NOWPAYMENTS_PKR_PER_USD);
  return {
    apiUrl: (process.env.NOWPAYMENTS_API_URL ?? DEFAULT_API_URL).replace(/\/$/, ""),
    apiKey: process.env.NOWPAYMENTS_API_KEY?.trim() ?? "",
    ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET?.trim() ?? "",
    callbackUrl: process.env.NOWPAYMENTS_IPN_CALLBACK_URL?.trim() ?? "",
    pkrPerUsd,
    currencies: configuredCurrencies()
  };
}

export function nowPaymentsPublicConfig(): { enabled: boolean; currencies: string[] } {
  const config = configuration();
  return {
    enabled: Boolean(
      config.apiKey
      && config.ipnSecret
      && /^https?:\/\//i.test(config.callbackUrl)
      && Number.isFinite(config.pkrPerUsd)
      && config.pkrPerUsd > 0
      && config.currencies.length > 0
    ),
    currencies: config.currencies
  };
}

function requiredConfiguration() {
  const config = configuration();
  if (!nowPaymentsPublicConfig().enabled) {
    throw new Error("NOWPayments is not configured. Add the API key, IPN secret, callback URL and PKR/USD rate.");
  }
  return config;
}

function responseMessage(payload: JsonObject): string {
  const value = payload.message ?? payload.error ?? payload.code;
  return typeof value === "string" && value.trim() ? value.trim() : "NOWPayments rejected the payment request.";
}

export async function createNowPayment(input: {
  orderId: string;
  amountPkr: number;
  payCurrency: string;
  description: string;
}): Promise<NowPayment> {
  const config = requiredConfiguration();
  const payCurrency = input.payCurrency.trim().toLowerCase();
  if (!config.currencies.includes(payCurrency)) throw new Error("Select an available cryptocurrency.");

  const priceAmount = Number((input.amountPkr / config.pkrPerUsd).toFixed(2));
  if (!Number.isFinite(priceAmount) || priceAmount < 0.01) throw new Error("Deposit amount is too small for crypto conversion.");

  const apiResponse = await fetch(`${config.apiUrl}/payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": config.apiKey },
    body: JSON.stringify({
      price_amount: priceAmount,
      price_currency: "usd",
      pay_currency: payCurrency,
      ipn_callback_url: config.callbackUrl,
      order_id: input.orderId,
      order_description: input.description,
      is_fixed_rate: true,
      is_fee_paid_by_user: false
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await apiResponse.json().catch(() => ({})) as JsonObject;
  if (!apiResponse.ok) throw new Error(responseMessage(payload));

  const paymentId = String(payload.payment_id ?? "").trim();
  const payAddress = String(payload.pay_address ?? "").trim();
  const payAmount = Number(payload.pay_amount);
  if (!paymentId || !payAddress || !Number.isFinite(payAmount) || payAmount <= 0) {
    throw new Error("NOWPayments returned incomplete payment instructions.");
  }

  return {
    paymentId,
    status: String(payload.payment_status ?? "waiting"),
    priceAmount: Number(payload.price_amount ?? priceAmount),
    priceCurrency: String(payload.price_currency ?? "usd"),
    payAmount,
    payCurrency: String(payload.pay_currency ?? payCurrency),
    payAddress,
    payinExtraId: String(payload.payin_extra_id ?? ""),
    network: String(payload.network ?? ""),
    expiresAt: String(payload.valid_until ?? payload.expiration_estimate_date ?? ""),
    raw: payload
  };
}

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value as JsonObject).sort().reduce<JsonObject>((result, key) => {
    result[key] = sortedValue((value as JsonObject)[key]);
    return result;
  }, {});
}

export function verifyNowPaymentsIpn(payload: unknown, signature: string): boolean {
  const secret = configuration().ipnSecret;
  const normalizedSignature = signature.trim().toLowerCase();
  if (!secret || !/^[a-f0-9]{128}$/.test(normalizedSignature)) return false;
  const digest = crypto
    .createHmac("sha512", secret)
    .update(JSON.stringify(sortedValue(payload)))
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(normalizedSignature, "hex"));
}
