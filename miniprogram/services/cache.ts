import { createLogger } from "../utils/logger/logger";

export type CacheSizeResult = {
  bytes: number;
  displayText: string;
};

export type ClearAppCacheResult = {
  success: boolean;
  clearedBytes?: number;
};

const PDF_CACHE_STORAGE_KEY = "conclusion_pdf_cache_map_v1";
const MATH_IMAGE_CACHE_STORAGE_KEY = "conclusion_math_image_cache_map_v1";
const KNOWN_CACHE_STORAGE_KEYS = [
  PDF_CACHE_STORAGE_KEY,
  MATH_IMAGE_CACHE_STORAGE_KEY,
] as const;
const cacheServiceLogger = createLogger("cache-service");

type SavedFileCacheMap = Record<string, string>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function formatSizeValue(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatBytes(bytes: number): string {
  const safeBytes = toNonNegativeInteger(bytes);
  if (safeBytes < 1024) {
    return `${safeBytes} B`;
  }

  const kb = safeBytes / 1024;
  if (kb < 1024) {
    return `${formatSizeValue(kb)} KB`;
  }

  const mb = kb / 1024;
  return `${formatSizeValue(mb)} MB`;
}

function getUtf8ByteLength(text: string): number {
  if (!text) {
    return 0;
  }

  let bytes = 0;

  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.charCodeAt(index);

    if (codePoint <= 0x7f) {
      bytes += 1;
      continue;
    }

    if (codePoint <= 0x7ff) {
      bytes += 2;
      continue;
    }

    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      bytes += 4;
      index += 1;
      continue;
    }

    bytes += 3;
  }

  return bytes;
}

function getStorageValueSize(value: unknown): number {
  if (typeof value === "string") {
    return getUtf8ByteLength(value);
  }

  if (value === undefined || value === null) {
    return 0;
  }

  try {
    return getUtf8ByteLength(JSON.stringify(value) || "");
  } catch (error) {
    cacheServiceLogger.warn("cache_value_serialize_failed", {
      error,
    });
    return 0;
  }
}

function normalizeSavedFileCacheMap(raw: unknown): SavedFileCacheMap {
  if (!isPlainObject(raw)) {
    return {};
  }

  const normalized: SavedFileCacheMap = {};
  Object.keys(raw).forEach((cacheKey) => {
    const filePath = toTrimmedString(raw[cacheKey]);
    if (!filePath) {
      return;
    }

    normalized[cacheKey] = filePath;
  });

  return normalized;
}

function readPdfCacheMapRaw(): unknown {
  try {
    return wx.getStorageSync(PDF_CACHE_STORAGE_KEY);
  } catch (error) {
    cacheServiceLogger.warn("read_pdf_cache_map_failed", {
      error,
    });
    return undefined;
  }
}

function readMathImageCacheMapRaw(): unknown {
  try {
    return wx.getStorageSync(MATH_IMAGE_CACHE_STORAGE_KEY);
  } catch (error) {
    cacheServiceLogger.warn("read_math_image_cache_map_failed", {
      error,
    });
    return undefined;
  }
}

function readPdfCacheMap(): SavedFileCacheMap {
  return normalizeSavedFileCacheMap(readPdfCacheMapRaw());
}

function readMathImageCacheMap(): SavedFileCacheMap {
  return normalizeSavedFileCacheMap(readMathImageCacheMapRaw());
}

function getUniqueCachedFilePaths(cacheMaps: SavedFileCacheMap[]): string[] {
  const dedupeSet: Record<string, true> = {};
  const filePaths: string[] = [];

  cacheMaps.forEach((cacheMap) => {
    Object.keys(cacheMap).forEach((cacheKey) => {
      const filePath = toTrimmedString(cacheMap[cacheKey]);
      if (!filePath || dedupeSet[filePath]) {
        return;
      }

      dedupeSet[filePath] = true;
      filePaths.push(filePath);
    });
  });

  return filePaths;
}

function getSavedFileListSafe(): Promise<WechatMiniprogram.FileItem[]> {
  return new Promise((resolve) => {
    wx.getSavedFileList({
      success: (res) => {
        resolve(Array.isArray(res.fileList) ? res.fileList : []);
      },
      fail: (error) => {
        cacheServiceLogger.warn("get_saved_file_list_failed", {
          error,
        });
        resolve([]);
      },
    });
  });
}

function getFileSizeSafe(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    wx.getFileInfo({
      filePath,
      success: (res) => {
        resolve(toNonNegativeInteger(res.size));
      },
      fail: () => {
        resolve(0);
      },
    });
  });
}

async function getPdfCacheFileSize(filePaths: string[]): Promise<number> {
  if (!filePaths.length) {
    return 0;
  }

  const savedFileList = await getSavedFileListSafe();
  const sizeByPath: Record<string, number> = {};

  savedFileList.forEach((item) => {
    const filePath = toTrimmedString(item.filePath);
    if (!filePath) {
      return;
    }

    sizeByPath[filePath] = toNonNegativeInteger(item.size);
  });

  const sizeList = await Promise.all(
    filePaths.map(async (filePath) => {
      const knownSize = sizeByPath[filePath];
      if (typeof knownSize === "number" && knownSize > 0) {
        return knownSize;
      }

      return getFileSizeSafe(filePath);
    }),
  );

  return sizeList.reduce((sum, size) => sum + toNonNegativeInteger(size), 0);
}

function isFileNotFoundError(error: unknown): boolean {
  const errMsg = String((error as { errMsg?: string } | undefined)?.errMsg || "").toLowerCase();
  if (!errMsg) {
    return false;
  }

  return errMsg.includes("file not exist") || errMsg.includes("no such file");
}

function removeSavedFileSafe(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    wx.removeSavedFile({
      filePath,
      success: () => {
        resolve(true);
      },
      fail: (error) => {
        if (isFileNotFoundError(error)) {
          resolve(true);
          return;
        }

        cacheServiceLogger.warn("remove_saved_file_failed", {
          filePath,
          error,
        });
        resolve(false);
      },
    });
  });
}

function clearKnownCacheStorageKeys(): boolean {
  let success = true;

  KNOWN_CACHE_STORAGE_KEYS.forEach((storageKey) => {
    try {
      wx.removeStorageSync(storageKey);
    } catch (error) {
      success = false;
      cacheServiceLogger.warn("remove_cache_storage_key_failed", {
        storageKey,
        error,
      });
    }
  });

  return success;
}

export async function getCacheSize(): Promise<CacheSizeResult> {
  try {
    const pdfCacheMapRaw = readPdfCacheMapRaw();
    const mathImageCacheMapRaw = readMathImageCacheMapRaw();
    const pdfCacheMap = normalizeSavedFileCacheMap(pdfCacheMapRaw);
    const mathImageCacheMap = normalizeSavedFileCacheMap(mathImageCacheMapRaw);
    const filePaths = getUniqueCachedFilePaths([pdfCacheMap, mathImageCacheMap]);
    const fileBytes = await getPdfCacheFileSize(filePaths);
    const storageBytes =
      getStorageValueSize(pdfCacheMapRaw) + getStorageValueSize(mathImageCacheMapRaw);
    const totalBytes = fileBytes + storageBytes;

    return {
      bytes: totalBytes,
      displayText: formatBytes(totalBytes),
    };
  } catch (error) {
    cacheServiceLogger.warn("get_cache_size_failed", {
      error,
    });
    return {
      bytes: 0,
      displayText: "0 B",
    };
  }
}

export async function clearAppCache(): Promise<ClearAppCacheResult> {
  try {
    const cacheSize = await getCacheSize();
    const pdfCacheMap = readPdfCacheMap();
    const mathImageCacheMap = readMathImageCacheMap();
    const filePaths = getUniqueCachedFilePaths([pdfCacheMap, mathImageCacheMap]);

    const removeResults = await Promise.all(filePaths.map((filePath) => removeSavedFileSafe(filePath)));
    const removeFilesSucceeded = removeResults.every((item) => item);
    const removeStorageSucceeded = clearKnownCacheStorageKeys();
    const success = removeFilesSucceeded && removeStorageSucceeded;

    return {
      success,
      clearedBytes: success ? cacheSize.bytes : undefined,
    };
  } catch (error) {
    cacheServiceLogger.warn("clear_app_cache_failed", {
      error,
    });
    return {
      success: false,
    };
  }
}
