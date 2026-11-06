import { expect, test } from '@playwright/test';

const ROUTES = ['/', '/about', '/business', '/brands', '/portfolio', '/news', '/careers', '/contact', '/privacy', '/terms'];

for (const route of ROUTES) {
  test(`공개 페이지 렌더링: ${route}`, async ({ page }) => {
    const res = await page.goto(route);
    expect(res?.status()).toBe(200);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
  });
}

test('홈 Hero 는 CMS 문구를 표시한다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Ideas Become Impact.').first()).toBeVisible();
});

test('robots / sitemap', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(await robots.text()).toContain('Disallow: /admin');
  expect((await request.get('/sitemap.xml')).status()).toBe(200);
});
