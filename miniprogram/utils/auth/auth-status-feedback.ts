import type {
  AuthStatusToastPayload,
  AuthStatusToastType,
} from "../../services/auth/auth-types";
import { createLogger } from "../logger/logger";

export interface AuthStatusToastState {
  visible: boolean;
  type: AuthStatusToastType;
  title: string;
  message: string;
  traceId: string;
  retryable: boolean;
  closable: boolean;
  updatedAt: number;
}

interface AuthStatusToastOptions extends AuthStatusToastPayload {
  autoHideMs?: number;
  source?: "mine" | "guard" | "unknown";
  onRetry?: () => void;
}

type AuthStatusToastListener = (state: AuthStatusToastState) => void;

const authStatusToastLogger = createLogger("auth-status-toast");

const DEFAULT_AUTO_HIDE_BY_TYPE: Record<AuthStatusToastType, number> = {
  idle: 0,
  logging: 0,
  success: 1500,
  warning: 2400,
  error: 4200,
  cancelled: 1500,
};

const DEFAULT_TITLE_BY_TYPE: Record<AuthStatusToastType, string> = {
  idle: "",
  logging: "登录中",
  success: "已完成登录",
  warning: "登录已完成",
  error: "登录未完成",
  cancelled: "已取消登录",
};

const listeners = new Set<AuthStatusToastListener>();
let hideTimer = 0;
let retryHandler: null | (() => void) = null;
let currentState: AuthStatusToastState = createIdleAuthStatusToastState();

function createIdleAuthStatusToastState(): AuthStatusToastState {
  return {
    visible: false,
    type: "idle",
    title: "",
    message: "",
    traceId: "",
    retryable: false,
    closable: false,
    updatedAt: Date.now(),
  };
}

function clearHideTimer() {
  clearTimeout(hideTimer);
  hideTimer = 0;
}

function emitState() {
  listeners.forEach((listener) => {
    try {
      listener(currentState);
    } catch (error) {
      authStatusToastLogger.warn("listener_failed", {
        error,
      });
    }
  });
}

function resolveDefaultMessageByType(type: AuthStatusToastType): string {
  switch (type) {
    case "logging":
      return "正在准备登录...";
    case "success":
      return "登录成功";
    case "warning":
      return "已登录，部分数据稍后刷新";
    case "error":
      return "登录失败，请稍后重试";
    case "cancelled":
      return "你已取消本次登录";
    case "idle":
    default:
      return "";
  }
}

function resolveAutoHideMs(options: AuthStatusToastOptions): number {
  if (typeof options.autoHideMs === "number" && options.autoHideMs >= 0) {
    return options.autoHideMs;
  }

  return DEFAULT_AUTO_HIDE_BY_TYPE[options.type];
}

function scheduleAutoHide(delay: number, reason: string) {
  if (delay <= 0) {
    return;
  }

  clearHideTimer();
  hideTimer = setTimeout(() => {
    hideAuthStatusToast(reason);
  }, delay) as unknown as number;
}

export function getAuthStatusToastState(): AuthStatusToastState {
  return currentState;
}

export function subscribeAuthStatusToast(listener: AuthStatusToastListener): () => void {
  listeners.add(listener);
  listener(currentState);

  return () => {
    listeners.delete(listener);
  };
}

export function hasAuthStatusToastSubscriber(): boolean {
  return listeners.size > 0;
}

export function showAuthStatusToast(options: AuthStatusToastOptions): void {
  const type = options.type || "idle";
  const nextState: AuthStatusToastState = type === "idle"
    ? createIdleAuthStatusToastState()
    : {
      visible: true,
      type,
      title: String(options.title || DEFAULT_TITLE_BY_TYPE[type]).trim(),
      message: String(options.message || resolveDefaultMessageByType(type)).trim(),
      traceId: String(options.traceId || "").trim(),
      retryable: Boolean(options.retryable),
      closable: Boolean(options.closable),
      updatedAt: Date.now(),
    };

  clearHideTimer();
  retryHandler = options.onRetry || null;
  currentState = nextState;

  authStatusToastLogger.info("state_change", {
    type: nextState.type,
    visible: nextState.visible,
    traceId: nextState.traceId,
    source: options.source || "unknown",
    retryable: nextState.retryable,
  });

  emitState();

  const autoHideMs = resolveAutoHideMs(options);
  if (nextState.visible && autoHideMs > 0) {
    scheduleAutoHide(autoHideMs, "auto_close");
  }
}

export function hideAuthStatusToast(reason = "manual_close"): void {
  if (!currentState.visible) {
    return;
  }

  clearHideTimer();
  retryHandler = null;
  currentState = createIdleAuthStatusToastState();

  authStatusToastLogger.info("state_hide", {
    reason,
  });

  emitState();
}

export function retryAuthStatusToast(): boolean {
  if (!retryHandler) {
    return false;
  }

  const handler = retryHandler;

  authStatusToastLogger.info("retry_click");
  hideAuthStatusToast("retry_click");

  handler();
  return true;
}
