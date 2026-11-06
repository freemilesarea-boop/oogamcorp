# OOGAM 데이터베이스 설계

- DBMS: PostgreSQL 16, ORM: Prisma 6 (`apps/api/prisma/schema.prisma`)
- 마이그레이션: `apps/api/prisma/migrations/` (`pnpm db:migrate` 개발, `pnpm db:deploy` 운영)
- 시드: `apps/api/prisma/seed.ts` (멱등)

## 공통 규칙
| 규칙 | 적용 |
|---|---|
| 기본키 | 모든 테이블 UUID (`@db.Uuid`, `uuid()`) |
| 타임스탬프 | `createdAt` / `updatedAt` (컬럼명은 Prisma 필드명 camelCase 그대로 사용) |
| 조직 격리 | 업무 데이터 테이블에 `organizationId` — 서비스 계층의 모든 조회에 조건 포함 |
| 소프트 삭제 | 사용자 생성 콘텐츠에 `deletedAt` (pages, tasks, projects, comments, files, budgets, transactions, approvals, brands, posts, announcements, calendar_events, databases/rows, departments, users) — 문서는 휴지통/복원 지원 |
| 금액 | `DECIMAL(18,2)` + 문자열 기반 연산(`@oogam/shared` money) |
| 무결성 | 외래키(Cascade/SetNull/Restrict 명시), Unique 제약, 조회 패턴별 인덱스 |
| 감사 | `audit_logs`(보안·운영) + `activity_logs`(업무 변경 이력) |

## 엔터티 그룹

### Core
| 테이블 | 설명 |
|---|---|
| organizations | 조직 (단일 기업이지만 격리 키) |
| users | 계정 (Argon2id 해시, 상태 INVITED/ACTIVE/DISABLED, 실패 횟수/잠금, MFA 필드) |
| memberships | 조직 소속: 역할, 부서, 직책, 사번, 입사일, 재직 상태 — `(organizationId,userId)` unique |
| hr_records | **민감 인사정보**(급여 등) — 별도 테이블, 별도 권한 |
| departments | 부서 트리(parentId), 관리자 |
| roles / permissions / role_permissions | RBAC. 시스템 역할 5종 + 사용자 정의 역할 |
| resource_grants | 리소스 단위 부여 (PAGE/PROJECT/DATABASE/FILE/WORKSPACE) 및 MODULE(권한 키) 명시 부여, 사용자 또는 부서 대상, 만료 |
| sessions | 서버 세션 (tokenHash, csrfToken, 만료, 유휴, 폐기) |
| invitations | 초대 (tokenHash, 만료, 수락/폐기) |

### Workspace / 문서
| 테이블 | 설명 |
|---|---|
| workspaces / workspace_members | 워크스페이스와 구성원 역할(ADMIN/MEMBER/VIEWER) |
| pages | 계층형 문서(parentId, position), Tiptap JSON `content`, 검색용 `contentText`, Yjs `yState`, 공개 범위, 버전, 템플릿, 휴지통 |
| page_snapshots | 버전 기록 (MANUAL/AUTO/RESTORE/COLLAB), `(pageId,version)` unique |
| page_updates | Yjs 증분 업데이트 로그 (공동 편집 변경 로그) |
| comments | 범용 댓글 (targetType/targetId, 스레드, 멘션, 해결) |
| files | 저장소 키, 원본명, MIME, 크기, 체크섬, 대상 엔터티 |
| entity_links | 엔터티 간 연결 (프로젝트↔문서, 업무↔문서 등) |

### 사용자 정의 데이터베이스
| 테이블 | 설명 |
|---|---|
| databases | 데이터베이스 정의 |
| database_properties | 속성(타입 TITLE…RELATION, FORMULA/ROLLUP 예약), `config` JSON(선택지, 관계 대상 등) |
| database_rows / database_cells | 행과 셀(`(rowId,propertyId)` unique, 값은 타입별 스키마 검증 후 JSON 저장) |
| database_views / database_view_preferences | 저장된 뷰(공유/개인) + 사용자별 보기 설정 |

### 프로젝트
| 테이블 | 설명 |
|---|---|
| projects | 키(조직 내 unique), 부서, 관리자, 상태, 우선순위, 진행률(자동 계산), 기간, 예산 연결 |
| project_task_statuses | 프로젝트별 사용자 정의 상태 → 기본 상태 카테고리 매핑 |
| project_members | 프로젝트 역할(MANAGER/MEMBER/VIEWER) |
| milestones | 마일스톤 |
| tasks | 업무(하위 업무 parentId, 상태, 우선순위, 일정, 체크리스트 JSON, 정렬 position) |
| task_assignees / task_dependencies | 복수 담당자 / 선행 관계(순환 방지 검사) |
| activity_logs | 프로젝트 활동 로그·업무 변경 이력 |

### 캘린더 / 결재 / 재무
| 테이블 | 설명 |
|---|---|
| calendar_events / event_attendees | 일정, 비공개 여부, RRULE(후속), 참석 응답 |
| approval_requests | 결재 문서 (번호 조직 내 unique, 상태, 현재 단계, **version 낙관적 잠금**, 프로젝트/예산/거래 연결) |
| approval_steps / approval_actions | 결재선 단계 `(requestId,order)` unique / 처리 이력 |
| business_units | 사업 구분 |
| budgets / budget_lines | 예산 편성·**승인 금액**(승인 데이터) |
| financial_transactions | 매출·지출 (공급가액, 부가세, 합계, 증빙, 승인 상태) |
| transaction_allocations | **집행 데이터** — 거래를 예산 항목에 배분 (승인과 분리) |

### CMS / 시스템
| 테이블 | 설명 |
|---|---|
| brands / portfolio_items | 브랜드(관계 확인 메모 포함)·포트폴리오, 게시 상태 |
| website_pages | 고정 페이지: `content`(편집/미리보기) ↔ `publishedContent`(공개) 분리 |
| website_posts | 뉴스·인사이트·채용 (metadata JSON) |
| contact_inquiries | 문의 접수 (동의 시각, IP 해시) |
| announcements / announcement_reads | 공지(전사/부서/프로젝트) + 읽음 상태 |
| notifications | 인앱 알림(읽음, 이메일 발송 시각) |
| audit_logs | 감사 로그 |
| system_settings | 조직별 설정 키-값 |

## 게시 상태 (CMS)
`DRAFT → REVIEW → PUBLISHED → ARCHIVED`. 공개 API(`/api/v1/public/*`)는 `PUBLISHED` 이고 `publishedAt <= now()` 인 항목, 페이지는 `publishedContent` 만 반환합니다.

## 마이그레이션 운용
- 개발: 스키마 수정 → `pnpm db:migrate --name <변경명>` → 커밋
- 운영: 컨테이너 기동 시 `prisma migrate deploy` 자동 실행. 파괴적 변경은 확장/정리 2단계로 배포.
