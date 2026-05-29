import { createLogger } from "../utils/logger/logger";
import { STORAGE_KEYS } from "../utils/storage/storage-keys";

export type SearchHistoryItem = {
  query: string;
  updatedAt: number;
};

export type RecentBrowseItem = {
  id: string;
  title: string;
  module: string;
  summary: string;
  tags: string[];
  viewedAt: number;
};

type RecentBrowseInput = {
  id: string;
  title?: string;
  module?: string;
  summary?: string;
  tags?: string[];
};

const SEARCH_HISTORY_STORAGE_KEY = STORAGE_KEYS.SEARCH_HISTORY;
const RECENT_BROWSE_STORAGE_KEY = STORAGE_KEYS.RECENT_BROWSE;
const MAX_SEARCH_HISTORY_COUNT = 30;
const MAX_RECENT_BROWSE_COUNT = 100;
const historyLogger = createLogger("history-service");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen: Record<string, true> = {};

  for (let index = 0; index < value.length; index += 1) {
    const text = toTrimmedString(value[index]);
    if (!text || seen[text]) {
      continue;
    }

    seen[text] = true;
    normalized.push(text);

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}

function toTimestamp(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return fallback;
}

function readStorage(storageKey: string, eventName: string): unknown {
  try {
    return wx.getStorageSync(storageKey);
  } catch (error) {
    historyLogger.warn(eventName, {
      error,
    });
    return undefined;
  }
}

function writeStorage(storageKey: string, value: unknown): void {
  wx.setStorageSync(storageKey, value);
}

function clearStorage(storageKey: string): void {
  wx.removeStorageSync(storageKey);
}

function normalizeSearchHistory(raw: unknown): SearchHistoryItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: SearchHistoryItem[] = [];
  const seenQuery: Record<string, true> = {};

  for (let index = 0; index < raw.length; index += 1) {
    const candidate = raw[index];

    let query = "";
    let updatedAt = 0;

    if (typeof candidate === "string") {
      query = toTrimmedString(candidate);
      updatedAt = Date.now() - index;
    } else if (isPlainObject(candidate)) {
      query = toTrimmedString(candidate.query);
      updatedAt = toTimestamp(candidate.updatedAt, Date.now() - index);
    }

    if (!query) {
      continue;
    }

    const dedupeKey = query.toLowerCase();
    if (seenQuery[dedupeKey]) {
      continue;
    }
    seenQuery[dedupeKey] = true;

    normalized.push({
      query,
      updatedAt,
    });
  }

  normalized.sort((left, right) => right.updatedAt - left.updatedAt);
  return normalized.slice(0, MAX_SEARCH_HISTORY_COUNT);
}

function mergeRecentBrowseItem(
  current: RecentBrowseItem | undefined,
  incoming: RecentBrowseItem,
): RecentBrowseItem {
  if (!current) {
    return incoming;
  }

  if (incoming.viewedAt > current.viewedAt) {
    return incoming;
  }

  if (incoming.viewedAt < current.viewedAt) {
    return current;
  }

  return {
    ...current,
    title: current.title || incoming.title,
    module: current.module || incoming.module,
    summary: current.summary || incoming.summary,
    tags: current.tags.length > 0 ? current.tags : incoming.tags,
  };
}

function normalizeRecentBrowse(raw: unknown): RecentBrowseItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const byId: Record<string, RecentBrowseItem> = {};

  for (let index = 0; index < raw.length; index += 1) {
    const candidate = raw[index];
    if (!isPlainObject(candidate)) {
      continue;
    }

    const id = toTrimmedString(candidate.id);
    if (!id) {
      continue;
    }

    const incoming: RecentBrowseItem = {
      id,
      title: toTrimmedString(candidate.title),
      module: toTrimmedString(candidate.module),
      summary: toTrimmedString(candidate.summary),
      tags: normalizeStringList(candidate.tags),
      viewedAt: toTimestamp(candidate.viewedAt, Date.now() - index),
    };

    byId[id] = mergeRecentBrowseItem(byId[id], incoming);
  }

  const normalized = Object.keys(byId).map((id) => byId[id]);
  normalized.sort((left, right) => right.viewedAt - left.viewedAt);
  return normalized.slice(0, MAX_RECENT_BROWSE_COUNT);
}

export function getSearchHistory(): SearchHistoryItem[] {
  const raw = readStorage(SEARCH_HISTORY_STORAGE_KEY, "search_history_read_failed");
  return normalizeSearchHistory(raw);
}

export function addSearchHistory(query: string): SearchHistoryItem[] {
  const normalizedQuery = toTrimmedString(query);
  if (!normalizedQuery) {
    return getSearchHistory();
  }

  const current = getSearchHistory();
  const dedupeKey = normalizedQuery.toLowerCase();
  const next: SearchHistoryItem[] = [
    {
      query: normalizedQuery,
      updatedAt: Date.now(),
    },
    ...current.filter((item) => item.query.toLowerCase() !== dedupeKey),
  ].slice(0, MAX_SEARCH_HISTORY_COUNT);

  try {
    writeStorage(SEARCH_HISTORY_STORAGE_KEY, next);
  } catch (error) {
    historyLogger.warn("search_history_write_failed", {
      queryLength: normalizedQuery.length,
      error,
    });
    throw error;
  }

  return next;
}

export function clearSearchHistory(): void {
  try {
    clearStorage(SEARCH_HISTORY_STORAGE_KEY);
  } catch (error) {
    historyLogger.warn("search_history_clear_failed", {
      error,
    });
    throw error;
  }
}

export function getRecentBrowse(): RecentBrowseItem[] {
  const raw = readStorage(RECENT_BROWSE_STORAGE_KEY, "recent_browse_read_failed");
  return normalizeRecentBrowse(raw);
}

export function recordRecentBrowse(input: RecentBrowseInput): RecentBrowseItem[] {
  const id = toTrimmedString(input.id);
  if (!id) {
    return getRecentBrowse();
  }

  const current = getRecentBrowse();
  const nextItem: RecentBrowseItem = {
    id,
    title: toTrimmedString(input.title),
    module: toTrimmedString(input.module),
    summary: toTrimmedString(input.summary),
    tags: normalizeStringList(input.tags),
    viewedAt: Date.now(),
  };
  const next: RecentBrowseItem[] = [
    nextItem,
    ...current.filter((item) => item.id !== id),
  ].slice(0, MAX_RECENT_BROWSE_COUNT);

  try {
    writeStorage(RECENT_BROWSE_STORAGE_KEY, next);
  } catch (error) {
    historyLogger.warn("recent_browse_write_failed", {
      id,
      error,
    });
    throw error;
  }

  return next;
}

export function clearRecentBrowse(): void {
  try {
    clearStorage(RECENT_BROWSE_STORAGE_KEY);
  } catch (error) {
    historyLogger.warn("recent_browse_clear_failed", {
      error,
    });
    throw error;
  }
}
