import { expect, test, type Page } from '@playwright/test';
import { newCorner } from './orderFlow.js';
import { uniqueName } from './unique.js';

// Exact quantity, a delivery offer and the open switch, in two real browsers at 360 px (ADR-0031).
// A real shop in a quiet corner far from the simulated shops is the only one asked.
const VIEWPORT = { width: 360, height: 740 };
const CORNER = newCorner();
test.use({ geolocation: CORNER, permissions: ['geolocation'] });

const newPhone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function login(page: Page, path: string) {
  await page.goto(path);
  await page.getByLabel(/mobile number/i).fill(newPhone());
  await page.getByRole('button', { name: 'Send OTP' }).click();
  await page.getByRole('button', { name: 'Fill demo OTP' }).click();
  await page.getByRole('button', { name: 'Log in' }).click();
}

const noSidewaysScroll = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

test('a shop answers with a quantity and a delivery offer, closes for the day, and the customer sees it all', async ({
  page,
  browser,
}) => {
  const shopContext = await browser.newContext({ viewport: VIEWPORT });
  const shop = await shopContext.newPage();
  await login(shop, '/app/shop');
  await shop.getByLabel('Shop name').fill(uniqueName('Offer Test Kirana'));
  await shop.getByRole('button', { name: /Grocery/ }).click();
  await shop.getByRole('checkbox', { name: 'We deliver to homes' }).check();
  await shop.getByLabel('Delivery fee (₹)').fill('20');
  await shop.getByText('Enter it by hand').click();
  await shop.getByLabel('Latitude').fill(String(CORNER.latitude));
  await shop.getByLabel('Longitude').fill(String(CORNER.longitude));
  await shop.getByRole('button', { name: 'Start my shop' }).click();
  await expect(shop.getByRole('switch', { name: 'Shop is open' })).toBeVisible({
    timeout: 15_000,
  });

  await login(page, '/app/');
  await page.getByRole('button', { name: 'Use my location' }).click();
  await page.getByLabel('क्या चाहिए?').fill('haldi');
  await page.getByRole('button', { name: 'Search' }).click();

  // The yes starts from the standing offer; the shop adds a price, an amount and its own fee.
  await shop.getByRole('button', { name: 'Yes, I have it' }).click({ timeout: 30_000 });
  // The question card (the settings above it have a fee field too).
  const card = shop.locator('article.card');
  const toggle = card.getByRole('switch', { name: 'We deliver' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(card.getByLabel('Delivery fee (₹)')).toHaveValue('20');
  await card.getByLabel('Your price (₹)').fill('40');
  await card.getByLabel('How much is there? (amount)').fill('5');
  await card.getByRole('button', { name: 'kg', exact: true }).click();
  await card.getByLabel('Delivery fee (₹)').fill('30');
  await card.getByLabel('In how many minutes?').fill('45');
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/offer-shop-yes.png', fullPage: true });
  await shop.getByRole('button', { name: 'Send', exact: true }).click();

  // The customer sees what the shop has and that it delivers, with the fee and the time.
  await expect(page.getByText('5 kg available')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('We deliver · ₹30 · 45 min')).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: 'e2e/artifacts/offer-customer-sees.png', fullPage: true });

  // "Dukaan aaj band hai": a closed shop is not asked.
  await shop.getByRole('switch', { name: 'Shop is open' }).click();
  await expect(shop.getByRole('switch', { name: 'Shop is closed today' })).toBeVisible();
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Use my location' }).click();
  await page.getByLabel('क्या चाहिए?').fill('namak');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.status-line')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(shop.getByRole('button', { name: 'Yes, I have it' })).toHaveCount(0);
  await shop.screenshot({ path: 'e2e/artifacts/offer-shop-closed.png', fullPage: true });

  // Opening again brings the shop back.
  await shop.getByRole('switch', { name: 'Shop is closed today' }).click();
  await expect(shop.getByRole('switch', { name: 'Shop is open' })).toBeVisible();
  await shopContext.close();
});
