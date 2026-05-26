# 08 — 发布与运维

## 发布步骤

### 前置检查

- [ ] `docs/07_test_and_acceptance.md` 回归清单全部 [M] 项通过
- [ ] 索引文件 `search_bundle.js` version 号已更新（如有数据变更）
- [ ] 内容文件 `content/*.js` display_version 已标记（如有新条目）
- [ ] `config/api.ts` 中的开关处于预期状态
- [ ] 运行日志无持续 ERROR（在 logs 页面检查）
- [ ] 真机测试通过（iOS + Android 各一台）

### 发布操作

1. **微信开发者工具 → 上传代码**
   - 填写版本号（如 v1.0.1）和版本描述
   - 版本号规则：`v{major}.{minor}.{patch}`
     - major: 大功能上线/不兼容变更
     - minor: 新功能/新模块
     - patch: bug fix/体验优化

2. **微信公众平台 → 版本管理**
   - 选择刚上传的版本
   - 设为"体验版" → 内部测试人员扫码验证
   - 验证通过后提交审核

3. **审核通过后 → 发布上线**
   - 灰度发布：先 5% → 观察 1h → 50% → 全量
   - 如无灰度能力：直接全量，密切监控前 30 分钟

### 发布后验证

- [ ] 搜索主页打开正常
- [ ] 搜索功能正常（远程 API 路径）
- [ ] 详情页正常加载
- [ ] 登录流程正常
- [ ] 无大量 ERROR 日志

---

## 配置项清单

### 编译时配置（`config/api.ts`）

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `baseURL` | `https://ok-shuxue.icu/` | API 基础 URL |
| `BASE_URL_OVERRIDE` | `""` | 手动覆盖（本地调试用） |
| `timeout` | `10000` | 请求超时（ms） |
| `SEARCH_API_CONFIG.USE_REMOTE_API` | `true` | 远程搜索开关 |
| `SEARCH_API_CONFIG.PAGE_SIZE` | `20` | 搜索结果每页条数 |
| `DETAIL_API_CONFIG.USE_REMOTE_API` | `true` | 远程详情开关 |
| `DETAIL_API_CONFIG.ENABLE_LOCAL_FALLBACK` | `true` | 本地回退开关 |

### 内容白名单（`config/content.ts`）

| 配置项 | 说明 |
|--------|------|
| `CONTENT_CONFIG` | 合法 module 和 id 清单，新增模块/条目时更新 |

### 紧急开关

| 操作 | 效果 | 场景 |
|------|------|------|
| `USE_REMOTE_API: false` | 全局切为纯本地模式 | 远程服务故障 |
| `ENABLE_LOCAL_FALLBACK: false` | 远程失败不兜底 | 调试/测试（勿在生产使用） |
| `BASE_URL_OVERRIDE` 设置值 | 切换 API 地址 | 紧急切换后端 |

---

## 监控日志点

### 关键日志事件

| eventName | 位置 | 含义 |
|-----------|------|------|
| `search_remote_start` | search.ts | 远程搜索请求发出 |
| `search_remote_success` | search.ts | 远程搜索成功 |
| `search_remote_fail` | search.ts | 远程搜索失败，触发回退 |
| `search_remote_fallback` | search.ts | 回退到本地搜索 |
| `search_local_complete` | search-engine.ts | 本地搜索完成 |
| `suggest_remote_start` | search.ts | 远程建议请求发出 |
| `suggest_remote_fail` | search.ts | 远程建议失败 |
| `detail_remote_start` | detail.ts | 远程详情加载 |
| `detail_remote_fail` | detail.ts | 远程详情失败 |
| `detail_local_fallback` | detail.ts | 回退本地详情 |
| `auth_login_start` | auth-service.ts | 登录流程开始 |
| `auth_login_success` | auth-service.ts | 登录成功 |
| `auth_login_fail` | auth-service.ts | 登录失败 |
| `auth_token_refresh` | auth-service.ts | Token 刷新 |
| `auth_token_expired` | request.ts | 收到 401，触发过期处理 |
| `pdf_download_start` | detail.ts | PDF 下载开始 |
| `pdf_download_complete` | detail.ts | PDF 下载完成 |
| `pdf_open_fail` | detail.ts | PDF 打开失败 |
| `favorite_toggle` | detail.ts | 收藏状态切换 |

### 日志查看

- 小程序内：个人中心 → 运行日志 → 按级别筛选
- 日志保留最近 300 条，自动滚动清理
- 敏感字段（token、password 等）已自动脱敏

---

## 常见故障处理

### 搜索返回空结果

1. 检查 `USE_REMOTE_API` 状态 → 远程故障则切为 `false`
2. 检查索引文件是否加载成功 → 查看 `search_remote_fallback` 日志
3. 检查查询是否全是特殊字符 → 本地引擎可能无法处理

### 详情页白屏

1. 检查 URL 参数 module + id 是否在白名单内
2. 检查远程 API 是否可达 → 日志搜 `detail_remote_fail`
3. 检查本地 content 文件是否加载 → 日志搜 `detail_local_fallback`

### 公式显示异常

1. 检查 KaTeX 字体文件是否打包（`assets/katex/fonts/`）
2. 检查 `math-render.ts` 对特殊 LaTeX 符号的处理
3. 在真机上测试（开发者工具字体渲染可能与真机不同）

### PDF 无法打开

1. 检查 pdfUrl 是否有效
2. 检查 `wx.downloadFile` 域名是否在合法域名白名单中
3. 检查本地存储空间 → 清理旧 PDF 缓存
4. 日志搜 `pdf_open_fail` 查看具体错误

### 登录失败

1. 检查 AppID 和 AppSecret 配置是否正确
2. 检查后端 `/api/v1/auth/wechat-miniapp-login` 是否可达
3. 检查微信开放平台配置（如需要）
4. 日志搜 `auth_login_fail` 查看错误详情

### API 全部不可用

1. 检查 `baseURL` 域名 DNS 解析
2. 检查 SSL 证书是否过期
3. 设置 `USE_REMOTE_API: false` 切为纯本地模式
4. 发布紧急版本或等待服务恢复
