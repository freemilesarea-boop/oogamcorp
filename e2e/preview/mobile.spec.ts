import { expect, test } from '@playwright/test';
import { loginExecutive, noHorizontalScroll } from './helpers';

test('모바일: 홈 메뉴·반응형', async ({ page }) => {
  await page.goto('/');
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: /메뉴/ }).first().click();
  await page.getByRole('navigation', { name: '모바일 메뉴' }).getByRole('link', { name: 'Brands' }).click();
  await expect(page).toHaveURL(/\/brands$/);
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(1);
});

test('모바일: 관리자 로그인·대시보드·드로어 메뉴', async ({ page }) => {
  await loginExecutive(page);
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  await page.getByRole('link', { name: '전자결재' }).click();
  await expect(page).toHaveURL(/\/admin\/approvals/);
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(1);
});
