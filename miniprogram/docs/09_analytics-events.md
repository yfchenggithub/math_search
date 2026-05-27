# Analytics Events (Stage 10)

## Goal

Lightweight funnel tracking for:

1. Search conversion
2. Recommendation conversion
3. PDF unlock and download conversion
4. No-result query optimization

## Principles

1. Tracking must not block user flows.
2. Tracking failures must be silent.
3. No user privacy data is reported.
4. No raw error object is reported.
5. No PDF URL or internal API URL is reported.

## Infra

- Unified module: `miniprogram/utils/analytics.ts`
- Adapter order:
  1. `wx.reportEvent`
  2. `wx.reportAnalytics`
  3. debug logger fallback
- Config:
  - `ANALYTICS_CONFIG.enabled`
  - `ANALYTICS_CONFIG.debug`
  - `ANALYTICS_CONFIG.provider`

## Common Fields

- `source`
- `page`
- `entry`
- `item_id`
- `module`
- `has_pdf`
- `unlock_status`
- `unlock_provider`
- `query`
- `result_count`
- `duration_ms`
- `error_type`

## Event List

### App and page view

- `app_launch`
- `home_view`
- `detail_view`
- `mine_view`

### Search and recommendation

- `home_search_submit`
- `home_search_result`
- `home_search_no_result`
- `home_suggest_click`
- `home_quick_filter_click`
- `home_recommend_click`

### Detail PDF funnel

- `detail_pdf_click`
- `detail_pdf_no_file`
- `pdf_unlock_modal_show`
- `pdf_unlock_click`
- `pdf_unlock_success`
- `pdf_unlock_fail`
- `pdf_download_start`
- `pdf_download_success`
- `pdf_download_fail`

### Favorite and share

- `favorite_click`
- `favorite_success`
- `favorite_cancel`
- `favorite_fail`
- `share_click`
- `copy_keyword_click`
- `copy_keyword_success`
- `copy_keyword_fail`

## Funnel Mapping

1. Search conversion:
   - `home_view -> home_search_submit -> home_search_result -> detail_view`
2. Recommendation conversion:
   - `home_view -> home_recommend_click -> detail_view`
3. PDF conversion:
   - `detail_view -> detail_pdf_click -> pdf_unlock_modal_show -> pdf_unlock_click -> pdf_unlock_success -> pdf_download_success`
4. No-result optimization:
   - `home_search_submit -> home_search_no_result`

## Privacy Guard

Sanitizer blocks keys such as:

- `token`
- `accessToken`
- `refreshToken`
- `openid`
- `session_key`
- `phone`
- `avatarUrl`
- `pdfUrl`
- `url`
- `apiUrl`
- `authorization`
- `cookie`

