/**
 * 小程序端 API 基础配置。
 *
 * 当前先做最小可用版本：
 * 1. 通过小程序环境区分开发 / 体验 / 正式环境
 * 2. 统一维护 baseURL、超时时间和默认请求头
 * 3. 后续只需要改这里，不需要逐页修改请求地址
 */
type ApiEnv = "develop" | "trial" | "release";

const BASE_URL_BY_ENV: Record<ApiEnv, string> = {
  // 本地联调时可替换为你自己的后端地址
  develop: "http://127.0.0.1:3000",
  // 体验版和正式版先给占位地址，接入真实后端时直接改这里
  trial: "https://api.example.com",
  release: "https://api.example.com",
};

function resolveApiEnv(): ApiEnv {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch (error) {
    console.warn("读取小程序环境失败，默认按正式环境处理", error);
    return "release";
  }
}

function resolveApiBaseURL(): string {
  const env = resolveApiEnv();
  return BASE_URL_BY_ENV[env];
}

export const API_CONFIG = {
  baseURL: resolveApiBaseURL(),
  timeout: 10000,
  header: {
    "content-type": "application/json",
    Accept: "application/json",
  },
};

