import { readApiEnvVersion } from "../../config/runtime-env";

export type LogLevel = "debug" | "info" | "warn" | "error" | "off";

type LoggerMethod = (eventName: string, payload?: unknown) => void;

export interface Logger {
  debug: LoggerMethod;
  info: LoggerMethod;
  warn: LoggerMethod;
  error: LoggerMethod;
}

const LOG_LEVEL_STORAGE_KEY = "__debug_log_level__";

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  off: 50,
};

const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "token",
  "authorization",
  "code",
  "password",
  "secret",
  "sessionkey",
  "cookie",
]);

const MAX_DEPTH = 5;
const MAX_KEYS = 40;
const MAX_ARRAY_ITEMS = 30;
const MAX_STRING_LENGTH = 400;
const MAX_SERIALIZED_LENGTH = 4000;

function normalizeSensitiveKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeSensitiveKey(key));
}

function normalizeLogLevel(value: unknown): LogLevel | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "debug"
    || normalized === "info"
    || normalized === "warn"
    || normalized === "error"
    || normalized === "off"
  ) {
    return normalized;
  }

  return null;
}

function resolveDefaultLogLevel(): LogLevel {
  let env: "develop" | "trial" | "release" = "release";

  try {
    env = readApiEnvVersion();
  } catch (_error) {
    env = "release";
  }

  if (env === "develop") {
    return "debug";
  }

  if (env === "trial") {
    return "info";
  }

  return "warn";
}

function resolveRuntimeLogLevel(): LogLevel {
  try {
    const storageLevel = normalizeLogLevel(wx.getStorageSync(LOG_LEVEL_STORAGE_KEY));
    if (storageLevel) {
      return storageLevel;
    }
  } catch (_error) {
    // no-op
  }

  return resolveDefaultLogLevel();
}

function shouldLog(level: LogLevel, activeLevel: LogLevel): boolean {
  return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[activeLevel];
}

function truncateText(value: string, maxLength = MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...(truncated, len=${value.length})`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function sanitizeError(
  error: Error,
  visited: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const runtimeError = error as Error & Record<string, unknown>;
  const output: Record<string, unknown> = {
    name: error.name,
    message: truncateText(String(error.message || "")),
  };

  if (error.stack) {
    output.stack = truncateText(error.stack, MAX_STRING_LENGTH * 3);
  }

  const ownKeys = Object.keys(runtimeError);
  for (let index = 0; index < ownKeys.length && index < MAX_KEYS; index += 1) {
    const key = ownKeys[index];
    if (key === "name" || key === "message" || key === "stack") {
      continue;
    }

    output[key] = sanitizeValue(runtimeError[key], visited, depth + 1, key);
  }

  if (ownKeys.length > MAX_KEYS) {
    output.__truncatedKeys = ownKeys.length - MAX_KEYS;
  }

  return output;
}

function sanitizeArray(
  value: unknown[],
  visited: WeakSet<object>,
  depth: number,
): unknown {
  if (visited.has(value)) {
    return "[Circular]";
  }
  visited.add(value);

  if (depth > MAX_DEPTH) {
    return "[MaxDepth]";
  }

  const limit = Math.min(value.length, MAX_ARRAY_ITEMS);
  const output: unknown[] = [];
  for (let index = 0; index < limit; index += 1) {
    output.push(sanitizeValue(value[index], visited, depth + 1));
  }

  if (value.length > MAX_ARRAY_ITEMS) {
    output.push(`...(truncated ${value.length - MAX_ARRAY_ITEMS} items)`);
  }

  return output;
}

function sanitizeObject(
  value: Record<string, unknown>,
  visited: WeakSet<object>,
  depth: number,
): unknown {
  if (visited.has(value)) {
    return "[Circular]";
  }
  visited.add(value);

  if (depth > MAX_DEPTH) {
    return "[MaxDepth]";
  }

  const keys = Object.keys(value);
  const output: Record<string, unknown> = {};
  const limit = Math.min(keys.length, MAX_KEYS);

  for (let index = 0; index < limit; index += 1) {
    const key = keys[index];

    if (isSensitiveKey(key)) {
      output[key] = "***";
      continue;
    }

    output[key] = sanitizeValue(value[key], visited, depth + 1, key);
  }

  if (keys.length > MAX_KEYS) {
    output.__truncatedKeys = keys.length - MAX_KEYS;
  }

  return output;
}

function sanitizeValue(
  value: unknown,
  visited: WeakSet<object>,
  depth: number,
  parentKey = "",
): unknown {
  if (isSensitiveKey(parentKey)) {
    return "***";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return truncateText(value);
  }

  if (
    typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint" || typeof value === "symbol") {
    return String(value);
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return sanitizeError(value, visited, depth);
  }

  if (typeof ArrayBuffer !== "undefined") {
    if (value instanceof ArrayBuffer) {
      return `[ArrayBuffer byteLength=${value.byteLength}]`;
    }

    if (ArrayBuffer.isView(value)) {
      return `[TypedArray byteLength=${value.byteLength}]`;
    }
  }

  if (Array.isArray(value)) {
    return sanitizeArray(value, visited, depth);
  }

  if (isPlainObject(value)) {
    return sanitizeObject(value, visited, depth);
  }

  return truncateText(String(value));
}

function trimPayloadSize(payload: unknown): unknown {
  let text = "";

  try {
    text = JSON.stringify(payload);
  } catch (_error) {
    return {
      summary: "[UnserializablePayload]",
    };
  }

  if (text.length <= MAX_SERIALIZED_LENGTH) {
    return payload;
  }

  return {
    summary: "[PayloadTruncated]",
    preview: truncateText(text, MAX_SERIALIZED_LENGTH),
  };
}

function sanitizePayload(payload: unknown): unknown {
  const sanitized = sanitizeValue(payload, new WeakSet<object>(), 0);
  return trimPayloadSize(sanitized);
}

function resolveConsoleMethod(level: LogLevel): (...args: unknown[]) => void {
  if (level === "debug" && typeof console.debug === "function") {
    return console.debug;
  }

  if (level === "info" && typeof console.info === "function") {
    return console.info;
  }

  if (level === "warn" && typeof console.warn === "function") {
    return console.warn;
  }

  if (level === "error" && typeof console.error === "function") {
    return console.error;
  }

  return console.log;
}

function emitLog(scope: string, level: LogLevel, eventName: string, payload?: unknown): void {
  const activeLevel = resolveRuntimeLogLevel();
  if (!shouldLog(level, activeLevel)) {
    return;
  }

  const method = resolveConsoleMethod(level);
  const normalizedEventName = String(eventName || "").trim() || "event";
  const label = `[${scope}] ${normalizedEventName}`;

  if (payload === undefined) {
    method(label);
    return;
  }

  method(label, sanitizePayload(payload));
}

export function createLogger(scope: string): Logger {
  const normalizedScope = String(scope || "").trim() || "app";

  return {
    debug: (eventName: string, payload?: unknown) => {
      emitLog(normalizedScope, "debug", eventName, payload);
    },
    info: (eventName: string, payload?: unknown) => {
      emitLog(normalizedScope, "info", eventName, payload);
    },
    warn: (eventName: string, payload?: unknown) => {
      emitLog(normalizedScope, "warn", eventName, payload);
    },
    error: (eventName: string, payload?: unknown) => {
      emitLog(normalizedScope, "error", eventName, payload);
    },
  };
}

export const LOGGER_STORAGE_KEYS = {
  DEBUG_LOG_LEVEL: LOG_LEVEL_STORAGE_KEY,
} as const;
