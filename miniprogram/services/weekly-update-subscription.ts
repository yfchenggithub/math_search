import { authService } from "./auth/auth-service";
import {
  recordWeeklyUpdateAuthorization,
  WEEKLY_UPDATE_TEMPLATE_ID,
  type WeeklyUpdateAuthorizationResult,
  type WeeklyUpdateSubscriptionStatus,
} from "./api/weekly-update-subscription-api";
import { requireAuthAndRun } from "../utils/guards/require-auth-and-run";
import { createLogger } from "../utils/logger/logger";
import { getErrorMessage } from "../utils/request";

export type WeeklyUpdatePromptSource =
  | "favorite_success"
  | "handout_success"
  | "weekly_updates_page"
  | "home_weekly_entry";

interface PromptOptions {
  source: WeeklyUpdatePromptSource;
  force?: boolean;
}

type SubscribeMessageResult = Record<string, unknown> & {
  errMsg?: string;
};

const weeklyUpdateLogger = createLogger("weekly-update-subscription");
const PROMPT_STORAGE_KEY = "weekly_update_subscription_prompt_v1";
const AUTO_PROMPT_THROTTLE_MS = 24 * 60 * 60 * 1000;

const PROMPT_COPY_BY_SOURCE: Record<WeeklyUpdatePromptSource, { title: string; content: string }> = {
  favorite_success: {
    title: "订阅每周更新",
    content: "收藏完成。下周有新的二级结论时，要不要提醒你？",
  },
  handout_success: {
    title: "继续接收周更",
    content: "讲义已生成。下周新增结论时，可以给你发一次微信提醒。",
  },
  weekly_updates_page: {
    title: "订阅下周提醒",
    content: "每周只提醒一次，有新的二级结论时点开查看。",
  },
  home_weekly_entry: {
    title: "订阅每周更新",
    content: "每周整理新结论，有更新时给你发一次提醒。",
  },
};

function readPromptState(): Record<string, number> {
  try {
    const raw = wx.getStorageSync(PROMPT_STORAGE_KEY);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }

    const nextState: Record<string, number> = {};
    Object.keys(raw as Record<string, unknown>).forEach((key) => {
      const value = Number((raw as Record<string, unknown>)[key]);
      if (Number.isFinite(value) && value > 0) {
        nextState[key] = value;
      }
    });
    return nextState;
  } catch (error) {
    weeklyUpdateLogger.warn("read_prompt_state_failed", { error });
    return {};
  }
}

function writePromptState(state: Record<string, number>) {
  try {
    wx.setStorageSync(PROMPT_STORAGE_KEY, state);
  } catch (error) {
    weeklyUpdateLogger.warn("write_prompt_state_failed", { error });
  }
}

function shouldSkipAutoPrompt(source: WeeklyUpdatePromptSource): boolean {
  const state = readPromptState();
  const lastPromptAt = Number(state[source] || 0);
  return lastPromptAt > 0 && Date.now() - lastPromptAt < AUTO_PROMPT_THROTTLE_MS;
}

function markPromptShown(source: WeeklyUpdatePromptSource) {
  const state = readPromptState();
  state[source] = Date.now();
  writePromptState(state);
}

function showSubscribeConfirm(source: WeeklyUpdatePromptSource): Promise<boolean> {
  const copy = PROMPT_COPY_BY_SOURCE[source] || PROMPT_COPY_BY_SOURCE.weekly_updates_page;

  return new Promise((resolve) => {
    wx.showModal({
      title: copy.title,
      content: copy.content,
      confirmText: "订阅提醒",
      cancelText: "先不用",
      success: (result) => {
        resolve(Boolean(result.confirm));
      },
      fail: () => {
        resolve(false);
      },
    });
  });
}

function requestSubscribeMessage(): Promise<SubscribeMessageResult> {
  return new Promise((resolve, reject) => {
    if (typeof wx.requestSubscribeMessage !== "function") {
      reject(new Error("当前微信版本暂不支持订阅消息"));
      return;
    }

    wx.requestSubscribeMessage({
      tmplIds: [WEEKLY_UPDATE_TEMPLATE_ID],
      success: (result) => {
        resolve(result as SubscribeMessageResult);
      },
      fail: (error) => {
        reject(error);
      },
    });
  });
}

function normalizeAuthorizationResult(rawResult: unknown): WeeklyUpdateAuthorizationResult {
  const result = String(rawResult || "").trim();
  if (
    result === "accept"
    || result === "reject"
    || result === "ban"
    || result === "filter"
  ) {
    return result;
  }

  return "reject";
}

function showResultToast(result: WeeklyUpdateAuthorizationResult, status: WeeklyUpdateSubscriptionStatus) {
  if (result === "accept") {
    const count = Math.max(0, Number(status.availableCount || 0));
    wx.showToast({
      title: count > 1 ? `已订阅 ${count} 次提醒` : "已订阅下次提醒",
      icon: "none",
    });
    return;
  }

  if (result === "ban") {
    wx.showToast({
      title: "订阅消息暂不可用",
      icon: "none",
    });
    return;
  }

  wx.showToast({
    title: "本次未订阅提醒",
    icon: "none",
  });
}

async function requestAndRecordWeeklyUpdateSubscription(
  source: WeeklyUpdatePromptSource,
): Promise<WeeklyUpdateSubscriptionStatus | null> {
  const subscribeResult = await requestSubscribeMessage();
  const result = normalizeAuthorizationResult(subscribeResult[WEEKLY_UPDATE_TEMPLATE_ID]);
  const status = await recordWeeklyUpdateAuthorization({
    template_id: WEEKLY_UPDATE_TEMPLATE_ID,
    result,
    source,
  });
  showResultToast(result, status);
  return status;
}

export async function promptWeeklyUpdateSubscription(
  options: PromptOptions,
): Promise<WeeklyUpdateSubscriptionStatus | null> {
  const source = options.source;
  const force = Boolean(options.force);

  if (!force && shouldSkipAutoPrompt(source)) {
    return null;
  }

  markPromptShown(source);

  const status = await requireAuthAndRun(
    async () => {
      const confirmed = await showSubscribeConfirm(source);
      if (!confirmed) {
        weeklyUpdateLogger.info("subscribe_confirm_cancelled", { source });
        return null;
      }

      try {
        return await requestAndRecordWeeklyUpdateSubscription(source);
      } catch (error) {
        weeklyUpdateLogger.warn("subscribe_request_failed", {
          source,
          error,
        });
        wx.showToast({
          title: getErrorMessage(error, "订阅失败，请稍后重试"),
          icon: "none",
        });
        return null;
      }
    },
    {
      title: "请先登录",
      content: "登录后才能接收每周更新提醒",
      loginSource: "favorites",
    },
  );
  return status || null;
}

export function canPromptWeeklyUpdateSubscription(): boolean {
  return authService.isAuthenticated();
}
