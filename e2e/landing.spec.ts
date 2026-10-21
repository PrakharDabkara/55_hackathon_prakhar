import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// PR T (ADR-0056): the landing page at "/". Static, so these tests need no login and no data.

test('"/" returns 200 and shows the headline', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Lift your shutter online in a minute.' }),
  ).toBeVisible();
});

test('the health check, /app/ and /app/shop are untouched', async ({ page, request }) => {
  expect((await request.get('/health')).status()).toBe(200);
  expect((await page.goto('/app/'))?.status()).toBe(200);
  expect((await page.goto('/app/shop'))?.status()).toBe(200);
});

test('every in-page link targets an existing id', async ({ page }) => {
  await page.goto('/');
  const hrefs = await page.locator('a[href^="#"]').evaluateAll((as) =>
    as.map((a) => a.getAttribute('href') as string),
  );
  expect(hrefs.length).toBeGreaterThan(2);
  for (const href of hrefs) {
    await expect(page.locator(href), href).toHaveCount(1);
  }
});

test('the buttons go where they say', async ({ page }) => {
  await page.goto('/');
  for (const link of await page.getByRole('link', { name: 'Open your shop' }).all())
    await expect(link).toHaveAttribute('href', '/app/shop');
  for (const link of await page.getByRole('link', { name: 'Find something' }).all())
    await expect(link).toHaveAttribute('href', '/app/');
  await page.getByRole('link', { name: 'Open your shop' }).first().click();
  await expect(page).toHaveURL(/\/app\/shop$/);
  await page.goto('/');
  await page.getByRole('link', { name: 'Find something' }).first().click();
  await expect(page).toHaveURL(/\/app\/$/);
});

test('sends the page security headers', async ({ request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
});

for (const look of ['light', 'dark', 'data-theme-dark', 'data-theme-light'] as const) {
  test(`axe finds nothing serious in ${look}`, async ({ page }) => {
    const scheme = look === 'dark' ? 'dark' : 'light';
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/');
    if (look.startsWith('data-theme-'))
      await page.evaluate(
        (t) => document.documentElement.setAttribute('data-theme', t),
        look.replace('data-theme-', ''),
      );
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
      [],
    );
  });
}

test('does not scroll sideways at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
});

test('every link and button is at least 44 px tall', async ({ page }) => {
  await page.goto('/');
  const small = await page
    .locator('a.lp-btn, nav a, header a')
    .evaluateAll((els) =>
      els
        .map((e) => ({ t: e.textContent?.trim(), h: e.getBoundingClientRect().height }))
        .filter((e) => e.h < 44),
    );
  expect(small).toEqual([]);
});

test('the text holds no 10-digit number and no 6-digit code', async ({ page }) => {
  await page.goto('/');
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/\d{10}/);
  expect(text).not.toMatch(/(?<!\d)\d{6}(?!\d)/);
});
