import type { AuthLoginStage } from "../../services/auth/auth-types";
import { createLogger } from "../logger/logger";
import { RequestError } from "../request";

const authLoginFeedbackLogger = createLogger("auth-login-feedback");

type RuntimeErrorWithMeta = Error & {
  code?: string | number;
  authCode?: string;
  errMsg?: string;
  statusCode?: number;
  rawError?: unknown;
  cause?: unknown;
};

export type AuthFlowErrorCategory =
  | "user_cancelled"
  | "wechat_login_failed"
  | "network_timeout"
  | "network_error"
  | "backend_login_failed"
  | "token_empty"
  | "unknown";

export interface AuthFlowErrorMapping {
  category: AuthFlowErrorCategory;
  userMessage: string;
  debugMessage: string;
  shouldToast: boolean;
  isUserCancelled: boolean;
}

interface AuthFlowErrorDetails {
  codes: string[];
  messages: string[];
  statusCode?: number;
}

interface LoginDebugTextOptions {
  traceId?: string;
  stage?: AuthLoginStage;
  elapsedMs?: number;
  errorCategory?: AuthFlowErrorCategory;
  isLoggedIn?: boolean;
  favoriteCount?: number;
  debugMessage?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pushUnique(values: string[], value: string) {
  if (!value || values.includes(value)) {
    return;
  }

  values.push(value);
}

function pushCode(codes: string[], code: unknown) {
  if (typeof code === "number") {
    pushUnique(codes, String(code));
    return;
  }

  const normalized = normalizeText(code);
  if (normalized) {
    pushUnique(codes, normalized);
  }
}

function extractAuthFlowErrorDetails(error: unknown): AuthFlowErrorDetails {
  const details: AuthFlowErrorDetails = {
    codes: [],
    messages: [],
  };
  const visited = new Set<unknown>();

  // 递归提取嵌套错误，保留原始诊断线索。
  const visit = (value: unknown, depth: number) => {
    if (value === null || value === undefined || depth > 3 || visited.has(value)) {
      return;
    }

    visited.add(value);

    if (value instanceof RequestError) {
      pushUnique(details.messages, normalizeText(value.message));
      pushCode(details.codes, value.code);
      if (typeof value.statusCode === "number" && details.statusCode === undefined) {
        details.statusCode = value.statusCode;
      }
    }

    if (value instanceof Error) {
      const runtimeError = value as RuntimeErrorWithMeta;
      pushUnique(details.messages, normalizeText(runtimeError.message));
      pushCode(details.codes, runtimeError.authCode);
      pushCode(details.codes, runtimeError.code);

      if (typeof runtimeError.statusCode === "number" && details.statusCode === undefined) {
        details.statusCode = runtimeError.statusCode;
      }

      visit(runtimeError.rawError, depth + 1);
      visit(runtimeError.cause, depth + 1);
      return;
    }

    if (isPlainObject(value)) {
      pushCode(details.codes, value.authCode);
      pushCode(details.codes, value.code);
      pushUnique(details.messages, normalizeText(value.message));
      pushUnique(details.messages, normalizeText(value.errMsg));

      if (typeof value.statusCode === "number" && details.statusCode === undefined) {
        details.statusCode = value.statusCode;
      }

      visit(value.rawError, depth + 1);
      visit(value.cause, depth + 1);
      return;
    }

    pushUnique(details.messages, normalizeText(value));
  };

  visit(error, 0);

  return details;
}

function containsText(source: string, keyword: string): boolean {
  return source.includes(keyword.toLowerCase());
}

function toLowerJoined(values: string[]): string {
  return values
    .map((item) => item.toLowerCase())
    .join(" ");
}

function resolveAuthFlowErrorCategory(details: AuthFlowErrorDetails): AuthFlowErrorCategory {
  const codesText = toLowerJoined(details.codes);
  const messagesText = toLowerJoined(details.messages);
  const combinedText = `${codesText} ${messagesText}`.trim();

  if (containsText(codesText, "wechat_login_cancelled") || containsText(combinedText, "cancel")) {
    return "user_cancelled";
  }

  if (containsText(codesText, "auth_api_token_empty")) {
    return "token_empty";
  }

  if (
    containsText(codesText, "wechat_login_failed")
    || containsText(codesText, "wechat_login_code_empty")
  ) {
    return "wechat_login_failed";
  }

  if (containsText(combinedText, "timeout")) {
    return "network_timeout";
  }

  if (typeof details.statusCode === "number" && details.statusCode >= 400) {
    return "backend_login_failed";
  }

  if (containsText(codesText, "auth_api_request_failed")) {
    if (containsText(combinedText, "network request failed")) {
      return "network_error";
    }
    return "backend_login_failed";
  }

  if (
    containsText(combinedText, "network request failed")
    || containsText(combinedText, "request aborted")
  ) {
    return "network_error";
  }

  return "unknown";
}

function resolveUserMessage(category: AuthFlowErrorCategory): string {
  switch (category) {
    case "user_cancelled":
      return "你已取消本次登录";
    case "wechat_login_failed":
      return "微信登录未完成，请稍后重试";
    case "network_timeout":
    case "network_error":
      return "网络不稳定，登录请求超时，请重试";
    case "backend_login_failed":
      return "登录服务暂时不可用，请稍后再试";
    case "token_empty":
      return "登录凭证异常，请稍后重试";
    default:
      return "登录暂时不可用，请稍后重试";
  }
}

export function createLoginTraceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `login_${timestamp}_${random}`;
}

export function getLoginStageText(stage: AuthLoginStage): string {
  switch (stage) {
    case "preparing":
      return "正在准备登录...";
    case "wechat_code":
      return "正在获取微信登录凭证...";
    case "server_sign_in":
      return "正在连接服务器...";
    case "session_ready":
      return "登录凭证已建立";
    case "syncing_profile":
      return "正在同步个人资料...";
    case "loading_summary":
      return "正在读取收藏统计...";
    case "success":
      return "已完成登录";
    case "partial_success":
      return "登录已完成，部分信息稍后刷新";
    case "failed":
      return "登录未完成，请重试";
    case "idle":
    default:
      return "";
  }
}

export function mapAuthFlowError(error: unknown): AuthFlowErrorMapping {
  const details = extractAuthFlowErrorDetails(error);
  const category = resolveAuthFlowErrorCategory(details);
  const codeText = details.codes.length ? details.codes.join(",") : "-";
  const messageText = details.messages.length ? details.messages.join(" | ") : "-";
  const statusText = typeof details.statusCode === "number" ? String(details.statusCode) : "-";

  if (category === "unknown") {
    authLoginFeedbackLogger.warn("map_auth_flow_error_unknown", {
      statusText,
      codeText,
      messageText,
    });
  }

  return {
    category,
    userMessage: resolveUserMessage(category),
    debugMessage: `[${category}] status=${statusText}; codes=${codeText}; messages=${messageText}`,
    shouldToast: category !== "user_cancelled",
    isUserCancelled: category === "user_cancelled",
  };
}

export function formatLoginDebugText(options: LoginDebugTextOptions): string {
  const elapsedMs = typeof options.elapsedMs === "number"
    ? Math.max(0, Math.floor(options.elapsedMs))
    : 0;

  const lines = [
    `traceId=${options.traceId || "-"}`,
    `stage=${options.stage || "idle"}`,
    `elapsed=${elapsedMs}ms`,
    `category=${options.errorCategory || "-"}`,
    `isLoggedIn=${Boolean(options.isLoggedIn)}`,
    `favoriteCount=${typeof options.favoriteCount === "number" ? options.favoriteCount : "-"}`,
  ];

  if (options.debugMessage) {
    lines.push(`detail=${options.debugMessage}`);
  }

  return lines.join(" | ");
}

export function isAuthDebugEnv(): boolean {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion === "develop";
  } catch (error) {
    authLoginFeedbackLogger.warn("read_env_version_failed", {
      fallback: false,
      error,
    });
    return false;
  }
}
