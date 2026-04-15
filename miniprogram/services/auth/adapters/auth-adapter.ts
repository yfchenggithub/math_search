import type { AuthLoginTraceOptions, LoginResult } from "../auth-types";

export interface AuthAdapter {
  login(options?: AuthLoginTraceOptions): Promise<LoginResult>;
  logout?(): Promise<void> | void;
}
