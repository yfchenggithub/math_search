# 05 — 数据契约

版本规则：`major.minor` — major 变更表示不兼容，minor 变更向后兼容。

---

## 1. 搜索索引：search_bundle.js

### 文件位置

`miniprogram/data/index/search_bundle.js`

### 版本

当前 version: `1`

### 结构

```typescript
interface SearchBundle {
  version: number;
  generatedAt: string;          // ISO 8601 with timezone "2026-04-16T17:50:14+08:00"
  fieldMaskLegend: Record<string, number>;
  docs: Record<string, SearchDoc>;
  termIndex: Record<string, IndexEntry[]>;
  prefixIndex: Record<string, IndexEntry[]>;
  suggestions: SuggestionEntry[];
}

type IndexEntry = [docId: string, score: number, fieldMask: number];

type SuggestionEntry = [displayText: string, docId: string, score: number];

interface SearchDoc {
  id: string;
  module: string;               // e.g. "inequality", "trigonometry", "vector"
  moduleDir: string;            // e.g. "不等式", "三角函数", "向量"
  title: string;
  summary: string;
  category: string;
  tags: string[];
  coreFormula: string;          // LaTeX
  rank: number;                 // 1=核心, 2=重要, 3=一般
  difficulty: number;           // 1-5
  searchBoost: number;
  hotScore: number;
  examFrequency: number;
  examScore: number;
  isFavorited?: boolean;        // 运行时注入，非构建产物
}
```

### fieldMaskLegend 定义

| 字段 | 位值 | 含义 |
|------|------|------|
| title | 1 | 标题命中 |
| alias | 2 | 别名命中 |
| keyword | 4 | 关键词命中 |
| synonym | 8 | 同义词命中 |
| intent | 16 | 意图标签命中 |
| query_template | 32 | 查询模板命中 |
| ocr_keyword | 64 | OCR关键词命中 |
| category | 128 | 分类命中 |
| tag | 256 | 标签命中 |
| formula_token | 512 | 公式token命中 |
| formula | 1024 | 原始公式命中 |
| summary | 2048 | 摘要命中 |
| statement_fragment | 4096 | 条件片段命中 |
| usage | 8192 | 使用场景命中 |
| knowledge_node | 16384 | 知识节点命中 |
| pinyin | 32768 | 全拼命中 |
| pinyin_abbr | 65536 | 拼音首字母命中 |

### 索引构建规则

- `termIndex` key: 归一化后的完整词语（lowercase, trim）
- `prefixIndex` key: 词语的前缀，每个 key 最多 32 条倒排记录
- `suggestions` 条目按 displayText 排序

---

## 2. 内容数据：content/{module}.js

### 文件位置

`miniprogram/data/content/{module}.js`（如 `inequality.js`）

### 版本

display_version: `2`（当前）

### 结构

```typescript
interface ContentModule {
  [itemId: string]: ContentItem;  // e.g. "I001", "V002"
}

interface ContentItem {
  id: string;
  title: string;
  module: string;
  alias: string[];
  difficulty: number;            // 1-5
  category: string;
  tags: string[];
  core_summary: string;
  core_formula: string;          // LaTeX
  related_formulas: RelatedFormula[];
  variables: Variable[];
  conditions: string;
  conclusions: string;
  usage: UsageInfo;
  interactive: InteractiveAssets;
  assets: ContentAssets;
  shareConfig: ShareConfig;
  relations: ContentRelations;
  isPro: boolean;
  remarks: string;
  knowledgeNode: string;
  altNodes: string[];
  display_version: number;
  sections: ContentSection[];    // v2 结构化字段
  // 以下为 legacy 字段（v1），sections 存在时忽略
  statement?: string;
  explanation?: string;
  proof?: string;
  examples?: string;
  traps?: string;
  summary?: string;
}

interface ContentSection {
  key: string;
  title: string;
  layout: "text" | "list" | "theorem-list" | "legacy";
  blocks: ContentBlock[];
}

type ContentBlock =
  | { kind: "text"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "formula"; latex: string; display?: "block" | "centered" }
  | { kind: "theorem"; title: string; description: string; formula: string }
  | { kind: "mixed"; segments: { type: "text"|"math"; content: string }[] };
```

### ID 命名规则

`{模块首字母大写}{三位数字}`

- 不等式 I001, I002, ...
- 三角函数 T001, T002, ...
- 向量 V001, V002, ...

---

## 3. 远程 API 响应

### 搜索：GET /api/v1/search

```typescript
// 请求
interface SearchParams {
  q: string;
  page: number;      // 从 1 开始
  page_size: number; // 默认 20
}

// 响应
interface SearchResponse {
  query: string;
  total: number;
  page: number;
  page_size: number;
  items: SearchItem[];
  facets: {
    module?: FacetBucket[];
    difficulty?: FacetBucket[];
    tags?: FacetBucket[];
  };
}

interface SearchItem {
  id: string;
  title: string;
  module: string;
  category: string;
  tags: string[];
  coreFormula: string;
  summary: string;
  rank: number;
  difficulty: number;
  searchBoost: number;
  hotScore: number;
  examFrequency: number;
  examScore: number;
  score: number;            // 远程搜索得分
  is_favorited: boolean;
}

interface FacetBucket {
  key: string;
  count: number;
}
```

### 建议：GET /api/v1/suggest

```typescript
// 响应
interface SuggestResponse {
  query: string;
  total: number;
  empty_hint: string;
  items: SuggestItem[];
}

interface SuggestItem {
  id: string;
  title: string;
  subtitle: string;
  module: string;
  difficulty: number;
  tags: string[];
  match_type: string;     // "exact" | "prefix" | "contains"
  match_field: string;    // fieldMaskLegend 中的字段名
  matched_text: string;
  score: number;
  badge: string;
}
```

### 详情：GET /api/v1/conclusions/:id

```typescript
// 响应（Canonical v2）
interface ConclusionDetail {
  id: string;
  title: string;
  module: string;
  category: string;
  summary: string;
  summaryHtml: string;
  aliases: string[];
  tags: string[];
  difficulty: number;
  difficultyLabel: string;
  coreFormula: string;
  coreFormulaHtml: string;
  pdfUrl: string | null;
  pdfFilename: string | null;
  sections: ApiSection[];
  is_favorited: boolean;
}

interface ApiSection {
  key: string;
  title: string;
  layout: string;
  blocks: ApiBlock[];
}
```

### 标准信封

```typescript
interface ApiEnvelope<T> {
  code?: number;           // 0 或 200 表示成功
  success?: boolean;
  message?: string;
  msg?: string;
  error?: string;
  data?: T;
}
```

---

## 4. 认证

### 登录请求/响应

```typescript
// POST /api/v1/auth/wechat-miniapp-login
// 请求体
interface LoginRequest {
  code: string;         // wx.login() 返回的 code
}

// 响应
interface LoginResponse {
  access_token: string;
  token_type: string;   // "bearer"
  refresh_token: string;
  expires_in: number;   // 秒
}
```

### 用户信息

```typescript
// GET /api/v1/users/me
interface UserProfile {
  id: string;
  nickname: string;
  avatar_url?: string;
}
```

---

## 5. 收藏

```typescript
// GET /api/v1/favorites
interface FavoriteListResponse {
  items: FavoriteRecord[];
  total: number;
}

interface FavoriteRecord {
  id: string;           // conclusion id
  title: string;
  module: string;
  moduleLabel: string;
  tags: string[];
  summary: string;
  favoritedAt: string;  // ISO 8601
  pdfAvailable: boolean;
}

// POST /api/v1/favorites
// 请求体
interface AddFavoriteRequest {
  conclusion_id: string;
}

// DELETE /api/v1/favorites/:id
// 无请求体，id = conclusion_id
```

---

## 6. 本地存储 Key

| Key | 类型 | 用途 |
|-----|------|------|
| `auth_session` | AuthSession | 认证会话 |
| `auth_access_token` | string | 访问令牌 |
| `auth_refresh_token` | string | 刷新令牌 |
| `auth_token_expiry` | number | 令牌过期时间戳 |
| `pdf_cache_{filename}` | string | PDF 文件本地路径 |
| `pdf_cache_map` | Record<string, string> | PDF 缓存映射表 |

---

## 7. 数据版本规则

### 索引文件（search_bundle.js）

- build 脚本生成时写入 `version` 和 `generatedAt`
- 向后兼容的变更（新增文档、新增索引词）：minor++
- 不兼容的变更（修改结构、删除字段）：major++，同步更新所有消费端

### 内容文件（content/*.js）

- `display_version` 标记单个条目的数据格式版本
- v1: legacy 纯文本字段（statement, explanation, proof, examples, traps）
- v2: 结构化 sections + blocks（优先使用，legacy 作为回退）
- 同一模块内可混存 v1 和 v2 条目

### API 响应

- 当前无版本号，接口路径不做版本化
- 字段新增向后兼容（客户端忽略未知字段）
- 字段删除/重命名视为 breaking change，需前后端同步上线
