import { createLogger } from "../utils/logger/logger";
import { STORAGE_KEYS } from "../utils/storage/storage-keys";
import { getSession } from "../utils/storage/token-storage";

type FavoriteStateSnapshot = {
  states: Record<string, boolean>;
  updatedAt: number;
  isComplete: boolean;
  ownerKey: string;
};

const FAVORITE_STATE_STORAGE_KEY = STORAGE_KEYS.FAVORITE_STATE_CACHE;
const FAVORITE_STATE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAVORITE_STATE_MAX_COUNT = 4000;
const favoriteStateCacheLogger = createLogger("favorite-state-cache");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimestamp(value: unknown, fallback: number): number {
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

function hashText(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

function resolveCurrentOwnerKey(): string {
  const session = getSession();
  if (!session) {
    return "";
  }

  const userId = normalizeText(session.user?.id);
  if (userId && userId !== "unknown") {
    return `user:${userId}`;
  }

  const accessToken = normalizeText(session.accessToken);
  return accessToken ? `token:${hashText(accessToken)}` : "";
}

function buildIdCandidates(rawId: unknown): string[] {
  const id = normalizeText(rawId);
  if (!id) {
    return [];
  }

  const list: string[] = [];
  const seen: Record<string, true> = {};

  const push = (value: unknown) => {
    const normalized = normalizeText(value);
    if (!normalized || seen[normalized]) {
      return;
    }

    seen[normalized] = true;
    list.push(normalized);
  };

  push(id);
  push(id.toUpperCase());
  push(id.toLowerCase());

  const withoutQuery = id.split("?")[0];
  push(withoutQuery);
  push(withoutQuery.toUpperCase());
  push(withoutQuery.toLowerCase());

  return list;
}

function normalizeStateMap(raw: unknown): Record<string, boolean> {
  if (!isPlainObject(raw)) {
    return {};
  }

  const normalized: Record<string, boolean> = {};
  const entries = raw as Record<string, unknown>;

  Object.keys(entries).forEach((rawKey) => {
    const keyCandidates = buildIdCandidates(rawKey);
    if (keyCandidates.length <= 0) {
      return;
    }

    const value = entries[rawKey];
    if (typeof value !== "boolean") {
      return;
    }

    keyCandidates.forEach((candidate) => {
      normalized[candidate] = value;
    });
  });

  return normalized;
}

function normalizeStateFromIds(rawIds: unknown): Record<string, boolean> {
  if (!Array.isArray(rawIds)) {
    return {};
  }

  const states: Record<string, boolean> = {};
  rawIds.forEach((rawId) => {
    const candidates = buildIdCandidates(rawId);
    candidates.forEach((candidate) => {
      states[candidate] = true;
    });
  });
  return states;
}

function normalizeSnapshot(raw: unknown): FavoriteStateSnapshot | null {
  const now = Date.now();

  if (Array.isArray(raw)) {
    return {
      states: normalizeStateFromIds(raw),
      updatedAt: now,
      isComplete: true,
      ownerKey: "",
    };
  }

  if (!isPlainObject(raw)) {
    return null;
  }

  const states = normalizeStateMap(raw.states);
  const fallbackStates = Object.keys(states).length > 0
    ? states
    : normalizeStateFromIds(raw.ids);

  return {
    states: fallbackStates,
    updatedAt: normalizeTimestamp(raw.updatedAt, now),
    isComplete: typeof raw.isComplete === "boolean" ? raw.isComplete : true,
    ownerKey: normalizeText(raw.ownerKey),
  };
}

function readFavoriteStateSnapshot(): FavoriteStateSnapshot | null {
  try {
    const snapshot = normalizeSnapshot(wx.getStorageSync(FAVORITE_STATE_STORAGE_KEY));
    if (!snapshot) {
      return null;
    }

    const ownerKey = resolveCurrentOwnerKey();
    if (!ownerKey || snapshot.ownerKey !== ownerKey) {
      return null;
    }

    return snapshot;
  } catch (error) {
    favoriteStateCacheLogger.warn("favorite_state_snapshot_read_failed", {
      error,
    });
    return null;
  }
}

function trimStateMap(
  source: Record<string, boolean>,
  maxCount: number,
): Record<string, boolean> {
  const entries = Object.entries(source);
  if (entries.length <= maxCount) {
    return source;
  }

  const trimmed: Record<string, boolean> = {};
  entries
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, maxCount)
    .forEach(([id, state]) => {
      trimmed[id] = state;
    });
  return trimmed;
}

function writeFavoriteStateSnapshot(snapshot: FavoriteStateSnapshot): void {
  try {
    wx.setStorageSync(FAVORITE_STATE_STORAGE_KEY, {
      states: trimStateMap(snapshot.states, FAVORITE_STATE_MAX_COUNT),
      updatedAt: snapshot.updatedAt,
      isComplete: snapshot.isComplete,
      ownerKey: snapshot.ownerKey,
    });
  } catch (error) {
    favoriteStateCacheLogger.warn("favorite_state_snapshot_write_failed", {
      size: Object.keys(snapshot.states).length,
      error,
    });
  }
}

function isSnapshotExpired(snapshot: FavoriteStateSnapshot): boolean {
  return Date.now() - snapshot.updatedAt > FAVORITE_STATE_CACHE_TTL_MS;
}

function createEmptySnapshot(): FavoriteStateSnapshot {
  return {
    states: {},
    updatedAt: Date.now(),
    isComplete: false,
    ownerKey: resolveCurrentOwnerKey(),
  };
}

export function getCachedFavoriteState(conclusionId: string): boolean | null {
  const candidates = buildIdCandidates(conclusionId);
  if (candidates.length <= 0) {
    return null;
  }

  const snapshot = readFavoriteStateSnapshot();
  if (!snapshot || isSnapshotExpired(snapshot)) {
    return null;
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const candidateId = candidates[index];
    if (!Object.prototype.hasOwnProperty.call(snapshot.states, candidateId)) {
      continue;
    }

    return Boolean(snapshot.states[candidateId]);
  }

  return snapshot.isComplete ? false : null;
}

export function setCachedFavoriteState(
  conclusionId: string,
  isFavorited: boolean,
): void {
  const ownerKey = resolveCurrentOwnerKey();
  if (!ownerKey) {
    return;
  }

  const candidates = buildIdCandidates(conclusionId);
  if (candidates.length <= 0) {
    return;
  }

  const snapshot = readFavoriteStateSnapshot() || createEmptySnapshot();
  const nextStates: Record<string, boolean> = {
    ...snapshot.states,
  };

  candidates.forEach((candidateId) => {
    if (isFavorited) {
      nextStates[candidateId] = true;
      return;
    }

    if (snapshot.isComplete) {
      delete nextStates[candidateId];
      return;
    }

    nextStates[candidateId] = false;
  });

  writeFavoriteStateSnapshot({
    states: nextStates,
    updatedAt: Date.now(),
    isComplete: snapshot.isComplete,
    ownerKey,
  });
}

export function syncCachedFavoriteStates(favoriteIds: string[]): void {
  const ownerKey = resolveCurrentOwnerKey();
  if (!ownerKey) {
    return;
  }

  const states = normalizeStateFromIds(favoriteIds);
  writeFavoriteStateSnapshot({
    states,
    updatedAt: Date.now(),
    isComplete: true,
    ownerKey,
  });
}
