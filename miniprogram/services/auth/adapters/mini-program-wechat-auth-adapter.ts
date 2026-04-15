import { loginByWechatMiniProgram } from "../../api/auth-api";
import {
  mapAuthLoginPayloadToSession,
  normalizeWechatMiniAppLoginResponse,
} from "../auth-normalizers";
import type { AuthLoginTraceOptions, AuthSession, LoginResult } from "../auth-types";
import type { AuthAdapter } from "./auth-adapter";

type AuthFlowRuntimeError = Error & {
  authCode?: string;
  code?: string | number;
  rawError?: unknown;
  cause?: unknown;
  statusCode?: number;
};

function emitStage(
  options: AuthLoginTraceOptions | undefined,
  stage: "preparing" | "wechat_code" | "server_sign_in" | "session_ready",
  message: string,
) {
  options?.onStageChange?.({
    stage,
    message,
    traceId: options.traceId,
    timestamp: Date.now(),
  });
}

function toAuthFlowError(
  authCode: string,
  fallbackMessage: string,
  rawError?: unknown,
): Error {
  const baseError = rawError instanceof Error
    ? rawError as AuthFlowRuntimeError
    : new Error(fallbackMessage) as AuthFlowRuntimeError;
  const runtimeError = baseError as AuthFlowRuntimeError;

  runtimeError.authCode = runtimeError.authCode || authCode;

  if (runtimeError.rawError === undefined && rawError !== undefined && rawError !== runtimeError) {
    runtimeError.rawError = rawError;
  }

  if (runtimeError.cause === undefined && rawError !== undefined && rawError !== runtimeError) {
    runtimeError.cause = rawError;
  }

  if (!runtimeError.message) {
    runtimeError.message = fallbackMessage;
  }

  if (runtimeError.statusCode === undefined && rawError && typeof rawError === "object") {
    const statusCode = (rawError as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number") {
      runtimeError.statusCode = statusCode;
    }
  }

  return runtimeError;
}

function isWechatLoginCancelled(error: unknown): boolean {
  const errMsg = error && typeof error === "object"
    ? String((error as { errMsg?: unknown }).errMsg || "").toLowerCase()
    : "";

  return errMsg.includes("cancel");
}

function normalizeWxLoginError(error: unknown): Error {
  if (isWechatLoginCancelled(error)) {
    return toAuthFlowError("WECHAT_LOGIN_CANCELLED", "Wechat login cancelled", error);
  }

  return toAuthFlowError("WECHAT_LOGIN_FAILED", "Wechat login failed", error);
}

function wxLoginAsync(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        const code = String(res.code || "").trim();
        if (!code) {
          reject(toAuthFlowError("WECHAT_LOGIN_CODE_EMPTY", "Wechat login code is empty"));
          return;
        }
        resolve(code);
      },
      fail: (error) => {
        reject(normalizeWxLoginError(error));
      },
    });
  });
}

export class MiniProgramWechatAuthAdapter implements AuthAdapter {
  async login(options?: AuthLoginTraceOptions): Promise<LoginResult> {
    const traceId = options?.traceId;
    console.info("[auth-flow] [adapter] login start", {
      traceId,
    });

    emitStage(options, "preparing", "正在准备登录...");

    try {
      emitStage(options, "wechat_code", "正在获取微信登录凭证...");
      const code = await wxLoginAsync();

      emitStage(options, "server_sign_in", "正在连接服务器...");
      const response = await loginByWechatMiniProgram({
        code,
        platform: "mini_program",
        authProvider: "wechat",
      }).catch((error) => {
        throw toAuthFlowError("AUTH_API_REQUEST_FAILED", "Auth API request failed", error);
      });

      const normalizedPayload = normalizeWechatMiniAppLoginResponse(response);
      if (!normalizedPayload.accessToken) {
        throw toAuthFlowError("AUTH_API_TOKEN_EMPTY", "Auth API token is empty", response);
      }

      const now = Date.now();
      const session: AuthSession = mapAuthLoginPayloadToSession(normalizedPayload, now);

      emitStage(options, "session_ready", "登录凭证已建立");
      console.info("[auth-flow] [adapter] login success", {
        traceId,
        platform: session.platform,
        authProvider: session.authProvider,
      });

      return { session };
    } catch (error) {
      const normalizedError = error instanceof Error
        ? error
        : toAuthFlowError("WECHAT_LOGIN_FAILED", "Wechat login failed", error);

      const authCode = (normalizedError as AuthFlowRuntimeError).authCode || "UNKNOWN";

      console.warn("[auth-flow] [adapter] login failed", {
        traceId,
        authCode,
        error: normalizedError,
      });

      throw normalizedError;
    }
  }
}
