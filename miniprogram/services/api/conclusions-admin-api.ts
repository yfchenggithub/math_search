import { CONCLUSIONS_ADMIN_API_CONFIG } from "../../config/api";
import { request } from "../request/request";

export type AdminConclusionPreviewType = "html" | "text" | "image" | "none";

export interface AdminConclusionRecord {
  id: string;
  title: string;
  module: string;
  moduleDir: string;
  category: string;
  tags: string[];
  summary: string;
  coreFormula: string;
  previewType: AdminConclusionPreviewType;
  previewHtml: string;
  previewText: string;
  previewImage: string;
  previewImageWidth: number;
  previewImageHeight: number;
  previewFallbackText: string;
  difficulty: number | null;
  rank: number | null;
  hotScore: number | null;
  examFrequency: number | null;
}

export interface ListAdminConclusionsParams {
  module?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminConclusionListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: AdminConclusionRecord[];
}

type AdminConclusionsQuery = Record<string, string | number | boolean | undefined>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  const seen: Record<string, true> = {};
  value.forEach((item) => {
    const text = normalizeText(item);
    if (!text || seen[text]) {
      return;
    }

    seen[text] = true;
    result.push(text);
  });

  return result;
}

function normalizePreviewType(value: unknown): AdminConclusionPreviewType {
  const text = normalizeText(value);
  if (text === "html" || text === "text" || text === "image") {
    return text;
  }

  return "none";
}

function normalizeRecord(raw: unknown): AdminConclusionRecord {
  const item = isPlainObject(raw) ? raw : {};

  return {
    id: normalizeText(item.id),
    title: normalizeText(item.title),
    module: normalizeText(item.module),
    moduleDir: normalizeText(item.moduleDir || item.module_dir),
    category: normalizeText(item.category || item.moduleLabel || item.module_label),
    tags: normalizeStringList(item.tags),
    summary: normalizeText(item.summary),
    coreFormula: normalizeText(item.coreFormula || item.core_formula),
    previewType: normalizePreviewType(item.previewType || item.preview_type),
    previewHtml: normalizeText(item.previewHtml || item.preview_html),
    previewText: normalizeText(item.previewText || item.preview_text),
    previewImage: normalizeText(item.previewImage || item.preview_image),
    previewImageWidth: normalizeNumber(item.previewImageWidth || item.preview_image_width) || 0,
    previewImageHeight: normalizeNumber(item.previewImageHeight || item.preview_image_height) || 0,
    previewFallbackText: normalizeText(item.previewFallbackText || item.preview_fallback_text),
    difficulty: normalizeNumber(item.difficulty),
    rank: normalizeNumber(item.rank),
    hotScore: normalizeNumber(item.hotScore || item.hot_score),
    examFrequency: normalizeNumber(item.examFrequency || item.exam_frequency),
  };
}

function normalizeListResponse(raw: unknown): AdminConclusionListResponse {
  const payload = isPlainObject(raw) ? raw : {};
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const page = normalizeNumber(payload.page) || 1;
  const pageSize = normalizeNumber(payload.pageSize ?? payload.page_size) || rawItems.length;

  return {
    total: normalizeNumber(payload.total) || rawItems.length,
    page,
    pageSize,
    items: rawItems.map((item) => normalizeRecord(item)),
  };
}

export async function listAdminConclusions(
  params: ListAdminConclusionsParams = {},
): Promise<AdminConclusionListResponse> {
  const query: AdminConclusionsQuery = {
    module: params.module,
    q: params.keyword,
    page: params.page,
    page_size: params.pageSize,
  };

  const raw = await request<unknown>({
    url: CONCLUSIONS_ADMIN_API_CONFIG.ADMIN_LIST_PATH,
    method: "GET",
    query,
    authMode: "required",
  });

  return normalizeListResponse(raw);
}
