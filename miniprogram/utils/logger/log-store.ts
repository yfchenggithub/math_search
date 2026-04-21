import { STORAGE_KEYS } from "../storage/storage-keys";

export type RuntimeLogLevel = "debug" | "info" | "warn" | "error";
export type RuntimeLogLevelFilter = "all" | RuntimeLogLevel;

export interface RuntimeLogItem {
  id: string;
  timestamp: number;
  level: RuntimeLogLevel;
  scope: string;
  eventName: string;
  payloadText: string;
  formattedLine: string;
  fileName?: string;
  line?: number;
}

export type RuntimeLogAppendInput = Omit<RuntimeLogItem, "id">;

const RUNTIME_LOG_STORAGE_KEY = STORAGE_KEYS.RUNTIME_LOGS;
const RUNTIME_LOG_MAX_COUNT = 300;
const MAX_SCOPE_LENGTH = 80;
const MAX_EVENT_NAME_LENGTH = 120;
const MAX_FILE_NAME_LENGTH = 120;
const MAX_PAYLOAD_TEXT_LENGTH = 3000;
const MAX_FORMATTED_LINE_LENGTH = 6000;

let hasWarnedReadFailure = false;
let hasWarnedWriteFailure = false;
let hasWarnedClearFailure = false;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...(truncated, len=${value.length})`;
}

function toText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  try {
    return String(value);
  } catch (_error) {
    return fallback;
  }
}

function toSafeInteger(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number"
    ? value
    : Number.parseInt(String(value), 10);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.trunc(numeric));
}

function normalizeLevel(value: unknown): RuntimeLogLevel | null {
  const normalized = toText(value).trim().toLowerCase();
  if (
    normalized === "debug"
    || normalized === "info"
    || normalized === "warn"
    || normalized === "error"
  ) {
    return normalized;
  }

  return null;
}

function warnReadFailure(error: unknown): void {
  if (hasWarnedReadFailure) {
    return;
  }

  hasWarnedReadFailure = true;
  console.warn("[runtime-log-store] read storage failed", error);
}

function warnWriteFailure(error: unknown): void {
  if (hasWarnedWriteFailure) {
    return;
  }

  hasWarnedWriteFailure = true;
  console.warn("[runtime-log-store] write storage failed", error);
}

function warnClearFailure(error: unknown): void {
  if (hasWarnedClearFailure) {
    return;
  }

  hasWarnedClearFailure = true;
  console.warn("[runtime-log-store] clear storage failed", error);
}

function createRuntimeLogId(timestamp: number): string {
  const randomPart = Math.random().toString(36).slice(2, 10) || "log";
  return `${timestamp}_${randomPart}`;
}

function normalizeRuntimeLogItem(raw: unknown): RuntimeLogItem | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const level = normalizeLevel(raw.level);
  if (!level) {
    return null;
  }

  const timestamp = toSafeInteger(raw.timestamp, Date.now());
  const eventName = truncateText(
    toText(raw.eventName, "event").trim() || "event",
    MAX_EVENT_NAME_LENGTH,
  );
  const scope = truncateText(
    toText(raw.scope, "app").trim() || "app",
    MAX_SCOPE_LENGTH,
  );
  const payloadText = truncateText(
    toText(raw.payloadText, "{}"),
    MAX_PAYLOAD_TEXT_LENGTH,
  );
  const formattedLine = truncateText(
    toText(raw.formattedLine, ""),
    MAX_FORMATTED_LINE_LENGTH,
  );
  const fileNameRaw = toText(raw.fileName).trim();
  const fileName = fileNameRaw
    ? truncateText(fileNameRaw, MAX_FILE_NAME_LENGTH)
    : undefined;
  const line = toSafeInteger(raw.line, 0) || undefined;

  return {
    id: toText(raw.id).trim() || createRuntimeLogId(timestamp),
    timestamp,
    level,
    scope,
    eventName,
    payloadText,
    formattedLine,
    fileName,
    line,
  };
}

function readStorageLogs(): RuntimeLogItem[] {
  let rawLogs: unknown = [];

  try {
    rawLogs = wx.getStorageSync(RUNTIME_LOG_STORAGE_KEY);
  } catch (error) {
    warnReadFailure(error);
    return [];
  }

  if (!Array.isArray(rawLogs)) {
    return [];
  }

  const normalizedLogs: RuntimeLogItem[] = [];

  for (let index = 0; index < rawLogs.length; index += 1) {
    const normalized = normalizeRuntimeLogItem(rawLogs[index]);
    if (!normalized) {
      continue;
    }

    normalizedLogs.push(normalized);
  }

  normalizedLogs.sort((first, second) => first.timestamp - second.timestamp);
  return normalizedLogs;
}

function persistStorageLogs(logs: RuntimeLogItem[]): void {
  try {
    wx.setStorageSync(RUNTIME_LOG_STORAGE_KEY, logs);
  } catch (error) {
    warnWriteFailure(error);
  }
}

function trimLogs(logs: RuntimeLogItem[]): RuntimeLogItem[] {
  if (logs.length <= RUNTIME_LOG_MAX_COUNT) {
    return logs;
  }

  return logs.slice(logs.length - RUNTIME_LOG_MAX_COUNT);
}

function normalizeInputLog(input: RuntimeLogAppendInput): RuntimeLogItem {
  const timestamp = toSafeInteger(input.timestamp, Date.now());
  const eventName = truncateText(
    toText(input.eventName, "event").trim() || "event",
    MAX_EVENT_NAME_LENGTH,
  );
  const scope = truncateText(
    toText(input.scope, "app").trim() || "app",
    MAX_SCOPE_LENGTH,
  );
  const payloadText = truncateText(
    toText(input.payloadText, "{}"),
    MAX_PAYLOAD_TEXT_LENGTH,
  );
  const formattedLine = truncateText(
    toText(input.formattedLine, ""),
    MAX_FORMATTED_LINE_LENGTH,
  );
  const fileNameRaw = toText(input.fileName).trim();
  const fileName = fileNameRaw
    ? truncateText(fileNameRaw, MAX_FILE_NAME_LENGTH)
    : undefined;
  const line = toSafeInteger(input.line, 0) || undefined;

  return {
    id: createRuntimeLogId(timestamp),
    timestamp,
    level: input.level,
    scope,
    eventName,
    payloadText,
    formattedLine,
    fileName,
    line,
  };
}

export function appendLog(log: RuntimeLogAppendInput): void {
  const nextLog = normalizeInputLog(log);
  const allLogs = readStorageLogs();
  allLogs.push(nextLog);
  persistStorageLogs(trimLogs(allLogs));
}

export function getLogs(): RuntimeLogItem[] {
  const logs = readStorageLogs();
  return logs.slice().sort((first, second) => second.timestamp - first.timestamp);
}

export function getLogsByLevel(level: RuntimeLogLevelFilter): RuntimeLogItem[] {
  if (level === "all") {
    return getLogs();
  }

  return getLogs().filter((log) => log.level === level);
}

export function getLogById(id: string): RuntimeLogItem | null {
  const targetId = toText(id).trim();
  if (!targetId) {
    return null;
  }

  const logs = readStorageLogs();
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const item = logs[index];
    if (item.id === targetId) {
      return item;
    }
  }

  return null;
}

export function clearLogs(): void {
  try {
    wx.removeStorageSync(RUNTIME_LOG_STORAGE_KEY);
  } catch (error) {
    warnClearFailure(error);
  }
}

export const RUNTIME_LOG_STORE_CONFIG = {
  STORAGE_KEY: RUNTIME_LOG_STORAGE_KEY,
  MAX_COUNT: RUNTIME_LOG_MAX_COUNT,
} as const;
