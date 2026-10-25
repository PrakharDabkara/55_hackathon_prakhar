import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { screenProblems } from './a11y.js';
import { forgetDemoStock, forgetShopOf, shopPlace } from './db.js';
import {
  ask,
  customerAt,
  login,
  newCorner,
  onboardShop,
  shopContextAt,
  useDemoLocation,
  VIEWPORT,
} from './orderFlow.js';
import { uniqueName } from './unique.js';

// App round 2: the fixes from the functional test of Find and the shop replies. Real browsers, the
// real API and Postgres, the five simulated shops, and the fake model. Screenshots at two phone
// sizes in both themes go to SCREENS_DIR (not committed).
const OUT = process.env['SCREENS_DIR'] ?? join('e2e', 'artifacts', 'app-round2');
const SIZES = [
  { name: '360x800', width: 360, height: 800 },
  { name: '412x915', width: 412, height: 915 },
] as const;
const THEMES = ['light', 'dark'] as const;

test.setTimeout(240_000);
test.beforeEach(async () => forgetDemoStock());

async function shoot(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
}

const photo = () =>
  sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 120, b: 60 } },
  })
    .jpeg()
    .toBuffer();

/** Back arrow of a customer screen. */
const back = (page: Page) => page.getByRole('button', { name: 'Back' }).click();

test.describe('Find: AI failure, did-you-mean, photo (C-11, C-12, C-14, C-15)', () => {
  test('an AI failure says the assistant is busy, with a ref, and a retry works', async ({
    page,
  }) => {
    await login(page, '/app/');
    await useDemoLocation(page);
    let failing = true;
    await page.route('**/requests', (route) =>
      failing && route.request().method() === 'POST'
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'ai_busy', message: 'busy', requestId: 'AB12CD' },
            }),
          })
        : route.continue(),
    );
    await ask(page, 'bottle brush');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(
      'Our assistant is busy right now. Please try again in a minute.',
    );
    await expect(alert).toContainText('Ref: AB12CD');
    await expect(alert).not.toContainText(/couldn't understand/i);
    expect(await screenProblems(page)).toEqual([]);

    failing = false;
    await page.getByRole('button', { name: 'Find nearby' }).click();
    await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
  });

  test('a chosen suggestion is the request; zero shops never reads "all replied"', async ({
    page,
  }) => {
    await login(page, '/app/');
    await useDemoLocation(page);
    await ask(page, 'bottle brsh');
    const sheet = page.getByRole('dialog', { name: /Did you mean/ });
    await sheet.getByRole('button', { name: /Yes, this one/ }).click();
    await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
    await expect(page.locator('.sh-parchi__item')).toContainText(/bottle brush/i);
    await expect(page.locator('.sh-parchi__alias')).toHaveText('you typed: bottle brsh');
    // Whatever moment the page is caught in, "no shops" and "all replied" never go together.
    const text = await page.locator('main').innerText();
    expect(!(text.includes('No shops asked') && text.includes('All shops have replied.'))).toBe(
      true,
    );
    expect(await screenProblems(page)).toEqual([]);
  });

  test('a search whose answer was lost comes back on retry, photo and all, once', async ({
    page,
  }) => {
    await login(page, '/app/');
    await useDemoLocation(page);
    await page.getByLabel('What do you need?').fill('haldi');
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'toy.jpg', mimeType: 'image/jpeg', buffer: await photo() });
    await expect(page.getByRole('img', { name: 'Your photo' })).toBeVisible();

    // The server finishes the search; the answer never reaches the phone (a proxy cut it).
    let cut = true;
    await page.route('**/requests', async (route) => {
      if (!cut || route.request().method() !== 'POST') return route.continue();
      cut = false;
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByRole('button', { name: 'Find nearby' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Something went wrong');
    await expect(alert).toContainText(/Ref: \S+/);
    // The photo stays; the retry reuses the search the server already made.
    await expect(page.getByRole('img', { name: 'Your photo' })).toBeVisible();
    await page.getByRole('button', { name: 'Find nearby' }).click();
    await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
    await back(page);
    await expect(page.getByRole('link', { name: /· View/ })).toHaveCount(1);
  });
});

test.describe('up to three active searches (C-08, C-10)', () => {
  test('cards, the back arrow, a refresh, the 4th prompt and Stop', async ({ page }) => {
    await login(page, '/app/');
    await useDemoLocation(page);
    const items = ['haldi', 'chini', 'namak'];
    for (const [i, what] of items.entries()) {
      await ask(page, what);
      await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
      await back(page);
      await expect(page).toHaveURL(/\/app\/$/);
      await expect(page.getByRole('link', { name: /· View/ })).toHaveCount(i + 1);
    }
    // The back arrow did not stop anything: every request is still live.
    const cards = page.getByRole('link', { name: /· View/ });
    expect(await screenProblems(page)).toEqual([]);

    // A card reopens its replies, at an address of its own that survives a refresh.
    await cards.first().click();
    await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/);
    const address = page.url();
    await page.reload();
    await expect(page).toHaveURL(address);
    await expect(page.getByRole('heading', { name: 'Replies' })).toBeVisible();
    await back(page);

    // A 4th search asks which of the three to stop.
    await page.getByLabel('What do you need?').fill('doodh');
    await page.getByRole('button', { name: 'Find nearby' }).click();
    const sheet = page.getByRole('dialog', { name: 'You can have 3 searches at a time' });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(500); // the sheet has finished sliding in
    expect(await screenProblems(page)).toEqual([]);
    await sheet
      .getByRole('button', { name: /^Stop / })
      .first()
      .click();
    await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
    await back(page);
    await expect(page.getByRole('link', { name: /· View/ })).toHaveCount(3);
    // Three are live: no hint to make a list.
    await expect(
      page.getByRole('button', { name: 'Need several things? Make a list' }),
    ).toHaveCount(0);
  });
});

test.describe('the shop (S-07, X-03)', () => {
  test('Not available can be undone for 5 seconds, then it is final', async ({ browser }) => {
    const corner = newCorner();
    const shopContext = await shopContextAt(browser, corner);
    const shop = await shopContext.newPage();
    await onboardShop(shop, uniqueName('Undo Test Kirana'));
    const { context, page: customer } = await customerAt(browser, corner);
    await ask(customer, 'haldi');

    await shop.getByRole('button', { name: 'Answer' }).click({ timeout: 30_000 });
    await shop.getByRole('button', { name: 'Not available' }).click();
    const bar = shop.getByRole('status', { name: 'Marked as not available' });
    await expect(bar).toBeVisible();
    await expect(shop.getByRole('dialog')).toHaveCount(0);
    expect(await screenProblems(shop)).toEqual([]);
    await bar.getByRole('button', { name: 'Undo' }).click();
    await expect(bar).toHaveCount(0);
    await expect(shop.getByRole('button', { name: 'Answer' })).toBeVisible();

    await shop.getByRole('button', { name: 'Answer' }).click();
    await shop.getByRole('button', { name: 'Not available' }).click();
    // Still its question for the first seconds, then final: the slip is stamped and leaves.
    await shop.waitForTimeout(2000);
    await expect(shop.getByRole('button', { name: 'Answer' })).toBeVisible();
    await expect(shop.getByText('No requests right now')).toBeVisible({ timeout: 15_000 });
    await context.close();
    await shopContext.close();
  });

  test('a demo shop starts setup on the demo place and Start saves it there', async ({
    browser,
  }) => {
    const phone = '9000000108';
    await forgetShopOf(phone);
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.goto('/app/shop');
    await page.getByLabel(/mobile number/i).fill(phone);
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByRole('button', { name: 'Fill the code' }).click();
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your shop' })).toBeVisible();
    await expect(page.getByText('Demo area: Vijay Nagar, Indore')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change' })).toBeVisible();
    expect(await screenProblems(page)).toEqual([]);

    const name = uniqueName('Demo Setup Kirana');
    await page.getByLabel('Shop name').fill(name);
    await page.getByRole('button', { name: 'Grocery' }).click();
    await page.getByRole('button', { name: 'Start getting requests' }).click();
    await expect(page.getByRole('switch', { name: 'Open' })).toBeVisible({ timeout: 15_000 });
    const place = await shopPlace(name);
    expect(Math.abs(place.lat - 22.7196)).toBeLessThan(0.001);
    expect(Math.abs(place.lng - 75.8577)).toBeLessThan(0.001);
    await forgetShopOf(phone);
    await context.close();
  });

  test('Change on the demo banner hands the choice back to the shop', async ({ browser }) => {
    const phone = '9000000109';
    await forgetShopOf(phone);
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.goto('/app/shop');
    await page.getByLabel(/mobile number/i).fill(phone);
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByRole('button', { name: 'Fill the code' }).click();
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('button', { name: 'Change' }).click();
    await expect(page.getByText(/Demo area/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Use my current location' })).toBeVisible();
    await context.close();
  });
});

test.describe('screenshots of the changed screens', () => {
  for (const size of SIZES) {
    for (const theme of THEMES) {
      test(`${size.name} ${theme}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        const tag = `${size.name}-${theme}`;
        await login(page, '/app/');
        await useDemoLocation(page);

        // Find: progress words, the busy error, the cards.
        await page.route('**/requests', (route) =>
          route.request().method() === 'POST'
            ? route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({
                  error: { code: 'ai_busy', message: 'busy', requestId: 'AB12CD' },
                }),
              })
            : route.continue(),
        );
        await ask(page, 'Mobile phone');
        await expect(page.getByRole('alert')).toContainText('Ref: AB12CD');
        await shoot(page, `find-busy-${tag}`);
        await page.unroute('**/requests');

        await page.getByLabel('What do you need?').fill('bottle brsh');
        await page.getByRole('button', { name: 'Find nearby' }).click();
        const sheet = page.getByRole('dialog', { name: /Did you mean/ });
        await expect(sheet).toBeVisible();
        await page.waitForTimeout(500);
        await shoot(page, `did-you-mean-${tag}`);
        await sheet.getByRole('button', { name: /Yes, this one/ }).click();
        await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
        await expect(page.locator('.sh-parchi__alias')).toHaveText('you typed: bottle brsh');
        await shoot(page, `replies-chosen-${tag}`);
        await back(page);

        for (const what of ['haldi', 'chini']) {
          await ask(page, what);
          await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
          await back(page);
        }
        await expect(page.getByRole('link', { name: /· View/ })).toHaveCount(3);
        await shoot(page, `find-cards-${tag}`);
        await page.getByLabel('What do you need?').fill('doodh');
        await page.getByRole('button', { name: 'Find nearby' }).click();
        await expect(
          page.getByRole('dialog', { name: 'You can have 3 searches at a time' }),
        ).toBeVisible();
        await page.waitForTimeout(500); // the sheet has finished sliding in
        await shoot(page, `limit-sheet-${tag}`);
        await context.close();
      });
    }
  }
});
