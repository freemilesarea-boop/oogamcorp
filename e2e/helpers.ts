import { expect, type Page } from '@playwright/test';

export const OWNER = { email: 'owner@e2e.oogam', password: 'E2eOwnerPassw0rd' };

export async function loginAs(page: Page, email = OWNER.email, password = OWNER.password) {
  await page.goto('/admin/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** 브라우저 세션의 CSRF 토큰으로 API 호출 (테스트 데이터 준비용) */
export async function apiAs(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const csrf = document.cookie.match(/oogam_csrf=([^;]+)/)?.[1] ?? '';
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, path, body },
  );
}
