# 04 — 搜索架构

## 总览

```
用户输入
    │
    ▼
┌──────────────────────────────────────┐
│  Layer 1: SUGGEST（建议层）          │
│  职责：补全用户输入，推荐搜索关键词     │
│  输入：部分输入字符                    │
│  输出：SearchSuggestion[] (≤8 条)     │
│  延迟目标：< 80ms                     │
│                                      │
│  数据源：                             │
│    远程 GET /api/v1/suggest?q=xxx    │
│    ↓ fallback                         │
│    本地 search_bundle.suggestions[]   │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Layer 2: CORE INDEX（核心索引层）    │
│  职责：查询词 → 候选结论 ID 集合      │
│  输入：normalized query + tokens      │
│  输出：{ docId → score } accumulator  │
│                                      │
│  数据源：                             │
│    termIndex: 精确词 → [{docId,score}]│
│    prefixIndex: 前缀 → [{docId,score}]│
│    fieldMask 解码参与得分计算的字段    │
│                                      │
│  权重规则：                           │
│    termIndex 匹配：1.0               │
│    prefixIndex 匹配：0.72             │
│    suggestFallback 兜底：0.9          │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Layer 3: RANK INDEX（排序层）        │
│  职责：对候选集合排序                 │
│  排序键（降序）：                      │
│    1. score（索引匹配得分）           │
│    2. rank（人工设定等级）            │
│    3. hotScore（热门权重）            │
│    4. id（字母序稳定排序）            │
│                                      │
│  数据源：search_bundle.docs[].rank    │
│         search_bundle.docs[].hotScore │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Layer 4: CONTENT（内容层）          │
│  职责：根据 ID 加载完整内容数据        │
│  输入：docId + module                 │
│  输出：SearchViewItem（卡片视图）     │
│        DetailDocumentView（详情视图） │
│                                      │
│  数据源：                             │
│    本地 content/*.js（registry 路由） │
│    远程 GET /api/v1/conclusions/:id   │
│    ↓ fallback                         │
│    本地 content 数据                   │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Layer 5: RENDER（渲染层）           │
│  职责：数据 → 微信原生组件渲染        │
│                                      │
│  搜索卡片：formula-card + category-tag│
│  建议列表：suggestion-list            │
│  详情内容：detail-section-renderer    │
│  数学公式：mixed-content-renderer     │
│            → KaTeX 编译              │
│            → math-render.ts 序列化    │
│            → rich-text 组件渲染       │
└──────────────────────────────────────┘
```

## 各层职责边界

### Layer 1: Suggest

| 属性 | 值 |
|------|-----|
| 触发条件 | 每次输入变化，query.length > 0 |
| 防抖 | 80ms（与 search 共用 debounce） |
| 输出上限 | 8 条 |
| 本地算法 | token 匹配加分：exact=300, prefix=200, contains=100 |
| 独立于搜索 | 建议失败不阻断搜索，搜索失败可用建议兜底 |

### Layer 2: Core Index

| 属性 | 值 |
|------|-----|
| 索引文件 | `data/index/search_bundle.js` |
| 索引结构 | `{ docs, termIndex, prefixIndex, suggestions }` |
| 查询预处理 | 小写、trim、多空格压缩、中文数字转换 |
| Token 构建 | 完整查询 + 去空格紧凑版 + 空格分割片段 + 2-gram |
| 最大 term 倒排长度 | prefixIndex 每个 key 限制 32 条 |
| fieldMask 字段 | title(1), alias(2), keyword(4), synonym(8), intent(16), query_template(32), ocr_keyword(64), category(128), tag(256), formula_token(512), formula(1024), summary(2048), statement_fragment(4096), usage(8192), knowledge_node(16384), pinyin(32768), pinyin_abbr(65536) |

### Layer 3: Rank

| 属性 | 值 |
|------|-----|
| rank 等级 | 数字越小优先级越高（1=核心结论, 2=重要, 3=一般） |
| hotScore | 热门度（可能来自远程 hot.json 合并） |
| 排序稳定性 | id 升序保证同分时结果顺序一致 |

### Layer 4: Content

| 属性 | 值 |
|------|-----|
| 模块注册 | `data/content/registry.ts` 映射 module → 数据导入 |
| 白名单 | `config/content.ts` 定义合法 module + id |
| 详情适配 | `utils/detail-content.ts` 将 raw data → DetailDocumentView |
| 远程格式 | Canonical v2 结构化详情（sections + blocks） |
| 本地格式 | display_version: 2 结构 + legacy 纯文本回退 |

### Layer 5: Render

| 组件 | 用途 |
|------|------|
| `formula-card` | 搜索结果卡片 |
| `suggestion-list` | 输入建议下拉 |
| `category-tag` | 分类/难度标签 |
| `mixed-content-renderer` | 行内 LaTeX + 文本混排（消费适配层产出的 html） |
| `detail-section-renderer` | 详情章节渲染（text/list/theorem-list/legacy） |
| `navigation-bar` | 自定义导航栏（适配胶囊按钮） |

### 详情混排策略（当前）

- structured（`display_version=2`）为权威来源，text/math 边界由数据显式给出。
- 适配层（`utils/detail-content.ts`）负责把 structured `segments` 转成最终 `block.html`，组件层不再做公式猜测。
- 对明显长推导公式会做“行内 → 独立公式块”提升，优先保证移动端可读性和布局稳定。
- legacy 文本才走启发式 mixed 渲染（`renderMixedTextHtml`）作为兼容回退。
- 详见数据契约文档：`05 — 数据契约` 中“文本+公式混排处理约定（当前实现）”。

## 双源切换机制

```
                     USE_REMOTE_API ?
                    /              \
                  true             false
                   |                 |
            远程 API 请求        本地 searchWithDebug()
                   |                 |
            成功？/ 失败？        直接返回本地结果
            /          \
         成功          失败
           |             |
      远程结果      ENABLE_LOCAL_FALLBACK ?
                        /              \
                      true             false
                       |                 |
                本地回退结果          返回空结果/错误
```

## 关键设计决策

1. **为什么是单文件索引（search_bundle.js）而非多层 JSON？**
   - 原始设计：core_index.json + suggest_index.json + rank_index.json + content/*.json
   - 实际演变为：所有索引打包为一个 search_bundle.js
   - 原因：减少加载次数，构建脚本统一生成，小程序包体积可控
   - 参见 ADR-0001

2. **为什么 prefixIndex 限制 32 条？**
   - 控制每个前缀的倒排列表大小，避免短前缀（如 "a"、"1"）匹配过多无用结果
   - 32 是一个经验值：保证覆盖率的同时控制计算复杂度

3. **为什么搜索和建议共享同一个 debounce（80ms）？**
   - 防止输入快速变化时发送冗余请求
   - 80ms 是手感阈值：低于此值用户感知不到延迟，高于此值会感觉"卡"
