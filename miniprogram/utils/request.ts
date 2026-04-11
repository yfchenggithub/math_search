import { API_CONFIG } from "../config/api";
import type {
  ApiBusinessMeta,
  ApiEnvelope,
  RequestData,
  RequestHeader,
  RequestMethod,
  RequestOptions,
  RequestQuery,
  RequestQueryPrimitive,
} from "../types/api";

type ErrorCode = number | string;

interface RequestErrorOptions {
  statusCode?: number;
  code?: ErrorCode;
  data?: unknown;
}

/**
 * Unified request error.
 * UI layer can read message directly for toast rendering.
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

function resolveBusinessError(data: unknown): RequestError | null {
  if (!isApiEnvelope(data)) {
    return null;
  }

  const success = data.success;
  const code = getCodeFromPayload(data);
  const message = getMessageFromPayload(data) || "Business error";

  if (success === false || !isBusinessCodeSuccess(code)) {
    return new RequestError(message, {
      code,
      data,
    });
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

function resolveRequestHeader(header?: RequestHeader): RequestHeader {
  return {
    ...API_CONFIG.header,
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

  // Backward compatible: allow old GET callers to pass query in `data`.
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

/**
 * Unified request entrance:
 * 1. merge baseURL + query params
 * 2. handle HTTP/network/business errors
 * 3. auto-unwrap `{ code, message, data }` by default
 */
export function request<TResponse>(
  options: RequestOptions = { url: "" },
): Promise<TResponse> {
  const {
    url,
    method = "GET",
    data,
    query,
    header,
    timeout = API_CONFIG.timeout,
    unwrapData = true,
  } = options;

  return new Promise<TResponse>((resolve, reject) => {
    let requestUrl = "";

    try {
      const resolvedQuery = resolveGetQuery(method, query, data);
      requestUrl = resolveRequestUrl(url, resolvedQuery);
    } catch (error) {
      reject(error);
      return;
    }

    const requestData = method === "GET"
      ? undefined
      : (data as RequestData | undefined);

    wx.request<RequestData>({
      url: requestUrl,
      method,
      data: requestData,
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
          reject(new RequestError("Empty response body"));
          return;
        }

        const businessError = resolveBusinessError(responseData);
        if (businessError) {
          reject(businessError);
          return;
        }

        resolve(unwrapResponseData<TResponse>(responseData, unwrapData));
      },
      fail: (error) => {
        reject(new RequestError(resolveNetworkErrorMessage(error.errMsg)));
      },
    });
  });
}
