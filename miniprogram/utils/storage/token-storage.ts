import type {
  AuthPlatform,
  AuthProvider,
  AuthSession,
  AuthUser,
} from "../../services/auth/auth-types";
import { STORAGE_KEYS } from "./storage-keys";

const DEFAULT_TOKEN_TYPE = "Bearer";
const DEFAULT_PLATFORM: AuthPlatform = "mini_program";
const DEFAULT_PROVIDER: AuthProvider = "wechat_mini_program";
const DEFAULT_USER_NICKNAME = "Wechat User";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function hasOwnProperty(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalTrimmedString(value: unknown): string | undefined {
  const normalized = toTrimmedString(value);
  return normalized || undefined;
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function resolvePlatform(value: unknown): AuthPlatform {
  const rawPlatform = toTrimmedString(value).toLowerCase();

  switch (rawPlatform) {
    case "mini_program":
    case "wechat_mini_program":
    case "wechat_miniapp":
      return "mini_program";
    case "h5":
      return "h5";
    case "web":
      return "web";
    case "android":
      return "android";
    case "ios":
      return "ios";
    default:
      return DEFAULT_PLATFORM;
  }
}

function resolveProvider(value: unknown): AuthProvider {
  const rawProvider = toTrimmedString(value).toLowerCase();

  switch (rawProvider) {
    case "wechat":
      return "wechat";
    case "wechat_mini_program":
      return "wechat_mini_program";
    case "h5":
      return "h5";
    case "web":
      return "web";
    case "android":
      return "android";
    case "ios":
      return "ios";
    default:
      return DEFAULT_PROVIDER;
  }
}

function parseUser(raw: unknown): AuthUser | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }

  const id = toTrimmedString(raw.id) || toTrimmedString(raw.userId) || toTrimmedString(raw.user_id);
  const nickname = toTrimmedString(raw.nickname);
  const avatarUrl = toOptionalTrimmedString(raw.avatarUrl) || toOptionalTrimmedString(raw.avatar_url);

  if (!id && !nickname && !avatarUrl) {
    return undefined;
  }

  return {
    id: id || "unknown",
    nickname: nickname || DEFAULT_USER_NICKNAME,
    avatarUrl,
  };
}

function resolveSessionExpiresAt(
  raw: Record<string, unknown>,
  lastLoginTime: number,
): number | undefined {
  const expiresAt = toPositiveNumber(raw.expiresAt);
  if (expiresAt) {
    return expiresAt;
  }

  const expiresIn = toPositiveNumber(raw.expiresIn) || toPositiveNumber(raw.expires_in);
  if (!expiresIn) {
    return undefined;
  }

  return lastLoginTime + expiresIn * 1000;
}

function normalizeSession(raw: Record<string, unknown>): AuthSession | null {
  const accessToken = toTrimmedString(raw.accessToken) || toTrimmedString(raw.token);
  if (!accessToken) {
    return null;
  }

  const lastLoginTime = toPositiveNumber(raw.lastLoginTime)
    || toPositiveNumber(raw.obtainedAt)
    || Date.now();

  return {
    accessToken,
    tokenType: toTrimmedString(raw.tokenType) || toTrimmedString(raw.token_type) || DEFAULT_TOKEN_TYPE,
    refreshToken: toOptionalTrimmedString(raw.refreshToken) || toOptionalTrimmedString(raw.refresh_token),
    expiresAt: resolveSessionExpiresAt(raw, lastLoginTime),
    platform: resolvePlatform(raw.platform),
    authProvider: resolveProvider(raw.authProvider || raw.auth_provider),
    user: parseUser(raw.user),
    lastLoginTime,
  };
}

function hasLegacySessionField(raw: Record<string, unknown>): boolean {
  const legacyKeys = [
    "token",
    "token_type",
    "refresh_token",
    "expires_in",
    "auth_provider",
    "obtainedAt",
  ];

  for (let index = 0; index < legacyKeys.length; index += 1) {
    if (hasOwnProperty(raw, legacyKeys[index])) {
      return true;
    }
  }

  return false;
}

export function saveSession(session: AuthSession): void {
  wx.setStorageSync(STORAGE_KEYS.AUTH_SESSION, session);
}

export function getSession(): AuthSession | null {
  const rawSession = wx.getStorageSync(STORAGE_KEYS.AUTH_SESSION);
  if (isPlainObject(rawSession)) {
    const normalizedSession = normalizeSession(rawSession);
    if (normalizedSession) {
      if (hasLegacySessionField(rawSession)) {
        saveSession(normalizedSession);
      }
      return normalizedSession;
    }
  }

  const legacyToken = toTrimmedString(wx.getStorageSync(STORAGE_KEYS.LEGACY_AUTH_TOKEN));
  if (!legacyToken) {
    return null;
  }

  const legacyUser = parseUser(wx.getStorageSync(STORAGE_KEYS.LEGACY_AUTH_USER));
  const migratedSession: AuthSession = {
    accessToken: legacyToken,
    tokenType: DEFAULT_TOKEN_TYPE,
    platform: DEFAULT_PLATFORM,
    authProvider: DEFAULT_PROVIDER,
    user: legacyUser,
    lastLoginTime: Date.now(),
  };

  saveSession(migratedSession);
  return migratedSession;
}

export function clearSession(): void {
  wx.removeStorageSync(STORAGE_KEYS.AUTH_SESSION);
  wx.removeStorageSync(STORAGE_KEYS.LEGACY_AUTH_TOKEN);
  wx.removeStorageSync(STORAGE_KEYS.LEGACY_AUTH_USER);
}

export function updateSession(patch: Partial<AuthSession>): AuthSession | null {
  const current = getSession();
  if (!current) {
    return null;
  }

  const next: AuthSession = {
    ...current,
    ...patch,
  };

  saveSession(next);
  return next;
}

export function getAccessToken(): string {
  return getSession()?.accessToken || "";
}

// Keep compatibility for old imports.
export function getToken(): string {
  return getAccessToken();
}
