import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  ask,
  customerAt,
  goTo,
  newCorner,
  onboardShop,
  order,
  setDelivery,
  sheetLogin,
  shopContextAt,
  VIEWPORT,
} from './orderFlow.js';
import { uniqueName, uniquePhone } from './unique.js';

// Every customer screen, at phone and desktop width, in light and dark: a screenshot to look at
// (e2e/screens/customer/, not committed) and an accessibility scan that must find nothing serious
// or critical (ADR-0042). Six real shops stand in one quiet corner and answer one request: three
// say yes (the most the customer sees live, ADR-0043; Alpha delivers and is the cheapest), the
// fourth answers a moment late and is remembered, like Echo from an earlier request, and one says no. One delivery
// order is out for delivery, one pickup question is open and one errand has a plan.
// Fail fast: a broken screen must not burn minutes. One try, 90 s.
test.describe.configure({ retries: 0 });
test.setTimeout(90_000);

/**
 * The shop's waiting question, found over HTTP while it is still open; the returned function
 * answers it as the shop app does (POST /pings/:id/answer), with the shop's own login. Find the
 * question first and answer later: after the third yes the other pings are no longer waiting
 * (they are NO_REPLY), but they can still be answered, late.
 */
async function waitingPing(shop: Page) {
  const origin = new URL(shop.url()).origin;
  const token = await shop.evaluate(() => localStorage.getItem('km-token'));
  const headers = { Authorization: `Bearer ${token}` };
  const http = shop.context().request;
  let pings: { id: string }[] = [];
  for (let i = 0; i < 40 && pings.length === 0; i++) {
    pings = (await (await http.get(`${origin}/shops/me/pings`, { headers })).json()) as {
      id: string;
    }[];
    if (pings.length === 0) await shop.waitForTimeout(500);
  }
  expect(pings.length, 'the shop was asked').toBeGreaterThan(0);
  const id = (pings[0] as { id: string }).id;
  return async (body: Record<string, unknown>) => {
    const res = await http.post(`${origin}/pings/${id}/answer`, { headers, data: body });
    expect(res.ok(), await res.text()).toBe(true);
  };
}

/** SCREENS=1 writes the 360/1280 x light/dark screenshots to look at; off by default (and in CI). */
const SCREENS = process.env['SCREENS'] === '1';
const SIZES = [
  { name: '360', width: 360, height: 800 },
  { name: '1280', width: 1280, height: 800 },
] as const;
const THEMES = ['light', 'dark'] as const;

async function look(page: Page, name: string) {
  // CI scans 360 px only, light and dark. SCREENS=1 adds 1280 px and writes the screenshots.
  for (const size of SCREENS ? SIZES : SIZES.slice(0, 1)) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      if (SCREENS)
        await page.screenshot({ path: `e2e/screens/customer/${name}-${size.name}-${theme}.png` });
      const scan = await new AxeBuilder({ page }).analyze();
      const bad = scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        bad.map(
          (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
        ),
        `${name} at ${size.name} in ${theme}`,
      ).toEqual([]);
    }
  }
  await page.setViewportSize(VIEWPORT);
}

type Corner = ReturnType<typeof newCorner>;

async function shopAt(browser: Browser, corner: Corner, name: string, delivers: boolean) {
  const context = await shopContextAt(browser, corner);
  const page = await context.newPage();
  await onboardShop(page, name);
  if (delivers) await setDelivery(page);
  return { context, page, name };
}

/** The shop answers the delivery question on its deck: will deliver (with a price), pickup only, or no. */
async function answer(shop: Page, choice: 'deliver' | 'pickup' | 'none', price?: string) {
  await shop.getByRole('button', { name: 'Answer' }).click({ timeout: 30_000 });
  const name = {
    deliver: 'Have it, will deliver',
    pickup: "Have it, can't deliver",
    none: 'Not available',
  }[choice];
  await shop.getByRole('radio', { name }).check();
  if (price) await shop.getByLabel('Price', { exact: true }).fill(price);
  await shop.getByRole('button', { name: 'Confirm' }).click();
  await expect(shop.getByText('No requests right now')).toBeVisible({ timeout: 15_000 });
}

test('every customer screen is readable and passes the accessibility scan', async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  const corner = newCorner();

  // --- Find and the login sheet, before any login (screens 1 and 2).
  const anonContext = await browser.newContext({
    viewport: VIEWPORT,
    geolocation: corner,
    permissions: ['geolocation'],
  });
  contexts.push(anonContext);
  const anon = await anonContext.newPage();
  await anon.goto('/app/');
  await expect(anon.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
  await look(anon, '1a-find-signed-out');
  await ask(anon, 'chini');
  const sheet = anon.getByRole('dialog', { name: 'Log in to send your request' });
  await expect(sheet).toBeVisible();
  await look(anon, '2a-login-sheet-phone');
  await sheet.getByLabel('Mobile number').fill(uniquePhone());
  await sheet.getByRole('button', { name: 'Send code' }).click();
  await expect(sheet.getByRole('button', { name: 'Fill demo OTP' })).toBeVisible();
  await look(anon, '2b-login-sheet-code');
  await sheet.getByRole('button', { name: 'Close' }).click();

  // --- Echo opens first and answers an earlier request alone: it is remembered afterwards. (A shop
  // that was just asked is not asked again for the same item, so the others open after this.)
  const e = await shopAt(browser, corner, uniqueName('Seed Echo Kirana'), true);
  contexts.push(e.context);
  const { context, page } = await customerAt(browser, corner);
  contexts.push(context);
  await ask(page, 'haldi', { delivery: true });
  await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
  await answer(e.page, 'deliver', '38');
  await expect(page.getByRole('listitem').filter({ hasText: e.name })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Stop asking' }).click();

  // --- Five more shops in the same quiet corner.
  const a = await shopAt(browser, corner, uniqueName('Seed Alpha Kirana'), true);
  const b = await shopAt(browser, corner, uniqueName('Seed Bravo Kirana'), false);
  const c = await shopAt(browser, corner, uniqueName('Seed Charlie Kirana'), false);
  const d = await shopAt(browser, corner, uniqueName('Seed Delta Kirana'), false);
  const f = await shopAt(browser, corner, uniqueName('Seed Foxtrot Kirana'), false);
  for (const s of [a, b, c, d, f]) contexts.push(s.context);

  // The request this run is about: two yes (Alpha delivers), two no, Echo remembered.
  await page.goto('/app/');
  await ask(page, 'haldi', { delivery: true });
  await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
  const requestUrl = page.url();
  // Wait until all four shops have the question, then answer in order.
  await Promise.all(
    [a, b, c, d, f].map(async (s) => {
      await expect(s.page.getByRole('button', { name: 'Answer' })).toBeVisible({ timeout: 30_000 });
    }),
  );
  // The first three yes are live; the fourth comes after them, so it is a late answer whatever the
  // network does (sent together, any of the four could be the one left out).
  const replyAlpha = await waitingPing(a.page);
  const replyBravo = await waitingPing(b.page);
  const replyCharlie = await waitingPing(c.page);
  const replyDelta = await waitingPing(d.page);
  const replyFoxtrot = await waitingPing(f.page);
  await replyAlpha({
    answer: 'yes',
    pricePaise: 4000,
    delivery: { feePaise: 2000, minutes: 30 },
  });
  await replyBravo({ answer: 'yes', pricePaise: 4500 });
  await replyCharlie({ answer: 'yes', pricePaise: 4200 });
  await replyDelta({ answer: 'yes', pricePaise: 5000 });
  await replyFoxtrot({ answer: 'no' });
  await expect(page.getByRole('listitem').filter({ hasText: a.name })).toBeVisible({
    timeout: 30_000,
  });
  // Three replies are live and the cheapest says so; the fourth shop and Echo are remembered.
  await expect(page.getByText(/3 have it/i)).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole('listitem').filter({ hasText: a.name }).getByText('Best price nearby'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Best price nearby')).toHaveCount(1);
  await expect(page.getByText(/Had it .* at ₹38/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Had it .* at ₹50/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /shops? (doesn't|don't) have it/ })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: /shops? (doesn't|don't) have it/ }).click();
  await look(page, '4a-replies-list');
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible({ timeout: 15_000 });
  await look(page, '4b-replies-map');
  await page.getByRole('button', { name: 'List' }).click();

  // --- Choose a shop (screen 5), then the delivery order (screen 6, out for delivery).
  const replyA = page.getByRole('listitem').filter({ hasText: a.name });
  await replyA.getByRole('button', { name: 'Choose this shop' }).click();
  const choose = page.getByRole('dialog', { name: 'Choose this shop' });
  await choose.getByRole('radio', { name: /Get it delivered/ }).check();
  await look(page, '5a-choose-delivery');
  await choose.getByRole('radio', { name: /I'll pick it up/ }).check();
  await look(page, '5b-choose-pickup');
  await choose.getByRole('button', { name: 'Close' }).click();
  await order(page, replyA);
  await look(page, '6a-order-accepted');
  await goTo(a.page, 'orders');
  await a.page.getByRole('button', { name: 'Out for delivery' }).first().click();
  await expect(
    page.getByText('Reaching by').or(page.getByText(/Out for delivery since/)),
  ).toBeVisible({ timeout: 20_000 });
  await look(page, '6b-order-out-for-delivery');

  // --- A pickup from Delta (remembered, never orderable) opens the "Did you get it?" question (screen 7).
  await page.context().route('https://www.google.com/**', (route) => route.abort());
  await page.goto(requestUrl);
  const replyD = page.getByRole('listitem').filter({ hasText: d.name });
  const popup = page.waitForEvent('popup').catch(() => null);
  await replyD.getByRole('link', { name: 'Show the way' }).click();
  await (await popup)?.close().catch(() => undefined);
  await page.goto('/app/orders');
  await expect(page.getByText(/Did you get .+ at .+\?/)).toBeVisible({ timeout: 15_000 });
  await look(page, '7-my-orders');

  // --- Find with the order strip, and the "Did you mean" sheet (screens 1 and 3).
  await page.goto('/app/');
  await expect(page.getByRole('link', { name: 'Track' })).toBeVisible({ timeout: 15_000 });
  await look(page, '1b-find-with-order');
  await ask(page, 'bottle brsh');
  await expect(page.getByRole('dialog', { name: /Did you mean/ })).toBeVisible();
  await look(page, '3-did-you-mean');
  await page.getByRole('button', { name: 'Close' }).click();

  // --- The errand: the list, then the plan (screens 8 and 9). The simulated shops in Indore answer.
  await page.goto('/app/errand');
  await look(page, '8a-errand-new');
  await page.getByLabel("What's the job?").fill('chai banane ka saaman');
  await page.getByRole('button', { name: 'Use demo location (Indore)' }).click();
  await page.getByRole('button', { name: 'Make my list' }).click();
  await expect(page.getByRole('heading', { name: 'Your list' })).toBeVisible({ timeout: 30_000 });
  await look(page, '8b-errand-list');
  await page.getByRole('button', { name: /Ask shops for these \d+/ }).click();
  await expect(page.getByText('Plan ready', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible({ timeout: 15_000 });
  await look(page, '9-errand-plan');

  // --- An address that needs a login, opened signed out: the sheet comes up and then the screen.
  const gated = await anonContext.newPage();
  await gated.goto('/app/orders');
  const gatedSheet = gated.getByRole('dialog', { name: 'Log in to send your request' });
  await expect(gatedSheet).toBeVisible();
  await sheetLogin(gated);
  await expect(gated.getByRole('heading', { name: 'My orders' })).toBeVisible();

  for (const ctx of contexts) await ctx.close();
});
