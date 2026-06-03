import { request } from "../request/request";

export interface ConclusionCardsApiResponse {
  total: number;
  items: unknown[];
  missingIds: string[];
}

interface ConclusionCardsRawResponse {
  total?: unknown;
  items?: unknown;
  list?: unknown;
  missing_ids?: unknown;
  missingIds?: unknown;
}

type ConclusionCardsQuery = {
  ids: string;
};

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIds(rawIds: string[]): string[] {
  const ids: string[] = [];
  const seen: Record<string, true> = {};

  rawIds.forEach((rawId) => {
    const id = toTrimmedString(rawId);
    if (!id || seen[id]) {
      return;
    }

    seen[id] = true;
    ids.push(id);
  });

  return ids;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  value.forEach((item) => {
    const text = toTrimmedString(item);
    if (text) {
      result.push(text);
    }
  });

  return result;
}

function normalizeConclusionCardsResponse(
  raw: ConclusionCardsRawResponse,
): ConclusionCardsApiResponse {
  const items = Array.isArray(raw.items)
    ? raw.items
    : (Array.isArray(raw.list) ? raw.list : []);
  const totalValue = Number(raw.total);

  return {
    total: Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : items.length,
    items,
    missingIds: normalizeStringList(raw.missing_ids || raw.missingIds),
  };
}

export async function getConclusionCardsByIds(
  rawIds: string[],
): Promise<ConclusionCardsApiResponse> {
  const ids = normalizeIds(rawIds);
  if (ids.length <= 0) {
    return {
      total: 0,
      items: [],
      missingIds: [],
    };
  }

  const raw = await request<ConclusionCardsRawResponse, undefined, ConclusionCardsQuery>({
    url: "/api/v1/search/cards",
    method: "GET",
    query: {
      ids: ids.join(","),
    },
    authMode: "optional",
  });

  return normalizeConclusionCardsResponse(raw);
}
