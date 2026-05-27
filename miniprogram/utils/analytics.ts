import { readApiEnvVersion } from "../config/runtime-env";
import { createLogger } from "./logger/logger";

type AnalyticsEnv = "develop" | "trial" | "release";
type AnalyticsPrimitive = string | number | boolean;
type AnalyticsParams = Record<string, unknown>;
type AnalyticsSafeParams = Record<string, AnalyticsPrimitive>;
type TrackEventOptions = {
  dedupeKey?: string;
  dedupeMs?: number;
};

type SearchEventName =
  | "home_search_submit"
  | "home_search_result"
  | "home_search_no_result"
  | "home_suggest_click";

type PdfUnlockEventName =
  | "pdf_unlock_modal_show"
  | "pdf_unlock_click"
  | "pdf_unlock_success"
  | "pdf_unlock_fail";

type ShareEventName =
  | "share_click"
  | "share_success"
  | "copy_keyword_click"
  | "copy_keyword_success"
  | "copy_keyword_fail";

type FavoriteEventName =
  | "favorite_click"
  | "favorite_success"
  | "favorite_cancel"
  | "favorite_fail";

const analyticsLogger = createLogger("analytics");
const DEFAULT_MAX_STRING_LENGTH = 120;
const QUERY_MAX_LENGTH = 50;
const TITLE_MAX_LENGTH = 80;
const DEFAULT_DEDUPE_MS = 800;
const MAX_RECENT_EVENT_KEYS = 160;

const BLOCKED_KEYS = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "openid",
  "unionid",
  "sessionkey",
  "phone",
  "mobile",
  "avatar",
  "avatarurl",
  "pdfurl",
  "url",
  "apiurl",
  "authorization",
  "cookie",
]);

const recentEventCache: Record<string, number> = {};

function resolveAnalyticsEnv(): AnalyticsEnv {
  try {
    return readApiEnvVersion();
  } catch (_error) {
    return "release";
  }
}

const analyticsEnv = resolveAnalyticsEnv();

export const ANALYTICS_CONFIG = {
  enabled: true,
  debug: analyticsEnv === "develop",
  provider: "wechat",
} as const;

function normalizeKey(rawKey: string): string {
  return rawKey.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength);
}

function resolveMaxLengthByKey(rawKey: string): number {
  const normalizedKey = normalizeKey(rawKey);

  if (normalizedKey === "query") {
    return QUERY_MAX_LENGTH;
  }

  if (normalizedKey === "title" || normalizedKey.endsWith("title")) {
    return TITLE_MAX_LENGTH;
  }

  return DEFAULT_MAX_STRING_LENGTH;
}

function sanitizeErrorLikeValue(rawValue: unknown): AnalyticsSafeParams {
  const output: AnalyticsSafeParams = {};

  if (isPlainObject(rawValue)) {
    const rawCode = rawValue.error_code ?? rawValue.code ?? rawValue.errCode;
    const rawType = rawValue.error_type ?? rawValue.type ?? rawValue.reason;

    const codeText = String(rawCode || "").trim();
    const typeText = String(rawType || "").trim();

    if (codeText) {
      output.error_code = truncateText(codeText, 40);
    }

    if (typeText) {
      output.error_type = truncateText(typeText, 40);
    }
  }

  if (typeof rawValue === "string") {
    const normalized = rawValue.trim().toLowerCase();
    if (normalized) {
      output.error_type = truncateText(normalized, 40);
    }
  }

  return output;
}

function sanitizeEventName(rawEventName: string): string {
  return String(rawEventName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
}

function toReportAnalyticsParams(params: AnalyticsSafeParams): Record<string, string> {
  const output: Record<string, string> = {};
  const keys = Object.keys(params);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    output[key] = String(params[key]);
  }
  return output;
}

function shouldDropByKey(rawKey: string): boolean {
  return BLOCKED_KEYS.has(normalizeKey(rawKey));
}

function debugLog(tag: string, eventName: string, params?: AnalyticsSafeParams): void {
  if (!ANALYTICS_CONFIG.debug) {
    return;
  }

  analyticsLogger.debug(tag, {
    eventName,
    params,
  });
}

function trimRecentEventCache(): void {
  const keys = Object.keys(recentEventCache);
  if (keys.length <= MAX_RECENT_EVENT_KEYS) {
    return;
  }

  keys
    .sort((left, right) => recentEventCache[left] - recentEventCache[right])
    .slice(0, keys.length - MAX_RECENT_EVENT_KEYS)
    .forEach((key) => {
      delete recentEventCache[key];
    });
}

function hitDedupe(options: TrackEventOptions): boolean {
  if (!options.dedupeKey) {
    return false;
  }

  const now = Date.now();
  const dedupeMs = Number.isFinite(options.dedupeMs)
    ? Math.max(0, Number(options.dedupeMs))
    : DEFAULT_DEDUPE_MS;
  const previousAt = recentEventCache[options.dedupeKey] || 0;
  if (previousAt > 0 && now - previousAt < dedupeMs) {
    return true;
  }

  recentEventCache[options.dedupeKey] = now;
  trimRecentEventCache();
  return false;
}

export function sanitizeAnalyticsParams(params: AnalyticsParams = {}): AnalyticsSafeParams {
  const output: AnalyticsSafeParams = {};
  const keys = Object.keys(params);

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const value = params[key];

    if (shouldDropByKey(key)) {
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === "function") {
      continue;
    }

    if (typeof value === "string") {
      const text = value.trim();
      if (!text) {
        continue;
      }

      output[key] = truncateText(text, resolveMaxLengthByKey(key));
      continue;
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        continue;
      }

      output[key] = value;
      continue;
    }

    if (typeof value === "boolean") {
      output[key] = value;
      continue;
    }

    const normalizedKey = normalizeKey(key);
    if (normalizedKey === "error" || normalizedKey.startsWith("error")) {
      const sanitizedError = sanitizeErrorLikeValue(value);
      const errorKeys = Object.keys(sanitizedError);
      for (let keyIndex = 0; keyIndex < errorKeys.length; keyIndex += 1) {
        const errorKey = errorKeys[keyIndex];
        output[errorKey] = sanitizedError[errorKey];
      }
    }
  }

  return output;
}

export function trackEvent(
  eventName: string,
  params: AnalyticsParams = {},
  options: TrackEventOptions = {},
): void {
  try {
    const safeEventName = sanitizeEventName(eventName);
    if (!safeEventName) {
      return;
    }

    if (hitDedupe(options)) {
      debugLog("event_deduped", safeEventName);
      return;
    }

    const safeParams = sanitizeAnalyticsParams(params);

    if (!ANALYTICS_CONFIG.enabled) {
      debugLog("analytics_disabled", safeEventName, safeParams);
      return;
    }

    const wxWithReportEvent = wx as WechatMiniprogram.Wx & {
      reportEvent?: (name: string, paramsRecord: AnalyticsSafeParams) => void;
      reportAnalytics?: (name: string, paramsRecord: Record<string, string>) => void;
    };

    if (typeof wxWithReportEvent.reportEvent === "function") {
      wxWithReportEvent.reportEvent(safeEventName, safeParams);
      return;
    }

    if (typeof wxWithReportEvent.reportAnalytics === "function") {
      wxWithReportEvent.reportAnalytics(
        safeEventName,
        toReportAnalyticsParams(safeParams),
      );
      return;
    }

    debugLog("analytics_fallback", safeEventName, safeParams);
  } catch (_error) {
    debugLog("analytics_error", eventName);
  }
}

export function trackPageView(
  pageName: string,
  params: AnalyticsParams = {},
  options: TrackEventOptions = {},
): void {
  const normalized = sanitizeEventName(pageName).replace(/_view$/, "");
  if (!normalized) {
    return;
  }

  trackEvent(
    `${normalized}_view`,
    params,
    {
      dedupeKey: options.dedupeKey || `page_view:${normalized}`,
      dedupeMs: options.dedupeMs ?? DEFAULT_DEDUPE_MS,
    },
  );
}

export function trackSearch(
  eventName: SearchEventName,
  params: AnalyticsParams = {},
  options: TrackEventOptions = {},
): void {
  trackEvent(eventName, params, options);
}

export function trackDetailView(params: AnalyticsParams = {}, options: TrackEventOptions = {}): void {
  trackEvent("detail_view", params, options);
}

export function trackPdfDownloadClick(
  params: AnalyticsParams = {},
  options: TrackEventOptions = {},
): void {
  trackEvent("detail_pdf_click", params, options);
}

export function trackPdfUnlockFlow(
  eventName: PdfUnlockEventName,
  params: AnalyticsParams = {},
  options: TrackEventOptions = {},
): void {
  trackEvent(eventName, params, options);
}

export function trackShare(
  eventName: ShareEventName,
  params: AnalyticsParams = {},
  options: TrackEventOptions = {},
): void {
  trackEvent(eventName, params, options);
}

export function trackFavorite(
  eventName: FavoriteEventName,
  params: AnalyticsParams = {},
  options: TrackEventOptions = {},
): void {
  trackEvent(eventName, params, options);
}
