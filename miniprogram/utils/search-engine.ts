/**
 * ========================================================
 * 🚀 search-engine.ts（TypeScript 最终版）
 * ========================================================
 *
 * 【设计目标】
 *
 * 1️⃣ 极致搜索性能（< 50ms）
 * 2️⃣ 单索引查询（core_index）
 * 3️⃣ 支持：
 *      - 精确匹配
 *      - 前缀匹配（已在构建阶段完成）
 *      - 拼音搜索
 *      - 公式搜索
 *
 * --------------------------------------------------------
 * 【核心思想】
 *
 * ❗ 不在前端做复杂逻辑
 * ❗ 所有计算在 Python 构建阶段完成
 *
 * ========================================================
 */

import { loadContent } from "../utils/data-loader";

type CoreIndex = Record<string, string[]>;
type RankIndex = Record<string, number>;

let CORE_INDEX: CoreIndex | null = null;
let RANK_INDEX: RankIndex | null = null;
let SUGGEST_LIST: string[] = [];

// 最大返回数量（控制体验）, 输入时下方出现下拉提示
const MAX_SUGGEST = 8;

/**
 * 初始化
 */
export function initSearchEngine() {
  if (CORE_INDEX) return;

  try {
    CORE_INDEX = loadContent("core_index");
    RANK_INDEX = loadContent("rank_index");
    SUGGEST_LIST = loadContent("suggest_index");
    // 上线后需要删除的语句
    (wx as any).debugIndex = { CORE_INDEX, RANK_INDEX, SUGGEST_LIST };
    console.log("Search Engine Ready");
  } catch (e) {
    console.error("Init failed", e);
  }
}

/**
 * 这里搜索到空页面时，系统推荐的结论
 */
export function fallbackSearch(q: string): string[] {
  if (!CORE_INDEX) return [];

  // 用 suggest 做兜底
  const related = SUGGEST_LIST.filter((w) => w.includes(q[0])).slice(0, 5);

  let result: string[] = [];

  for (const word of related) {
    result = result.concat(CORE_INDEX[word] || []);
  }

  return Array.from(new Set(result)).slice(0, 20);
}

/**
 * 搜索
 */
export function search(query: string): string[] {
  if (!query || !CORE_INDEX) return [];

  const q = normalize(query);

  let ids = CORE_INDEX[q];

  if (!ids || ids.length === 0) {
    ids = fallbackSearch(q);
  }

  return rank(ids);
}

/**
 * 排序（可扩展） 排序系统（rank_index）
 */
function rank(ids: string[]): string[] {
  if (!RANK_INDEX) return ids;

  return [...ids].sort((a, b) => {
    const sa = RANK_INDEX![a] || 0;
    const sb = RANK_INDEX![b] || 0;
    return sb - sa;
  });
}

/**
 * 自动补全（前端轻量实现）
 */
export function suggest(query: string): string[] {
  if (!query) return [];

  const q = normalize(query);
  const prefixMatches: string[] = [];
  const fuzzyMatches: string[] = [];

  for (let i = 0; i < SUGGEST_LIST.length; i++) {
    const item = SUGGEST_LIST[i];

    const lowerItem = item.toLowerCase();

    // ✅ 前缀匹配（最高优先级）
    if (lowerItem.startsWith(q)) {
      prefixMatches.push(item);
    }
    // ✅ 包含匹配（次优）
    else if (lowerItem.includes(q)) {
      fuzzyMatches.push(item);
    }

    // ✅ 提前截断（性能关键）
    if (prefixMatches.length >= MAX_SUGGEST) break;
  }

  // ✅ 排序策略（关键体验）
  const result = [...prefixMatches, ...fuzzyMatches].slice(0, MAX_SUGGEST);

  return result;
  // 简单前缀匹配（超快）
  // return SUGGEST_LIST.filter((word) => word.startsWith(q)).slice(0, 10);
}

/**
 * 标准化
 */
function normalize(q: string): string {
  return q.trim().toLowerCase();
}
