import { readApiEnvVersion } from "../config/runtime-env";
import { createLogger } from "./logger/logger";
import {
  PDF_UNLOCK_DURATION_MS,
  setPdfEntitlementUnlockedForDuration,
} from "./pdf-entitlement";

const pdfUnlockLogger = createLogger("pdf-entitlement-unlock");

export type PdfUnlockProvider = "mock" | "free_quota" | "manual" | "rewarded_video";
export type PdfEntitlementUnlockResult =
  | {
      unlocked: true;
      source: PdfUnlockProvider;
    }
  | {
      unlocked: false;
      reason: "cancelled" | "unavailable";
      source?: PdfUnlockProvider;
    };

export function resolvePdfUnlockProvider(): PdfUnlockProvider {
  if (readApiEnvVersion() === "develop") {
    return "mock";
  }

  return "manual";
}

export async function unlockPdfEntitlement(): Promise<PdfEntitlementUnlockResult> {
  try {
    const rewardResult = await showRewardedVideoAdIfAvailable();
    if (rewardResult.unlocked) {
      return rewardResult;
    }

    if (rewardResult.reason === "cancelled") {
      return rewardResult;
    }
  } catch (error) {
    pdfUnlockLogger.warn("rewarded_video_unlock_failed", { error });
  }

  if (readApiEnvVersion() === "develop") {
    return mockUnlockPdfEntitlementForDev();
  }

  return {
    unlocked: false,
    reason: "unavailable",
    source: resolvePdfUnlockProvider(),
  };
}

export async function showRewardedVideoAdIfAvailable(): Promise<PdfEntitlementUnlockResult> {
  // TODO(stage5): replace this stub with real rewarded video ad integration.
  return {
    unlocked: false,
    reason: "unavailable",
    source: resolvePdfUnlockProvider(),
  };
}

export function mockUnlockPdfEntitlementForDev(): PdfEntitlementUnlockResult {
  // TODO(stage5): replace this mock unlock with real rewarded video ad.
  // This is only used for local development and UI flow verification.
  setPdfEntitlementUnlockedForDuration(PDF_UNLOCK_DURATION_MS);

  return {
    unlocked: true,
    source: "mock",
  };
}
