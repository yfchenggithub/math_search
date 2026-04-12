export type CanonicalSectionBlockType =
  | "rich_text"
  | "theorem_group"
  | "warning_group"
  | "summary"
  | "proof_steps"
  | "example_group"
  | string;

export interface CanonicalDetailToken {
  type?: "text" | "math_inline" | string;
  text?: string;
  latex?: string;
  [key: string]: unknown;
}

export interface CanonicalTheoremItem {
  title?: string;
  desc?: string;
  desc_tokens?: CanonicalDetailToken[];
  formula_latex?: string;
  latex?: string;
  [key: string]: unknown;
}

export interface CanonicalParagraphBlock {
  id?: string;
  type?: "paragraph";
  text?: string;
  tokens?: CanonicalDetailToken[];
  [key: string]: unknown;
}

export interface CanonicalMathBlock {
  id?: string;
  type?: "math_block";
  latex?: string;
  align?: "left" | "center" | string;
  [key: string]: unknown;
}

export interface CanonicalTheoremGroupBlock {
  id?: string;
  type?: "theorem_group";
  items?: CanonicalTheoremItem[];
  [key: string]: unknown;
}

export type CanonicalDetailBlock =
  | CanonicalParagraphBlock
  | CanonicalMathBlock
  | CanonicalTheoremGroupBlock
  | Record<string, unknown>;

export interface CanonicalDetailSection {
  key?: string;
  title?: string;
  block_type?: CanonicalSectionBlockType;
  blocks?: CanonicalDetailBlock[];
  [key: string]: unknown;
}

export interface CanonicalDetailVariable {
  name?: string;
  latex?: string;
  description?: string;
  required?: boolean;
  [key: string]: unknown;
}

export interface CanonicalConditionLikeItem {
  id?: string;
  title?: string;
  content?: CanonicalDetailToken[] | Record<string, unknown>[];
  [key: string]: unknown;
}

export interface CanonicalDetailPlain {
  statement?: string;
  explanation?: string;
  proof?: string;
  examples?: string;
  traps?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface CanonicalDetailContent {
  render_schema_version?: number;
  primary_formula?: string;
  variables?: CanonicalDetailVariable[];
  conditions?: CanonicalConditionLikeItem[];
  conclusions?: CanonicalConditionLikeItem[];
  sections?: CanonicalDetailSection[];
  plain?: CanonicalDetailPlain;
  [key: string]: unknown;
}

export interface CanonicalDetailMeta {
  title?: string;
  aliases?: string[];
  difficulty?: number | string;
  category?: string;
  tags?: string[];
  summary?: string;
  is_pro?: boolean;
  remarks?: string;
  [key: string]: unknown;
}

export interface CanonicalDetailIdentity {
  module?: string;
  knowledge_node?: string;
  alt_nodes?: string[];
  slug?: string;
  [key: string]: unknown;
}

export interface CanonicalDetailAssets {
  cover?: string | null;
  svg?: string | null;
  png?: string | null;
  pdf?: string | null;
  mp4?: string | null;
  extra?: unknown;
  [key: string]: unknown;
}

export interface CanonicalDetailExt {
  share?: Record<string, unknown>;
  relations?: Record<string, unknown>;
  exam?: Record<string, unknown>;
  extra?: {
    usage?: Record<string, unknown>;
    interactive?: Record<string, unknown>;
    related_formulas?: string[];
    legacy_display_version?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CanonicalConclusionDetail {
  id?: string;
  identity?: CanonicalDetailIdentity;
  meta?: CanonicalDetailMeta;
  content?: CanonicalDetailContent;
  assets?: CanonicalDetailAssets;
  ext?: CanonicalDetailExt;
  is_favorited?: boolean;
  pdf_url?: string | null;
  pdf_filename?: string | null;
  pdf_available?: boolean;
  [key: string]: unknown;
}

export interface CanonicalConclusionDetailEnvelope {
  data?: CanonicalConclusionDetail;
  [key: string]: unknown;
}
