# OOGAM API

- Base URL: `/api/v1` (운영: `https://oogam.co.kr/api/v1`)
- 문서: Swagger UI `/api/docs`, OpenAPI JSON `/api/docs/openapi.json` (개발 환경 기본 활성, 운영 기본 비활성)
- 인증: 쿠키 세션(`oogam_session`, HttpOnly). 상태 변경 요청(POST/PUT/PATCH/DELETE)은 `X-CSRF-Token` 헤더 필수 (로그인 응답 `csrfToken` 또는 `oogam_csrf` 쿠키 값)
- 권한: 서버 측 강제. 권한 부족 403, 미인증 401, 접근 불가 리소스는 404
- 목록 API 공통 쿼리: `page`, `pageSize`(≤100), `q`, `sort`(허용 목록), `order`(asc|desc) → 응답 `{ items, total, page, pageSize, totalPages }`
- 오류 형식: `{ statusCode, message, error? }` (검증 오류 시 message 배열)
- 금액: 문자열 decimal (`"1234.50"`), 날짜: ISO 8601

총 229개 엔드포인트 (자동 생성 목록, 상세 스키마는 Swagger 참조)

## Health

| Method | Path |
|---|---|
| GET | `/health/live` |
| GET | `/health` |

## Authentication

| Method | Path |
|---|---|
| POST | `/auth/login` |
| POST | `/auth/logout` |
| GET | `/auth/me` |
| POST | `/auth/change-password` |
| GET | `/auth/sessions` |
| DELETE | `/auth/sessions/{id}` |
| GET | `/auth/invitation` |
| POST | `/auth/accept-invitation` |

## Projects

| Method | Path |
|---|---|
| GET | `/projects` |
| POST | `/projects` |
| GET | `/projects/{id}` |
| PATCH | `/projects/{id}` |
| DELETE | `/projects/{id}` |
| GET | `/projects/{id}/activity` |
| POST | `/projects/{id}/members` |
| DELETE | `/projects/{id}/members/{userId}` |
| POST | `/projects/{id}/milestones` |
| PATCH | `/projects/{id}/milestones/{mid}` |
| DELETE | `/projects/{id}/milestones/{mid}` |
| POST | `/projects/{id}/statuses` |
| DELETE | `/projects/{id}/statuses/{sid}` |
| POST | `/projects/{id}/links` |
| DELETE | `/projects/{id}/links/{linkId}` |

## Tasks

| Method | Path |
|---|---|
| GET | `/tasks` |
| POST | `/tasks` |
| GET | `/tasks/mine` |
| POST | `/tasks/reorder` |
| GET | `/tasks/{id}` |
| PATCH | `/tasks/{id}` |
| DELETE | `/tasks/{id}` |
| POST | `/tasks/{id}/dependencies` |
| DELETE | `/tasks/{id}/dependencies/{depId}` |
| POST | `/tasks/{id}/links` |
| DELETE | `/tasks/{id}/links/{linkId}` |

## Users

| Method | Path |
|---|---|
| GET | `/directory/users` |
| GET | `/directory/departments` |

## Employees

| Method | Path |
|---|---|
| GET | `/employees/invitations` |
| POST | `/employees/invitations` |
| POST | `/employees/invitations/{id}/resend` |
| DELETE | `/employees/invitations/{id}` |
| GET | `/employees` |
| GET | `/employees/roles` |
| GET | `/employees/{id}` |
| PATCH | `/employees/{id}` |
| PUT | `/employees/{id}/role` |
| POST | `/employees/{id}/deactivate` |
| POST | `/employees/{id}/reactivate` |
| GET | `/employees/{id}/hr` |
| PUT | `/employees/{id}/hr` |

## Departments

| Method | Path |
|---|---|
| GET | `/departments` |
| POST | `/departments` |
| GET | `/departments/{id}` |
| PATCH | `/departments/{id}` |
| DELETE | `/departments/{id}` |
| GET | `/departments/{id}/members` |
| POST | `/departments/{id}/members` |
| DELETE | `/departments/{id}/members/{userId}` |

## Workspaces

| Method | Path |
|---|---|
| GET | `/workspaces` |
| GET | `/workspaces/{id}` |

## Documents

| Method | Path |
|---|---|
| GET | `/documents` |
| POST | `/documents` |
| GET | `/documents/tree` |
| GET | `/documents/templates` |
| GET | `/documents/trash` |
| GET | `/documents/{id}` |
| PATCH | `/documents/{id}` |
| DELETE | `/documents/{id}` |
| PUT | `/documents/{id}/content` |
| POST | `/documents/{id}/move` |
| POST | `/documents/{id}/duplicate` |
| POST | `/documents/{id}/restore` |
| DELETE | `/documents/{id}/permanent` |
| GET | `/documents/{id}/activity` |
| GET | `/documents/{id}/versions` |
| POST | `/documents/{id}/versions` |
| GET | `/documents/{id}/versions/{sid}` |
| POST | `/documents/{id}/versions/{sid}/restore` |
| GET | `/documents/{id}/access` |
| POST | `/documents/{id}/access/grants` |
| DELETE | `/documents/{id}/access/grants/{grantId}` |
| PATCH | `/documents/{id}/visibility` |

## Comments

| Method | Path |
|---|---|
| GET | `/comments` |
| POST | `/comments` |
| PATCH | `/comments/{id}` |
| DELETE | `/comments/{id}` |
| POST | `/comments/{id}/resolve` |

## Files

| Method | Path |
|---|---|
| POST | `/files` |
| GET | `/files` |
| GET | `/files/{id}` |
| DELETE | `/files/{id}` |
| GET | `/files/{id}/download` |

## Notifications

| Method | Path |
|---|---|
| GET | `/notifications` |
| GET | `/notifications/unread-count` |
| POST | `/notifications/read-all` |
| POST | `/notifications/{id}/read` |
| DELETE | `/notifications/{id}` |

## Announcements

| Method | Path |
|---|---|
| GET | `/announcements` |
| POST | `/announcements` |
| GET | `/announcements/{id}` |
| PATCH | `/announcements/{id}` |
| DELETE | `/announcements/{id}` |
| POST | `/announcements/{id}/read` |

## Databases

| Method | Path |
|---|---|
| GET | `/databases` |
| POST | `/databases` |
| GET | `/databases/{id}` |
| PATCH | `/databases/{id}` |
| DELETE | `/databases/{id}` |
| GET | `/databases/{id}/activity` |
| POST | `/databases/{id}/properties` |
| POST | `/databases/{id}/properties/reorder` |
| PATCH | `/databases/{id}/properties/{pid}` |
| DELETE | `/databases/{id}/properties/{pid}` |
| GET | `/databases/{id}/rows` |
| POST | `/databases/{id}/rows` |
| POST | `/databases/{id}/rows/reorder` |
| GET | `/databases/{id}/rows/{rowId}` |
| PATCH | `/databases/{id}/rows/{rowId}` |
| DELETE | `/databases/{id}/rows/{rowId}` |
| GET | `/databases/{id}/rows/{rowId}/activity` |
| GET | `/databases/{id}/views` |
| POST | `/databases/{id}/views` |
| PATCH | `/databases/{id}/views/{viewId}` |
| DELETE | `/databases/{id}/views/{viewId}` |
| PUT | `/databases/{id}/views/{viewId}/preference` |
| DELETE | `/databases/{id}/views/{viewId}/preference` |
| GET | `/databases/{id}/export.csv` |
| POST | `/databases/{id}/import` |

## Calendar

| Method | Path |
|---|---|
| GET | `/calendar/events` |
| POST | `/calendar/events` |
| GET | `/calendar/invitations` |
| GET | `/calendar/events/{id}` |
| PATCH | `/calendar/events/{id}` |
| DELETE | `/calendar/events/{id}` |
| POST | `/calendar/events/{id}/respond` |

## Approvals

| Method | Path |
|---|---|
| GET | `/approvals` |
| POST | `/approvals` |
| GET | `/approvals/summary` |
| GET | `/approvals/{id}` |
| PATCH | `/approvals/{id}` |
| DELETE | `/approvals/{id}` |
| POST | `/approvals/{id}/submit` |
| POST | `/approvals/{id}/approve` |
| POST | `/approvals/{id}/reject` |
| POST | `/approvals/{id}/request-changes` |
| POST | `/approvals/{id}/cancel` |
| POST | `/approvals/{id}/comments` |

## Finance

| Method | Path |
|---|---|
| GET | `/finance/dashboard` |
| GET | `/finance/business-units` |
| POST | `/finance/business-units` |
| PATCH | `/finance/business-units/{id}` |
| DELETE | `/finance/business-units/{id}` |
| GET | `/finance/budgets` |
| POST | `/finance/budgets` |
| GET | `/finance/budget-lines` |
| GET | `/finance/budgets/{id}` |
| PATCH | `/finance/budgets/{id}` |
| DELETE | `/finance/budgets/{id}` |
| POST | `/finance/budgets/{id}/submit` |
| POST | `/finance/budgets/{id}/approve` |
| POST | `/finance/budgets/{id}/return` |
| POST | `/finance/budgets/{id}/close` |
| GET | `/finance/transactions` |
| POST | `/finance/transactions` |
| GET | `/finance/transactions/export` |
| GET | `/finance/transactions/{id}` |
| PATCH | `/finance/transactions/{id}` |
| DELETE | `/finance/transactions/{id}` |
| PUT | `/finance/transactions/{id}/allocations` |
| POST | `/finance/transactions/{id}/submit` |
| POST | `/finance/transactions/{id}/approve` |
| POST | `/finance/transactions/{id}/reject` |

## CMS

| Method | Path |
|---|---|
| GET | `/cms/overview` |
| GET | `/cms/brands` |
| POST | `/cms/brands` |
| PUT | `/cms/brands/order` |
| GET | `/cms/brands/{id}` |
| PATCH | `/cms/brands/{id}` |
| DELETE | `/cms/brands/{id}` |
| POST | `/cms/brands/{id}/status` |
| GET | `/cms/portfolio` |
| POST | `/cms/portfolio` |
| GET | `/cms/portfolio/{id}` |
| PATCH | `/cms/portfolio/{id}` |
| DELETE | `/cms/portfolio/{id}` |
| POST | `/cms/portfolio/{id}/status` |
| GET | `/cms/posts` |
| POST | `/cms/posts` |
| GET | `/cms/posts/{id}` |
| PATCH | `/cms/posts/{id}` |
| DELETE | `/cms/posts/{id}` |
| POST | `/cms/posts/{id}/status` |
| GET | `/cms/pages` |
| GET | `/cms/pages/{key}` |
| PUT | `/cms/pages/{key}` |
| GET | `/cms/pages/{key}/preview` |
| POST | `/cms/pages/{key}/discard` |
| POST | `/cms/pages/{key}/publish` |
| POST | `/cms/pages/{key}/unpublish` |
| GET | `/cms/inquiries` |
| GET | `/cms/inquiries/{id}` |
| PATCH | `/cms/inquiries/{id}` |
| DELETE | `/cms/inquiries/{id}` |

## Public site

| Method | Path |
|---|---|
| GET | `/public/site` |
| GET | `/public/home` |
| GET | `/public/pages/{key}` |
| GET | `/public/brands` |
| GET | `/public/brands/{slug}` |
| GET | `/public/portfolio` |
| GET | `/public/posts` |
| GET | `/public/posts/{type}/{slug}` |
| GET | `/public/sitemap` |
| POST | `/public/inquiries` |

## Audit logs

| Method | Path |
|---|---|
| GET | `/audit-logs` |
| GET | `/audit-logs/actions` |

## Settings

| Method | Path |
|---|---|
| GET | `/settings/roles` |
| POST | `/settings/roles` |
| GET | `/settings/permissions` |
| PUT | `/settings/roles/{id}/permissions` |
| DELETE | `/settings/roles/{id}` |
| GET | `/settings/grants` |
| POST | `/settings/grants` |
| DELETE | `/settings/grants/{id}` |
| GET | `/settings/system` |
| GET | `/settings/system/{key}` |
| PUT | `/settings/system/{key}` |

## Search

| Method | Path |
|---|---|
| GET | `/search` |

## Dashboard

| Method | Path |
|---|---|
| GET | `/dashboard` |
