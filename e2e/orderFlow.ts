import { expect, type Browser, type Page } from '@playwright/test';

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

export const newPhone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

/** Logs in with a fresh phone number: the shop app and the customer app word their buttons differently. */
export async function login(page: Page, path: string) {
  const shop = path.startsWith('/app/shop');
  await page.goto(path);
  await page.getByLabel(/mobile number/i).fill(newPhone());
  await page.getByRole('button', { name: shop ? 'Send code' : 'Send OTP' }).click();
  await page.getByRole('button', { name: shop ? 'Fill the code' : 'Fill demo OTP' }).click();
  await page.getByRole('button', { name: 'Log in' }).click();
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
  await customer.getByRole('button', { name: 'Use my location' }).click();
  await customer.getByLabel('क्या चाहिए?').fill('haldi');
  // "Deliver to me" with an address typed here (Delivery v2): the shop gets three answers.
  await customer.getByRole('checkbox', { name: 'Deliver to me' }).check();
  await customer.getByLabel('Home address').fill(ADDRESS);
  await customer.getByRole('button', { name: 'Search' }).click();

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
 * "Ghar mangwao" → "Order bhejo" → "Pakka karo". The address was chosen on Find, so there is none to
 * type. The shop's yes is fresh, so the order starts ACCEPTED: no waiting for the shop (ADR-0039).
 */
export async function order(
  customer: Page,
  card: ReturnType<Page['locator']>,
  { note }: { note?: string } = {},
) {
  await card.getByRole('button', { name: 'Deliver to me' }).click();
  await card.getByRole('button', { name: 'Send order' }).click();
  if (note) await card.getByLabel('Note for the shop').fill(note);
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/delivery-address-step.png', fullPage: true });
  await card.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(card.getByText('The shop accepted your order')).toBeVisible({ timeout: 15_000 });
}
