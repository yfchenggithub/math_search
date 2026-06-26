import { CORRECTION_REPORT_API_CONFIG } from "../../config/api";
import { request } from "../request/request";

export type CorrectionReportStatus = "pending" | "reviewed" | "ignored";
export type CorrectionReportLocation =
  | "title"
  | "summary"
  | "core_formula"
  | "body"
  | "pdf"
  | "other";
export type CorrectionReportType = "formula" | "text" | "layout" | "other";

export interface SubmitCorrectionReportPayload {
  conclusion_id: string;
  conclusion_title: string;
  error_location: CorrectionReportLocation;
  error_type: CorrectionReportType;
  description: string;
}

export interface CorrectionReportRecord {
  id: number;
  userId: string;
  conclusionId: string;
  conclusionTitle: string;
  errorLocation: CorrectionReportLocation;
  errorType: CorrectionReportType;
  description: string;
  status: CorrectionReportStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ListCorrectionReportsParams {
  status?: CorrectionReportStatus | "all";
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface CorrectionReportListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: CorrectionReportRecord[];
}

type CorrectionReportsQuery = Record<string, string | number | boolean | undefined>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function normalizeStatus(value: unknown): CorrectionReportStatus {
  const status = normalizeText(value).toLowerCase();
  if (status === "reviewed" || status === "ignored") {
    return status;
  }

  return "pending";
}

function normalizeLocation(value: unknown): CorrectionReportLocation {
  const location = normalizeText(value).toLowerCase();
  if (
    location === "title"
    || location === "summary"
    || location === "core_formula"
    || location === "pdf"
    || location === "other"
  ) {
    return location;
  }

  return "body";
}

function normalizeType(value: unknown): CorrectionReportType {
  const type = normalizeText(value).toLowerCase();
  if (type === "formula" || type === "layout" || type === "other") {
    return type;
  }

  return "text";
}

function normalizeRecord(raw: unknown): CorrectionReportRecord {
  const item = isPlainObject(raw) ? raw : {};

  return {
    id: normalizeNumber(item.id),
    userId: normalizeText(item.userId || item.user_id),
    conclusionId: normalizeText(item.conclusionId || item.conclusion_id),
    conclusionTitle: normalizeText(item.conclusionTitle || item.conclusion_title),
    errorLocation: normalizeLocation(item.errorLocation || item.error_location),
    errorType: normalizeType(item.errorType || item.error_type),
    description: normalizeText(item.description),
    status: normalizeStatus(item.status),
    createdAt: normalizeText(item.createdAt || item.created_at),
    updatedAt: normalizeText(item.updatedAt || item.updated_at),
  };
}

function normalizeListResponse(raw: unknown): CorrectionReportListResponse {
  const payload = isPlainObject(raw) ? raw : {};
  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  return {
    total: normalizeNumber(payload.total, rawItems.length),
    page: normalizeNumber(payload.page, 1),
    pageSize: normalizeNumber(payload.pageSize ?? payload.page_size, rawItems.length),
    items: rawItems.map((item) => normalizeRecord(item)),
  };
}

export async function submitCorrectionReport(
  payload: SubmitCorrectionReportPayload,
): Promise<CorrectionReportRecord> {
  const raw = await request<unknown, SubmitCorrectionReportPayload>({
    url: CORRECTION_REPORT_API_CONFIG.SUBMIT_PATH,
    method: "POST",
    data: payload,
    authMode: "optional",
  });

  return normalizeRecord(raw);
}

export async function listCorrectionReports(
  params: ListCorrectionReportsParams = {},
): Promise<CorrectionReportListResponse> {
  const query: CorrectionReportsQuery = {
    status: params.status && params.status !== "all" ? params.status : undefined,
    keyword: params.keyword,
    page: params.page,
    page_size: params.pageSize,
  };

  const raw = await request<unknown>({
    url: CORRECTION_REPORT_API_CONFIG.ADMIN_LIST_PATH,
    method: "GET",
    query,
    authMode: "required",
  });

  return normalizeListResponse(raw);
}
