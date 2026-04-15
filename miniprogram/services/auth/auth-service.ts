import { authStore } from "../../stores/auth-store";
import {
  clearSession,
  getAccessToken as readAccessToken,
  getSession,
  saveSession,
  updateSession,
} from "../../utils/storage/token-storage";
import { setAuthExpiredHandler } from "../request/request";
import { MiniProgramWechatAuthAdapter } from "./adapters/mini-program-wechat-auth-adapter";
import type { AuthAdapter } from "./adapters/auth-adapter";
import type {
  AuthSession,
  AuthStatus,
  AuthUser,
} from "./auth-types";

class AuthService {
  private initialized = false;
  private loginPromise: Promise<AuthSession> | null = null;
  private adapter: AuthAdapter;

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

  async login(): Promise<AuthSession> {
    this.init();

    const state = authStore.getState();
    if (state.status === "authenticated" && state.session) {
      return state.session;
    }

    if (this.loginPromise) {
      return this.loginPromise;
    }

    authStore.setLoggingIn();

    this.loginPromise = this.adapter.login()
      .then((result) => {
        const session = result.session;
        saveSession(session);
        authStore.setAuthenticated(session);
        return session;
      })
      .catch((error) => {
        authStore.setVisitor(String((error as Error)?.message || ""));
        throw error;
      })
      .finally(() => {
        this.loginPromise = null;
      });

    return this.loginPromise;
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
}

export const authService = new AuthService(new MiniProgramWechatAuthAdapter());
