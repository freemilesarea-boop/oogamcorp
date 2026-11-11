import { defineConfig, devices } from '@playwright/test';

/**
 * 홈페이지 CMS 모드(NEXT_PUBLIC_DATA_SOURCE=cms) E2E.
 * 실행 전: CMS 모드로 빌드·기동한 서버와 콘텐츠가 비어 있는 DB (website_pages·business_areas 등).
 *   CMS_E2E_URL=http://127.0.0.1:3930 \
 *   CMS_E2E_OWNER_EMAIL=… CMS_E2E_OWNER_PASSWORD=… CMS_E2E_EDITOR_EMAIL=… CMS_E2E_EDITOR_PASSWORD=… \
 *   pnpm exec playwright test -c playwright.cms.config.ts --trace off
 * 계정 정보는 환경변수로만 전달하며 저장소에 포함하지 않는다. (게시 권한 없는 편집자 = MANAGER 역할)
 */
export default defineConfig({
  testDir: './e2e/cms',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.CMS_E2E_URL ?? 'http://127.0.0.1:3930',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'off',
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
