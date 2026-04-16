import { API_CONFIG } from "../../config/api";
import { createLogger } from "../../utils/logger/logger";
import { getAccessToken, getSession } from "../../utils/storage/token-storage";
import type {
  ApiEnvelope,
  AuthMode,
  RequestData,
  RequestHeader,
  RequestMethod,
  RequestOptions,
  RequestQuery,
  RequestQueryPrimitive,
} from "./request-types";

type ErrorCode = number | string;
type AuthExpiredHandler = (error: RequestError) => void;
type WechatRequestBody = WechatMiniprogram.IAnyObject | string | ArrayBuffer;
const requestLogger = createLogger("request");

interface RequestErrorOptions {
  statusCode?: number;
  code?: ErrorCode;
  data?: unknown;
  requestId?: string;
}

export class RequestError extends Error {
  statusCode?: number;
  code?: ErrorCode;
  data?: unknown;
  requestId?: string;

  constructor(message: string, options: RequestErrorOptions = {}) {
    super(message);
    this.name = "RequestError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.data = options.data;
    this.requestId = options.requestId;
  }
}

let authExpiredHandler: AuthExpiredHandler | null = null;
let isHandlingAuthExpired = false;

export function setAuthExpiredHandler(handler: AuthExpiredHandler | null): void {
  authExpiredHandler = handler;
}

function emitAuthExpired(error: RequestError, skip401Handler?: boolean): void {
  if (!authExpiredHandler || skip401Handler || isHandlingAuthExpired) {
    return;
  }

  isHandlingAuthExpired = true;

  try {
    authExpiredHandler(error);
  } finally {
    setTimeout(() => {
      isHandlingAuthExpired = false;
    }, 0);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function hasOwnProperty(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function isApiEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  if (!isPlainObject(value)) {
    return false;
  }

  const hasCodeOrSuccess = hasOwnProperty(value, "code") || hasOwnProperty(value, "success");
  const hasDataAndMessage =
    hasOwnProperty(value, "data")
    && (hasOwnProperty(value, "message") || hasOwnProperty(value, "msg"));

  return hasCodeOrSuccess || hasDataAndMessage;
}

function getMessageFromPayload(data: unknown): string {
  if (!isPlainObject(data)) {
    return "";
  }

  const candidateKeys: Array<keyof ApiEnvelope> = ["message", "msg", "error"];

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

function isBusinessCodeSuccess(code: ErrorCode | undefined): boolean {
  if (code === undefined || code === "") {
    return true;
  }

  if (typeof code === "number") {
    return code === 0 || code === 200;
  }

  return code === "0" || code === "200";
}

function resolveHttpErrorMessage(statusCode: number, data: unknown): string {
  const payloadMessage = getMessageFromPayload(data);
  if (payloadMessage) {
    return payloadMessage;
  }

  return `Request failed (HTTP ${statusCode})`;
}

function resolveBusinessError(
  data: unknown,
  skip401Handler?: boolean,
): RequestError | null {
  if (!isApiEnvelope(data)) {
    return null;
  }

  const success = data.success;
  const code = getCodeFromPayload(data);
  const message = getMessageFromPayload(data) || "Business error";

  if (success === false || !isBusinessCodeSuccess(code)) {
    const error = new RequestError(message, {
      code,
      data,
    });

    if (code === 401 || code === "401") {
      emitAuthExpired(error, skip401Handler);
    }

    return error;
  }

  return null;
}

function normalizeQueryPrimitive(value: RequestQueryPrimitive): string {
  return String(value);
}

function appendQueryEntry(
  pairs: string[],
  key: string,
  value: RequestQueryPrimitive,
) {
  const encodedKey = encodeURIComponent(key);
  const encodedValue = encodeURIComponent(normalizeQueryPrimitive(value));
  pairs.push(`${encodedKey}=${encodedValue}`);
}

function buildQueryString(query?: RequestQuery): string {
  if (!query) {
    return "";
  }

  const pairs: string[] = [];
  const keys = Object.keys(query);

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const value = query[key];

    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (let arrayIndex = 0; arrayIndex < value.length; arrayIndex += 1) {
        appendQueryEntry(pairs, key, value[arrayIndex]);
      }
      continue;
    }

    appendQueryEntry(pairs, key, value);
  }

  return pairs.join("&");
}

function appendQueryToUrl(url: string, query?: RequestQuery): string {
  const queryString = buildQueryString(query);
  if (!queryString) {
    return url;
  }

  const connector = url.includes("?") ? "&" : "?";
  return `${url}${connector}${queryString}`;
}

function resolveRequestUrl(url: string, query?: RequestQuery): string {
  const normalizedUrl = url.trim();

  if (!normalizedUrl) {
    throw new RequestError("Request URL is empty");
  }

  if (/^https?:\/\//i.test(normalizedUrl)) {
    return appendQueryToUrl(normalizedUrl, query);
  }

  const baseURL = API_CONFIG.baseURL.trim().replace(/\/+$/, "");
  if (!baseURL) {
    throw new RequestError("API baseURL is not configured");
  }

  const mergedUrl = `${baseURL}/${normalizedUrl.replace(/^\/+/, "")}`;
  return appendQueryToUrl(mergedUrl, query);
}

function resolveAuthHeader(authMode: AuthMode): RequestHeader {
  if (authMode === "none") {
    return {};
  }

  const accessToken = getAccessToken();

  if (!accessToken && authMode === "required") {
    throw new RequestError("Please login first", {
      statusCode: 401,
      code: "AUTH_REQUIRED_NO_TOKEN",
    });
  }

  if (!accessToken) {
    return {};
  }

  const tokenType = getSession()?.tokenType || "Bearer";

  return {
    Authorization: `${tokenType} ${accessToken}`,
  };
}

function resolveRequestHeader(
  header: RequestHeader | undefined,
  authMode: AuthMode,
): RequestHeader {
  return {
    ...API_CONFIG.header,
    ...resolveAuthHeader(authMode),
    ...header,
  };
}

function resolveNetworkErrorMessage(errMsg?: string): string {
  const message = String(errMsg || "").toLowerCase();

  if (message.includes("timeout")) {
    return "Request timeout, please retry";
  }

  if (message.includes("abort")) {
    return "Request aborted";
  }

  if (message.includes("fail")) {
    return "Network request failed";
  }

  return "Network request failed";
}

function resolveGetQuery(
  method: RequestMethod,
  query: RequestQuery | undefined,
  data: unknown,
): RequestQuery | undefined {
  if (method !== "GET") {
    return query;
  }

  if (query) {
    return query;
  }

  if (isPlainObject(data)) {
    return data as RequestQuery;
  }

  return undefined;
}

function unwrapResponseData<TResponse>(data: unknown, unwrapData: boolean): TResponse {
  if (!unwrapData) {
    return data as TResponse;
  }

  if (isApiEnvelope(data) && hasOwnProperty(data, "data")) {
    return data.data as TResponse;
  }

  return data as TResponse;
}

export function getErrorMessage(
  error: unknown,
  fallback = "Request failed, please retry",
): string {
  if (error instanceof RequestError && error.message) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function createRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `req_${timestamp}_${random}`;
}

function buildResponseSummary(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    return {
      type: "string",
      length: data.length,
      preview: data.slice(0, 200),
    };
  }

  if (Array.isArray(data)) {
    return {
      type: "array",
      length: data.length,
      sample: data.slice(0, 3),
    };
  }

  if (isPlainObject(data)) {
    const keys = Object.keys(data);
    const sample: Record<string, unknown> = {};
    const limit = Math.min(keys.length, 5);

    for (let index = 0; index < limit; index += 1) {
      const key = keys[index];
      sample[key] = data[key];
    }

    return {
      type: "object",
      keyCount: keys.length,
      keys: keys.slice(0, 10),
      sample,
    };
  }

  return {
    type: typeof data,
    value: data,
  };
}

export function request<
  TResponse,
  TData = RequestData,
  TQuery extends RequestQuery = RequestQuery,
>(
  options: RequestOptions<TData, TQuery> = { url: "" },
): Promise<TResponse> {
  const {
    url,
    method = "GET",
    data,
    query,
    header,
    timeout = API_CONFIG.timeout,
    unwrapData = true,
    authMode = "none",
    skip401Handler = false,
  } = options;

  return new Promise<TResponse>((resolve, reject) => {
    const requestId = createRequestId();
    const startedAt = Date.now();
    let requestUrl = "";
    let requestHeader: RequestHeader = {};
    let resolvedQuery: RequestQuery | undefined;

    const getDurationMs = (): number => Date.now() - startedAt;

    const rejectWithLog = (
      error: unknown,
      extra: {
        statusCode?: number;
      } = {},
    ) => {
      requestLogger.warn("request_fail", {
        requestId,
        method,
        url: requestUrl || url,
        authMode,
        statusCode: extra.statusCode,
        durationMs: getDurationMs(),
        error,
      });

      reject(error);
    };

    try {
      resolvedQuery = resolveGetQuery(method, query, data);
      requestUrl = resolveRequestUrl(url, resolvedQuery);
      requestHeader = resolveRequestHeader(header, authMode);
    } catch (error) {
      if (error instanceof RequestError && !error.requestId) {
        error.requestId = requestId;
      }
      rejectWithLog(error);
      return;
    }

    const requestData = method === "GET"
      ? undefined
      : (data as RequestData | undefined);

    requestLogger.info("request_start", {
      method,
      url: requestUrl,
      requestId,
      authMode,
    });
    requestLogger.debug("request_start_detail", {
      method,
      url: requestUrl,
      requestId,
      authMode,
      query: resolvedQuery,
      data: requestData,
      header: requestHeader,
    });

    wx.request<WechatRequestBody>({
      url: requestUrl,
      method,
      data: requestData,
      timeout,
      header: requestHeader,
      success: (response) => {
        const { statusCode, data: responseData } = response;

        if (statusCode === 401) {
          const unauthorizedError = new RequestError(
            resolveHttpErrorMessage(statusCode, responseData),
            {
              statusCode,
              code: 401,
              data: responseData,
              requestId,
            },
          );
          emitAuthExpired(unauthorizedError, skip401Handler);
          rejectWithLog(unauthorizedError, { statusCode });
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          rejectWithLog(new RequestError(resolveHttpErrorMessage(statusCode, responseData), {
            statusCode,
            data: responseData,
            requestId,
          }), { statusCode });
          return;
        }

        if (responseData === null || responseData === undefined) {
          rejectWithLog(new RequestError("Empty response body", {
            requestId,
          }), { statusCode });
          return;
        }

        const businessError = resolveBusinessError(responseData, skip401Handler);
        if (businessError) {
          businessError.requestId = requestId;
          rejectWithLog(businessError, {
            statusCode: businessError.statusCode,
          });
          return;
        }

        requestLogger.info("request_success", {
          requestId,
          method,
          url: requestUrl,
          statusCode,
          durationMs: getDurationMs(),
        });
        requestLogger.debug("request_success_summary", {
          requestId,
          method,
          url: requestUrl,
          statusCode,
          durationMs: getDurationMs(),
          response: buildResponseSummary(responseData),
        });

        resolve(unwrapResponseData<TResponse>(responseData, unwrapData));
      },
      fail: (error: WechatMiniprogram.GeneralCallbackResult) => {
        rejectWithLog(new RequestError(resolveNetworkErrorMessage(error.errMsg), {
          data: error,
          requestId,
        }));
      },
    });
  });
}
