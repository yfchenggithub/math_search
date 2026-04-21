/**
 * API config center.
 * Keep baseURL and search mode switches in one place for easy rollback.
 */
import { createLogger } from "../utils/logger/logger";
import type { ApiEnv }from "./runtime-env";
import { readApiEnvVersion } from "./runtime-env";

const apiConfigLogger = createLogger("api-config");

const BASE_URL_BY_ENV: Record<ApiEnv, string> = {
  // local debug
  develop: "https://ok-shuxue.cloud/",
  // placeholders for future deployment
  trial: "https://ok-shuxue.cloud/",
  // 146.56.223.203
  release: "https://ok-shuxue.cloud/",
};

/**
 * Optional manual override.
 * Example for real-device LAN debug: "http://192.168.1.10:8000"
 */
const BASE_URL_OVERRIDE = "";

export function resolveApiEnv(): ApiEnv {
  try {
    return readApiEnvVersion();
  } catch (error) {
    apiConfigLogger.warn("resolve_env_failed", {
      fallbackEnv: "release",
      error,
    });
    return "release";
  }
}

function resolveApiBaseURL(): string {
  const customBaseURL = BASE_URL_OVERRIDE.trim();
  if (customBaseURL) {
    return customBaseURL;
  }

  const env = resolveApiEnv();
  return BASE_URL_BY_ENV[env];
}

export const API_CONFIG = {
  baseURL: resolveApiBaseURL(),
  timeout: 10000,
  header: {
    "content-type": "application/json",
    Accept: "application/json",
  },
} as const;

/**
 * Search runtime config.
 * - USE_REMOTE_API=true: remote first, local fallback.
 * - USE_REMOTE_API=false: local only.
 */
export const SEARCH_API_CONFIG = {
  USE_REMOTE_API: true,
  SEARCH_PATH: "/api/v1/search",
  SUGGEST_PATH: "/api/v1/suggest",
  PAGE_SIZE: 20,
} as const;

/**
 * Detail runtime config.
 * - USE_REMOTE_API=true: call canonical v2 detail API first.
 * - ENABLE_LOCAL_FALLBACK=true: fallback to local detail bundle when remote fails.
 */
export const DETAIL_API_CONFIG = {
  USE_REMOTE_API: true,
  ENABLE_LOCAL_FALLBACK: true,
  DETAIL_PATH_PREFIX: "/api/v1/conclusions",
} as const;
