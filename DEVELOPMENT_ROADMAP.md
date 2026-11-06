# OOGAM 개발 로드맵

진행 현황의 상세 판정은 [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) 를 기준으로 합니다.

## 완료된 단계 (이번 세션)
| Phase | 내용 |
|---|---|
| 1 Repository & Infrastructure | pnpm 모노레포, Next.js 15, NestJS 11, Prisma 6 스키마/마이그레이션, PostgreSQL/Redis, Docker(개발/운영), Nginx, 환경 분리, 구조화 로깅, 헬스체크, 백업/복구 |
| 2 Corporate Website | 디자인 시스템, 공개 레이아웃, 홈/회사/사업/브랜드/포트폴리오/뉴스/채용/문의/약관, CMS 연동 |
| 3 Admin Foundation | 세션 인증, CSRF, 로그인 제한, RBAC + 리소스 권한, 관리자 셸, 대시보드, 사용자 관리 |
| 4 Collaboration | 문서/에디터, 프로젝트·업무, 댓글, 파일, 알림 |
| 5 Advanced Workspace | 사용자 정의 DB·뷰, 협업 서버, 문서 이력, 캘린더, 검색 |
| 6 Business Operations | 예산, 거래, 전자결재, 직원, 부서, 대시보드 |
| 7 Quality & Docs | 통합/E2E 테스트, 보안 검토, 백업 검증, 문서 |

## 다음 우선순위 (권장 순서)
1. **운영 준비(승인 필요)**: 스테이징 서버 구축 → DNS/HTTPS → SMTP → 운영 배포 (DEPLOYMENT.md 체크리스트)
2. **보안 강화**: MFA(TOTP) 구현, 공개 사이트 CSP, 레이트 리밋 Redis 저장소, 업로드 바이러스 검사, 세션 목록 기기 정보 개선
3. **콘텐츠 확정**: 브랜드 법인 관계 확인 후 게시, 회사 소개·사업 영역 카피, 개인정보처리방침/이용약관 법무 검토
4. **협업 고도화**: 공동 편집 커서/프레즌스 UX 개선, 문서 내 멘션 노드, 블록 드래그 핸들, 페이지 링크 블록, 문서 권한 상속 UI
5. **데이터베이스 고도화**: Formula/Rollup 평가기, Timeline 뷰, 대량 행 가상 스크롤, 관계형 양방향 동기화
6. **프로젝트 고도화**: Gantt(의존 화살표·드래그 일정 조정), 반복 업무, 업무 템플릿, 프로젝트 템플릿
7. **경영 관리**: 예산 대비 실적 리포트 다운로드(XLSX), 회계 시스템 연동 인터페이스(내보내기 전용), 결재 양식 템플릿·전결 규정
8. **검색**: pg_trgm 인덱스 또는 전문 검색 엔진(OpenSearch/Meilisearch) 도입
9. **관측성**: OpenTelemetry 트레이싱, 에러 추적(Sentry 등), 메트릭 대시보드
10. **성능**: 공개 사이트 이미지 최적화/CDN, API 응답 캐싱, N+1 점검

## 기술 부채 / 주의
- 일부 집계는 애플리케이션 레벨 계산 → 데이터 증가 시 SQL 집계/머티리얼라이즈드 뷰로 이전
- Throttler 저장소 인메모리 (단일 인스턴스 가정)
- Next.js rewrites 는 빌드 시점 평가 (운영은 Nginx 가 /api 직접 라우팅하므로 영향 없음)
