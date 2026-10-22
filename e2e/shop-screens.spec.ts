import { screenProblems } from './a11y.js';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ageAnswers } from './db.js';
import {
  ask as askFor,
  customerAt,
  goTo,
  login,
  newCorner,
  orderFromReply,
  onboardShop,
  setDelivery,
  shopContextAt,
  VIEWPORT,
} from './orderFlow.js';

// Every shop screen, at phone and desktop width, in light and dark: a screenshot to look at
// (e2e/screens/shop/, not committed) and an accessibility scan that must find nothing serious or
// critical (ADR-0041). One shop is seeded with a full deck (a delivery question, plain questions,
// an order request), an order to send out and one already delivered.
test.setTimeout(400_000);

/** Collects what the page's Content-Security-Policy refuses (an inline style attribute, say). */
function watchCsp(page: Page, sink: string[]) {
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) sink.push(message.text());
  });
}

const SIZES = [
  { name: '360', width: 360, height: 800 },
  { name: '1280', width: 1280, height: 800 },
] as const;
const THEMES = ['light', 'dark'] as const;

type Corner = ReturnType<typeof newCorner>;

async function customer(browser: Browser, corner: Corner) {
  return customerAt(browser, corner);
}

async function ask(page: Page, what: string, delivery: boolean) {
  await page.goto('/app/');
  await askFor(page, what, { delivery });
}

/** The shop says "have it, will deliver" for the one question on its deck. */
async function willDeliver(shop: Page) {
  await shop.getByRole('button', { name: 'Answer' }).click({ timeout: 30_000 });
  await shop.getByRole('radio', { name: 'Have it, will deliver' }).check();
  await shop.getByLabel('Price', { exact: true }).fill('40');
  await shop.getByRole('button', { name: 'Confirm' }).click();
  await expect(shop.getByText('No requests right now')).toBeVisible({ timeout: 15_000 });
}

async function orderIt(page: Page, shopName: string) {
  await orderFromReply(page, shopName);
}

async function look(page: Page, name: string) {
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      // Let fonts, the stamp and the slide-in finish before looking.
      await page.waitForTimeout(250);
      const file = `e2e/screens/shop/${name}-${size.name}-${theme}.png`;
      await page.screenshot({ path: file, fullPage: false });
      expect.soft(await screenProblems(page), `${name} at ${size.name} in ${theme}`).toEqual([]);
    }
  }
  await page.setViewportSize(VIEWPORT);
}

test('every shop screen is readable and passes the accessibility scan', async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  const csp: string[] = [];

  // --- Login (A) and set-up (B), for a shop that does not exist yet.
  const newcomerCorner = newCorner();
  const newcomerContext = await shopContextAt(browser, newcomerCorner);
  contexts.push(newcomerContext);
  const newcomer = await newcomerContext.newPage();
  watchCsp(newcomer, csp);
  await newcomer.goto('/app/shop');
  await look(newcomer, 'A1-login');
  await login(newcomer, '/app/shop');
  await expect(newcomer.getByRole('heading', { name: 'Set up your shop' })).toBeVisible();
  await look(newcomer, 'B1-setup');
  await newcomer.getByLabel('Shop name').fill('Sharma Kirana');
  await newcomer.getByRole('button', { name: 'Grocery' }).click();
  await newcomer.getByRole('button', { name: 'Dairy' }).click();
  await newcomer.getByRole('button', { name: 'Pooja items' }).click();
  await newcomer.getByRole('button', { name: 'Use my current location' }).click();
  await expect(newcomer.getByRole('button', { name: 'Start getting requests' })).toBeEnabled();
  await look(newcomer, 'B2-setup-filled');
  await newcomer.getByRole('button', { name: 'Start getting requests' }).click();
  await expect(newcomer.getByText('No requests right now')).toBeVisible({ timeout: 15_000 });
  await look(newcomer, 'C5-empty');
  await newcomer.getByRole('switch', { name: 'Open' }).click();
  await expect(newcomer.getByText("You're closed", { exact: true })).toBeVisible();
  await look(newcomer, 'C6-closed');

  // --- A shop with a full deck.
  const corner = newCorner();
  const shopContext = await shopContextAt(browser, corner);
  contexts.push(shopContext);
  const shop = await shopContext.newPage();
  watchCsp(shop, csp);
  const shopName = `Screens Kirana ${Date.now().toString(36)}`;
  await onboardShop(shop, shopName);
  await setDelivery(shop);

  // An order to send out, one that is already delivered (the newest is first on Orders), and one that waits for Accept.
  const sent = await customer(browser, corner);
  contexts.push(sent.context);
  await ask(sent.page, 'chai patti', true);
  await willDeliver(shop);
  await orderIt(sent.page, shopName);

  const done = await customer(browser, corner);
  contexts.push(done.context);
  await ask(done.page, 'adrak', true);
  await willDeliver(shop);
  await orderIt(done.page, shopName);
  await goTo(shop, 'orders');
  await shop.getByRole('button', { name: 'Out for delivery' }).first().click();
  await expect(done.page.getByText('Out for delivery').first()).toBeVisible({ timeout: 15_000 });
  await done.page.getByRole('button', { name: 'I received it' }).click();
  await expect(done.page.getByText('Delivered').first()).toBeVisible({ timeout: 15_000 });

  const waiting = await customer(browser, corner);
  contexts.push(waiting.context);
  await ask(waiting.page, 'jeera', true);
  await goTo(shop, 'requests');
  await willDeliver(shop);
  await ageAnswers(shopName);
  await orderIt(waiting.page, shopName);

  // Questions still waiting: a delivery question and two plain ones.
  for (const [what, delivery] of [
    ['namak', false],
    ['chini', false],
    ['haldi', true],
  ] as const) {
    const c = await customer(browser, corner);
    contexts.push(c.context);
    await ask(c.page, what, delivery);
  }
  await shop.reload();
  await expect(shop.getByText(/Order request/)).toBeVisible({ timeout: 30_000 });
  await expect(shop.getByText('The customer wants this delivered')).toBeVisible({
    timeout: 30_000,
  });
  await expect(shop.locator('.sh-deck__slide')).toHaveCount(4, { timeout: 30_000 });

  await look(shop, 'C1-deck');
  await shop.getByRole('button', { name: 'Next request' }).click();
  await look(shop, 'C2-deck-second');

  // The answer sheets: a plain question (D) and a delivery question (E). The deck runs: the order
  // request, then the questions as they were asked (salt, sugar, turmeric with delivery).
  await goTo(shop, 'requests');
  await shop.locator('.sh-deck__slide').nth(1).getByRole('button', { name: 'Answer' }).click();
  await look(shop, 'D-answer-sheet');
  await shop.getByRole('button', { name: 'Close' }).click();
  await shop.locator('.sh-deck__slide').nth(3).getByRole('button', { name: 'Answer' }).click();
  await shop.getByRole('radio', { name: 'Have it, will deliver' }).check();
  await expect(shop.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await look(shop, 'E-answer-sheet-delivery');
  await shop.getByLabel('Price', { exact: true }).fill('45');
  await expect(shop.getByText('Customer pays cash · ₹65')).toBeVisible();
  await expect(shop.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  await look(shop, 'E2-answer-sheet-delivery-priced');
  await shop.getByRole('button', { name: 'Close' }).click();

  // The menu.
  await shop.getByRole('button', { name: 'Menu' }).click();
  await look(shop, 'C3-menu');
  await shop.keyboard.press('Escape');

  for (const [view, name] of [
    ['orders', 'F1-orders-active'],
    ['insights', 'G1-insights'],
    ['delivery', 'H-delivery'],
    ['settings', 'I1-settings'],
    ['notifications', 'I2-notifications'],
  ] as const) {
    await goTo(shop, view);
    await expect(shop.getByRole('heading', { level: 1 })).toBeVisible();
    await look(shop, name);
  }
  await goTo(shop, 'orders');
  await shop.getByRole('button', { name: /Done today/ }).click();
  await look(shop, 'F2-orders-done');
  await goTo(shop, 'insights');
  await shop.getByRole('button', { name: '7 days' }).click();
  await look(shop, 'G2-insights-week');

  expect(csp).toEqual([]);
  for (const context of contexts) await context.close();
});
