/**
 * 사이트 모드. 'preview' 는 대표 검수용 Preview/Staging 빌드 전용이다 (빌드 시점 값).
 * - 모든 페이지 noindex/nofollow, robots.txt 전체 차단
 * - 화면 하단에 "PREVIEW · 가상 데이터" 표시
 */
export const SITE_MODE = process.env.NEXT_PUBLIC_SITE_MODE === 'preview' ? 'preview' : 'production';
export const isPreview = SITE_MODE === 'preview';

/**
 * 정적 사이트 모드: 백엔드(API·DB) 없이 공개 홈페이지만 배포 (예: Vercel).
 * - 공개 페이지는 번들된 가상 샘플 스냅샷을 읽기 전용으로 사용
 * - /admin, /api 는 미들웨어(서버)에서 차단, 문의 폼 비활성
 */
export const isStaticSite = process.env.NEXT_PUBLIC_DATA_SOURCE === 'static';

/**
 * CMS 모드: 공개 홈페이지 + 홈페이지 CMS 관리자만 제공하는 배포 (예: Vercel + Supabase).
 * - 같은 배포 안에서 NestJS 의 인증·CMS·공개 사이트 모듈을 서버리스로 구동 (@oogam/api/serverless)
 * - 사내 업무 시스템(재무·직원·결재·문서 등) 화면과 API 는 미들웨어에서 404 (라우트도 존재하지 않음)
 */
export const isCmsSite = process.env.NEXT_PUBLIC_DATA_SOURCE === 'cms';
