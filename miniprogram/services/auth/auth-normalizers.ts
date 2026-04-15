import type {
  AuthPlatform,
  AuthProvider,
  AuthSession,
  AuthUser,
  AuthUserApiDTO,
  NormalizedAuthLoginPayload,
  WechatMiniAppLoginApiResponse,
} from "./auth-types";

const DEFAULT_TOKEN_TYPE = "Bearer";
const DEFAULT_USER_NICKNAME = "Wechat User";
const DEFAULT_AUTH_PLATFORM: AuthPlatform = "mini_program";
const DEFAULT_AUTH_PROVIDER: AuthProvider = "wechat_mini_program";

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalTrimmedString(value: unknown): string | undefined {
  const text = toTrimmedString(value);
  return text || undefined;
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function resolveAuthPlatform(value: unknown): AuthPlatform {
  const rawPlatform = toTrimmedString(value).toLowerCase();

  switch (rawPlatform) {
    case "mini_program":
    case "wechat_miniapp":
    case "wechat_mini_program":
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
      return DEFAULT_AUTH_PLATFORM;
  }
}

function resolveAuthProvider(value: unknown): AuthProvider {
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
      return DEFAULT_AUTH_PROVIDER;
  }
}

function resolveAvatarUrl(raw: AuthUserApiDTO): string | undefined {
  return toOptionalTrimmedString(raw.avatarUrl) || toOptionalTrimmedString(raw.avatar_url);
}

export function normalizeAuthUserFromApi(raw?: AuthUserApiDTO | null): AuthUser | undefined {
  if (!raw) {
    return undefined;
  }

  const id = toTrimmedString(raw.id) || toTrimmedString(raw.user_id);
  const nickname = toTrimmedString(raw.nickname);
  const avatarUrl = resolveAvatarUrl(raw);

  if (!id && !nickname && !avatarUrl) {
    return undefined;
  }

  return {
    id: id || "unknown",
    nickname: nickname || DEFAULT_USER_NICKNAME,
    avatarUrl,
  };
}

export function normalizeWechatMiniAppLoginResponse(
  data: WechatMiniAppLoginApiResponse,
): NormalizedAuthLoginPayload {
  // Backend DTO (snake_case) -> unified auth payload (camelCase).
  return {
    accessToken: toTrimmedString(data.token),
    tokenType: toTrimmedString(data.token_type) || DEFAULT_TOKEN_TYPE,
    refreshToken: toOptionalTrimmedString(data.refresh_token),
    expiresIn: toPositiveNumber(data.expires_in),
    platform: resolveAuthPlatform(data.platform),
    authProvider: resolveAuthProvider(data.auth_provider),
    user: normalizeAuthUserFromApi(data),
  };
}

export function mapAuthLoginPayloadToSession(
  payload: NormalizedAuthLoginPayload,
  currentTimestamp = Date.now(),
): AuthSession {
  // Convert relative expiry (expiresIn seconds) into absolute session expiry timestamp.
  const expiresAt = typeof payload.expiresIn === "number"
    ? currentTimestamp + payload.expiresIn * 1000
    : undefined;

  return {
    accessToken: payload.accessToken,
    tokenType: payload.tokenType || DEFAULT_TOKEN_TYPE,
    refreshToken: payload.refreshToken,
    expiresAt,
    platform: payload.platform || DEFAULT_AUTH_PLATFORM,
    authProvider: payload.authProvider || DEFAULT_AUTH_PROVIDER,
    user: payload.user,
    lastLoginTime: currentTimestamp,
  };
}
