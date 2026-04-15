import type { AuthSession, AuthStatus, AuthUser } from "../services/auth/auth-types";

export interface AuthState {
  status: AuthStatus;
  session: AuthSession | null;
  user: AuthUser | null;
  lastError: string;
}

type AuthListener = (state: AuthState) => void;

class AuthStore {
  private state: AuthState = {
    status: "visitor",
    session: null,
    user: null,
    lastError: "",
  };

  private listeners = new Set<AuthListener>();

  getState(): AuthState {
    return this.state;
  }

  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    listener(this.state);

    return () => {
      this.listeners.delete(listener);
    };
  }

  setVisitor(lastError = ""): void {
    this.state = {
      status: "visitor",
      session: null,
      user: null,
      lastError,
    };
    this.emit();
  }

  setLoggingIn(): void {
    this.state = {
      ...this.state,
      status: "logging_in",
      lastError: "",
    };
    this.emit();
  }

  setAuthenticated(session: AuthSession): void {
    this.state = {
      status: "authenticated",
      session,
      user: session.user || null,
      lastError: "",
    };
    this.emit();
  }

  setExpired(): void {
    this.state = {
      status: "expired",
      session: null,
      user: null,
      lastError: "SESSION_EXPIRED",
    };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => {
      listener(this.state);
    });
  }
}

export const authStore = new AuthStore();
