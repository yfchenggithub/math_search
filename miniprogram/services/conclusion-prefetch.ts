import { FEATURE_FLAGS } from "../config/feature-flags";
import { getSettings } from "./settings";
import { createLogger } from "../utils/logger/logger";
import {
  getDetailDocumentById,
  type DetailDocumentView,
  type MathImageNode,
} from "../utils/detail-content";
import { buildAbsoluteApiUrl } from "../utils/api-url";
import { getPdfEntitlement, isPdfEntitlementActive } from "../utils/pdf-entitlement";

const prefetchLogger = createLogger("conclusion-prefetch");

const PDF_CACHE_STORAGE_KEY = "conclusion_pdf_cache_map_v1";
const MATH_IMAGE_CACHE_STORAGE_KEY = "conclusion_math_image_cache_map_v1";
const DEFAULT_PREFETCH_MAX_COUNT = 16;
const DEFAULT_DETAIL_CONCURRENCY = 2;
const DEFAULT_ASSET_CONCURRENCY = 3;

type SavedFileCacheMap = Record<string, string>;

export type PrefetchConclusionsOptions = {
  reason?: string;
  maxCount?: number;
  detailConcurrency?: number;
  assetConcurrency?: number;
};

type PrefetchCacheContext = {
  pdfCacheMap: SavedFileCacheMap;
  mathImageCacheMap: SavedFileCacheMap;
  dirtyPdfCache: boolean;
  dirtyMathImageCache: boolean;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function toPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  return Math.max(1, Math.floor(fallback));
}

function uniqNormalizedIds(ids: string[], maxCount: number): string[] {
  const normalized: string[] = [];
  const seen: Record<string, true> = {};

  ids.forEach((rawId) => {
    const id = normalizeText(rawId);
    if (!id || seen[id] || normalized.length >= maxCount) {
      return;
    }

    seen[id] = true;
    normalized.push(id);
  });

  return normalized;
}

function readSavedFileCacheMap(storageKey: string): SavedFileCacheMap {
  try {
    const raw = wx.getStorageSync(storageKey);
    if (!isPlainObject(raw)) {
      return {};
    }

    const normalized: SavedFileCacheMap = {};
    Object.keys(raw).forEach((cacheKey) => {
      const filePath = normalizeText(raw[cacheKey]);
      if (!filePath) {
        return;
      }

      normalized[cacheKey] = filePath;
    });

    return normalized;
  } catch (error) {
    prefetchLogger.warn("read_saved_file_cache_map_failed", {
      storageKey,
      error,
    });
    return {};
  }
}

function writeSavedFileCacheMap(storageKey: string, cacheMap: SavedFileCacheMap): void {
  try {
    wx.setStorageSync(storageKey, cacheMap);
  } catch (error) {
    prefetchLogger.warn("write_saved_file_cache_map_failed", {
      storageKey,
      size: Object.keys(cacheMap).length,
      error,
    });
  }
}

function createPrefetchCacheContext(): PrefetchCacheContext {
  return {
    pdfCacheMap: readSavedFileCacheMap(PDF_CACHE_STORAGE_KEY),
    mathImageCacheMap: readSavedFileCacheMap(MATH_IMAGE_CACHE_STORAGE_KEY),
    dirtyPdfCache: false,
    dirtyMathImageCache: false,
  };
}

function flushPrefetchCacheContext(context: PrefetchCacheContext): void {
  if (context.dirtyPdfCache) {
    writeSavedFileCacheMap(PDF_CACHE_STORAGE_KEY, context.pdfCacheMap);
  }

  if (context.dirtyMathImageCache) {
    writeSavedFileCacheMap(MATH_IMAGE_CACHE_STORAGE_KEY, context.mathImageCacheMap);
  }
}

function isLikelyLocalFilePath(path: string): boolean {
  if (!path) {
    return false;
  }

  return /^wxfile:\/\//i.test(path) || /^file:\/\//i.test(path) || /^[a-z]:\\/i.test(path);
}

function isHttpUrl(pathOrUrl: string): boolean {
  return /^https?:\/\//i.test(pathOrUrl);
}

function isSavedFilePathAvailable(savedFilePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const normalizedPath = normalizeText(savedFilePath);
    if (!normalizedPath) {
      resolve(false);
      return;
    }

    wx.getFileInfo({
      filePath: normalizedPath,
      success: () => {
        resolve(true);
      },
      fail: () => {
        resolve(false);
      },
    });
  });
}

function saveFileFromTempPath(tempFilePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.saveFile({
      tempFilePath,
      success: (res) => {
        const savedFilePath = normalizeText(res.savedFilePath);
        if (!savedFilePath) {
          reject(new Error("saveFile empty savedFilePath"));
          return;
        }

        resolve(savedFilePath);
      },
      fail: (error) => {
        reject(error);
      },
    });
  });
}

function downloadAndSaveFile(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          reject(new Error(`download failed (HTTP ${res.statusCode})`));
          return;
        }

        saveFileFromTempPath(res.tempFilePath)
          .then(resolve)
          .catch(reject);
      },
      fail: (error) => {
        reject(error);
      },
    });
  });
}

async function runWithConcurrency<T>(
  list: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (list.length <= 0) {
    return;
  }

  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  let pointer = 0;

  const runners = new Array(Math.min(safeConcurrency, list.length)).fill(0).map(async () => {
    while (pointer < list.length) {
      const current = pointer;
      pointer += 1;
      await worker(list[current], current);
    }
  });

  await Promise.all(runners);
}

function hashText(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

function buildMathImageCacheKey(latex: string, sourceUrl: string): string {
  const normalizedLatex = normalizeText(latex);
  const normalizedUrl = normalizeText(sourceUrl);
  if (!normalizedLatex && !normalizedUrl) {
    return "";
  }

  const formulaIdentity = normalizedLatex || normalizedUrl;
  return `math_image::${hashText(formulaIdentity)}::${hashText(normalizedUrl || formulaIdentity)}`;
}

function buildPdfCacheKey(conclusionId: string, rawPdfUrl: string): string {
  const normalizedId = normalizeText(conclusionId);
  const normalizedUrl = normalizeText(rawPdfUrl);
  if (!normalizedId || !normalizedUrl) {
    return "";
  }

  return `${normalizedId}::${normalizedUrl}`;
}

function pickMathImageSourceUrl(node: MathImageNode): string {
  const directUrl = normalizeText(node.imageUrl);
  if (directUrl) {
    if (isLikelyLocalFilePath(directUrl)) {
      return directUrl;
    }

    return isHttpUrl(directUrl) ? directUrl : buildAbsoluteApiUrl(directUrl);
  }

  const assetUrl = normalizeText(node.asset?.png) || normalizeText(node.asset?.webp);
  if (!assetUrl) {
    return "";
  }

  return buildAbsoluteApiUrl(assetUrl);
}

function collectMathImageNodes(detail: DetailDocumentView): MathImageNode[] {
  const nodes: MathImageNode[] = [];

  if (detail.coreFormulaImage) {
    nodes.push(detail.coreFormulaImage);
  }

  detail.sections.forEach((section) => {
    section.blocks.forEach((block) => {
      if (block.kind === "math_image") {
        nodes.push({
          type: "math_image",
          latex: block.latex,
          alt: block.alt,
          asset: block.asset,
          imageUrl: block.imageUrl,
          displayWidth: block.displayWidth,
          imageLoadFailed: block.imageLoadFailed,
          __path: block.__path,
        });
      }

      if (block.kind !== "theorem") {
        return;
      }

      if (Array.isArray(block.formulaImages)) {
        block.formulaImages.forEach((node) => {
          nodes.push(node);
        });
      }

      if (Array.isArray(block.descParts)) {
        block.descParts.forEach((part) => {
          if (part.kind === "math_image" && part.image) {
            nodes.push(part.image);
          }
        });
      }
    });
  });

  return nodes;
}

async function prefetchMathImagesForDetail(
  detail: DetailDocumentView,
  context: PrefetchCacheContext,
  assetConcurrency: number,
): Promise<void> {
  const candidates = collectMathImageNodes(detail)
    .map((node) => {
      const sourceUrl = pickMathImageSourceUrl(node);
      const cacheKey = buildMathImageCacheKey(normalizeText(node.latex), sourceUrl);
      return {
        cacheKey,
        sourceUrl,
      };
    })
    .filter((candidate) => candidate.cacheKey && candidate.sourceUrl && isHttpUrl(candidate.sourceUrl));

  if (candidates.length <= 0) {
    return;
  }

  const dedupe: Record<string, true> = {};
  const queue = candidates.filter((candidate) => {
    if (dedupe[candidate.cacheKey]) {
      return false;
    }

    dedupe[candidate.cacheKey] = true;
    return true;
  });

  await runWithConcurrency(queue, assetConcurrency, async (candidate) => {
    const cachedFilePath = normalizeText(context.mathImageCacheMap[candidate.cacheKey]);
    if (cachedFilePath) {
      const available = await isSavedFilePathAvailable(cachedFilePath);
      if (available) {
        return;
      }

      delete context.mathImageCacheMap[candidate.cacheKey];
      context.dirtyMathImageCache = true;
    }

    try {
      const savedFilePath = await downloadAndSaveFile(candidate.sourceUrl);
      context.mathImageCacheMap[candidate.cacheKey] = savedFilePath;
      context.dirtyMathImageCache = true;
    } catch (error) {
      prefetchLogger.warn("prefetch_math_image_failed", {
        id: detail.id,
        cacheKey: candidate.cacheKey,
        sourceUrl: candidate.sourceUrl,
        error,
      });
    }
  });
}

function shouldPrefetchPdf(): boolean {
  if (!FEATURE_FLAGS.ENABLE_PDF_ENTITLEMENT_FLOW) {
    return true;
  }

  return isPdfEntitlementActive(getPdfEntitlement());
}

async function prefetchPdfForDetail(
  detail: DetailDocumentView,
  context: PrefetchCacheContext,
): Promise<void> {
  if (!detail.pdfAvailable) {
    return;
  }

  const rawPdfUrl = normalizeText(detail.pdfUrl);
  if (!rawPdfUrl) {
    return;
  }

  if (!shouldPrefetchPdf()) {
    return;
  }

  const cacheKey = buildPdfCacheKey(detail.id, rawPdfUrl);
  if (!cacheKey) {
    return;
  }

  const cachedFilePath = normalizeText(context.pdfCacheMap[cacheKey]);
  if (cachedFilePath) {
    const available = await isSavedFilePathAvailable(cachedFilePath);
    if (available) {
      return;
    }

    delete context.pdfCacheMap[cacheKey];
    context.dirtyPdfCache = true;
  }

  const fullPdfUrl = buildAbsoluteApiUrl(rawPdfUrl);
  if (!fullPdfUrl || !isHttpUrl(fullPdfUrl)) {
    return;
  }

  try {
    const savedFilePath = await downloadAndSaveFile(fullPdfUrl);
    context.pdfCacheMap[cacheKey] = savedFilePath;
    context.dirtyPdfCache = true;
  } catch (error) {
    prefetchLogger.warn("prefetch_pdf_failed", {
      id: detail.id,
      cacheKey,
      fullPdfUrl,
      error,
    });
  }
}

function getCurrentNetworkTypeSafe(): Promise<string> {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (result) => {
        resolve(normalizeText(result.networkType).toLowerCase());
      },
      fail: () => {
        resolve("unknown");
      },
    });
  });
}

async function shouldPrefetchBinaryAssets(): Promise<boolean> {
  const wifiOnlyDownload = Boolean(getSettings().wifiOnlyDownload);
  if (!wifiOnlyDownload) {
    return true;
  }

  const networkType = await getCurrentNetworkTypeSafe();
  return networkType === "wifi";
}

export async function prefetchConclusionBundlesByIds(
  ids: string[],
  options: PrefetchConclusionsOptions = {},
): Promise<void> {
  const maxCount = toPositiveInteger(options.maxCount, DEFAULT_PREFETCH_MAX_COUNT);
  const detailConcurrency = toPositiveInteger(
    options.detailConcurrency,
    DEFAULT_DETAIL_CONCURRENCY,
  );
  const assetConcurrency = toPositiveInteger(
    options.assetConcurrency,
    DEFAULT_ASSET_CONCURRENCY,
  );
  const reason = normalizeText(options.reason) || "unknown";
  const normalizedIds = uniqNormalizedIds(ids, maxCount);

  if (normalizedIds.length <= 0) {
    return;
  }

  const binaryAssetEnabled = await shouldPrefetchBinaryAssets();
  const cacheContext = createPrefetchCacheContext();
  const detailList: DetailDocumentView[] = [];

  await runWithConcurrency(normalizedIds, detailConcurrency, async (id) => {
    try {
      const detail = await getDetailDocumentById(id);
      if (detail) {
        detailList.push(detail);
      }
    } catch (error) {
      prefetchLogger.warn("prefetch_detail_failed", {
        id,
        reason,
        error,
      });
    }
  });

  if (!binaryAssetEnabled || detailList.length <= 0) {
    flushPrefetchCacheContext(cacheContext);
    return;
  }

  await runWithConcurrency(detailList, detailConcurrency, async (detail) => {
    await Promise.all([
      prefetchMathImagesForDetail(detail, cacheContext, assetConcurrency),
      prefetchPdfForDetail(detail, cacheContext),
    ]);
  });

  flushPrefetchCacheContext(cacheContext);
}

