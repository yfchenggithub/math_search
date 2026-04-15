import { loginByWechatMiniProgram } from "../../api/auth-api";
import type { AuthSession, LoginResult } from "../auth-types";
import type { AuthAdapter } from "./auth-adapter";

function wxLoginAsync(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        const code = String(res.code || "").trim();
        if (!code) {
          reject(new Error("WECHAT_LOGIN_CODE_EMPTY"));
          return;
        }
        resolve(code);
      },
      fail: (error) => {
        reject(error);
      },
    });
  });
}

function resolveExpiresAt(expiresIn?: number): number | undefined {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return undefined;
  }

  return Date.now() + expiresIn * 1000;
}

export class MiniProgramWechatAuthAdapter implements AuthAdapter {
  async login(): Promise<LoginResult> {
    const code = await wxLoginAsync();
    if (!code) {
      throw new Error("WECHAT_LOGIN_CODE_EMPTY");
    }

    const response = await loginByWechatMiniProgram({
      code,
      platform: "mini_program",
      authProvider: "wechat",
    });

    const token = String(response.accessToken || "").trim();
    if (!token) {
      throw new Error("AUTH_API_TOKEN_EMPTY");
    }

    const session: AuthSession = {
      token,
      tokenType: String(response.tokenType || "Bearer").trim() || "Bearer",
      refreshToken: response.refreshToken,
      expiresAt: resolveExpiresAt(response.expiresIn),
      platform: "mini_program",
      authProvider: "wechat",
      user: response.user,
      obtainedAt: Date.now(),
    };

    return { session };
  }
}
