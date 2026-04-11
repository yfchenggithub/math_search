import type {
  ConclusionDetail,
  SearchParams,
  SearchResponse,
  SuggestResponse,
} from "../types/api";
import { RequestError, request } from "../utils/request";

function sanitizeKeyword(value: string): string {
  return value.trim();
}

function sanitizeOptionalText(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue || undefined;
}

function sanitizeInteger(
  value: number | undefined,
  minimum: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(minimum, Math.floor(value));
}

/**
 * 搜索接口参数整理。
 * 只把有效值带给后端，避免把空字符串和无效分页参数一起传过去。
 */
function buildSearchParams(params: SearchParams): SearchParams {
  const nextParams: SearchParams = {
    q: sanitizeKeyword(params.q),
  };

  const module = sanitizeOptionalText(params.module);
  const limit = sanitizeInteger(params.limit, 1);
  const offset = sanitizeInteger(params.offset, 0);

  if (module) {
    nextParams.module = module;
  }

  if (limit !== undefined) {
    nextParams.limit = limit;
  }

  if (offset !== undefined) {
    nextParams.offset = offset;
  }

  return nextParams;
}

/**
 * 搜索结论列表。
 * 为空关键词直接返回空结果，避免页面层额外判断。
 */
export function searchConclusions(
  params: SearchParams,
): Promise<SearchResponse> {
  const requestParams = buildSearchParams(params);

  if (!requestParams.q) {
    return Promise.resolve({
      list: [],
      total: 0,
    });
  }

  return request<SearchResponse>({
    url: "/search",
    method: "GET",
    query: { ...requestParams },
  });
}

/**
 * 获取联想建议。
 * 输入为空时直接返回空数组，适合输入框实时联想场景。
 */
export function getSuggestions(q: string): Promise<SuggestResponse> {
  const keyword = sanitizeKeyword(q);

  if (!keyword) {
    return Promise.resolve({
      suggestions: [],
    });
  }

  return request<SuggestResponse>({
    url: "/suggest",
    method: "GET",
    query: {
      q: keyword,
    },
  });
}

/**
 * 获取结论详情。
 * id 为空时直接抛出可读错误，方便页面层统一 toast。
 */
export function getConclusionDetail(id: string): Promise<ConclusionDetail> {
  const normalizedId = sanitizeKeyword(id);

  if (!normalizedId) {
    return Promise.reject(new RequestError("详情 ID 不能为空"));
  }

  return request<ConclusionDetail>({
    url: `/api/v1/conclusions/${encodeURIComponent(normalizedId)}`,
    method: "GET",
  });
}
