import { ContentMap, type ContentType } from "../data/content/registry";

export interface LocalSearchBundleFallback {
  version?: number;
  generatedAt?: string;
  fieldMaskLegend: Record<string, number>;
  docs: Record<string, unknown>;
  termIndex: Record<string, unknown>;
  prefixIndex: Record<string, unknown>;
  suggestions: unknown[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * 通用本地内容加载器。
 * 主要用于 detail 等页面读取静态内容。
 */
export function loadContent<T = unknown>(name: ContentType): T {
  try {
    const data = ContentMap[name];
    if (!data) {
      throw new Error(`Content [${name}] not found in ContentMap`);
    }

    return data as T;
  } catch (error) {
    console.error("加载本地内容失败:", name, error);
    return {} as T;
  }
}

/**
 * 本地搜索索引兜底加载器。
 * 仅作为远程搜索失败后的 fallback 数据来源。
 */
export function loadSearchBundleFallback(): LocalSearchBundleFallback | null {
  try {
    const loadedBundle = require("../data/index/search_bundle.js") as Partial<LocalSearchBundleFallback>;

    if (!isPlainObject(loadedBundle)) {
      throw new Error("Search bundle is not an object");
    }

    if (
      !isPlainObject(loadedBundle.docs)
      || !isPlainObject(loadedBundle.termIndex)
      || !isPlainObject(loadedBundle.prefixIndex)
      || !Array.isArray(loadedBundle.suggestions)
      || !isPlainObject(loadedBundle.fieldMaskLegend)
    ) {
      throw new Error("Search bundle fields are incomplete");
    }

    return loadedBundle as LocalSearchBundleFallback;
  } catch (error) {
    console.error("加载本地搜索索引失败:", error);
    return null;
  }
}
