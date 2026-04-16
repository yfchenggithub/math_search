import { authStore } from "../../stores/auth-store";
import {
  clearSession,
  getAccessToken as readAccessToken,
  getSession,
  saveSession,
  updateSession,
} from "../../utils/storage/token-storage";
import { createLogger } from "../../utils/logger/logger";
import { setAuthExpiredHandler } from "../request/request";
import { MiniProgramWechatAuthAdapter } from "./adapters/mini-program-wechat-auth-adapter";
import type { AuthAdapter } from "./adapters/auth-adapter";
import type {
  AuthLoginStage,
  AuthLoginStagePayload,
  AuthLoginTraceOptions,
  AuthSession,
  AuthStatus,
  AuthUser,
} from "./auth-types";
import { mapAuthFlowError } from "../../utils/auth/auth-login-feedback";

const authLogger = createLogger("auth-service");

class AuthService {
  private initialized = false;
  private loginPromise: Promise<AuthSession> | null = null;
  private adapter: AuthAdapter;
  private loginStartedAt = 0;
  private currentLoginTraceId = "";
  private currentLoginStage: AuthLoginStage = "idle";
  private currentLoginStageMessage = "";
  private stageListeners = new Set<(payload: AuthLoginStagePayload) => void>();

  constructor(adapter: AuthAdapter) {
    this.adapter = adapter;
  }

  init(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    setAuthExpiredHandler(() => {
      this.onAuthExpired();
    });

    const session = getSession();
    if (!session) {
      authStore.setVisitor();
      return;
    }

    if (this.isSessionExpired(session)) {
      clearSession();
      authStore.setExpired();
      return;
    }

    authStore.setAuthenticated(session);
  }

  async login(options?: AuthLoginTraceOptions): Promise<AuthSession> {
    this.init();

    const removeStageListener = this.subscribeStageListener(options);
    const state = authStore.getState();
    if (state.status === "authenticated" && state.session) {
      if (options?.onStageChange) {
        options.onStageChange({
          stage: "session_ready",
          message: "Session is still valid, reuse current session",
          traceId: options.traceId,
          timestamp: Date.now(),
        });
      }
      removeStageListener();
      return state.session;
    }

    if (this.loginPromise) {
      this.logAuthFlow("login_reuse_inflight", {
        traceId: this.currentLoginTraceId,
        stage: this.currentLoginStage,
      });

      if (options?.onStageChange && this.currentLoginStage !== "idle") {
        options.onStageChange({
          stage: this.currentLoginStage,
          message: this.currentLoginStageMessage || "复用中的登录流程",
          traceId: this.currentLoginTraceId,
          timestamp: Date.now(),
        });
      }

      return this.loginPromise.finally(() => {
        removeStageListener();
      });
    }

    const traceId = this.resolveTraceId(options);
    this.currentLoginTraceId = traceId;
    this.currentLoginStage = "idle";
    this.currentLoginStageMessage = "";
    this.loginStartedAt = Date.now();

    this.logAuthFlow("login_start", {
      traceId,
    });

    authStore.setLoggingIn();
    this.notifyStage({
      stage: "preparing",
      message: "正在准备登录...",
      traceId,
      timestamp: Date.now(),
    });

    this.loginPromise = this.adapter.login({
      traceId,
      onStageChange: (payload) => {
        this.notifyStage({
          ...payload,
          traceId: payload.traceId || traceId,
          timestamp: payload.timestamp || Date.now(),
        });
      },
    })
      .then((result) => {
        const session = result.session;
        saveSession(session);
        authStore.setAuthenticated(session);

        const elapsedMs = this.getElapsedMs();
        this.logAuthFlow("login_success", {
          traceId,
          elapsedMs,
          platform: session.platform,
          authProvider: session.authProvider,
        });

        return session;
      })
      .catch((error) => {
        const mappedError = mapAuthFlowError(error);
        this.notifyStage({
          stage: "failed",
          message: mappedError.userMessage,
          traceId,
          timestamp: Date.now(),
        });
        this.logAuthFlow("login_fail", {
          traceId,
          elapsedMs: this.getElapsedMs(),
          category: mappedError.category,
          debugMessage: mappedError.debugMessage,
        }, "warn");

        authStore.setVisitor(String((error as Error)?.message || mappedError.category));
        throw error;
      })
      .finally(() => {
        this.logAuthFlow("login_finish", {
          traceId,
          elapsedMs: this.getElapsedMs(),
          finalStage: this.currentLoginStage,
        });

        this.loginPromise = null;
        this.loginStartedAt = 0;
        this.currentLoginTraceId = "";
        this.currentLoginStage = "idle";
        this.currentLoginStageMessage = "";
        this.stageListeners.clear();
      });

    return this.loginPromise.finally(() => {
      removeStageListener();
    });
  }

  logout(): void {
    clearSession();
    authStore.setVisitor();
  }

  getAccessToken(): string {
    const session = getSession();
    if (!session) {
      return "";
    }

    if (this.isSessionExpired(session)) {
      this.onAuthExpired();
      return "";
    }

    return readAccessToken();
  }

  // Keep compatibility for callers that still read getToken().
  getToken(): string {
    return this.getAccessToken();
  }

  getCurrentUser(): AuthUser | null {
    return authStore.getState().user;
  }

  getStatus(): AuthStatus {
    return authStore.getState().status;
  }

  isAuthenticated(): boolean {
    return this.getStatus() === "authenticated" && Boolean(this.getAccessToken());
  }

  async requireAuth(): Promise<boolean> {
    if (this.isAuthenticated()) {
      return true;
    }

    await this.login();
    return this.isAuthenticated();
  }

  onAuthExpired(): void {
    this.logAuthFlow("auth_expired", {
      traceId: this.currentLoginTraceId || undefined,
      stage: this.currentLoginStage,
    }, "warn");
    clearSession();
    authStore.setExpired();
  }

  syncUser(user: AuthUser): void {
    const nextSession = updateSession({ user });
    if (!nextSession) {
      return;
    }

    authStore.setAuthenticated(nextSession);
  }

  private isSessionExpired(session: AuthSession): boolean {
    if (typeof session.expiresAt !== "number") {
      return false;
    }

    return session.expiresAt <= Date.now();
  }

  private resolveTraceId(options?: AuthLoginTraceOptions): string {
    const traceId = String(options?.traceId || "").trim();
    if (traceId) {
      return traceId;
    }

    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `auth_${timestamp}_${random}`;
  }

  private subscribeStageListener(options?: AuthLoginTraceOptions): () => void {
    const listener = options?.onStageChange;
    if (!listener) {
      return () => {};
    }

    this.stageListeners.add(listener);

    return () => {
      this.stageListeners.delete(listener);
    };
  }

  private notifyStage(payload: AuthLoginStagePayload): void {
    const normalizedPayload: AuthLoginStagePayload = {
      ...payload,
      traceId: payload.traceId || this.currentLoginTraceId || undefined,
      timestamp: payload.timestamp || Date.now(),
    };

    this.currentLoginStage = normalizedPayload.stage;
    this.currentLoginStageMessage = normalizedPayload.message || "";

    this.logAuthFlow("login_stage_change", {
      traceId: normalizedPayload.traceId,
      stage: normalizedPayload.stage,
      message: normalizedPayload.message || "",
    });

    this.stageListeners.forEach((listener) => {
      try {
        listener(normalizedPayload);
      } catch (error) {
        this.logAuthFlow("login_stage_listener_failed", {
          traceId: normalizedPayload.traceId,
          error,
        }, "warn");
      }
    });
  }

  private getElapsedMs(): number {
    if (!this.loginStartedAt) {
      return 0;
    }

    return Date.now() - this.loginStartedAt;
  }

  private logAuthFlow(
    eventName: string,
    extra?: Record<string, unknown>,
    level: "debug" | "info" | "warn" | "error" = "info",
  ): void {
    if (level === "debug") {
      authLogger.debug(eventName, extra);
      return;
    }

    if (level === "warn") {
      authLogger.warn(eventName, extra);
      return;
    }

    if (level === "error") {
      authLogger.error(eventName, extra);
      return;
    }

    authLogger.info(eventName, extra);
  }
}

export const authService = new AuthService(new MiniProgramWechatAuthAdapter());
