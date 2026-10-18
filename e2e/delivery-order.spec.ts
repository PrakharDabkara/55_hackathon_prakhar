import { expect, test, type Browser, type Page } from '@playwright/test';

// A delivery order from end to end, in two real browsers at 360 px (ADR-0031, PR D): the customer
// asks for it at home, the shop accepts, sets out and delivers; and a decline that falls back to
// pickup. A real shop in a quiet corner far from the simulated shops is the only one asked.
const VIEWPORT = { width: 360, height: 740 };
const ADDRESS = 'Flat 4B, Sapna Apartments, Vijay Nagar, Indore';

/**
 * A quiet corner of its own on every run: shops from earlier runs remember this item where they
 * were, and three of them near each other would answer the search from memory without asking.
 */
const newCorner = () => ({
  latitude: Number((24 + Math.random() * 2).toFixed(4)),
  longitude: Number((77 + Math.random() * 2).toFixed(4)),
});

const newPhone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function login(page: Page, path: string) {
  await page.goto(path);
  await page.getByLabel(/mobile number/i).fill(newPhone());
  await page.getByRole('button', { name: 'OTP bhejo' }).click();
  await page.getByRole('button', { name: 'Demo OTP bharein' }).click();
  await page.getByRole('button', { name: 'Login karein' }).click();
}

const noSidewaysScroll = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

/** A shop that delivers (standing offer ₹20), opened at `corner`, and a customer standing there. */
async function setup(
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
  await customer.getByRole('button', { name: 'Dhoondho' }).click();

  // The shop says yes (the standing offer pre-fills the delivery), and the customer sees its card.
  await shop.getByRole('button', { name: /Haan hai/ }).click({ timeout: 30_000 });
  await shop.locator('article.card').getByLabel('Aapka daam (₹)').fill('40');
  await shop.getByRole('button', { name: 'Bhejo' }).click();
  const card = customer.getByRole('listitem').filter({ hasText: name });
  await expect(card).toBeVisible({ timeout: 30_000 });
  return { shop, shopContext, customer, customerContext, card };
}

/** "Ghar mangwao" → "Order bhejo" → the address step → "Pakka karo". */
async function order(customer: Page, card: ReturnType<Page['locator']>) {
  await card.getByRole('button', { name: 'Ghar mangwao' }).click();
  await card.getByRole('button', { name: 'Order bhejo' }).click();
  await card.getByLabel('Ghar ka pata').fill(ADDRESS);
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/delivery-address-step.png', fullPage: true });
  await card.getByRole('button', { name: 'Pakka karo' }).click();
  await expect(card.getByText(/jawab ka intezaar/)).toBeVisible();
}

test('a delivery order: the customer asks, the shop accepts, sets out and delivers', async ({
  browser,
}) => {
  const { shop, shopContext, customer, customerContext, card } = await setup(
    browser,
    'Delivery Test Kirana',
    newCorner(),
  );
  await order(customer, card);

  // The shop sees the order, but not where to go until it says yes.
  const shopCard = shop.locator('article.order-card');
  await expect(shopCard).toBeVisible({ timeout: 30_000 });
  await expect(shopCard.getByText('Grahak', { exact: true })).toBeVisible();
  await expect(shopCard.getByText(/Cash on delivery/)).toBeVisible();
  await expect(shop.getByText(ADDRESS)).toHaveCount(0);
  await expect(shopCard.getByRole('link', { name: 'Map par dekho' })).toHaveCount(0);
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/delivery-shop-new-order.png', fullPage: true });

  await shopCard.getByRole('button', { name: 'Accept' }).click();
  await expect(shopCard.getByText(ADDRESS)).toBeVisible();
  const map = shopCard.getByRole('link', { name: 'Map par dekho' });
  await expect(map).toHaveAttribute('href', /google\.com\/maps\/search\/\?api=1&query=2[4-6]\./);
  await expect(shopCard.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(card.getByText('Dukaan ne order le liya')).toBeVisible({ timeout: 15_000 });
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/delivery-shop-accepted.png', fullPage: true });

  await shopCard.getByRole('button', { name: 'Nikal gaye' }).click();
  await expect(card.getByText('Nikal gaye — raste mein hai')).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole('button', { name: 'Order cancel karo' })).toHaveCount(0);
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/delivery-customer-out.png', fullPage: true });

  await shopCard.getByRole('button', { name: 'Pahuncha diya' }).click();
  await expect(card.getByText(/Pahunch gaya/)).toBeVisible({ timeout: 15_000 });
  await expect(shopCard.getByText('Pahuncha diya gaya')).toBeVisible();
  await noSidewaysScroll(customer);
  await customer.screenshot({
    path: 'e2e/artifacts/delivery-customer-delivered.png',
    fullPage: true,
  });

  await shopContext.close();
  await customerContext.close();
});

test('a shop that declines: the customer is told, and it is pickup', async ({ browser }) => {
  const { shop, shopContext, customer, customerContext, card } = await setup(
    browser,
    'Decline Test Kirana',
    newCorner(),
  );
  await order(customer, card);

  const shopCard = shop.locator('article.order-card');
  await expect(shopCard).toBeVisible({ timeout: 30_000 });
  await shopCard.getByRole('button', { name: 'Decline' }).click();
  await expect(shopCard.getByText('Aapne mana kiya')).toBeVisible();
  await expect(shop.getByText(ADDRESS)).toHaveCount(0);

  await expect(card.getByText(/Dukaan ne mana kiya/)).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText(/khud jaakar/)).toBeVisible();
  // It is still a shop to walk to.
  await expect(card.getByRole('link', { name: 'Raasta' })).toBeVisible();
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/delivery-declined-pickup.png', fullPage: true });

  await shopContext.close();
  await customerContext.close();
});
