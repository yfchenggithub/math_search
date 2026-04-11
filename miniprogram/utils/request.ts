import { API_CONFIG } from "../config/api";
import type {
  ApiBusinessMeta,
  RequestHeader,
  RequestData,
  RequestOptions,
} from "../types/api";

type ErrorCode = number | string;

interface RequestErrorOptions {
  statusCode?: number;
  code?: ErrorCode;
  data?: unknown;
}

/**
 * 统一的请求异常对象。
 *
 * 页面层只需要拿 message 做 toast，
 * 如果后续要做埋点或更细的错误分流，也能拿到状态码和原始数据。
 */
export class RequestError extends Error {
  statusCode?: number;
  code?: ErrorCode;
  data?: unknown;

  constructor(message: string, options: RequestErrorOptions = {}) {
    super(message);
    this.name = "RequestError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.data = options.data;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function getMessageFromPayload(data: unknown): string {
  if (!isPlainObject(data)) {
    return "";
  }

  const candidateKeys: Array<keyof ApiBusinessMeta> = ["message", "msg", "error"];

  for (let index = 0; index < candidateKeys.length; index += 1) {
    const key = candidateKeys[index];
    const value = data[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function getCodeFromPayload(data: unknown): ErrorCode | undefined {
  if (!isPlainObject(data)) {
    return undefined;
  }

  const code = data.code;
  if (typeof code === "number" || typeof code === "string") {
    return code;
  }

  return undefined;
}

function resolveHttpErrorMessage(statusCode: number, data: unknown): string {
  const payloadMessage = getMessageFromPayload(data);

  if (payloadMessage) {
    return payloadMessage;
  }

  return `请求失败（HTTP ${statusCode}）`;
}

function resolveBusinessError(data: unknown): RequestError | null {
  if (!isPlainObject(data)) {
    return null;
  }

  const success = data.success;
  const code = getCodeFromPayload(data);
  const message = getMessageFromPayload(data) || "接口返回业务异常";

  if (success === false) {
    return new RequestError(message, {
      code,
      data,
    });
  }

  if (typeof code === "number" && code !== 0 && code !== 200) {
    return new RequestError(message, {
      code,
      data,
    });
  }

  if (typeof code === "string" && code !== "" && code !== "0" && code !== "200") {
    return new RequestError(message, {
      code,
      data,
    });
  }

  return null;
}

function resolveRequestUrl(url: string): string {
  const normalizedUrl = url.trim();

  if (/^https?:\/\//i.test(normalizedUrl)) {
    return normalizedUrl;
  }

  const baseURL = API_CONFIG.baseURL.trim().replace(/\/+$/, "");
  if (!baseURL) {
    throw new RequestError("API baseURL 未配置");
  }

  return `${baseURL}/${normalizedUrl.replace(/^\/+/, "")}`;
}

function resolveRequestHeader(header?: RequestHeader): RequestHeader {
  return {
    ...API_CONFIG.header,
    ...header,
  };
}

function resolveNetworkErrorMessage(errMsg?: string): string {
  const message = String(errMsg || "").toLowerCase();

  if (message.includes("timeout")) {
    return "请求超时，请稍后重试";
  }

  if (message.includes("abort")) {
    return "请求已取消";
  }

  if (message.includes("fail")) {
    return "网络请求失败，请检查网络或接口域名配置";
  }

  return "网络请求失败，请稍后重试";
}

/**
 * 把未知异常转换成适合页面直接提示的可读文本。
 */
export function getErrorMessage(
  error: unknown,
  fallback = "请求失败，请稍后重试",
): string {
  if (error instanceof RequestError && error.message) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

/**
 * 小程序通用请求封装。
 *
 * 设计原则：
 * 1. 只保留当前阶段真正需要的能力
 * 2. 页面层直接拿 data，不再重复解包
 * 3. HTTP 异常和基础业务异常统一在这里收口
 */
export function request<TResponse extends RequestData>(
  options: RequestOptions,
): Promise<TResponse> {
  const {
    url,
    method = "GET",
    data,
    header,
    timeout = API_CONFIG.timeout,
  } = options;

  return new Promise<TResponse>((resolve, reject) => {
    let requestUrl = "";

    try {
      requestUrl = resolveRequestUrl(url);
    } catch (error) {
      reject(error);
      return;
    }

    wx.request<TResponse>({
      url: requestUrl,
      method,
      data,
      timeout,
      header: resolveRequestHeader(header),
      success: (response) => {
        const { statusCode, data: responseData } = response;

        if (statusCode < 200 || statusCode >= 300) {
          reject(new RequestError(resolveHttpErrorMessage(statusCode, responseData), {
            statusCode,
            data: responseData,
          }));
          return;
        }

        if (responseData === null || responseData === undefined) {
          reject(new RequestError("服务端返回为空"));
          return;
        }

        const businessError = resolveBusinessError(responseData);
        if (businessError) {
          reject(businessError);
          return;
        }

        resolve(responseData);
      },
      fail: (error) => {
        reject(new RequestError(resolveNetworkErrorMessage(error.errMsg)));
      },
    });
  });
}
