import { normalizeConclusionCardItem } from "../services/conclusion-card-cache";
import { renderMath } from "./math-render";

export type ConclusionCardPreviewType = "html" | "text" | "image" | "none";

export type ConclusionCardPreviewFields = {
  previewType: ConclusionCardPreviewType;
  previewHtml: string;
  previewText: string;
  previewImage: string;
  previewImageWidth: number;
  previewImageHeight: number;
  previewFallbackText: string;
};

type BuildConclusionCardPreviewOptions = {
  source?: unknown;
  preferred?: unknown;
  fallbackText?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function toTrimmedString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
}

function normalizeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function readPreferredField(preferred: unknown, keys: string[]): unknown {
  if (!isPlainObject(preferred)) {
    return undefined;
  }

  for (let index = 0; index < keys.length; index += 1) {
    const value = preferred[keys[index]];
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

export function normalizeConclusionFormulaSource(value: unknown): string {
  const text = toTrimmedString(value);
  if (text) {
    return text;
  }

  if (!isPlainObject(value)) {
    return "";
  }

  return toTrimmedString(value.latex || value.text || value.source);
}

export function resolveConclusionCardFormulaSource(
  source?: unknown,
  preferred?: unknown,
): string {
  const cardItem = normalizeConclusionCardItem(preferred);
  return cardItem?.coreFormulaLatex
    || normalizeConclusionFormulaSource(source)
    || normalizeConclusionFormulaSource(
      readPreferredField(preferred, [
        "coreFormula",
        "core_formula",
        "formula",
        "coreFormulaLatex",
        "core_formula_latex",
        "formulaLatex",
        "formula_latex",
      ]),
    );
}

export function buildConclusionCardPreview(
  options: BuildConclusionCardPreviewOptions,
): ConclusionCardPreviewFields {
  const { source, preferred, fallbackText } = options;
  const cardItem = normalizeConclusionCardItem(preferred);
  const formulaSource = cardItem?.coreFormulaLatex
    || normalizeConclusionFormulaSource(source)
    || normalizeConclusionFormulaSource(
      readPreferredField(preferred, [
        "coreFormula",
        "core_formula",
        "formula",
        "coreFormulaLatex",
        "core_formula_latex",
        "formulaLatex",
        "formula_latex",
      ]),
    );
  const previewImage = toTrimmedString(cardItem?.previewImage)
    || toTrimmedString(
      readPreferredField(preferred, [
        "previewImage",
        "preview_image",
        "previewImageUrl",
        "preview_image_url",
      ]),
    );
  const previewImageWidth = normalizeNumber(cardItem?.previewImageWidth)
    || normalizeNumber(readPreferredField(preferred, ["previewImageWidth", "preview_image_width"]));
  const previewImageHeight = normalizeNumber(cardItem?.previewImageHeight)
    || normalizeNumber(readPreferredField(preferred, ["previewImageHeight", "preview_image_height"]));
  const previewHtml = toTrimmedString(readPreferredField(preferred, ["previewHtml", "preview_html"]));
  const previewText = toTrimmedString(readPreferredField(preferred, ["previewText", "preview_text"]))
    || toTrimmedString(cardItem?.previewText);
  const previewFallbackText = toTrimmedString(
    readPreferredField(preferred, ["previewFallbackText", "preview_fallback_text"]),
  )
    || toTrimmedString(cardItem?.previewFallbackText)
    || formulaSource
    || toTrimmedString(fallbackText);

  if (previewImage) {
    return {
      previewType: "image",
      previewHtml: "",
      previewText: "",
      previewImage,
      previewImageWidth,
      previewImageHeight,
      previewFallbackText,
    };
  }

  if (previewHtml) {
    return {
      previewType: "html",
      previewHtml,
      previewText: "",
      previewImage: "",
      previewImageWidth: 0,
      previewImageHeight: 0,
      previewFallbackText,
    };
  }

  if (previewText) {
    return {
      previewType: "text",
      previewHtml: "",
      previewText,
      previewImage: "",
      previewImageWidth: 0,
      previewImageHeight: 0,
      previewFallbackText: previewFallbackText || previewText,
    };
  }

  if (!formulaSource) {
    return {
      previewType: "none",
      previewHtml: "",
      previewText: "",
      previewImage: "",
      previewImageWidth: 0,
      previewImageHeight: 0,
      previewFallbackText: "",
    };
  }

  const mathResult = renderMath(formulaSource, true);
  return {
    previewType: mathResult.html ? "html" : "text",
    previewHtml: mathResult.html,
    previewText: mathResult.html ? "" : mathResult.source,
    previewImage: "",
    previewImageWidth: 0,
    previewImageHeight: 0,
    previewFallbackText: mathResult.source,
  };
}
