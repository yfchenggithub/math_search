type SearchIndexTuple = [string, number, number];
type SearchSuggestionTuple = [string, string, number];

export interface SearchDoc {
  id: string;
  module: string;
  moduleDir: string;
  title: string;
  summary?: string;
  category?: string;
  tags?: string[];
  coreFormula?: string;
  rank?: number;
  difficulty?: number;
  searchBoost?: number;
  hotScore?: number;
  examFrequency?: number;
  examScore?: number;
}

interface SearchBundle {
  version: number;
  generatedAt: string;
  fieldMaskLegend: Record<string, number>;
  docs: Record<string, SearchDoc>;
  termIndex: Record<string, SearchIndexTuple[]>;
  prefixIndex: Record<string, SearchIndexTuple[]>;
  suggestions: SearchSuggestionTuple[];
}

export interface SearchSuggestion {
  text: string;
  id: string;
  score: number;
}

export interface SearchMatchReason {
  source: "term" | "prefix" | "suggestion";
  token: string;
  score: number;
  fields: string[];
}

export interface SearchResult {
  id: string;
  score: number;
  doc: SearchDoc;
  reasons: SearchMatchReason[];
  matchedFields: string[];
}

export interface SearchDebugMatch {
  id: string;
  title: string;
  score: number;
  matchedFieldsLabel: string;
  reasonSummary: string;
}

export interface SearchDebugInfo {
  normalizedQuery: string;
  lookupTokens: string[];
  termHitCount: number;
  prefixHitCount: number;
  suggestionHitCount: number;
  resultCount: number;
  fallbackUsed: boolean;
  topSuggestions: SearchSuggestion[];
  topMatches: SearchDebugMatch[];
}

export interface SearchResponse {
  query: string;
  normalizedQuery: string;
  suggestions: SearchSuggestion[];
  results: SearchResult[];
  debug: SearchDebugInfo;
}

export interface SearchMeta {
  totalDocs: number;
  hotDocCount: number;
  highExamFrequencyCount: number;
  categories: string[];
  generatedAt: string;
}

interface SearchAccumulator {
  id: string;
  score: number;
  doc: SearchDoc;
  reasons: SearchMatchReason[];
  matchedFieldMap: Record<string, true>;
}

type DebugWx = WechatMiniprogram.Wx & {
  debugSearchBundle?: SearchBundle;
  debugSearchEngine?: SearchResponse;
};

const MAX_SUGGEST = 8;
const MAX_RESULTS = 20;
const MAX_INDEX_SCAN = 32;
const PREFIX_WEIGHT = 0.72;
const SUGGESTION_FALLBACK_WEIGHT = 0.9;

let SEARCH_BUNDLE: SearchBundle | null = null;
let FIELD_MASK_ENTRIES: Array<{ name: string; mask: number }> = [];

function isValidSearchBundle(bundle: Partial<SearchBundle> | null): bundle is SearchBundle {
  return !!bundle
    && !!bundle.docs
    && !!bundle.termIndex
    && !!bundle.prefixIndex
    && !!bundle.suggestions
    && !!bundle.fieldMaskLegend;
}

export function initSearchEngine() {
  if (SEARCH_BUNDLE) {
    return;
  }

  try {
    const loadedBundle = require("../data/index/search_bundle.js") as Partial<SearchBundle>;

    if (!isValidSearchBundle(loadedBundle)) {
      throw new Error("Invalid search bundle payload");
    }

    SEARCH_BUNDLE = loadedBundle;
    FIELD_MASK_ENTRIES = Object.keys(SEARCH_BUNDLE.fieldMaskLegend)
      .map((name) => ({
        name,
        mask: SEARCH_BUNDLE!.fieldMaskLegend[name],
      }))
      .sort((left, right) => left.mask - right.mask);

    if (typeof wx !== "undefined") {
      (wx as DebugWx).debugSearchBundle = SEARCH_BUNDLE;
    }

    console.log("Search bundle ready");
  } catch (error) {
    SEARCH_BUNDLE = null;
    FIELD_MASK_ENTRIES = [];
    console.error("Search bundle init failed", error);
  }
}

export function getSearchMeta(): SearchMeta {
  const bundle = getBundle();

  if (!bundle) {
    return {
      totalDocs: 0,
      hotDocCount: 0,
      highExamFrequencyCount: 0,
      categories: [],
      generatedAt: "",
    };
  }

  const categories: string[] = [];
  const categorySeen: Record<string, true> = {};
  let hotDocCount = 0;
  let highExamFrequencyCount = 0;

  for (const id in bundle.docs) {
    const doc = bundle.docs[id];

    if ((doc.hotScore || 0) >= 80) {
      hotDocCount += 1;
    }

    if ((doc.examFrequency || 0) >= 0.8) {
      highExamFrequencyCount += 1;
    }

    if (doc.category && !categorySeen[doc.category]) {
      categorySeen[doc.category] = true;
      categories.push(doc.category);
    }
  }

  return {
    totalDocs: Object.keys(bundle.docs).length,
    hotDocCount,
    highExamFrequencyCount,
    categories,
    generatedAt: bundle.generatedAt,
  };
}

export function getSearchDocument(id: string): SearchDoc | null {
  const bundle = getBundle();

  if (!bundle || !bundle.docs[id]) {
    return null;
  }

  return bundle.docs[id];
}

export function suggest(query: string): SearchSuggestion[] {
  const bundle = getBundle();
  const normalizedQuery = normalize(query);

  if (!bundle || !normalizedQuery) {
    return [];
  }

  return collectSuggestions(bundle, normalizedQuery, MAX_SUGGEST);
}

export function search(query: string): string[] {
  return searchWithDebug(query).results.map((item) => item.id);
}

export function searchWithDebug(query: string): SearchResponse {
  const bundle = getBundle();
  const normalizedQuery = normalize(query);

  if (!bundle || !normalizedQuery) {
    return createEmptyResponse(query, normalizedQuery);
  }

  const suggestions = collectSuggestions(bundle, normalizedQuery, MAX_SUGGEST);
  const lookupTokens = buildLookupTokens(normalizedQuery);
  const accumulatorMap: Record<string, SearchAccumulator> = {};

  let termHitCount = 0;
  let prefixHitCount = 0;

  for (let index = 0; index < lookupTokens.length; index += 1) {
    const token = lookupTokens[index];
    const termEntries = bundle.termIndex[token] || [];
    const prefixEntries = bundle.prefixIndex[token] || [];

    termHitCount += termEntries.length;
    prefixHitCount += prefixEntries.length;

    mergeIndexEntries(accumulatorMap, bundle, termEntries, "term", token, 1);
    mergeIndexEntries(accumulatorMap, bundle, prefixEntries, "prefix", token, PREFIX_WEIGHT);
  }

  let fallbackUsed = false;

  if (Object.keys(accumulatorMap).length === 0 && suggestions.length > 0) {
    fallbackUsed = true;
    mergeSuggestionEntries(accumulatorMap, bundle, suggestions, SUGGESTION_FALLBACK_WEIGHT);
  }

  const results = finalizeResults(accumulatorMap);
  const debug: SearchDebugInfo = {
    normalizedQuery,
    lookupTokens,
    termHitCount,
    prefixHitCount,
    suggestionHitCount: suggestions.length,
    resultCount: results.length,
    fallbackUsed,
    topSuggestions: suggestions.slice(0, 5),
    topMatches: buildTopMatches(results),
  };

  const response: SearchResponse = {
    query,
    normalizedQuery,
    suggestions,
    results,
    debug,
  };

  if (typeof wx !== "undefined") {
    (wx as DebugWx).debugSearchEngine = response;
  }

  return response;
}

function createEmptyResponse(query: string, normalizedQuery: string): SearchResponse {
  return {
    query,
    normalizedQuery,
    suggestions: [],
    results: [],
    debug: {
      normalizedQuery,
      lookupTokens: [],
      termHitCount: 0,
      prefixHitCount: 0,
      suggestionHitCount: 0,
      resultCount: 0,
      fallbackUsed: false,
      topSuggestions: [],
      topMatches: [],
    },
  };
}

function getBundle(): SearchBundle | null {
  if (!SEARCH_BUNDLE) {
    initSearchEngine();
  }

  return SEARCH_BUNDLE;
}

function collectSuggestions(bundle: SearchBundle, normalizedQuery: string, limit: number): SearchSuggestion[] {
  const normalizedNeedles = buildLookupTokens(normalizedQuery);
  const seen: Record<string, true> = {};
  const matches: SearchSuggestion[] = [];

  for (let index = 0; index < bundle.suggestions.length; index += 1) {
    const tuple = bundle.suggestions[index];
    const text = tuple[0];
    const docId = tuple[1];
    const baseScore = tuple[2];
    const normalizedText = normalize(text);
    const matchBonus = getSuggestionMatchBonus(normalizedText, normalizedNeedles);

    if (matchBonus === 0) {
      continue;
    }

    const dedupeKey = `${text}::${docId}`;

    if (seen[dedupeKey]) {
      continue;
    }

    seen[dedupeKey] = true;

    matches.push({
      text,
      id: docId,
      score: baseScore + matchBonus,
    });
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.text.length - right.text.length;
  });

  return matches.slice(0, limit);
}

function getSuggestionMatchBonus(normalizedText: string, needles: string[]): number {
  for (let index = 0; index < needles.length; index += 1) {
    const needle = needles[index];

    if (!needle) {
      continue;
    }

    if (normalizedText === needle) {
      return 300;
    }

    if (normalizedText.startsWith(needle)) {
      return 200;
    }

    if (normalizedText.includes(needle)) {
      return 100;
    }
  }

  return 0;
}

function buildLookupTokens(normalizedQuery: string): string[] {
  const parts = normalizedQuery.split(/\s+/);
  const compact = normalizedQuery.replace(/\s+/g, "");
  const tokens = [normalizedQuery, compact].concat(parts);
  const seen: Record<string, true> = {};
  const result: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token || seen[token]) {
      continue;
    }

    seen[token] = true;
    result.push(token);
  }

  return result;
}

function mergeIndexEntries(
  accumulatorMap: Record<string, SearchAccumulator>,
  bundle: SearchBundle,
  entries: SearchIndexTuple[],
  source: "term" | "prefix",
  token: string,
  weight: number,
) {
  const scanLimit = Math.min(entries.length, MAX_INDEX_SCAN);

  for (let index = 0; index < scanLimit; index += 1) {
    const entry = entries[index];
    const docId = entry[0];
    const baseScore = entry[1];
    const fieldMask = entry[2];
    const doc = bundle.docs[docId];

    if (!doc) {
      continue;
    }

    const accumulator = getAccumulator(accumulatorMap, docId, doc);
    const weightedScore = Math.round(baseScore * weight);
    const fields = decodeFieldMask(fieldMask);

    accumulator.score += weightedScore;

    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      accumulator.matchedFieldMap[fields[fieldIndex]] = true;
    }

    if (accumulator.reasons.length < 6) {
      accumulator.reasons.push({
        source,
        token,
        score: weightedScore,
        fields,
      });
    }
  }
}

function mergeSuggestionEntries(
  accumulatorMap: Record<string, SearchAccumulator>,
  bundle: SearchBundle,
  suggestions: SearchSuggestion[],
  weight: number,
) {
  const seenDocIds: Record<string, true> = {};

  for (let index = 0; index < suggestions.length; index += 1) {
    const suggestion = suggestions[index];
    const doc = bundle.docs[suggestion.id];

    if (!doc || seenDocIds[suggestion.id]) {
      continue;
    }

    seenDocIds[suggestion.id] = true;

    const accumulator = getAccumulator(accumulatorMap, suggestion.id, doc);
    const weightedScore = Math.round(suggestion.score * weight);

    accumulator.score += weightedScore;
    accumulator.matchedFieldMap.suggestions = true;

    if (accumulator.reasons.length < 6) {
      accumulator.reasons.push({
        source: "suggestion",
        token: suggestion.text,
        score: weightedScore,
        fields: ["suggestions"],
      });
    }
  }
}

function getAccumulator(
  accumulatorMap: Record<string, SearchAccumulator>,
  docId: string,
  doc: SearchDoc,
): SearchAccumulator {
  if (!accumulatorMap[docId]) {
    accumulatorMap[docId] = {
      id: docId,
      score: 0,
      doc,
      reasons: [],
      matchedFieldMap: {},
    };
  }

  return accumulatorMap[docId];
}

function finalizeResults(accumulatorMap: Record<string, SearchAccumulator>): SearchResult[] {
  const results: SearchResult[] = [];

  for (const id in accumulatorMap) {
    const accumulator = accumulatorMap[id];
    const matchedFields = Object.keys(accumulator.matchedFieldMap);

    results.push({
      id: accumulator.id,
      score: accumulator.score,
      doc: accumulator.doc,
      reasons: accumulator.reasons,
      matchedFields,
    });
  }

  results.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const rightRank = right.doc.rank || 0;
    const leftRank = left.doc.rank || 0;

    if (rightRank !== leftRank) {
      return rightRank - leftRank;
    }

    const rightHotScore = right.doc.hotScore || 0;
    const leftHotScore = left.doc.hotScore || 0;

    if (rightHotScore !== leftHotScore) {
      return rightHotScore - leftHotScore;
    }

    return left.id.localeCompare(right.id);
  });

  return results.slice(0, MAX_RESULTS);
}

function buildTopMatches(results: SearchResult[]): SearchDebugMatch[] {
  return results.slice(0, 5).map((result) => ({
    id: result.id,
    title: result.doc.title,
    score: result.score,
    matchedFieldsLabel: result.matchedFields.length > 0
      ? result.matchedFields.slice(0, 4).join(" / ")
      : "unknown",
    reasonSummary: summarizeReasons(result.reasons),
  }));
}

function summarizeReasons(reasons: SearchMatchReason[]): string {
  if (reasons.length === 0) {
    return "no-reason";
  }

  return reasons
    .slice(0, 3)
    .map((reason) => {
      const fieldLabel = reason.fields.length > 0
        ? `@${reason.fields.slice(0, 2).join("/")}`
        : "";

      return `${reason.source}:${reason.token}${fieldLabel}`;
    })
    .join(" | ");
}

function decodeFieldMask(fieldMask: number): string[] {
  const fields: string[] = [];

  for (let index = 0; index < FIELD_MASK_ENTRIES.length; index += 1) {
    const entry = FIELD_MASK_ENTRIES[index];

    if ((fieldMask & entry.mask) === entry.mask) {
      fields.push(entry.name);
    }
  }

  return fields;
}

function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}
