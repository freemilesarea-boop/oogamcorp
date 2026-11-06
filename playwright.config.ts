import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: 실제 API(NestJS) + Web(Next.js production build) + PostgreSQL(oogam_e2e) 로 실행.
 * 사전 조건: pnpm build 완료, PostgreSQL/Redis 기동.
 * 실행: pnpm test:e2e
 */
const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgresql://oogam:oogam_dev_pw@localhost:5432/oogam_e2e?schema=public';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3000', trace: 'off', locale: 'ko-KR', timezoneId: 'Asia/Seoul' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'bash e2e/start-api.sh',
      url: 'http://localhost:4000/api/v1/health/live',
      timeout: 120_000,
      reuseExistingServer: false,
      env: { E2E_DATABASE_URL: E2E_DB },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @oogam/web start',
      url: 'http://localhost:3000',
      timeout: 120_000,
      reuseExistingServer: false,
      env: { API_INTERNAL_URL: 'http://localhost:4000', WEB_PORT: '3000' },
    },
  ],
});
