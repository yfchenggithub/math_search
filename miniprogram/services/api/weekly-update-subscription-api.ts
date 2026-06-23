import { request } from "../request/request";

export const WEEKLY_UPDATE_TEMPLATE_ID = "ZRc75fk-bUszGZ5lVUA-rHz_zBxGgs_o9LevvwPUIxw";

export type WeeklyUpdateAuthorizationResult = "accept" | "reject" | "ban" | "filter";

export interface WeeklyUpdateSubscriptionStatus {
  templateId: string;
  status: "active" | "inactive" | string;
  isFollowing: boolean;
  availableCount: number;
  needsResubscribe: boolean;
  lastRequestResult: string | null;
  lastPromptSource: string | null;
  lastAuthorizedAt: string | null;
  lastSentAt: string | null;
  totalAcceptCount: number;
  totalRejectCount: number;
  totalSentCount: number;
}

export interface WeeklyUpdateAuthorizationPayload {
  template_id?: string;
  result: WeeklyUpdateAuthorizationResult;
  source?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.round(parsed));
}

function normalizeSubscriptionStatus(raw: unknown): WeeklyUpdateSubscriptionStatus {
  if (!isPlainObject(raw)) {
    return {
      templateId: WEEKLY_UPDATE_TEMPLATE_ID,
      status: "inactive",
      isFollowing: false,
      availableCount: 0,
      needsResubscribe: false,
      lastRequestResult: null,
      lastPromptSource: null,
      lastAuthorizedAt: null,
      lastSentAt: null,
      totalAcceptCount: 0,
      totalRejectCount: 0,
      totalSentCount: 0,
    };
  }

  const status = normalizeText(raw.status) || "inactive";
  const availableCount = normalizeCount(raw.availableCount ?? raw.available_count);
  const isFollowing = Boolean(raw.isFollowing ?? raw.is_following ?? status === "active");

  return {
    templateId: normalizeText(raw.templateId || raw.template_id) || WEEKLY_UPDATE_TEMPLATE_ID,
    status,
    isFollowing,
    availableCount,
    needsResubscribe: Boolean(raw.needsResubscribe ?? raw.needs_resubscribe),
    lastRequestResult: normalizeText(raw.lastRequestResult || raw.last_request_result) || null,
    lastPromptSource: normalizeText(raw.lastPromptSource || raw.last_prompt_source) || null,
    lastAuthorizedAt: normalizeText(raw.lastAuthorizedAt || raw.last_authorized_at) || null,
    lastSentAt: normalizeText(raw.lastSentAt || raw.last_sent_at) || null,
    totalAcceptCount: normalizeCount(raw.totalAcceptCount ?? raw.total_accept_count),
    totalRejectCount: normalizeCount(raw.totalRejectCount ?? raw.total_reject_count),
    totalSentCount: normalizeCount(raw.totalSentCount ?? raw.total_sent_count),
  };
}

export async function getWeeklyUpdateSubscriptionStatus(): Promise<WeeklyUpdateSubscriptionStatus> {
  const raw = await request<unknown>({
    url: "/api/v1/weekly-update-subscription",
    method: "GET",
    authMode: "required",
  });

  return normalizeSubscriptionStatus(raw);
}

export async function recordWeeklyUpdateAuthorization(
  payload: WeeklyUpdateAuthorizationPayload,
): Promise<WeeklyUpdateSubscriptionStatus> {
  const raw = await request<unknown, WeeklyUpdateAuthorizationPayload>({
    url: "/api/v1/weekly-update-subscription/authorization",
    method: "POST",
    data: payload,
    authMode: "required",
  });

  return normalizeSubscriptionStatus(raw);
}
