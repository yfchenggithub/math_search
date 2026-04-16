import type {
  AuthUser,
  AuthUserApiDTO,
  WechatMiniAppLoginApiResponse,
  WechatMiniAppLoginRequest,
} from "../auth/auth-types";
import { normalizeAuthUserFromApi } from "../auth/auth-normalizers";
import { RequestError, request } from "../request/request";
import { createLogger } from "../../utils/logger/logger";

const AUTH_API_PATHS = {
  WECHAT_MINI_LOGIN: "/api/v1/auth/wechat-miniapp-login",
  MINE_USER_INFO: "/api/v1/users/me",
} as const;

const authApiLogger = createLogger("auth-api");

function getErrorRequestId(error: unknown): string | undefined {
  if (error instanceof RequestError) {
    return error.requestId;
  }

  return undefined;
}

function buildLoginResponseSummary(response: WechatMiniAppLoginApiResponse): Record<string, unknown> {
  const runtimeResponse = response as WechatMiniAppLoginApiResponse & Record<string, unknown>;
  return {
    hasAccessToken: Boolean(runtimeResponse.accessToken || runtimeResponse.token),
    hasRefreshToken: Boolean(runtimeResponse.refreshToken || runtimeResponse.refresh_token),
    hasUser: Boolean(runtimeResponse.user),
    keys: Object.keys(runtimeResponse).slice(0, 12),
  };
}

export async function loginByWechatMiniProgram(
  payload: WechatMiniAppLoginRequest,
): Promise<WechatMiniAppLoginApiResponse> {
  authApiLogger.info("wechat_login_request_start", {
    path: AUTH_API_PATHS.WECHAT_MINI_LOGIN,
    authMode: "none",
    payload,
  });

  try {
    const response = await request<WechatMiniAppLoginApiResponse, WechatMiniAppLoginRequest>({
      url: AUTH_API_PATHS.WECHAT_MINI_LOGIN,
      method: "POST",
      data: payload,
      authMode: "none",
    });

    authApiLogger.info("wechat_login_request_success", {
      path: AUTH_API_PATHS.WECHAT_MINI_LOGIN,
    });
    authApiLogger.debug("wechat_login_response_summary", {
      path: AUTH_API_PATHS.WECHAT_MINI_LOGIN,
      summary: buildLoginResponseSummary(response),
    });

    return response;
  } catch (error) {
    authApiLogger.warn("wechat_login_request_fail", {
      path: AUTH_API_PATHS.WECHAT_MINI_LOGIN,
      requestId: getErrorRequestId(error),
      error,
    });
    throw error;
  }
}

export async function fetchMineUserInfo(): Promise<AuthUser> {
  authApiLogger.info("mine_user_info_request_start", {
    path: AUTH_API_PATHS.MINE_USER_INFO,
    authMode: "required",
  });

  try {
    const rawUser = await request<AuthUserApiDTO>({
      url: AUTH_API_PATHS.MINE_USER_INFO,
      method: "GET",
      authMode: "required",
    });

    const normalizedUser = normalizeAuthUserFromApi(rawUser) || {
      id: "unknown",
      nickname: "Wechat User",
      avatarUrl: undefined,
    };

    authApiLogger.info("mine_user_info_request_success", {
      path: AUTH_API_PATHS.MINE_USER_INFO,
      userId: normalizedUser.id,
    });
    authApiLogger.debug("mine_user_info_response_summary", {
      path: AUTH_API_PATHS.MINE_USER_INFO,
      hasAvatar: Boolean(normalizedUser.avatarUrl),
      nickname: normalizedUser.nickname,
    });

    return normalizedUser;
  } catch (error) {
    authApiLogger.warn("mine_user_info_request_fail", {
      path: AUTH_API_PATHS.MINE_USER_INFO,
      requestId: getErrorRequestId(error),
      error,
    });
    throw error;
  }
}
