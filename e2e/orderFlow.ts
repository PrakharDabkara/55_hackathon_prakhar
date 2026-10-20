import { expect, type Browser, type Page } from '@playwright/test';
import { uniquePhone } from './unique.js';

// Shared by the delivery specs: a real shop in a quiet corner far from the simulated shops, a
// customer standing there, and the "Ghar mangwao" steps. Two real browsers at 360 px.
export const VIEWPORT = { width: 360, height: 740 };
export const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';

/**
 * A quiet corner of its own on every run: shops from earlier runs remember this item where they
 * were, and three of them near each other would answer the search from memory without asking.
 */
export const newCorner = () => ({
  latitude: Number((24 + Math.random() * 2).toFixed(4)),
  longitude: Number((77 + Math.random() * 2).toFixed(4)),
});

export const newPhone = uniquePhone;

/** The customer app's login sheet is open: a fresh phone, the demo code, Log in. */
export async function sheetLogin(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Log in to send your request' });
  await dialog.getByLabel('Mobile number').fill(newPhone());
  await dialog.getByRole('button', { name: 'Send code' }).click();
  await dialog.getByRole('button', { name: 'Fill demo OTP' }).click();
  await dialog.getByRole('button', { name: 'Log in' }).click();
  await expect(dialog).toHaveCount(0);
}

/** Logs in with a fresh phone number. The customer app has no login page: My orders asks for one. */
export async function login(page: Page, path: string) {
  if (!path.startsWith('/app/shop')) {
    await page.goto('/app/orders');
    await sheetLogin(page);
    await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible();
    await page.goto(path);
    return;
  }
  await page.goto(path);
  await page.getByLabel(/mobile number/i).fill(newPhone());
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByRole('button', { name: 'Fill the code' }).click();
  await page.getByRole('button', { name: 'Log in' }).click();
}

/** Find, as a customer: type the item, optionally ask for delivery, press Find nearby. */
export async function ask(
  page: Page,
  what: string,
  { delivery = false, address = ADDRESS }: { delivery?: boolean; address?: string } = {},
) {
  await page.getByLabel('What do you need?').fill(what);
  if (delivery) {
    await page.getByRole('switch', { name: 'Deliver to me' }).click();
    // Find first checks for a kept address: either the typing field comes, or the kept address is
    // shown as a line (a customer who ordered before). Type only into the field.
    const field = page.getByLabel('Delivery address');
    await expect(field.or(page.getByText(/^Deliver to: /))).toBeVisible();
    if (await field.isVisible()) await field.fill(address);
  }
  await page.getByRole('button', { name: 'Find nearby' }).click();
}

/** The demo place in Indore, through the "Near you" chip, for a browser with no location of its own. */
export async function useDemoLocation(page: Page) {
  await page.getByRole('button', { name: /Near you/ }).click();
  await page.getByRole('button', { name: 'Use demo location (Indore)' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
}

/** A browser for a shop standing at `corner`, so "Use my current location" finds it there. */
export const shopContextAt = (browser: Browser, corner: { latitude: number; longitude: number }) =>
  browser.newContext({ viewport: VIEWPORT, geolocation: corner, permissions: ['geolocation'] });

/** First login of a new shop: a name, Grocery, and its place from the phone. No delivery here. */
export async function onboardShop(shop: Page, name: string) {
  await login(shop, '/app/shop');
  await shop.getByLabel('Shop name').fill(name);
  await shop.getByRole('button', { name: 'Grocery' }).click();
  await shop.getByRole('button', { name: 'Use my current location' }).click();
  await shop.getByRole('button', { name: 'Start getting requests' }).click();
  await expect(shop.getByRole('switch', { name: 'Open' })).toBeVisible({ timeout: 15_000 });
}

/** Goes to a place in the shop app (the menu links are hash addresses). */
export const goTo = (shop: Page, view: string) =>
  shop.evaluate((v) => {
    location.hash = `#/${v}`;
  }, view);

/** Turns on the standing delivery offer: ₹20, usually 30 minutes. */
export async function setDelivery(shop: Page) {
  await goTo(shop, 'delivery');
  await shop.getByRole('switch', { name: 'I deliver' }).click();
  await shop.getByLabel('Default fee ₹').fill('20');
  await shop.getByRole('button', { name: '30 min' }).click();
  await shop.getByRole('button', { name: 'Save' }).click();
  await expect(shop.getByText('Saved.')).toBeVisible();
  await goTo(shop, 'requests');
}

export const noSidewaysScroll = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

/** A shop that delivers (standing offer ₹20), opened at `corner`, and a customer standing there. */
export async function setup(
  browser: Browser,
  label: string,
  corner: { latitude: number; longitude: number },
) {
  const shopContext = await shopContextAt(browser, corner);
  const shop = await shopContext.newPage();
  // A name nobody else has: shops from earlier runs may remember this item in the same corner.
  const name = `${label} ${Date.now().toString(36)}`;
  await onboardShop(shop, name);
  await setDelivery(shop);

  const customerContext = await browser.newContext({
    viewport: VIEWPORT,
    geolocation: corner,
    permissions: ['geolocation'],
  });
  const customer = await customerContext.newPage();
  await login(customer, '/app/');
  // "Deliver to me" with an address typed here (Delivery v2): the shop gets three answers.
  await ask(customer, 'haldi', { delivery: true });

  // The shop says "will deliver" (the fee and time start from its delivery settings), and the customer sees its card.
  await shop.getByRole('button', { name: 'Answer' }).click({ timeout: 30_000 });
  await shop.getByRole('radio', { name: 'Have it, will deliver' }).check();
  await shop.getByLabel('Price', { exact: true }).fill('40');
  await shop.getByRole('button', { name: 'Confirm' }).click();
  const card = customer.getByRole('listitem').filter({ hasText: name });
  await expect(card).toBeVisible({ timeout: 30_000 });
  return { shop, shopContext, customer, customerContext, card };
}

/**
 * "Choose this shop" → "Get it delivered" → "Place order". The address was chosen on Find, so there
 * is none to type. The shop's yes is fresh, so the order starts ACCEPTED: no waiting for the shop
 * (ADR-0039). The customer lands on the order page.
 */
export async function order(
  customer: Page,
  card: ReturnType<Page['locator']>,
  { note }: { note?: string } = {},
) {
  await card.getByRole('button', { name: 'Choose this shop' }).click();
  const sheet = customer.getByRole('dialog', { name: 'Choose this shop' });
  await sheet.getByRole('radio', { name: /Get it delivered/ }).check();
  // A search made without "Deliver to me" has no address yet: the sheet asks for one.
  const address = sheet.getByLabel('Delivery address');
  if (await address.count()) await address.fill(ADDRESS);
  if (note) await sheet.getByLabel('Note for the shop').fill(note);
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/delivery-address-step.png', fullPage: true });
  await sheet.getByRole('button', { name: 'Place order' }).click();
  await expect(customer).toHaveURL(/\/app\/order\/[\w-]+$/);
  await expect(customer.getByText('Shop accepted').first()).toBeVisible({ timeout: 15_000 });
}

/** A customer standing at `corner` (the browser's own location), logged in on Find. */
export async function customerAt(
  browser: Browser,
  corner: { latitude: number; longitude: number },
) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    geolocation: corner,
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  await login(page, '/app/');
  await expect(page.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
  return { context, page };
}

/** On the replies screen: opens the shop's reply, asks for delivery and places the order. */
export async function orderFromReply(customer: Page, shopName: string) {
  const reply = customer.getByRole('listitem').filter({ hasText: shopName });
  await expect(reply).toBeVisible({ timeout: 30_000 });
  await order(customer, reply);
}
