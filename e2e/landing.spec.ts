import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// PR T (ADR-0056): the landing page at "/". Static, so these tests need no login and no data.

test('"/" returns 200 and shows the headline', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Buy from the shops you trust, right around the corner.',
    }),
  ).toBeVisible();
});

test('the health check, /app/ and /app/shop are untouched', async ({ page, request }) => {
  expect((await request.get('/health')).status()).toBe(200);
  expect((await page.goto('/app/'))?.status()).toBe(200);
  expect((await page.goto('/app/shop'))?.status()).toBe(200);
});

test('every in-page link targets an existing id', async ({ page }) => {
  await page.goto('/');
  const hrefs = await page
    .locator('a[href^="#"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') as string));
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

test('every visible link and button is at least 44 px tall', async ({ page }) => {
  for (const size of [
    { width: 360, height: 800 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/');
    const small = await page
      .locator('a.lp-btn, nav a, header a, header button')
      .evaluateAll((els) =>
        els
          .map((e) => ({ t: e.textContent?.trim(), r: e.getBoundingClientRect() }))
          .filter((e) => e.r.height > 0 && (e.r.height < 44 || e.r.width < 44))
          .map((e) => e.t),
      );
    expect(small, `${size.width}px`).toEqual([]);
  }
});

test('the phone header is one compact row and the button is smaller than the wordmark (L-09, L-13)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const header = await page.locator('.lp-header').boundingBox();
  expect(header?.height ?? 999).toBeLessThanOrEqual(64);
  const brand = await page.locator('.lp-brand').boundingBox();
  const cta = await page.locator('.lp-header__cta').boundingBox();
  expect(cta?.width ?? 999).toBeLessThan(brand?.width ?? 0);
});

test('the shop replies line up under the parchi on a phone (L-12)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const centre = (b: { x: number; width: number } | null) => (b ? b.x + b.width / 2 : -1);
  const groups = await page.locator('.lp-replies').all();
  expect(groups.length).toBe(2); // the hero and the buyers band
  for (const group of groups) {
    const slip = centre(await group.locator('.lp-slip').boundingBox());
    for (const reply of await group.locator('.lp-reply').all())
      expect(Math.abs(centre(await reply.boundingBox()) - slip)).toBeLessThanOrEqual(4);
  }
});

test('does not scroll sideways at the other sizes, or with text zoomed to 200%', async ({
  page,
}) => {
  const sizes = [
    [390, 844],
    [412, 915],
    [844, 390],
    [1280, 800],
    [180, 400], // 360 px at 200% zoom
  ] as const;
  for (const [width, height] of sizes)
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(scroll, `${width}x${height} ${scheme}`).toBeLessThanOrEqual(client);
    }
});

test('the theme toggle follows the system, overrides it and remembers the choice (L-03)', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Dark theme' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await bg();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bg()).not.toBe(dark);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Dark theme' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('the theme toggle still works when storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
    });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the text holds no 10-digit number and no 6-digit code', async ({ page }) => {
  await page.goto('/');
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/\d{10}/);
  expect(text).not.toMatch(/(?<!\d)\d{6}(?!\d)/);
});
