import { request } from "../request/request";
import { downloadAndOpenPdfDocument } from "../pdf-document";

export interface FavoriteRecord {
  id: string;
  title: string;
  module: string;
  moduleLabel: string;
  tags: string[];
  summary: string;
  favoritedAt: string;
  pdfAvailable: boolean;
}

export interface FavoritesListResponse {
  list: FavoriteRecord[];
  total: number;
}

export interface GetFavoritesListParams {
  page?: number;
  pageSize?: number;
  module?: string;
  keyword?: string;
  sort?: "recent" | "title";
}

export interface AddFavoriteRequest {
  conclusion_id: string;
}

export type FavoriteHandoutStatus =
  | "ready"
  | "processing"
  | "failed"
  | "expired";

export interface FavoriteHandoutErrorInfo {
  code: string;
  message: string;
}

export interface FavoriteHandoutResponse {
  handoutId: string;
  title: string;
  status: FavoriteHandoutStatus;
  itemCount: number;
  filename: string | null;
  pdfUrl: string | null;
  createdAt: string;
  expiresAt: string | null;
  error: FavoriteHandoutErrorInfo | null;
}

type FavoritesListQuery = Record<string, string | number | boolean | undefined>;

interface FavoritesListRawResponse {
  list?: unknown[];
  items?: unknown[];
  total?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeHandoutStatus(rawStatus: unknown): FavoriteHandoutStatus {
  const status = normalizeText(rawStatus).toLowerCase();
  if (status === "ready" || status === "processing" || status === "failed" || status === "expired") {
    return status;
  }

  return "failed";
}

function normalizeFavoriteHandoutError(rawError: unknown): FavoriteHandoutErrorInfo | null {
  if (!isPlainObject(rawError)) {
    return null;
  }

  const code = normalizeText(rawError.code);
  const message = normalizeText(rawError.message);
  if (!code && !message) {
    return null;
  }

  return {
    code,
    message,
  };
}

function normalizeFavoriteHandoutResponse(raw: unknown): FavoriteHandoutResponse {
  if (!isPlainObject(raw)) {
    return {
      handoutId: "",
      title: "收藏讲义",
      status: "failed",
      itemCount: 0,
      filename: null,
      pdfUrl: null,
      createdAt: "",
      expiresAt: null,
      error: {
        code: "INVALID_RESPONSE",
        message: "讲义生成响应异常",
      },
    };
  }

  return {
    handoutId: normalizeText(raw.handoutId || raw.handout_id),
    title: normalizeText(raw.title) || "收藏讲义",
    status: normalizeHandoutStatus(raw.status),
    itemCount: Number.isFinite(Number(raw.itemCount ?? raw.item_count))
      ? Number(raw.itemCount ?? raw.item_count)
      : 0,
    filename: normalizeOptionalText(raw.filename),
    pdfUrl: normalizeOptionalText(raw.pdfUrl || raw.pdf_url),
    createdAt: normalizeText(raw.createdAt || raw.created_at),
    expiresAt: normalizeOptionalText(raw.expiresAt || raw.expires_at),
    error: normalizeFavoriteHandoutError(raw.error),
  };
}

function normalizeFavoriteRecord(raw: unknown): FavoriteRecord | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const id = String(raw.id || raw.conclusion_id || "").trim();
  if (!id) {
    return null;
  }

  const module = String(raw.module || "function").trim() || "function";
  const tags = Array.isArray(raw.tags)
    ? raw.tags
      .map((item) => String(item || "").trim())
      .filter((item) => Boolean(item))
    : [];

  return {
    id,
    title: String(raw.title || "未命名结论").trim() || "未命名结论",
    module,
    moduleLabel: String(raw.moduleLabel || raw.module_label || module).trim() || module,
    tags,
    summary: String(raw.summary || "").trim(),
    favoritedAt: String(raw.favoritedAt || raw.favorited_at || "").trim(),
    pdfAvailable: Boolean(raw.pdfAvailable ?? raw.pdf_available),
  };
}

function normalizeFavoritesListResponse(raw: unknown): FavoritesListResponse {
  if (!isPlainObject(raw)) {
    return {
      list: [],
      total: 0,
    };
  }

  const rawList = Array.isArray(raw.list)
    ? raw.list
    : (Array.isArray(raw.items) ? raw.items : []);

  const list = rawList
    .map((item) => normalizeFavoriteRecord(item))
    .filter((item): item is FavoriteRecord => Boolean(item));

  const total = typeof raw.total === "number" ? raw.total : list.length;

  return {
    list,
    total,
  };
}

export async function getFavoritesList(
  query: GetFavoritesListParams = {},
): Promise<FavoritesListResponse> {
  const requestQuery: FavoritesListQuery = {
    page: query.page,
    pageSize: query.pageSize,
    module: query.module,
    keyword: query.keyword,
    sort: query.sort,
  };

  const raw = await request<FavoritesListRawResponse>({
    url: "/api/v1/favorites",
    method: "GET",
    query: requestQuery,
    authMode: "required",
  });

  return normalizeFavoritesListResponse(raw);
}

export function addFavorite(payload: AddFavoriteRequest): Promise<void> {
  return request<void, AddFavoriteRequest>({
    url: "/api/v1/favorites",
    method: "POST",
    data: payload,
    authMode: "required",
  });
}

export function removeFavorite(conclusionId: string): Promise<void> {
  const id = encodeURIComponent(String(conclusionId || "").trim());

  return request<void>({
    url: `/api/v1/favorites/${id}`,
    method: "DELETE",
    authMode: "required",
  });
}

export async function createFavoriteHandout(): Promise<FavoriteHandoutResponse> {
  const raw = await request<unknown, Record<string, never>>({
    url: "/api/v1/favorites/handouts",
    method: "POST",
    data: {},
    authMode: "required",
  });

  return normalizeFavoriteHandoutResponse(raw);
}

export async function downloadFavoriteHandoutPdf(
  pdfUrl: string,
  filename?: string,
): Promise<void> {
  await downloadAndOpenPdfDocument({
    pdfUrl,
    filename,
    authMode: "required",
  });
}
