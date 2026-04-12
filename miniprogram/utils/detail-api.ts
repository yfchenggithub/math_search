import { DETAIL_API_CONFIG } from "../config/api";
import type {
  CanonicalConclusionDetail,
  CanonicalConclusionDetailEnvelope,
} from "../types/detail";
import { RequestError, request } from "./request";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeId(id: string): string {
  return String(id || "").trim();
}

function buildDetailPath(id: string): string {
  const normalizedId = normalizeId(id);

  if (!normalizedId) {
    throw new RequestError("详情 ID 不能为空");
  }

  const prefix = DETAIL_API_CONFIG.DETAIL_PATH_PREFIX.replace(/\/+$/, "");
  return `${prefix}/${encodeURIComponent(normalizedId)}`;
}

function unwrapCanonicalDetailPayload(payload: unknown): CanonicalConclusionDetail {
  if (!isPlainObject(payload)) {
    throw new RequestError("详情接口返回格式错误");
  }

  const envelope = payload as CanonicalConclusionDetailEnvelope;

  if (isPlainObject(envelope.data)) {
    return envelope.data;
  }

  return payload as CanonicalConclusionDetail;
}

/**
 * 拉取 canonical v2 详情。
 * 注意这里只做请求与解包，页面适配统一放在 detail-content.ts。
 */
export async function fetchConclusionDetail(id: string): Promise<CanonicalConclusionDetail> {
  const data = await request<unknown>({
    url: buildDetailPath(id),
    method: "GET",
    // 有些后端会返回多层 data，这里关闭 request 默认解包，交给 detail-api 统一兜底。
    unwrapData: false,
  });

  return unwrapCanonicalDetailPayload(data);
}
