/**
 * API config center.
 * Keep baseURL and search mode switches in one place for easy rollback.
 */
type ApiEnv = "develop" | "trial" | "release";

const BASE_URL_BY_ENV: Record<ApiEnv, string> = {
  // local debug
  develop: "http://127.0.0.1:8000",
  // placeholders for future deployment
  trial: "http://127.0.0.1:8000",
  release: "http://127.0.0.1:8000",
};

/**
 * Optional manual override.
 * Example for real-device LAN debug: "http://192.168.1.10:8000"
 */
const BASE_URL_OVERRIDE = "";

function resolveApiEnv(): ApiEnv {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch (error) {
    console.warn("Failed to read envVersion, fallback to release", error);
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
