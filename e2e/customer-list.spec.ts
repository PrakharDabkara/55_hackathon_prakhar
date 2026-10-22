import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { forgetDemoStock } from './db.js';
import {
  ask,
  customerAt,
  goTo,
  newCorner,
  noSidewaysScroll,
  onboardShop,
  setDelivery,
  shopContextAt,
  VIEWPORT,
} from './orderFlow.js';

// Shopping lists in the customer app (ADR-0055, PR U3), in real browsers at 360 px. Part one is a
// customer at the demo place, where the simulated shops answer. Part two is a quiet corner of its
// own with two real shops (one delivers, one does not), so prices and modes are known.
// Screenshots go to e2e/screens/customer/ (not committed), or to U3_SHOTS_DIR at 390 px wide.
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const DEMO = { latitude: 22.7196, longitude: 75.8577 };

async function nothingBlocking(page: Page, label: string) {
  const scan = await new AxeBuilder({ page }).analyze();
  const bad = scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}

/** Light, dark (the phone's setting) and dark through data-theme, as the Account screen sets it. */
async function scanBoth(page: Page, label: string) {
  // A sheet that just opened is still rising for 160 ms: scan it once it has settled.
  await page.waitForTimeout(300);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await nothingBlocking(page, `${label} in ${scheme}`);
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await nothingBlocking(page, `${label} with data-theme dark`);
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

async function shot(page: Page, file: string, scheme: 'light' | 'dark' = 'light') {
  const dir = process.env['U3_SHOTS_DIR'];
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  if (dir) await page.setViewportSize({ width: 390, height: 1500 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: dir ? `${dir}/${file}.png` : `e2e/screens/customer/U3-${file}-360-${scheme}.png`,
  });
  if (dir) await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

/** The element is on screen and a tap at its centre would hit it (nothing sticky covers it). */
async function expectUncovered(target: Locator) {
  await expect(target).toBeInViewport({ ratio: 1 });
  const hit = await target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top !== null && el.contains(top);
  });
  expect(hit).toBe(true);
}

const lineInputs = (page: Page) => page.locator('.cu-leditor__input');

// ---------------------------------------------------------------------------------------------
// Part one: the demo place, simulated shops.

// Part one asks at the demo place, shared with every other spec: forget what the shops learned.
test.afterAll(forgetDemoStock);

let demo: { context: BrowserContext; page: Page };
test.afterAll(async () => {
  await demo?.context.close();
});

test('S58: build a list with Enter, a paste and a remove', async ({ browser }) => {
  demo = await customerAt(browser, DEMO);
  const page = demo.page;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'A list' }).click();
  await expect(page.getByText('Enter adds the next line')).toBeVisible();
  await expect(
    page.getByText('Pick up or delivery: you choose for each shop once they answer.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find these nearby' })).toBeDisabled();

  await page.getByRole('textbox', { name: 'Next item' }).fill('namak');
  await page.keyboard.press('Enter');
  await page.keyboard.type('haldi');
  await page.keyboard.press('Enter');
  await page.keyboard.type('tractor spare bolt');
  await expect(lineInputs(page)).toHaveCount(4); // three lines and the empty "Next item"

  // A paste of a comma list becomes lines.
  await page.getByRole('textbox', { name: 'Next item' }).focus();
  await page.evaluate(() => {
    const target = document.activeElement as HTMLElement;
    const data = new DataTransfer();
    data.setData('text/plain', 'atta, mirchi');
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.getByText('5 of 10')).toBeVisible();

  // A line is removed with its ✕, named after it.
  await page.getByRole('button', { name: 'Remove haldi' }).click();
  await expect(page.getByText('4 of 10')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Item 2' })).toHaveValue('tractor spare bolt');
  await expect(page.getByRole('button', { name: 'Find these 4 nearby' })).toBeEnabled();
  await noSidewaysScroll(page);
  await shot(page, 'list-editor');
  await scanBoth(page, 'the list editor');

  // The words survive a switch to One thing and back, and a reload.
  await page.getByRole('button', { name: 'One thing' }).click();
  await page.getByRole('button', { name: 'A list' }).click();
  await expect(page.getByText('4 of 10')).toBeVisible();
  await page.reload();
  await expect(page.getByText('4 of 10')).toBeVisible();
});

test('S59: the check screen asks about "mirchi", then the list goes to the shops', async () => {
  const page = demo.page;
  await page.getByRole('button', { name: 'Find these 4 nearby' }).click();
  await expect(page.getByRole('heading', { name: 'Check your list' })).toBeVisible({
    timeout: 30_000,
  });
  const row = page.getByRole('listitem', { name: 'mirchi' });
  await expect(row.getByRole('radiogroup')).toBeVisible();
  await expect(row.getByRole('radio', { name: 'As I typed' })).toBeVisible();
  await expect(page.getByText(/AI sorted your list and can make mistakes/)).toBeVisible();
  await expect(page.getByText("Not in our list: we'll ask every shop nearby")).toBeVisible();

  // Sending without answering the question says so and sends nothing.
  await page.getByRole('button', { name: 'Ask shops nearby' }).click();
  await expect(page.getByText('Choose one for “mirchi”.')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/list\/[\w-]+$/);
  await noSidewaysScroll(page);
  await shot(page, 'list-check');
  await scanBoth(page, 'the check screen');

  await row.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Ask shops nearby' }).click();
  await expect(page.getByText(/^Sent to \d+ shops? · 4 items$/)).toBeVisible({ timeout: 30_000 });
});

test('S60: answers arrive as ranked cards, the first one open', async () => {
  const page = demo.page;
  const cards = page.locator('li[aria-label]').filter({ has: page.locator('.cu-lanswer__head') });
  await expect.poll(async () => cards.count(), { timeout: 90_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByText(/shops? answered · still listening for \d+ min/)).toBeVisible();
  await expect(cards.first().getByRole('button', { expanded: true })).toBeVisible();
  await expect(cards.nth(1).getByRole('button', { expanded: false })).toBeVisible();

  // More lines had first (the API's order), as "X of 4".
  const haves = (await cards.locator('.cu-lanswer__count').allTextContents()).map((t) =>
    Number(/^(\d+) of 4$/.exec(t.trim())?.[1]),
  );
  expect(haves.length).toBeGreaterThanOrEqual(2);
  expect([...haves].sort((a, b) => b - a)).toEqual(haves);

  await expect(page.getByRole('button', { name: 'Make my plan' })).toBeEnabled();
  await expect(page.getByText(/items? have a shop so far|Every item has a shop/)).toBeVisible();
  await noSidewaysScroll(page);
  await shot(page, 'list-replies', 'light');
  await shot(page, 'list-replies-dark', 'dark');
  await scanBoth(page, 'the list replies');
});

test('S61: Stop asking on a list and on a single search, each asked in the page first', async ({
  browser,
}) => {
  const page = demo.page;
  await page.getByRole('button', { name: 'Stop asking' }).click();
  const sheet = page.getByRole('dialog', { name: 'Stop asking shops?' });
  await expect(sheet).toBeVisible();
  await scanBoth(page, 'the stop sheet');
  await sheet.getByRole('button', { name: 'Keep waiting' }).click();
  await expect(sheet).toHaveCount(0);
  // The simulated shops may already have filled the list (8 answers): both read as live.
  await expect(page.getByText(/still listening|Enough answers/)).toBeVisible();

  await page.getByRole('button', { name: 'Stop asking' }).click();
  await sheet.getByRole('button', { name: 'Stop asking' }).click();
  await expect(page.getByText(/^You stopped asking · \d+ shops? answered$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make my plan' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop asking' })).toHaveCount(0);

  // A single search: Home, then "One thing", then Stop asking with the same question.
  await page.goto('/app/');
  await page.getByRole('button', { name: 'One thing' }).click();
  await ask(page, 'haldi');
  await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Stop asking' }).click();
  await expect(page.getByRole('dialog', { name: 'Stop asking shops?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Stop asking' }).click();
  await expect(page.getByRole('heading', { name: 'What do you need?' })).toBeVisible({
    timeout: 15_000,
  });
  void browser;
});

// ---------------------------------------------------------------------------------------------
// Part two: two real shops in a corner of their own.

const corner = newCorner();
let alpha: Page; // delivers
let bravo: Page; // pickup only
let alphaContext: BrowserContext;
let bravoContext: BrowserContext;
let buyer: { context: BrowserContext; page: Page };
const suffix = Date.now().toString(36);
const alphaName = `Plan Alpha ${suffix}`;
const bravoName = `Plan Bravo ${suffix}`;
let listUrl = '';

const parchi = (shop: Page) => shop.locator('article.sh-parchi').filter({ hasText: /A list · / });

/** Ticks every line of the open list card and prices them in the order shown. */
async function answerWith(shop: Page, prices: string[], fee: string | null) {
  const card = parchi(shop);
  await expect(card).toHaveCount(1, { timeout: 60_000 });
  const boxes = card.getByRole('checkbox');
  await expect(boxes).toHaveCount(prices.length);
  for (let i = 0; i < prices.length; i++) await boxes.nth(i).click();
  const fields = card.getByLabel(/^Price for /);
  for (let i = 0; i < prices.length; i++) await fields.nth(i).fill(prices[i] as string);
  const deliver = card.getByRole('switch', { name: /I can deliver this list/ });
  if (fee === null) {
    if (await deliver.count()) {
      if ((await deliver.getAttribute('aria-checked')) === 'true') await deliver.click();
    }
  } else {
    if ((await deliver.getAttribute('aria-checked')) !== 'true') await deliver.click();
    await card.getByLabel('Delivery fee').fill(fee);
  }
  await card.getByRole('button', { name: 'Send answer' }).click();
  await expect(card).toHaveCount(0, { timeout: 15_000 });
}

test('S62: two real shops answer a list line by line', async ({ browser }) => {
  alphaContext = await shopContextAt(browser, corner);
  bravoContext = await shopContextAt(browser, corner);
  alpha = await alphaContext.newPage();
  bravo = await bravoContext.newPage();
  await onboardShop(alpha, alphaName);
  await setDelivery(alpha);
  await onboardShop(bravo, bravoName);
  buyer = await customerAt(browser, corner);
  const page = buyer.page;
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.getByRole('button', { name: 'A list' }).click();
  await page.getByRole('textbox', { name: 'Next item' }).fill('chini');
  await page.keyboard.press('Enter');
  await page.keyboard.type('haldi');
  await page.keyboard.press('Enter');
  await page.keyboard.type('atta');
  // Nothing here needs a question: the list goes straight to the shops.
  await page.getByRole('button', { name: 'Find these 3 nearby' }).click();
  await expect(page).toHaveURL(/\/app\/list\/[\w-]+$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Check your list' })).toHaveCount(0);
  await expect(page.getByText('Sent to 2 shops · 3 items')).toBeVisible({ timeout: 30_000 });
  listUrl = page.url();

  await goTo(alpha, 'requests');
  await goTo(bravo, 'requests');
  await answerWith(alpha, ['50', '60', '30'], '25');
  await answerWith(bravo, ['40', '42', '35'], null);
  await expect(page.getByText('2 shops answered · still listening', { exact: false })).toBeVisible({
    timeout: 30_000,
  });
});

test('S63: make the plan, switch a shop to Deliver, move one item', async () => {
  const page = buyer.page;
  await page.getByRole('button', { name: 'Make my plan' }).click();
  await expect(page.getByRole('heading', { name: 'Your plan' })).toBeVisible();
  const stats = page.getByRole('group', { name: 'Plan totals' });
  // One shop covers all three, and the cheaper one (Bravo, ₹117) is it.
  await expect(stats.getByText('3 of 3')).toBeVisible();
  await expect(stats.getByText('₹117')).toBeVisible();
  const cardOf = (name: string) => page.getByRole('listitem', { name });
  await expect(cardOf(bravoName)).toBeVisible();
  await expect(cardOf(alphaName)).toHaveCount(0);
  await expect(cardOf(bravoName).getByRole('button', { name: "Doesn't deliver" })).toBeDisabled();
  await noSidewaysScroll(page);

  // Move Atta to Alpha: two shops now, and Alpha can deliver.
  await cardOf(bravoName)
    .getByRole('button', { name: /Wheat flour/ })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Move Wheat flour' });
  await expect(sheet.getByText('₹30')).toBeVisible();
  await sheet.getByRole('button', { name: new RegExp(alphaName) }).click();
  await expect(cardOf(alphaName).getByText('1 item')).toBeVisible();
  await expect(cardOf(bravoName).getByText('2 items')).toBeVisible();
  await expect(stats.getByText('₹112')).toBeVisible(); // 40 + 42 + 30

  await cardOf(alphaName).getByRole('button', { name: 'Deliver · ₹25' }).click();
  await expect(stats.getByText('₹137')).toBeVisible();
  await page.getByLabel('Delivery address').fill('Flat 4B, Sapna Apartments, Vijay Nagar, Indore');
  await expect(page.getByRole('button', { name: 'Order from 2 shops · pay cash' })).toBeVisible();
  await expect(
    page.getByText('Each shop gets its own order. Prices are fixed once you order.'),
  ).toBeVisible();
  await shot(page, 'list-plan');
  await scanBoth(page, 'the plan');
});

test('S64: order, then pickup "Got it" and delivery "I received it"', async () => {
  const page = buyer.page;
  await page.getByRole('button', { name: 'Order from 2 shops · pay cash' }).click();
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible({ timeout: 30_000 });
  const cardOf = (name: string) => page.getByRole('listitem', { name });
  await expect(cardOf(bravoName).getByText('Being packed · 0 of 2')).toBeVisible();
  await expect(cardOf(alphaName)).toBeVisible();
  await noSidewaysScroll(page);

  // Bravo packs both lines (a packing slip) and marks it ready: the count moves live.
  await goTo(bravo, 'orders');
  const slip = bravo.locator('article.sh-order').filter({ hasText: 'Pickup · 2 items' });
  await expect(slip).toBeVisible({ timeout: 30_000 });
  await slip.getByRole('checkbox').nth(0).click();
  await expect(cardOf(bravoName).getByText('Being packed · 1 of 2')).toBeVisible({
    timeout: 30_000,
  });
  await slip.getByRole('checkbox').nth(1).click();
  await slip.getByRole('button', { name: 'Ready for pickup' }).click();
  await expect(cardOf(bravoName).getByText('Ready for pickup')).toBeVisible({ timeout: 30_000 });
  await expect(cardOf(bravoName).getByRole('link', { name: /Directions/ })).toBeVisible();
  await shot(page, 'list-orders');
  await scanBoth(page, 'the list orders');
  await cardOf(bravoName).getByRole('button', { name: 'Got it' }).click();
  await expect(cardOf(bravoName).getByText('Collected')).toBeVisible({ timeout: 15_000 });

  // Alpha delivers: out for delivery, then received.
  await goTo(alpha, 'orders');
  const delivery = alpha.locator('article.sh-order').first();
  await expect(delivery.getByRole('button', { name: 'Out for delivery' })).toBeVisible({
    timeout: 30_000,
  });
  await delivery.getByRole('button', { name: 'Out for delivery' }).click();
  await expect(cardOf(alphaName).getByText('Out for delivery')).toBeVisible({ timeout: 30_000 });
  await cardOf(alphaName).getByRole('button', { name: 'I received it' }).click();
  await expect(cardOf(alphaName).getByText('Delivered')).toBeVisible({ timeout: 15_000 });
});

test('S65: My orders groups the list, and the push link opens its replies', async () => {
  const page = buyer.page;
  await page.goto('/app/orders');
  const row = page.getByRole('link', { name: /List · 3 items/ });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('2 shops');
  await noSidewaysScroll(page);

  // The address a list notification opens (ADR-0055 rule 15) shows the same list.
  const id = new URL(listUrl).pathname.split('/').pop() as string;
  await page.goto(`/app/list/${id}`);
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible({ timeout: 15_000 });
  await expectUncovered(page.getByRole('button', { name: 'Back' }));
  await alphaContext.close();
  await bravoContext.close();
  await buyer.context.close();
});
