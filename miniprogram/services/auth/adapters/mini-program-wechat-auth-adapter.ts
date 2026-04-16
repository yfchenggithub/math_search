import { loginByWechatMiniProgram } from "../../api/auth-api";
import {
  mapAuthLoginPayloadToSession,
  normalizeWechatMiniAppLoginResponse,
} from "../auth-normalizers";
import type { AuthLoginTraceOptions, AuthSession, LoginResult } from "../auth-types";
import type { AuthAdapter } from "./auth-adapter";
import { createLogger } from "../../../utils/logger/logger";

type AuthFlowRuntimeError = Error & {
  authCode?: string;
  code?: string | number;
  rawError?: unknown;
  cause?: unknown;
  statusCode?: number;
};

const adapterLogger = createLogger("auth-adapter");

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

function wxLoginAsync(traceId?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    adapterLogger.info("wx_login_call_start", {
      traceId,
    });

    wx.login({
      success: (res) => {
        const code = String(res.code || "").trim();
        if (!code) {
          const error = toAuthFlowError("WECHAT_LOGIN_CODE_EMPTY", "Wechat login code is empty");
          adapterLogger.warn("wx_login_code_fail", {
            traceId,
            error,
          });
          reject(error);
          return;
        }

        adapterLogger.info("wx_login_code_success", {
          traceId,
          code,
          codeLength: code.length,
        });
        resolve(code);
      },
      fail: (error) => {
        const normalizedError = normalizeWxLoginError(error);
        adapterLogger.warn("wx_login_call_fail", {
          traceId,
          error: normalizedError,
        });
        reject(normalizedError);
      },
    });
  });
}

export class MiniProgramWechatAuthAdapter implements AuthAdapter {
  async login(options?: AuthLoginTraceOptions): Promise<LoginResult> {
    const traceId = options?.traceId;
    adapterLogger.info("login_start", {
      traceId,
    });

    emitStage(options, "preparing", "姝ｅ湪鍑嗗鐧诲綍...");

    try {
      emitStage(options, "wechat_code", "姝ｅ湪鑾峰彇寰俊鐧诲綍鍑瘉...");
      const code = await wxLoginAsync(traceId);

      emitStage(options, "server_sign_in", "姝ｅ湪杩炴帴鏈嶅姟鍣?..");
      adapterLogger.info("backend_login_request_start", {
        traceId,
      });
      const response = await loginByWechatMiniProgram({
        code,
        platform: "mini_program",
        authProvider: "wechat",
      }).catch((error) => {
        adapterLogger.warn("backend_login_request_fail", {
          traceId,
          error,
        });
        throw toAuthFlowError("AUTH_API_REQUEST_FAILED", "Auth API request failed", error);
      });
      adapterLogger.info("backend_login_request_success", {
        traceId,
      });

      const normalizedPayload = normalizeWechatMiniAppLoginResponse(response);
      if (!normalizedPayload.accessToken) {
        throw toAuthFlowError("AUTH_API_TOKEN_EMPTY", "Auth API token is empty", response);
      }

      const now = Date.now();
      const session: AuthSession = mapAuthLoginPayloadToSession(normalizedPayload, now);

      emitStage(options, "session_ready", "Login credential ready");
      adapterLogger.info("login_success", {
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

      adapterLogger.warn("login_fail", {
        traceId,
        authCode,
        error: normalizedError,
      });

      throw normalizedError;
    }
  }
}
