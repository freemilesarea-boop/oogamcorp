import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Preview(대표 검수용) 사이트 대상 E2E. infra/preview/up.sh 로 기동된 환경을 HTTPS + Basic 인증으로 검증한다.
 * 실행: pnpm exec playwright test -c playwright.preview.config.ts
 * 접속 정보는 .preview/ (gitignore) 에서 읽으며 코드에 포함하지 않는다.
 */
const env = (file: string) =>
  Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const basic = env('.preview/basic.env');
const pv = env('.preview/preview.env');

export default defineConfig({
  testDir: './e2e/preview',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.PREVIEW_URL ?? pv.PUBLIC_SITE_URL,
    httpCredentials: { username: basic.PREVIEW_BASIC_USER, password: basic.PREVIEW_BASIC_PASS },
    // 로컬 Preview 는 자체 서명 인증서 — 인증서 자체는 별도 검증 단계(openssl/curl --cacert)에서 확인
    ignoreHTTPSErrors: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
});
