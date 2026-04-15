import type { LoginResult } from "../auth-types";

export interface AuthAdapter {
  login(): Promise<LoginResult>;
  logout?(): Promise<void> | void;
}
