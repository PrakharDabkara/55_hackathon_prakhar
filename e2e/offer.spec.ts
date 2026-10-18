import { expect, test, type Page } from '@playwright/test';

// Exact quantity, a delivery offer and the open switch, in two real browsers at 360 px (ADR-0031).
// A real shop in a quiet corner far from the simulated shops is the only one asked.
const VIEWPORT = { width: 360, height: 740 };
const CORNER = { latitude: 22.9, longitude: 76.1 };
test.use({ geolocation: CORNER, permissions: ['geolocation'] });

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

test('a shop answers with a quantity and a delivery offer, closes for the day, and the customer sees it all', async ({
  page,
  browser,
}) => {
  const shopContext = await browser.newContext({ viewport: VIEWPORT });
  const shop = await shopContext.newPage();
  await login(shop, '/app/shop');
  await shop.getByLabel('Dukaan ka naam').fill('Offer Test Kirana');
  await shop.getByRole('button', { name: /किराना/ }).click();
  await shop.getByRole('checkbox', { name: 'Hum ghar bhejte hain' }).check();
  await shop.getByLabel('Delivery ka daam (₹)').fill('20');
  await shop.getByText('Haath se likhein').click();
  await shop.getByLabel('Latitude').fill(String(CORNER.latitude));
  await shop.getByLabel('Longitude').fill(String(CORNER.longitude));
  await shop.getByRole('button', { name: 'Dukaan shuru karein' }).click();
  await expect(shop.getByRole('switch', { name: 'Dukaan khuli hai' })).toBeVisible({
    timeout: 15_000,
  });

  await login(page, '/app/');
  await page.getByRole('button', { name: 'Meri location' }).click();
  await page.getByLabel('क्या चाहिए?').fill('haldi');
  await page.getByRole('button', { name: 'Dhoondho' }).click();

  // The yes starts from the standing offer; the shop adds a price, an amount and its own fee.
  await shop.getByRole('button', { name: /Haan hai/ }).click({ timeout: 30_000 });
  const toggle = shop.getByRole('switch', { name: 'Ghar bhej denge' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(shop.getByLabel('Delivery ka daam (₹)')).toHaveValue('20');
  await shop.getByLabel('Aapka daam (₹)').fill('40');
  await shop.getByLabel('Kitna hai? (maatra)').fill('5');
  await shop.getByRole('button', { name: 'kg', exact: true }).click();
  await shop.getByLabel('Delivery ka daam (₹)').fill('30');
  await shop.getByLabel('Kitne minute mein?').fill('45');
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/offer-shop-yes.png', fullPage: true });
  await shop.getByRole('button', { name: 'Bhejo' }).click();

  // The customer sees what the shop has and that it delivers, with the fee and the time.
  await expect(page.getByText('5 kg hai')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Ghar bhej denge · ₹30 · 45 min')).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: 'e2e/artifacts/offer-customer-sees.png', fullPage: true });

  // "Dukaan aaj band hai": a closed shop is not asked.
  await shop.getByRole('switch', { name: 'Dukaan khuli hai' }).click();
  await expect(shop.getByRole('switch', { name: 'Dukaan aaj band hai' })).toBeVisible();
  await page
    .getByRole('button', { name: 'Wapas' })
    .click()
    .catch(() => undefined);
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Meri location' }).click();
  await page.getByLabel('क्या चाहिए?').fill('namak');
  await page.getByRole('button', { name: 'Dhoondho' }).click();
  await expect(page.locator('.status-line')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(shop.getByRole('button', { name: /Haan hai/ })).toHaveCount(0);
  await shop.screenshot({ path: 'e2e/artifacts/offer-shop-closed.png', fullPage: true });

  // Opening again brings the shop back.
  await shop.getByRole('switch', { name: 'Dukaan aaj band hai' }).click();
  await expect(shop.getByRole('switch', { name: 'Dukaan khuli hai' })).toBeVisible();
  await shopContext.close();
});
