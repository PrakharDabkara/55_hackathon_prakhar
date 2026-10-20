import { expect, test } from '@playwright/test';
import { ask, useDemoLocation } from './orderFlow.js';
import { uniquePhone } from './unique.js';

// The first end-to-end test: a real browser, the real API, Postgres, Redis and five simulated
// grocery shops that answer pings in the background (see global-setup.ts).
test('a customer asks for sugar and watches simulated shops answer on the map', async ({
  page,
}) => {
  await page.goto('/app/');
  // No login wall: Find opens for anyone, and the first Find asks for the login.
  await useDemoLocation(page);
  await ask(page, 'chini');
  const dialog = page.getByRole('dialog', { name: 'Log in to send your request' });
  await dialog.getByLabel('Mobile number').fill(uniquePhone());
  await dialog.getByRole('button', { name: 'Send code' }).click();
  await dialog.getByRole('button', { name: 'Fill demo OTP' }).click();
  await dialog.getByRole('button', { name: 'Log in' }).click();

  // The draft is sent right after the login: the replies screen opens with the request as a parchi.
  await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
  await expect(page.locator('.sh-parchi')).toBeVisible();

  // Within 30 seconds: a reply with a price and a "N have it" stamp.
  await expect(page.getByRole('list', { name: 'Replies' }).getByText('₹').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/[1-9]\d* have it/i)).toBeVisible();

  // The map really is there, with the attribution OpenStreetMap asks for.
  await page.getByRole('button', { name: 'Map' }).click();
  const shopPins = page.locator('.leaflet-marker-icon .cu-map-pin');
  await expect(shopPins.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.leaflet-control-attribution')).toContainText(
    '© OpenStreetMap contributors',
  );
  await page.getByRole('button', { name: 'List' }).click();

  await page.screenshot({ path: 'e2e/artifacts/seeker-results.png', fullPage: true });
});
