import { expect, test, type Page } from '@playwright/test';
import { ask, login, newCorner, onboardShop, setDelivery, shopContextAt } from './orderFlow.js';
import { uniqueName } from './unique.js';

// Exact quantity, a delivery offer and the open switch, in two real browsers at 360 px (ADR-0031).
// A real shop in a quiet corner far from the simulated shops is the only one asked.
const CORNER = newCorner();
test.use({ geolocation: CORNER, permissions: ['geolocation'] });

const noSidewaysScroll = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

test('a shop answers with a price and a delivery offer, closes for the day, and the customer sees it all', async ({
  page,
  browser,
}) => {
  const shopContext = await shopContextAt(browser, CORNER);
  const shop = await shopContext.newPage();
  await onboardShop(shop, uniqueName('Offer Test Kirana'));
  await setDelivery(shop);

  await login(page, '/app/');
  await ask(page, 'haldi');

  // The answer starts from the standing offer (₹20, 30 minutes); the shop adds a price.
  await shop.getByRole('button', { name: 'Answer' }).click({ timeout: 30_000 });
  const sheet = shop.getByRole('dialog');
  await expect(sheet.getByRole('switch', { name: 'Offer delivery · ₹20 fee' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await sheet.getByLabel('Price · optional').fill('40');
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/offer-shop-yes.png', fullPage: true });
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  // The stamp lands, then the slip leaves the deck.
  await expect(shop.getByText('No requests right now')).toBeVisible();

  // The customer sees the price and that it delivers, with the fee and the time.
  await expect(page.getByText('Delivers · ₹20 · 30 min')).toBeVisible({ timeout: 30_000 });
  await noSidewaysScroll(page);
  await page.screenshot({ path: 'e2e/artifacts/offer-customer-sees.png', fullPage: true });

  // A closed shop is not asked.
  await shop.getByRole('switch', { name: 'Open' }).click();
  await expect(shop.getByRole('switch', { name: 'Closed' })).toBeVisible();
  await expect(shop.getByText("You're closed", { exact: true })).toBeVisible();
  await page.goto('/app/');
  await ask(page, 'namak');
  await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(shop.getByRole('button', { name: 'Answer' })).toHaveCount(0);
  await shop.screenshot({ path: 'e2e/artifacts/offer-shop-closed.png', fullPage: true });

  // Opening again brings the shop back.
  await shop.getByRole('button', { name: 'Open shop' }).click();
  await expect(shop.getByRole('switch', { name: 'Open' })).toBeVisible();
  await shopContext.close();
});
