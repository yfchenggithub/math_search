export type AuthStatus = "visitor" | "logging_in" | "authenticated" | "expired";

export type AuthPlatform = "mini_program";
export type AuthProvider = "wechat";

export interface AuthUser {
  id: string;
  nickname: string;
  avatarUrl?: string;
}

export interface AuthSession {
  token: string;
  tokenType: string;
  refreshToken?: string;
  expiresAt?: number;
  platform: AuthPlatform;
  authProvider: AuthProvider;
  user?: AuthUser;
  obtainedAt: number;
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
  platform: AuthPlatform;
  authProvider: AuthProvider;
}

export interface WechatMiniAppLoginResponse {
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  expiresIn?: number;
  user?: AuthUser;
}
