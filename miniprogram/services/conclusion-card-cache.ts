import { getConclusionCardsByIds } from "./api/conclusion-cards-api";
import { buildAbsoluteApiUrl } from "../utils/api-url";
import { createLogger } from "../utils/logger/logger";
import { STORAGE_KEYS } from "../utils/storage/storage-keys";

export type ConclusionCardPreviewType = "image" | "text" | "none";

export interface ConclusionCardCacheItem {
  id: string;
  title: string;
  summary: string;
  module: string;
  moduleDir: string;
  category: string;
  tags: string[];
  difficulty: number | null;
  rank: number | null;
  searchBoost: number | null;
  hotScore: number | null;
  examFrequency: number | null;
  examScore: number | null;
  isFavorited: boolean;
  coreFormulaLatex: string;
  previewType: ConclusionCardPreviewType;
  previewImage: string;
  previewImageWidth: number;
  previewImageHeight: number;
  previewText: string;
  previewFallbackText: string;
  contentUpdatedAt: string;
  updatedAt: number;
}

export interface ConclusionCardCacheReadResult {
  hitMap: Record<string, ConclusionCardCacheItem>;
  missingIds: string[];
}

export interface ConclusionCardResolveResult {
  items: ConclusionCardCacheItem[];
  missingIds: string[];
}

type ConclusionCardCacheMap = Record<string, ConclusionCardCacheItem>;

interface CoreFormulaInfo {
  latex: string;
  png: string;
  webp: string;
  displayWidth: number;
  displayHeight: number;
}

const CONCLUSION_CARD_CACHE_STORAGE_KEY = STORAGE_KEYS.CONCLUSION_CARD_CACHE;
const CONCLUSION_CARD_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONCLUSION_CARD_CACHE_MAX_COUNT = 500;
const PREVIEW_IMAGE_MAX_WIDTH_PX = 288;
const PREVIEW_IMAGE_MAX_HEIGHT_PX = 118;
const PREVIEW_IMAGE_DEFAULT_WIDTH_PX = 160;
const conclusionCardCacheLogger = createLogger("conclusion-card-cache");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function toTrimmedString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
}

function normalizeIds(rawIds: string[]): string[] {
  const ids: string[] = [];
  const seen: Record<string, true> = {};

  rawIds.forEach((rawId) => {
    const id = toTrimmedString(rawId);
    if (!id || seen[id]) {
      return;
    }

    seen[id] = true;
    ids.push(id);
  });

  return ids;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  value.forEach((item) => {
    const text = toTrimmedString(item);
    if (text) {
      result.push(text);
    }
  });

  return result;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const text = toTrimmedString(value);
  if (!text) {
    return null;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePositiveNumber(value: unknown): number {
  const numberValue = normalizeNumber(value);
  return numberValue !== null && numberValue > 0 ? numberValue : 0;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value > 0;
  }

  const text = toTrimmedString(value).toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  const text = toTrimmedString(value);
  if (!text) {
    return fallback;
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCoreFormula(value: unknown): CoreFormulaInfo {
  if (typeof value === "string") {
    return {
      latex: value.trim(),
      png: "",
      webp: "",
      displayWidth: 0,
      displayHeight: 0,
    };
  }

  if (!isPlainObject(value)) {
    return {
      latex: "",
      png: "",
      webp: "",
      displayWidth: 0,
      displayHeight: 0,
    };
  }

  const asset = isPlainObject(value.asset) ? value.asset : {};
  const scale = normalizePositiveNumber(asset.scale) || 1;
  const directWidth = normalizePositiveNumber(asset.display_width_px);
  const directHeight = normalizePositiveNumber(asset.display_height_px);
  const derivedWidth = normalizePositiveNumber(asset.width_px) / scale;
  const derivedHeight = normalizePositiveNumber(asset.height_px) / scale;

  return {
    latex: toTrimmedString(value.latex || value.text || value.source),
    png: toTrimmedString(asset.png),
    webp: toTrimmedString(asset.webp),
    displayWidth: directWidth || derivedWidth || 0,
    displayHeight: directHeight || derivedHeight || 0,
  };
}

function normalizePreviewImageDimensions(
  rawWidth: unknown,
  rawHeight: unknown,
): { width: number; height: number } {
  let width = normalizePositiveNumber(rawWidth);
  let height = normalizePositiveNumber(rawHeight);

  if (width <= 0) {
    return {
      width: PREVIEW_IMAGE_DEFAULT_WIDTH_PX,
      height: 0,
    };
  }

  let scale = 1;
  if (width > PREVIEW_IMAGE_MAX_WIDTH_PX) {
    scale = Math.min(scale, PREVIEW_IMAGE_MAX_WIDTH_PX / width);
  }

  if (height > PREVIEW_IMAGE_MAX_HEIGHT_PX) {
    scale = Math.min(scale, PREVIEW_IMAGE_MAX_HEIGHT_PX / height);
  }

  if (scale < 1) {
    width = Math.max(1, Math.round(width * scale));
    height = height > 0 ? Math.max(1, Math.round(height * scale)) : 0;
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: height > 0 ? Math.max(1, Math.round(height)) : 0,
  };
}

function normalizeFinalPreviewImageDimensions(
  rawWidth: unknown,
  rawHeight: unknown,
): { width: number; height: number } {
  return normalizePreviewImageDimensions(rawWidth, rawHeight);
}

function normalizeContentUpdatedAt(raw: Record<string, unknown>): string {
  const directValue = toTrimmedString(
    raw.contentUpdatedAt
    || raw.content_updated_at
    || raw.updated_at
    || raw.update_time
    || raw.updateTime
    || raw.modified_at
    || raw.modifiedAt
    || raw.created_at
    || raw.createdTime
    || raw.created_time,
  );
  if (directValue) {
    return directValue;
  }

  const camelUpdatedAt = raw.updatedAt;
  if (typeof camelUpdatedAt === "string") {
    return camelUpdatedAt.trim();
  }

  const camelCreatedAt = raw.createdAt;
  if (typeof camelCreatedAt === "string") {
    return camelCreatedAt.trim();
  }

  return "";
}

function normalizeImageUrl(pathOrUrl: string): string {
  const normalized = toTrimmedString(pathOrUrl);
  return normalized ? buildAbsoluteApiUrl(normalized) : "";
}

function normalizeConclusionCardItemWithTimestamp(
  raw: unknown,
  updatedAt: number,
): ConclusionCardCacheItem | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const id = toTrimmedString(raw.id || raw.conclusion_id);
  if (!id) {
    return null;
  }

  const title = toTrimmedString(raw.title) || id;
  const summary = toTrimmedString(raw.summary || raw.statement_clean || raw.snippet);
  const module = toTrimmedString(raw.module);
  const moduleDir = toTrimmedString(raw.moduleDir || raw.module_dir);
  const category = toTrimmedString(raw.category || raw.moduleLabel || raw.module_label);
  const coreFormula = normalizeCoreFormula(
    raw.coreFormula || raw.core_formula || raw.formula,
  );
  const coreFormulaLatex = coreFormula.latex
    || toTrimmedString(
      raw.coreFormulaLatex
      || raw.core_formula_latex
      || raw.formulaLatex
      || raw.formula_latex,
    );
  const imageUrl = normalizeImageUrl(
    coreFormula.png
      || coreFormula.webp
      || toTrimmedString(
        raw.previewImage
        || raw.preview_image
        || raw.previewImageUrl
        || raw.preview_image_url,
      ),
  );
  const rawPreviewText = toTrimmedString(raw.previewText || raw.preview_text);
  const rawPreviewFallbackText = toTrimmedString(
    raw.previewFallbackText || raw.preview_fallback_text,
  );
  const previewType: ConclusionCardPreviewType = imageUrl
    ? "image"
    : ((rawPreviewText || coreFormulaLatex) ? "text" : "none");
  const hasSourceImageDimensions = coreFormula.displayWidth > 0 && coreFormula.displayHeight > 0;
  const previewImageDimensions = previewType !== "image"
    ? { width: 0, height: 0 }
    : (
      hasSourceImageDimensions
        ? normalizePreviewImageDimensions(coreFormula.displayWidth, coreFormula.displayHeight)
        : normalizeFinalPreviewImageDimensions(
          raw.previewImageWidth || raw.preview_image_width,
          raw.previewImageHeight || raw.preview_image_height,
        )
    );

  return {
    id,
    title,
    summary,
    module,
    moduleDir,
    category,
    tags: normalizeStringList(raw.tags),
    difficulty: normalizeNumber(raw.difficulty),
    rank: normalizeNumber(raw.rank),
    searchBoost: normalizeNumber(raw.searchBoost || raw.search_boost),
    hotScore: normalizeNumber(raw.hotScore || raw.hot_score),
    examFrequency: normalizeNumber(raw.examFrequency || raw.exam_frequency),
    examScore: normalizeNumber(raw.examScore || raw.exam_score),
    isFavorited: normalizeBoolean(raw.isFavorited || raw.is_favorited),
    coreFormulaLatex,
    previewType,
    previewImage: previewType === "image" ? imageUrl : "",
    previewImageWidth: previewImageDimensions.width,
    previewImageHeight: previewImageDimensions.height,
    previewText: previewType === "text" ? (rawPreviewText || coreFormulaLatex) : "",
    previewFallbackText: rawPreviewFallbackText || coreFormulaLatex || summary,
    contentUpdatedAt: normalizeContentUpdatedAt(raw),
    updatedAt,
  };
}

export function normalizeConclusionCardItem(raw: unknown): ConclusionCardCacheItem | null {
  return normalizeConclusionCardItemWithTimestamp(raw, Date.now());
}

function normalizeStoredConclusionCardItem(raw: unknown): ConclusionCardCacheItem | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const updatedAt = normalizeTimestamp(raw.updatedAt, 0);
  if (updatedAt <= 0) {
    return null;
  }

  return normalizeConclusionCardItemWithTimestamp(raw, updatedAt);
}

function isCacheItemFresh(item: ConclusionCardCacheItem): boolean {
  const ageMs = Date.now() - item.updatedAt;
  return ageMs >= 0 && ageMs <= CONCLUSION_CARD_CACHE_TTL_MS;
}

function readCacheMap(): ConclusionCardCacheMap {
  try {
    const raw = wx.getStorageSync(CONCLUSION_CARD_CACHE_STORAGE_KEY);
    const source = isPlainObject(raw) && isPlainObject(raw.items) ? raw.items : raw;
    if (!isPlainObject(source)) {
      return {};
    }

    const result: ConclusionCardCacheMap = {};
    Object.keys(source).forEach((cacheId) => {
      const item = normalizeStoredConclusionCardItem(source[cacheId]);
      if (!item || !isCacheItemFresh(item)) {
        return;
      }

      result[item.id] = item;
    });

    return result;
  } catch (error) {
    conclusionCardCacheLogger.warn("conclusion_card_cache_read_failed", {
      error,
    });
    return {};
  }
}

function trimCacheMap(source: ConclusionCardCacheMap): ConclusionCardCacheMap {
  const items = Object.values(source);
  if (items.length <= CONCLUSION_CARD_CACHE_MAX_COUNT) {
    return source;
  }

  const result: ConclusionCardCacheMap = {};
  items
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, CONCLUSION_CARD_CACHE_MAX_COUNT)
    .forEach((item) => {
      result[item.id] = item;
    });

  return result;
}

function writeCacheMap(cacheMap: ConclusionCardCacheMap): void {
  try {
    wx.setStorageSync(
      CONCLUSION_CARD_CACHE_STORAGE_KEY,
      trimCacheMap(cacheMap),
    );
  } catch (error) {
    conclusionCardCacheLogger.warn("conclusion_card_cache_write_failed", {
      size: Object.keys(cacheMap).length,
      error,
    });
  }
}

function writeNormalizedConclusionCardsToCache(
  items: ConclusionCardCacheItem[],
): void {
  if (items.length <= 0) {
    return;
  }

  const cacheMap = readCacheMap();
  items.forEach((item) => {
    cacheMap[item.id] = item;
  });
  writeCacheMap(cacheMap);
}

function mapItemsById(items: ConclusionCardCacheItem[]): Record<string, ConclusionCardCacheItem> {
  const itemMap: Record<string, ConclusionCardCacheItem> = {};
  items.forEach((item) => {
    itemMap[item.id] = item;
  });
  return itemMap;
}

export function writeConclusionCardsToCache(items: unknown[]): void {
  const updatedAt = Date.now();
  const normalizedItems = items
    .map((item) => normalizeConclusionCardItemWithTimestamp(item, updatedAt))
    .filter((item): item is ConclusionCardCacheItem => Boolean(item));

  writeNormalizedConclusionCardsToCache(normalizedItems);
}

export function readConclusionCardsFromCache(
  rawIds: string[],
): ConclusionCardCacheReadResult {
  const ids = normalizeIds(rawIds);
  const cacheMap = readCacheMap();
  const hitMap: Record<string, ConclusionCardCacheItem> = {};
  const missingIds: string[] = [];

  ids.forEach((id) => {
    const item = cacheMap[id];
    if (item) {
      hitMap[id] = item;
      return;
    }

    missingIds.push(id);
  });

  return {
    hitMap,
    missingIds,
  };
}

export function getCachedConclusionCard(id: string): ConclusionCardCacheItem | null {
  const normalizedId = toTrimmedString(id);
  if (!normalizedId) {
    return null;
  }

  return readCacheMap()[normalizedId] || null;
}

export async function fetchAndCacheConclusionCards(
  rawIds: string[],
): Promise<ConclusionCardResolveResult> {
  const ids = normalizeIds(rawIds);
  if (ids.length <= 0) {
    return {
      items: [],
      missingIds: [],
    };
  }

  const response = await getConclusionCardsByIds(ids);
  const updatedAt = Date.now();
  const items = response.items
    .map((item) => normalizeConclusionCardItemWithTimestamp(item, updatedAt))
    .filter((item): item is ConclusionCardCacheItem => Boolean(item));
  const itemMap = mapItemsById(items);
  const missingIds = ids.filter((id) => !itemMap[id]);

  writeNormalizedConclusionCardsToCache(items);

  return {
    items: ids
      .map((id) => itemMap[id])
      .filter((item): item is ConclusionCardCacheItem => Boolean(item)),
    missingIds: normalizeIds([...response.missingIds, ...missingIds]),
  };
}

export async function resolveConclusionCards(
  rawIds: string[],
): Promise<ConclusionCardResolveResult> {
  const ids = normalizeIds(rawIds);
  if (ids.length <= 0) {
    return {
      items: [],
      missingIds: [],
    };
  }

  const cached = readConclusionCardsFromCache(ids);
  if (cached.missingIds.length <= 0) {
    return {
      items: ids
        .map((id) => cached.hitMap[id])
        .filter((item): item is ConclusionCardCacheItem => Boolean(item)),
      missingIds: [],
    };
  }

  let fetched: ConclusionCardResolveResult;
  try {
    fetched = await fetchAndCacheConclusionCards(cached.missingIds);
  } catch (error) {
    conclusionCardCacheLogger.warn("conclusion_card_cache_fetch_missing_failed", {
      missingCount: cached.missingIds.length,
      error,
    });

    return {
      items: ids
        .map((id) => cached.hitMap[id])
        .filter((item): item is ConclusionCardCacheItem => Boolean(item)),
      missingIds: cached.missingIds,
    };
  }

  const fetchedMap = mapItemsById(fetched.items);

  return {
    items: ids
      .map((id) => cached.hitMap[id] || fetchedMap[id])
      .filter((item): item is ConclusionCardCacheItem => Boolean(item)),
    missingIds: ids.filter((id) => !cached.hitMap[id] && !fetchedMap[id]),
  };
}
