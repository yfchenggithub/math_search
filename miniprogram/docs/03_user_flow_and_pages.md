# 03 — 用户流程与页面

## 页面地图

```
pages/index/index           启动页（透明跳板，立即 redirect）
    │
    └── pages/search/search ────── 主页（tabBar[0]）
            │
            ├── 点击结果卡片
            │     └── pages/detail/detail ── 详情页
            │           ├── 收藏开关
            │           └── PDF 查看/下载
            │
            ├── 点击底部 tab
            │     └── pages/mine/mine ────── 个人中心（tabBar[1]）
            │           ├── 点击"我的收藏"
            │           │     └── pages/favorites/favorites
            │           │           └── 点击条目 → pages/detail/detail
            │           ├── 点击"运行日志"
            │           │     └── pages/logs/logs
            │           │           └── 点击条目 → pages/runtime-log-detail/...
            │           └── 登录/登出按钮
            │
            └── 搜索框输入
                  └── 建议列表（内联在搜索页）
```

## 关键用户流程

### 流程 1：搜索→结果→详情

```
[搜索框输入] → 80ms防抖 → suggest 补全下拉
                            │
                            ├── 用户点选建议 → 填充搜索框 → 触发搜索
                            │
                            └── 用户继续输入 → 触发搜索
                                    │
                                    ▼
                            [结果卡片列表]
                              card: 公式预览 + 标题 + 标签 + 难度
                                    │
                                    ▼ 点击
                            [详情页]
                              ├── 核心公式（居中高亮）
                              ├── 结构化章节（定义/条件/结论/应用/陷阱）
                              ├── PDF 查看按钮（如果 pdfAvailable）
                              ├── ★ 收藏开关（isFavorited toggle）
                              └── 返回按钮 → 回到搜索结果（保持滚动位置和结果）
```

### 流程 2：收藏管理

```
[个人中心] → 点击"我的收藏(N)"
    │
    ▼
[收藏列表页]
  ├── 筛选：按模块
  ├── 排序：最近收藏 / 标题 A-Z
  ├── 批量管理：多选删除
  └── 点击条目 → 进入详情页
```

### 流程 3：登录认证

```
[个人中心] → 点击"微信登录"
    │
    ▼
wx.login() → code → POST /api/v1/auth/wechat-miniapp-login
    │                    │
    │                    ▼
    │              access_token + refresh_token
    │                    │
    │                    ▼
    │              存储到本地 Storage ▼ TokenStorage
    │                    │
    │                    ▼
    │              GET /api/v1/users/me → 获取头像+昵称
    │                    │
    ▼                    ▼
[个人中心刷新：显示用户信息 + 收藏计数]
```

### 流程 4：搜索流程（本地引擎路径）

```
输入 query: "tanx单调"
    │
    ▼
normalize(query) → "tanx 单调"
    │
    ├── buildQueryTokens → ["tanx单调", "tanx", "单调"]
    │
    ├── termIndex 精确匹配 → accumulator { T01: 1.0, T02: 0.72 }
    ├── prefixIndex 前缀匹配 → accumulator 合并（权重 0.72）
    │
    ├── (可选) suggestFallback 建议回退（权重 0.9）
    │
    ▼
finalizeResults → 排序：score↓ → rank↓ → hotScore↓ → id↑
    │
    ▼
top 20 → 适配为 SearchViewItem[]
    │
    ▼
[渲染结果卡片列表]
```

## 页面职责边界

| 页面 | 负责 | 不负责 |
|------|------|--------|
| search | 输入、建议、搜索触发、结果显示 | 不渲染详情、不管理收藏状态 |
| detail | 详情渲染、PDF、收藏开关 | 不做搜索、不做列表分页 |
| mine | 用户信息、入口导航 | 不做搜索、不做详情 |
| favorites | 收藏列表、筛选排序、批量管理 | 不渲染详情（跳转 detail 页） |
| logs | 日志列表、级别筛选 | 不处理日志写入 |
| runtime-log-detail | 单条日志详情查看/复制 | 不做日志分析 |

## 状态保持契约

- 从 detail 返回 search 时：保持搜索关键词、结果列表、滚动位置
- 从 favorites 返回 mine 时：个人中心正常显示（无需重新登录）
- Tab 切换不销毁页面实例（微信 tabBar 默认行为）
- 登录状态全局共享（auth-store 观察者模式），任一页面登录后其他页面自动感知
