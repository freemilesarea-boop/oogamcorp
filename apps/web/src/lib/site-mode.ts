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
