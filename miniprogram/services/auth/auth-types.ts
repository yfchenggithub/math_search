export type AuthStatus = "visitor" | "logging_in" | "authenticated" | "expired";

export type AuthPlatform = "mini_program" | "h5" | "web" | "android" | "ios";
export type AuthProvider =
  | "wechat"
  | "wechat_mini_program"
  | "h5"
  | "web"
  | "android"
  | "ios";

export interface AuthUser {
  id: string;
  nickname: string;
  avatarUrl?: string;
}

export interface AuthSession {
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  expiresAt?: number;
  platform: AuthPlatform;
  authProvider: AuthProvider;
  user?: AuthUser;
  lastLoginTime: number;
}

export interface LoginResult {
  session: AuthSession;
}

export interface RequireAuthOptions {
  title?: string;
  content?: string;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
}

export interface WechatMiniAppLoginRequest {
  code: string;
  platform: "mini_program";
  authProvider: "wechat";
}

export interface AuthUserApiDTO {
  id?: string | null;
  user_id?: string | null;
  nickname?: string | null;
  avatarUrl?: string | null;
  avatar_url?: string | null;
}

export interface WechatMiniAppLoginApiResponse extends AuthUserApiDTO {
  token?: string | null;
  token_type?: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  platform?: string | null;
  auth_provider?: string | null;
}

export interface NormalizedAuthLoginPayload {
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  expiresIn?: number;
  platform: AuthPlatform;
  authProvider: AuthProvider;
  user?: AuthUser;
}
