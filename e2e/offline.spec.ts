import { expect, test, type Page } from '@playwright/test';
import { onboardShop, shopContextAt, newCorner } from './orderFlow.js';
import { uniqueName } from './unique.js';

// ADR-0057: after one visit, the service worker keeps the app shell, so /app/ and /app/shop open
// with no network, show the offline banner, and draw their text in the self-hosted fonts.

/** The worker is active and has stored the page and a Latin font (the install runs after the load). */
async function shellKept(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const names = await caches.keys();
          const urls = (
            await Promise.all(
              names.map(async (name) => (await (await caches.open(name)).keys()).map((r) => r.url)),
            )
          ).flat();
          return {
            page: urls.some((u) => u.endsWith('/app/')),
            font: urls.some((u) => /mukta-latin-400.*\.woff2$/.test(u)),
            script: urls.some((u) => /\/assets\/main-.*\.js$/.test(u)),
          };
        }),
      { timeout: 15_000 },
    )
    .toEqual({ page: true, font: true, script: true });
  // The page must be controlled by it for the reload to go through the worker.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

const fontsLoaded = (page: Page, family: string) =>
  page.evaluate(async (name) => {
    await document.fonts.ready;
    return [...document.fonts].some(
      (face) => face.family.replaceAll('"', '') === name && face.status === 'loaded',
    );
  }, family);

test('the customer app opens offline with its banner and its fonts', async ({ page, context }) => {
  const failedFonts: string[] = [];
  page.on('requestfailed', (request) => {
    if (/\.woff2?$/.test(request.url())) failedFonts.push(request.url());
  });
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
  await shellKept(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
  await expect(page.getByText(/You're offline/).first()).toBeVisible();
  expect(await fontsLoaded(page, 'Mukta')).toBe(true);
  expect(failedFonts).toEqual([]);

  // A deep link opens the same shell.
  await page.goto('/app/orders');
  await expect(page.locator('#root')).not.toBeEmpty();
  await context.setOffline(false);
});

test('the shop app opens offline with its banner and its fonts', async ({ browser }) => {
  const context = await shopContextAt(browser, newCorner());
  const page = await context.newPage();
  await onboardShop(page, uniqueName('Offline Kirana'));
  await shellKept(page);
  await expect(page.getByRole('switch', { name: 'Open' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("You're offline. Reconnect to answer.")).toBeVisible({
    timeout: 15_000,
  });
  expect(await fontsLoaded(page, 'Mukta')).toBe(true);
  await context.setOffline(false);
  await context.close();
});
