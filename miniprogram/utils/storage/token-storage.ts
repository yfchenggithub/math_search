import type { AuthSession, AuthUser } from "../../services/auth/auth-types";
import { STORAGE_KEYS } from "./storage-keys";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function parseUser(raw: unknown): AuthUser | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }

  const id = String(raw.id || "").trim();
  const nickname = String(raw.nickname || "").trim();
  const avatarUrl = String(raw.avatarUrl || "").trim();

  if (!id && !nickname && !avatarUrl) {
    return undefined;
  }

  return {
    id: id || "unknown",
    nickname: nickname || "微信用户",
    avatarUrl: avatarUrl || undefined,
  };
}

function normalizeSession(raw: Record<string, unknown>): AuthSession | null {
  const token = String(raw.token || "").trim();
  if (!token) {
    return null;
  }

  return {
    token,
    tokenType: String(raw.tokenType || "Bearer").trim() || "Bearer",
    refreshToken: typeof raw.refreshToken === "string" ? raw.refreshToken : undefined,
    expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : undefined,
    platform: "mini_program",
    authProvider: "wechat",
    user: parseUser(raw.user),
    obtainedAt: typeof raw.obtainedAt === "number" ? raw.obtainedAt : Date.now(),
  };
}

export function saveSession(session: AuthSession): void {
  wx.setStorageSync(STORAGE_KEYS.AUTH_SESSION, session);
}

export function getSession(): AuthSession | null {
  const rawSession = wx.getStorageSync(STORAGE_KEYS.AUTH_SESSION);
  if (isPlainObject(rawSession)) {
    const normalizedSession = normalizeSession(rawSession);
    if (normalizedSession) {
      return normalizedSession;
    }
  }

  const legacyToken = String(wx.getStorageSync(STORAGE_KEYS.LEGACY_AUTH_TOKEN) || "").trim();
  if (!legacyToken) {
    return null;
  }

  const legacyUser = parseUser(wx.getStorageSync(STORAGE_KEYS.LEGACY_AUTH_USER));
  const migratedSession: AuthSession = {
    token: legacyToken,
    tokenType: "Bearer",
    platform: "mini_program",
    authProvider: "wechat",
    user: legacyUser,
    obtainedAt: Date.now(),
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

export function getToken(): string {
  return getSession()?.token || "";
}
