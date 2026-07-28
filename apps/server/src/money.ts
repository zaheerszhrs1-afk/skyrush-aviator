export const MINOR_FACTOR = 100;

export function toMinor(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Invalid monetary amount.");
  const minor = Math.round((value + Number.EPSILON) * MINOR_FACTOR);
  if (!Number.isSafeInteger(minor)) throw new Error("Monetary amount is outside the supported range.");
  return minor;
}

export function fromMinor(value: unknown): number {
  const minor = Number(value ?? 0);
  if (!Number.isFinite(minor)) return 0;
  return Number((minor / MINOR_FACTOR).toFixed(2));
}

export function legacyMoney(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
}

export function minorFromDocument(document: any, minorKey: string, legacyKey: string): number {
  const explicitMinor = Number(document?.[minorKey]);
  if (Number.isSafeInteger(explicitMinor)) return explicitMinor;
  return toMinor(legacyMoney(document?.[legacyKey]));
}
