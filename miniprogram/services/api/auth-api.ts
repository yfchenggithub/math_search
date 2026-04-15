import type {
  AuthUser,
  AuthUserApiDTO,
  WechatMiniAppLoginApiResponse,
  WechatMiniAppLoginRequest,
} from "../auth/auth-types";
import { normalizeAuthUserFromApi } from "../auth/auth-normalizers";
import { request } from "../request/request";

const AUTH_API_PATHS = {
  WECHAT_MINI_LOGIN: "/api/v1/auth/wechat-miniapp-login",
  MINE_USER_INFO: "/api/v1/users/me",
} as const;

export function loginByWechatMiniProgram(
  payload: WechatMiniAppLoginRequest,
): Promise<WechatMiniAppLoginApiResponse> {
  return request<WechatMiniAppLoginApiResponse, WechatMiniAppLoginRequest>({
    url: AUTH_API_PATHS.WECHAT_MINI_LOGIN,
    method: "POST",
    data: payload,
    authMode: "none",
  });
}

export async function fetchMineUserInfo(): Promise<AuthUser> {
  const rawUser = await request<AuthUserApiDTO>({
    url: AUTH_API_PATHS.MINE_USER_INFO,
    method: "GET",
    authMode: "required",
  });

  return normalizeAuthUserFromApi(rawUser) || {
    id: "unknown",
    nickname: "Wechat User",
    avatarUrl: undefined,
  };
}
