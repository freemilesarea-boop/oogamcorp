import { expect, test } from '@playwright/test';

test('모바일: 홈 가로 스크롤 없음 + 모바일 메뉴', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByText('Ideas Become Impact.').first()).toBeVisible();
});

test('모바일: 관리자 로그인 화면', async ({ page }) => {
  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { name: '워크스페이스 로그인' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
