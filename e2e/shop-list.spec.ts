import { screenProblems } from './a11y.js';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { customerApi, listView, orderAll, sendList, stopList, type Customer } from './listApi.js';
import {
  goTo,
  newCorner,
  noSidewaysScroll,
  onboardShop,
  setDelivery,
  shopContextAt,
} from './orderFlow.js';

// Shopping lists on the shop side (ADR-0055, PR U2), in a real browser at 360 px. The customer's
// half (sorting, sending, ordering) goes through the public API; only the shop is a browser, and
// nothing here touches the database. One shop is made once and used by the tests in order.
// Screenshots go to e2e/screens/shop/ (not committed).
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

// "chini" and "haldi" are grocery words in the catalog; the third line fits no kind of shop.
const LINES = ['chini', 'haldi', 'tractor spare bolt'];
const corner = newCorner();
let context: BrowserContext;
let shop: Page;
let shopName = '';

test.beforeAll(async ({ browser }) => {
  context = await shopContextAt(browser, corner);
  shop = await context.newPage();
  shopName = `List Test Kirana ${Date.now().toString(36)}`;
  await onboardShop(shop, shopName);
  await setDelivery(shop);
});
test.afterAll(async () => context?.close());

const card = () => shop.locator('article.sh-parchi').filter({ hasText: /A list · / });

/** Ticks lines of the open list card by name and types their prices. */
async function tick(prices: Record<string, string>) {
  for (const [line, price] of Object.entries(prices)) {
    await card()
      .getByRole('checkbox', { name: new RegExp(line) })
      .click();
    await card().getByLabel(`Price for ${line}`).fill(price);
  }
}

async function nothingBlocking(page: Page, label: string) {
  expect.soft(await screenProblems(page), label).toEqual([]);
}

/** U2_SHOTS_DIR set: the same screenshots at 390 px wide, written there (for the PR). */
/** The element is on screen and is what a tap at its centre would hit (nothing sticky covers it). */
async function expectUncovered(target: Locator) {
  await expect(target).toBeInViewport({ ratio: 1 });
  const hit = await target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top !== null && el.contains(top);
  });
  expect(hit).toBe(true);
}

async function shot(file: string, target?: Locator) {
  const dir = process.env['U2_SHOTS_DIR'];
  if (dir) await shop.setViewportSize({ width: 390, height: 1100 });
  await shop.waitForTimeout(400);
  await shop.evaluate(() =>
    document.querySelectorAll('.sh-parchi__paper').forEach((el) => el.scrollTo(0, 0)),
  );
  const path = dir ? `${dir}/${file.replace('-360', '-390')}.png` : `e2e/screens/shop/${file}.png`;
  if (target) await target.screenshot({ path });
  else await shop.screenshot({ path, fullPage: false });
  if (dir) await shop.setViewportSize({ width: 360, height: 740 });
}

/** A fresh customer sends the three lines; resolves when this shop's deck shows it. */
async function newList(): Promise<{ customer: Customer; id: string }> {
  const customer = await customerApi();
  return { customer, id: await sendList(customer, LINES, corner) };
}

async function shopIdOf(customer: Customer, id: string): Promise<string> {
  const answer = (
    (await listView(customer, id))['answers'] as { shopId: string; name: string }[]
  ).find((a) => a.name === shopName);
  if (!answer) throw new Error('the shop has not answered yet');
  return answer.shopId;
}

/** Answers the open list card with everything ticked: ₹48 + ₹45 + ₹30, delivery on, fee ₹25. */
const firstOrderId = (ordered: Record<string, unknown>): string => {
  const first = (ordered['orders'] as { id: string }[])[0];
  if (!first) throw new Error('no order was made');
  return first.id;
};

async function answerEverything() {
  await tick({ Sugar: '48', 'Turmeric powder': '45', 'Tractor spare bolt': '30' });
  // This shop delivers by default, so the switch starts on.
  await expect(card().getByRole('switch', { name: /I can deliver this list/ })).toBeChecked();
  await card().getByLabel('Delivery fee').fill('25');
  await card().getByRole('button', { name: 'Send answer' }).click();
  await expect(card()).toHaveCount(0, { timeout: 15_000 });
}

let first: { customer: Customer; id: string };

test("S50: one list parchi with only this shop's lines, and the rest under Other", async () => {
  first = await newList();
  await expect(card()).toHaveCount(1, { timeout: 30_000 });
  await expect(card().getByText('A list · 3')).toBeVisible();
  await expect(card().getByText('Tick what you have')).toBeVisible();
  await expect(card().getByText('under 1 km')).toBeVisible();
  await expect(card().getByRole('checkbox')).toHaveCount(3);
  await expect(card().getByRole('checkbox', { name: /Sugar/ })).toBeVisible();
  await expect(card().getByRole('checkbox', { name: /Turmeric powder/ })).toBeVisible();
  const other = card().locator('[data-group="other"]');
  await expect(other.getByText('Other · asked to all shops')).toBeVisible();
  await expect(other.getByRole('checkbox', { name: /Tractor spare bolt/ })).toBeVisible();
  // The shop never learns who asked.
  await expect(card()).not.toContainText(/Asha|Grahak|\+91|Sapna/);
  await noSidewaysScroll(shop);
});

test('S51: a missing price shows inline; tick, price and delivery fee, then send', async () => {
  await tick({ Sugar: '48' });
  await card()
    .getByRole('checkbox', { name: /Turmeric powder/ })
    .click();
  await card().getByRole('button', { name: 'Send answer' }).click();
  await expect(card().getByText('Add a price')).toBeVisible();
  await expect(card().getByLabel('Price for Turmeric powder')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await shot('U2-list-validation-360');

  await card().getByLabel('Price for Turmeric powder').fill('45');
  await expect(card().getByText('Add a price')).toHaveCount(0);
  await tick({ 'Tractor spare bolt': '30' });
  await expect(card().getByText('You have 3 of 3')).toBeVisible();
  await expect(card().getByLabel('Total')).toHaveText('₹123');
  // This shop delivers by default, so the switch starts on.
  await expect(card().getByRole('switch', { name: /I can deliver this list/ })).toBeChecked();
  const fee = card().getByLabel('Delivery fee');
  await expect(fee).toHaveValue('20'); // from this shop's own delivery settings
  await fee.fill('25');

  // Readable in both themes at 360 px, with the card filled in.
  for (const scheme of ['light', 'dark'] as const) {
    await shop.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await shot(`U2-list-${scheme}-360`);
    await nothingBlocking(shop, `list parchi in ${scheme}`);
  }
  // And through the data-theme switch the app itself uses.
  await shop.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await nothingBlocking(shop, 'list parchi with data-theme dark');
  await shop.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await shop.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

  await card().getByRole('button', { name: 'Send answer' }).click();
  // The stamp lands for 300 ms and the deck moves on.
  await expect(shop.getByText('No requests right now')).toBeVisible({ timeout: 15_000 });

  // The customer sees all three lines, ₹123, one fee of ₹25 and delivery offered.
  const list = await listView(first.customer, first.id);
  expect(list['answers']).toHaveLength(1);
  expect(list['answers'][0]).toMatchObject({
    name: shopName,
    haveCount: 3,
    totalPaise: 12_300,
    canDeliver: true,
    deliveryFeePaise: 2500,
  });
});

test('S52: "none of these" asks in the page first; a closed list says so and leaves', async () => {
  const { customer, id } = await newList();
  await expect(card()).toHaveCount(1, { timeout: 30_000 });
  await card().getByRole('button', { name: 'Send answer' }).click();
  const ask = shop.getByRole('alertdialog', { name: "Send 'none of these'?" });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Go back' }).click();
  await expect(ask).toHaveCount(0);

  expect((await stopList(customer, id)).status).toBe(200);
  await expect(shop.getByText('This list has closed')).toBeVisible({ timeout: 30_000 });
  await expect(card()).toHaveCount(0, { timeout: 15_000 });
  await expect(shop.getByText('No requests right now')).toBeVisible();
});

test('S53: a push link opens the deck at that card; "none of these" is sent after the question', async () => {
  await newList();
  await newList();
  await expect(card())
    .toHaveCount(2, { timeout: 30_000 })
    .catch(() => undefined);
  await shop.reload();
  await expect(shop.getByText('1 of 2')).toBeVisible({ timeout: 30_000 });
  // The parchi ids, as the shop's own page sees them.
  const ids = await shop.evaluate(async () => {
    const res = await fetch('/shops/me/lists', {
      headers: { Authorization: `Bearer ${localStorage.getItem('km-token')}` },
    });
    return ((await res.json()) as { id: string; expiresAt: string }[])
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
      .map((p) => p.id);
  });
  expect(ids).toHaveLength(2);
  await shop.goto(`/app/shop?parchi=${ids[1]}`);
  await expect(shop.getByText('2 of 2')).toBeVisible({ timeout: 30_000 });

  // Clear the deck: "none of these" on both, with the in-page question each time.
  for (let left = 2; left > 0; left--) {
    await card().first().getByRole('button', { name: 'Send answer' }).click();
    await shop.getByRole('alertdialog').getByRole('button', { name: 'Send', exact: true }).click();
    await expect(card()).toHaveCount(left - 1, { timeout: 15_000 });
  }
  await expect(shop.getByText('No requests right now')).toBeVisible({ timeout: 15_000 });
});

test('S54: delivery order from a list: tick as you pack, it survives a reload, then out', async () => {
  const { customer, id } = await newList();
  await expect(card()).toHaveCount(1, { timeout: 30_000 });
  await answerEverything();
  const shopId = await shopIdOf(customer, id);
  const ordered = await orderAll(customer, id, shopId, 3, 'delivery');
  expect(ordered['orders']).toHaveLength(1);

  await goTo(shop, 'orders');
  const order = shop.locator('article.sh-order').first();
  await expect(order.getByText('Delivery · 3 items')).toBeVisible({ timeout: 30_000 });
  await expect(order.getByText(/Customer chose you · /)).toBeVisible();
  await expect(order.getByText('Tick as you pack')).toBeVisible();
  await expect(order.getByText('0 of 3 packed')).toBeVisible();
  await expect(order.getByText(/₹148/)).toBeVisible(); // 48 + 45 + 30 + fee 25
  await expect(order.getByText(/Sapna Apartments/)).toBeVisible();

  await order.getByRole('checkbox', { name: /Chini/ }).click();
  await expect(order.getByText('1 of 3 packed')).toBeVisible();
  await expect(order.getByRole('checkbox', { name: /Chini/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(order.getByText('2 items not packed yet. You can still send it out')).toBeVisible();
  await shot('U2-packing-delivery-360');
  await nothingBlocking(shop, 'packing parchi (delivery)');

  // The ticks live on the server: a reload keeps them.
  await shop.reload();
  const again = shop.locator('article.sh-order').first();
  await expect(again.getByText('1 of 3 packed')).toBeVisible({ timeout: 30_000 });
  await expect(again.getByRole('checkbox', { name: /Chini/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(again.getByRole('checkbox', { name: /Haldi/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  // Un-ticking works too.
  await again.getByRole('checkbox', { name: /Chini/ }).click();
  await expect(again.getByText('0 of 3 packed')).toBeVisible();
  await again.getByRole('checkbox', { name: /Chini/ }).click();
  await expect(again.getByText('1 of 3 packed')).toBeVisible();

  // Sending it out is allowed with items unpacked (the note says so).
  await again.getByRole('button', { name: 'Out for delivery' }).click();
  await expect(again.getByText('Waiting for the customer to confirm')).toBeVisible({
    timeout: 15_000,
  });
  const view = await customer.call('GET', `/orders/${firstOrderId(ordered)}`);
  expect(view.body['state']).toBe('OUT_FOR_DELIVERY');
  expect(view.body['packedCount']).toBe(1);
});

test('S55: pickup order from a list: no address, "Ready for pickup" and then waiting', async () => {
  const { customer, id } = await newList();
  await goTo(shop, 'requests');
  await expect(card()).toHaveCount(1, { timeout: 30_000 });
  await answerEverything();
  const shopId = await shopIdOf(customer, id);
  const ordered = await orderAll(customer, id, shopId, 3, 'pickup');
  const orderId = firstOrderId(ordered);

  await goTo(shop, 'orders');
  const order = shop.locator('article.sh-order').filter({ hasText: 'Pickup · 3 items' });
  await expect(order).toBeVisible({ timeout: 30_000 });
  await expect(order.getByText('The customer will come to pick it up')).toBeVisible();
  await expect(order.getByRole('link', { name: 'Open map' })).toHaveCount(0);
  await expect(order.getByText(/Sapna|Vijay Nagar|For: /)).toHaveCount(0);
  await expect(order.getByRole('button', { name: 'Out for delivery' })).toHaveCount(0);
  await expect(
    order.getByText('3 items not packed yet. You can still mark it ready'),
  ).toBeVisible();

  await order.getByRole('checkbox', { name: /Chini/ }).click();
  await order.getByRole('checkbox', { name: /Haldi/ }).click();
  await expect(order.getByText('2 of 3 packed')).toBeVisible();
  await expect(order.getByText('1 items not packed yet')).toHaveCount(0);
  await expect(order.getByText('1 item not packed yet. You can still mark it ready')).toBeVisible();
  await shot('U2-packing-pickup-360');
  await nothingBlocking(shop, 'packing parchi (pickup)');

  await order.getByRole('button', { name: 'Ready for pickup' }).click();
  await expect(order.getByText('Ready · waiting for the customer to collect')).toBeVisible({
    timeout: 15_000,
  });
  await expect(order.getByRole('button', { name: 'Ready for pickup' })).toHaveCount(0);
  await expect(order.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  const view = await customer.call('GET', `/orders/${orderId}`);
  expect(view.body['state']).toBe('READY');

  // The Home tile still counts it as active.
  await goTo(shop, 'requests');
  await expect(shop.getByRole('link', { name: /Active orders/ })).toContainText('2');
});

test('S57: a 10-line list keeps its footer in view; only the lines scroll', async () => {
  await goTo(shop, 'requests');
  const customer = await customerApi();
  // Six grocery words and four that fit no kind of shop.
  const id = await sendList(
    customer,
    [
      'chini',
      'haldi',
      'atta',
      'namak',
      'chawal',
      'besan',
      'tractor spare bolt',
      'garden hose nozzle',
      'brass door knocker',
      'bicycle spoke wrench',
    ],
    corner,
  );
  await expect(card()).toHaveCount(1, { timeout: 30_000 });
  await expect(card().getByRole('checkbox')).toHaveCount(10);
  for (const [size, fresh] of [
    [{ width: 360, height: 740 }, false],
    [{ width: 390, height: 844 }, false],
    [{ width: 360, height: 740 }, true],
    [{ width: 390, height: 844 }, true],
  ] as const) {
    // The second pass is a reload: no new-order banner, so the card has more room.
    if (fresh && size.width === 360) {
      await shop.reload();
      await expect(card()).toHaveCount(1, { timeout: 30_000 });
    }
    await shop.setViewportSize(size);
    await shop.waitForTimeout(300);
    const send = card().getByRole('button', { name: 'Send answer' });
    // Send and the promise are on screen without scrolling the card or the page, and not covered.
    await expectUncovered(send);
    await expect(send).toBeInViewport({ ratio: 1 });
    await expect(card().getByText("If the customer picks you, you're committed")).toBeInViewport({
      ratio: 1,
    });
    await expect(card().getByText('You have 0 of 10')).toBeInViewport({ ratio: 1 });
    // The lines area is the one that scrolls, and the fade says more lines are hidden.
    const scroll = card().locator('.sh-lscroll');
    expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(card().locator('.sh-lscroll.has-more')).toHaveCount(1);
    await scroll.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(card().locator('.sh-lscroll.has-more')).toHaveCount(0);
    await expect(send).toBeInViewport({ ratio: 1 });
    await scroll.evaluate((el) => el.scrollTo(0, 0));
    await shot(`U2-list-10-lines-${size.width}`);
  }
  await shop.setViewportSize({ width: 360, height: 740 });
  // Clean up: "none of these".
  await card().getByRole('button', { name: 'Send answer' }).click();
  await shop.getByRole('alertdialog').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card()).toHaveCount(0, { timeout: 15_000 });
  void id;
});
