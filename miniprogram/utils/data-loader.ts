import { ContentMap, type ContentType } from "../data/content/registry";
import { createLogger } from "./logger/logger";

export interface LocalSearchBundleFallback {
  version?: number;
  generatedAt?: string;
  fieldMaskLegend: Record<string, number>;
  docs: Record<string, unknown>;
  termIndex: Record<string, unknown>;
  prefixIndex: Record<string, unknown>;
  suggestions: unknown[];
}

const dataLoaderLogger = createLogger("data-loader");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function loadContent<T = unknown>(name: ContentType): T {
  try {
    const data = ContentMap[name];
    if (!data) {
      throw new Error(`Content [${name}] not found in ContentMap`);
    }

    return data as T;
  } catch (error) {
    dataLoaderLogger.error("load_content_failed", {
      name,
      error,
    });
    return {} as T;
  }
}

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
    dataLoaderLogger.error("load_search_bundle_fallback_failed", {
      error,
    });
    return null;
  }
}
