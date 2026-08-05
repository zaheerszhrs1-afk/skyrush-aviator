export interface PaymentMethodConfig {
  id: string;
  code: string;
  title: string;
  logoUrl: string;
  qrImageUrl: string;
  identifierLabel: string;
  identifierValue: string;
  instructions: string;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  receiptRequired: boolean;
  sortOrder: number;
}

export const DEFAULT_PAYMENT_METHODS: PaymentMethodConfig[] = [
  {
    id: "jazzcash",
    code: "JazzCash",
    title: "JazzCash",
    logoUrl: "/payment-logos/jazzcash.png",
    qrImageUrl: "/payment-logos/jazzcash-qr.png",
    identifierLabel: "TILL ID",
    identifierValue: "984046332",
    instructions: "Scan the QR code or use the Till ID in JazzCash to complete the payment.",
    depositEnabled: true,
    withdrawalEnabled: true,
    receiptRequired: true,
    sortOrder: 10
  },
  {
    id: "easypaisa",
    code: "EasyPaisa",
    title: "Easypaisa",
    logoUrl: "/payment-logos/easypaisa.png",
    qrImageUrl: "/jazzcash-raast-qr.jpg",
    identifierLabel: "RAAST ID",
    identifierValue: "984046332",
    instructions: "Scan the QR code or use the Raast ID in Easypaisa to complete the payment.",
    depositEnabled: true,
    withdrawalEnabled: true,
    receiptRequired: true,
    sortOrder: 20
  }
];

const text = (value: unknown, fallback: string, max: number): string => {
  const output = String(value ?? "").trim().slice(0, max);
  return output || fallback;
};

const safeId = (value: unknown, fallback: string): string => {
  const candidate = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return candidate || fallback;
};

export function normalizePaymentMethods(value: unknown): PaymentMethodConfig[] {
  const input = Array.isArray(value) ? value : [];
  const source = input.length > 0 ? input : DEFAULT_PAYMENT_METHODS;
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();
  const result: PaymentMethodConfig[] = [];

  for (let index = 0; index < source.length && result.length < 20; index += 1) {
    const item: any = source[index] ?? {};
    let id = safeId(item.id, `method-${index + 1}`);
    while (seenIds.has(id)) id = `${id}-${index + 1}`;
    const title = text(item.title, `Payment method ${index + 1}`, 80);
    const code = text(item.code, title.replace(/\s+/g, " "), 80);
    const codeKey = code.toLowerCase();
    if (seenCodes.has(codeKey)) continue;
    seenIds.add(id);
    seenCodes.add(codeKey);
    result.push({
      id,
      code,
      title,
      logoUrl: text(item.logoUrl, "", 1000),
      qrImageUrl: text(item.qrImageUrl, "", 1000),
      identifierLabel: text(item.identifierLabel, "ACCOUNT ID", 80),
      identifierValue: text(item.identifierValue, "", 160),
      instructions: text(item.instructions, "Complete the payment and upload the receipt for verification.", 500),
      depositEnabled: item.depositEnabled !== false,
      withdrawalEnabled: item.withdrawalEnabled !== false,
      receiptRequired: item.receiptRequired !== false,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Math.floor(Number(item.sortOrder)) : (index + 1) * 10
    });
  }

  return result.sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title));
}
