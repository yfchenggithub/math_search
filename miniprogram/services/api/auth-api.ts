import { request } from "../request/request";
import type {
  AuthUser,
  WechatMiniAppLoginRequest,
  WechatMiniAppLoginResponse,
} from "../auth/auth-types";

const AUTH_API_PATHS = {
  WECHAT_MINI_LOGIN: "/api/v1/auth/wechat/mini-program/login",
  MINE_USER_INFO: "/api/v1/users/me",
} as const;

export function loginByWechatMiniProgram(
  payload: WechatMiniAppLoginRequest,
): Promise<WechatMiniAppLoginResponse> {
  return request<WechatMiniAppLoginResponse, WechatMiniAppLoginRequest>({
    url: AUTH_API_PATHS.WECHAT_MINI_LOGIN,
    method: "POST",
    data: payload,
    authMode: "none",
  });
}

export function fetchMineUserInfo(): Promise<AuthUser> {
  return request<AuthUser>({
    url: AUTH_API_PATHS.MINE_USER_INFO,
    method: "GET",
    authMode: "required",
  });
}
