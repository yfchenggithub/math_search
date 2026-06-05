# 结论卡片公式预览统一链路

## 背景

结论卡片在多个页面出现：

- 搜索页搜索结果
- 搜索首页推荐区：热门结论、最近更新、常用模型
- 结论管理
- 我的收藏
- 最近浏览

这些卡片都使用同一个小程序组件：

```text
miniprogram/components/conclusion-card
```

组件本身只负责展示，不负责从后端字段推导公式预览。它根据以下字段决定是否显示公式预览：

```ts
previewType
previewHtml
previewText
previewImage
previewImageWidth
previewImageHeight
previewFallbackText
```

如果调用方没有正确生成这些字段，卡片就只会显示标题、摘要、标签，不会显示公式预览。

## 后端数据源

当前 `/api/v1/admin/conclusions` 不是直接读小程序本地数据，也不是读 SQLAlchemy 的 `conclusions` 表，而是复用后端搜索索引。

链路如下：

```text
D:\mathnode_backend\app\api\v1\conclusions.py
  -> list_admin_conclusions
  -> SearchService.search(...)
  -> MemoryIndexStore.search(...)
  -> app/data/backend_search_index.json
```

默认索引路径由后端配置提供：

```text
D:\mathnode_backend\app\core\config.py
INDEX_JSON_PATH = "app/data/backend_search_index.json"
```

索引中的 `coreFormula` 可能是字符串，也可能是对象。例如 `S001`：

```json
{
  "id": "S001",
  "title": "有限集合子集计数公式",
  "coreFormula": {
    "latex": "\\sum_{k=0}^n \\mathrm{C}_n^k = 2^n",
    "type": "math_image",
    "asset": {
      "png": "/static/formulas/S001/c19ed99cb8bf6982@3x.png",
      "webp": "/static/formulas/S001/c19ed99cb8bf6982@3x.webp",
      "display_width_px": 78,
      "display_height_px": 46
    }
  }
}
```

旧问题的根因是部分页面只把 `coreFormula` 当字符串处理，遇到对象型公式时会丢失公式预览信息。

## 统一前端入口

统一逻辑放在：

```text
miniprogram/utils/conclusion-card-preview.ts
```

核心导出：

```ts
buildConclusionCardPreview(options)
resolveConclusionCardFormulaSource(source, preferred)
normalizeConclusionFormulaSource(value)
```

`buildConclusionCardPreview` 的职责是把不同来源的数据统一转换为 `conclusion-card` 需要的 preview props。

输入示例：

```ts
const preview = buildConclusionCardPreview({
  source: item.coreFormula,
  preferred: item,
  fallbackText: item.summary,
});
```

输出示例：

```ts
{
  previewType: "image",
  previewHtml: "",
  previewText: "",
  previewImage: "https://ok-shuxue.icu/static/formulas/S001/c19ed99cb8bf6982@3x.png",
  previewImageWidth: 78,
  previewImageHeight: 46,
  previewFallbackText: "\\sum_{k=0}^n \\mathrm{C}_n^k = 2^n"
}
```

## 预览生成优先级

统一工具按以下顺序生成预览：

1. 公式图片

   优先使用 `coreFormula.asset.png`，其次 `coreFormula.asset.webp`，再其次已有的 `previewImage / preview_image / previewImageUrl / preview_image_url`。

   相对路径会通过 `buildAbsoluteApiUrl` 补成完整 URL。

2. 已有 HTML

   如果没有图片，但有 `previewHtml / preview_html`，使用 HTML 预览。

3. 已有文本

   如果没有图片和 HTML，但有 `previewText / preview_text`，使用文本预览。

4. LaTeX 渲染

   如果只有 LaTeX，则调用 `renderMath(latex, true)` 生成 KaTeX HTML。

5. 无预览

   如果以上都没有，则返回 `previewType: "none"`。

## 支持的公式字段

统一工具会识别这些公式来源：

```text
coreFormula
core_formula
formula
coreFormulaLatex
core_formula_latex
formulaLatex
formula_latex
```

对象型公式会识别：

```text
latex
text
source
asset.png
asset.webp
asset.display_width_px
asset.display_height_px
asset.width_px
asset.height_px
asset.scale
```

## 页面接入点

### 搜索结果

文件：

```text
miniprogram/pages/search/search.ts
```

入口：

```ts
buildSearchCards(...)
```

每个搜索结果会调用：

```ts
buildConclusionCardPreview({
  source: formulaSource,
  preferred: item,
  fallbackText: summary,
});
```

### 热门结论、最近更新、常用模型

文件：

```text
miniprogram/pages/search/search.ts
```

入口：

```ts
buildHomeRecommendationSeeds(...)
```

推荐区三个分组都来自同一批 `HomeRecommendSeed`：

```text
热门结论 -> hotSeeds -> toHomeRecommendItem
最近更新 -> recentSeeds -> toHomeRecommendItem
常用模型 -> commonSeeds -> toHomeRecommendItem
```

因此这三个分组已经共用同一套公式预览逻辑。

### 结论管理

文件：

```text
miniprogram/services/api/conclusions-admin-api.ts
miniprogram/pages/conclusion-management/conclusion-management.ts
```

接口适配阶段先调用：

```ts
resolveConclusionCardFormulaSource(...)
buildConclusionCardPreview(...)
```

页面映射阶段也调用：

```ts
buildConclusionCardPreview({
  source: record.coreFormula,
  preferred: record,
  fallbackText: summary,
});
```

这样 `/api/v1/admin/conclusions` 返回对象型 `coreFormula` 时，也能显示和搜索页一致的公式图片预览。

### 我的收藏

文件：

```text
miniprogram/pages/favorites/favorites.ts
```

收藏页先用 `resolveConclusionCards(ids)` 获取或补齐卡片缓存，再调用：

```ts
buildConclusionCardPreview({
  source: card?.coreFormulaLatex,
  preferred: card,
  fallbackText: summary,
});
```

### 最近浏览

文件：

```text
miniprogram/pages/recent-browse/recent-browse.ts
```

最近浏览同样先用 `resolveConclusionCards(ids)` 获取卡片缓存，再调用：

```ts
buildConclusionCardPreview({
  source: card?.coreFormulaLatex,
  preferred: card,
  fallbackText: summary,
});
```

## 卡片组件渲染规则

文件：

```text
miniprogram/components/conclusion-card/conclusion-card.wxml
```

渲染顺序：

```text
previewType === "html"  && previewHtml  -> rich-text
previewType === "text"  && previewText  -> text
previewType === "image" && previewImage -> image
image 加载失败且有 fallback       -> text fallback
html/text 缺字段且有 fallback     -> text fallback
```

页面侧不要直接写公式预览 DOM，只需要传入统一 preview props。

## 排查公式预览不显示

按顺序检查：

1. 后端返回项是否有 `coreFormula`、`core_formula`、`formula` 或 `preview*` 字段。
2. 如果 `coreFormula` 是对象，确认是否有 `latex` 和 `asset.png/webp`。
3. 小程序端是否经过 `buildConclusionCardPreview`。
4. 传给 `conclusion-card` 的 `previewType` 是否为 `image/html/text`。
5. 图片路径是否能通过 `buildAbsoluteApiUrl` 补成可访问地址。
6. 图片加载失败时，`previewFallbackText` 是否有值。

## 验证命令

类型检查：

```bash
npx -p typescript@5.4.5 tsc --noEmit
```

预期：

```text
搜索结果、热门结论、最近更新、常用模型、结论管理、我的收藏、最近浏览
同一条结论显示相同的公式预览。
```
