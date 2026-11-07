/**
 * 사이트 모드. 'preview' 는 대표 검수용 Preview/Staging 빌드 전용이다 (빌드 시점 값).
 * - 모든 페이지 noindex/nofollow, robots.txt 전체 차단
 * - 화면 하단에 "PREVIEW · 가상 데이터" 표시
 */
export const SITE_MODE = process.env.NEXT_PUBLIC_SITE_MODE === 'preview' ? 'preview' : 'production';
export const isPreview = SITE_MODE === 'preview';
