import { loginByWechatMiniProgram } from "../../api/auth-api";
import {
  mapAuthLoginPayloadToSession,
  normalizeWechatMiniAppLoginResponse,
} from "../auth-normalizers";
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

    const normalizedPayload = normalizeWechatMiniAppLoginResponse(response);
    if (!normalizedPayload.accessToken) {
      throw new Error("AUTH_API_TOKEN_EMPTY");
    }

    const now = Date.now();
    const session: AuthSession = mapAuthLoginPayloadToSession(normalizedPayload, now);

    return { session };
  }
}
