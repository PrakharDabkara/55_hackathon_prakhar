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

export async function login(page: Page, path: string) {
  await page.goto(path);
  await page.getByLabel(/mobile number/i).fill(newPhone());
  await page.getByRole('button', { name: 'OTP bhejo' }).click();
  await page.getByRole('button', { name: 'Demo OTP bharein' }).click();
  await page.getByRole('button', { name: 'Login karein' }).click();
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
  const shopContext = await browser.newContext({ viewport: VIEWPORT });
  const shop = await shopContext.newPage();
  await login(shop, '/app/shop');
  // A name nobody else has: shops from earlier runs may remember this item in the same corner.
  const name = `${label} ${Date.now().toString(36)}`;
  await shop.getByLabel('Dukaan ka naam').fill(name);
  await shop.getByRole('button', { name: /किराना/ }).click();
  await shop.getByRole('checkbox', { name: 'Hum ghar bhejte hain' }).check();
  await shop.getByLabel('Delivery ka daam (₹)').fill('20');
  await shop.getByText('Haath se likhein').click();
  await shop.getByLabel('Latitude').fill(String(corner.latitude));
  await shop.getByLabel('Longitude').fill(String(corner.longitude));
  await shop.getByRole('button', { name: 'Dukaan shuru karein' }).click();
  await expect(shop.getByRole('switch', { name: 'Dukaan khuli hai' })).toBeVisible({
    timeout: 15_000,
  });

  const customerContext = await browser.newContext({
    viewport: VIEWPORT,
    geolocation: corner,
    permissions: ['geolocation'],
  });
  const customer = await customerContext.newPage();
  await login(customer, '/app/');
  await customer.getByRole('button', { name: 'Meri location' }).click();
  await customer.getByLabel('क्या चाहिए?').fill('haldi');
  // "Deliver to me" with an address typed here (Delivery v2): the shop gets three answers.
  await customer.getByRole('checkbox', { name: 'Ghar mangwao' }).check();
  await customer.getByLabel('Ghar ka pata').fill(ADDRESS);
  await customer.getByRole('button', { name: 'Dhoondho' }).click();

  // The shop says "will deliver" (the standing offer pre-fills fee and time), and the customer sees its card.
  await shop.getByRole('button', { name: /Haan, deliver karunga/ }).click({ timeout: 30_000 });
  await shop.locator('article.card').getByLabel('Aapka daam (₹)').fill('40');
  await shop.getByRole('button', { name: 'Bhejo' }).click();
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
  await card.getByRole('button', { name: 'Ghar mangwao' }).click();
  await card.getByRole('button', { name: 'Order bhejo' }).click();
  if (note) await card.getByLabel('Dukaan ke liye note').fill(note);
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/delivery-address-step.png', fullPage: true });
  await card.getByRole('button', { name: 'Pakka karo' }).click();
  await expect(card.getByText('Dukaan ne order le liya')).toBeVisible({ timeout: 15_000 });
}
