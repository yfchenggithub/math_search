import { STORAGE_KEYS } from "./storage/storage-keys";

export const PDF_UNLOCK_STORAGE_KEY = STORAGE_KEYS.PDF_UNLOCK_EXPIRE_AT;
export const PDF_UNLOCK_DURATION_MS = 2 * 60 * 60 * 1000;

export type PdfEntitlement = {
  unlocked: boolean;
  expireAt: number | null;
  remainingSeconds: number;
};

function createLockedEntitlement(): PdfEntitlement {
  return {
    unlocked: false,
    expireAt: null,
    remainingSeconds: 0,
  };
}

function toTimestamp(rawValue: unknown): number | null {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue === "string") {
    const parsedValue = Number(rawValue.trim());
    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return null;
}

export function setPdfEntitlementExpireAt(expireAt: number): PdfEntitlement {
  if (!Number.isFinite(expireAt) || expireAt <= 0) {
    clearPdfEntitlement();
    return createLockedEntitlement();
  }

  wx.setStorageSync(PDF_UNLOCK_STORAGE_KEY, expireAt);
  return getPdfEntitlement();
}

export function setPdfEntitlementUnlockedForDuration(
  durationMs: number = PDF_UNLOCK_DURATION_MS,
): PdfEntitlement {
  const safeDurationMs = Number.isFinite(durationMs)
    ? Math.max(0, Math.floor(durationMs))
    : PDF_UNLOCK_DURATION_MS;
  return setPdfEntitlementExpireAt(Date.now() + safeDurationMs);
}

export function clearPdfEntitlement(): void {
  wx.removeStorageSync(PDF_UNLOCK_STORAGE_KEY);
}

export function clearExpiredPdfEntitlement(): void {
  const expireAt = toTimestamp(wx.getStorageSync(PDF_UNLOCK_STORAGE_KEY));
  if (expireAt === null || expireAt <= Date.now()) {
    clearPdfEntitlement();
  }
}

export function getPdfEntitlement(): PdfEntitlement {
  const expireAt = toTimestamp(wx.getStorageSync(PDF_UNLOCK_STORAGE_KEY));

  if (expireAt === null || expireAt <= 0) {
    return createLockedEntitlement();
  }

  const now = Date.now();
  if (expireAt <= now) {
    clearPdfEntitlement();
    return createLockedEntitlement();
  }

  const remainingSeconds = Math.max(0, Math.floor((expireAt - now) / 1000));
  if (remainingSeconds <= 0) {
    clearPdfEntitlement();
    return createLockedEntitlement();
  }

  return {
    unlocked: true,
    expireAt,
    remainingSeconds,
  };
}

export function isPdfEntitlementActive(
  entitlement: PdfEntitlement = getPdfEntitlement(),
): boolean {
  return entitlement.unlocked && entitlement.remainingSeconds > 0;
}

export function formatPdfRemainingTime(remainingSeconds: number): string {
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
    return "\u5df2\u8fc7\u671f";
  }

  if (remainingSeconds < 60) {
    return "\u4e0d\u8db3 1 \u5206\u949f";
  }

  if (remainingSeconds < 3600) {
    const minutes = Math.max(1, Math.floor(remainingSeconds / 60));
    return `${minutes}\u5206\u949f`;
  }

  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  if (minutes <= 0) {
    return `${hours}\u5c0f\u65f6`;
  }

  return `${hours}\u5c0f\u65f6${minutes}\u5206`;
}
