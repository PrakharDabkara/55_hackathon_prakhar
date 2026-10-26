import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { axeProblems, screenProblems } from './a11y.js';
import { forgetDemoStock } from './db.js';
import {
  ask,
  customerAt,
  login,
  newCorner,
  onboardShop,
  shopContextAt,
  useDemoLocation,
} from './orderFlow.js';
import { uniqueName } from './unique.js';

// App round 3: the retest of the phone test. Real browsers, API and Postgres. Screenshots go to
// SCREENS_DIR (not committed).
const OUT = process.env['SCREENS_DIR'] ?? join('e2e', 'artifacts', 'app-round3');
test.setTimeout(240_000);
test.beforeEach(async () => forgetDemoStock());

test.describe('asking shops (C-05, C-17)', () => {
  test('Ask shops now asks the shop that had it recently', async ({ browser }) => {
    const corner = newCorner();
    const shopContext = await shopContextAt(browser, corner);
    const shop = await shopContext.newPage();
    await onboardShop(shop, uniqueName('Remembered Kirana'));

    // A first customer: the shop says yes, so it now remembers the item.
    const first = await customerAt(browser, corner);
    await ask(first.page, 'haldi');
    await shop.getByRole('button', { name: 'Answer' }).click({ timeout: 30_000 });
    await shop.getByRole('radio', { name: 'Have it' }).first().check();
    await shop.getByLabel('Price', { exact: true }).fill('40');
    await shop.getByRole('button', { name: 'Confirm' }).click();
    await first.context.close();

    // A second customer: one remembered shop is too few, so it is not asked at first.
    const second = await customerAt(browser, corner);
    await ask(second.page, 'haldi');
    await second.page.getByRole('button', { name: 'Ask shops now' }).click({ timeout: 30_000 });
    // ...and "Ask shops now" asks it anyway.
    await expect(shop.getByRole('button', { name: 'Answer' })).toBeVisible({ timeout: 30_000 });
    await second.context.close();
    await shopContext.close();
  });

  test('every shop said no: the screen stops waiting and offers the next steps', async ({
    browser,
  }) => {
    const corner = newCorner();
    const shopContext = await shopContextAt(browser, corner);
    const shop = await shopContext.newPage();
    await onboardShop(shop, uniqueName('No Kirana'));
    const { context, page } = await customerAt(browser, corner);
    await ask(page, 'haldi');
    await expect(page.getByText('No replies yet')).toBeVisible({ timeout: 30_000 });

    await shop.getByRole('button', { name: 'Answer' }).click({ timeout: 30_000 });
    await shop.getByRole('button', { name: 'Not available' }).click();
    // Final after the 5 s undo window.
    await expect(page.getByText('None of the shops nearby have it')).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.getByText('No replies yet')).toHaveCount(0);
    await expect(page.locator('.sh-skeleton')).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'Live' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try different words' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search 5 km' })).toBeVisible();
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, 'final-state-360.png'), fullPage: true });
    expect(await screenProblems(page)).toEqual([]);
    expect(await axeProblems(page)).toEqual([]);
    await context.close();
    await shopContext.close();
  });
});

test.describe('Find (C-09, C-11)', () => {
  test('the progress words are inside the disabled button', async ({ page }) => {
    await login(page, '/app/');
    await useDemoLocation(page);
    await page.route('**/requests', async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 4500));
      await route.continue();
    });
    await ask(page, 'sugar');
    const button = page.getByRole('button', { name: 'Reading your request…' });
    await expect(button).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Finding the right item…' })).toBeDisabled({
      timeout: 6000,
    });
    await expect(page.locator('.cu-find__progress')).toHaveCount(0);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, 'find-progress-360.png') });
  });

  test('a phone says what AskBuy cannot do, not "couldn\'t understand"', async ({ page }) => {
    await login(page, '/app/');
    await useDemoLocation(page);
    await ask(page, 'Samsung A4 phone');
    await expect(page.getByRole('alert')).toContainText("can't ask shops for phones");
    await expect(page.getByText("couldn't understand")).toHaveCount(0);
  });
});

test.describe('Account (A-09)', () => {
  test('the eye shows the full number and hides it when the screen is left', async ({ page }) => {
    await login(page, '/app/');
    await page.goto('/app/account');
    const value = page.getByTestId('phone-value');
    await expect(value).toHaveText('+91 ••••• •••••');
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.getByRole('button', { name: 'Show phone number' }).click();
    await expect(value).toHaveText(/^\+91 \d{5} \d{5}$/);
    expect(requests.some((u) => u.endsWith('/account/phone/reveal'))).toBe(true);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, 'account-eye-360.png') });
    await page.goto('/app/account');
    await expect(page.getByTestId('phone-value')).toHaveText('+91 ••••• •••••');
  });
});
