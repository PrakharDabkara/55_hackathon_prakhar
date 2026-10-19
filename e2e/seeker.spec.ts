import { expect, test } from '@playwright/test';

// The first end-to-end test: a real browser, the real API, Postgres, Redis and five simulated
// grocery shops that answer pings in the background (see global-setup.ts).
test('a customer asks for sugar and watches simulated shops answer on the map', async ({
  page,
}) => {
  await page.goto('/app/');

  // Log in with the Demo mode box: no SMS, the code is filled for us.
  await page.getByLabel(/mobile number/i).fill('9810000501');
  await page.getByRole('button', { name: 'Send OTP' }).click();
  await page.getByRole('button', { name: 'Fill demo OTP' }).click();
  await page.getByRole('button', { name: 'Log in' }).click();

  // Search "chini" (sugar) near the demo location, having seen it for Rs 60 elsewhere.
  await page.getByRole('button', { name: 'Demo location (Indore)' }).click();
  await page.getByLabel('क्या चाहिए?').fill('chini');
  await page.getByLabel(/I saw it for ₹__/).fill('60');
  await page.getByRole('button', { name: 'Search' }).click();

  // Within 30 seconds: a pin besides the user's own, a row with a price, and a "haan" in the status.
  const shopPins = page
    .locator('.leaflet-marker-icon.km-pin')
    .filter({ has: page.locator('path') });
  await expect(shopPins.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.result .price').first()).toContainText('₹', { timeout: 30_000 });
  await expect(page.locator('.status-line')).toHaveText(/[1-9]\d* said yes/, {
    timeout: 30_000,
  });

  // The map really is there, with the attribution OpenStreetMap asks for.
  await expect(page.locator('.leaflet-control-attribution')).toContainText(
    '© OpenStreetMap contributors',
  );
  await expect(page.getByRole('link', { name: 'Directions' }).first()).toHaveAttribute(
    'href',
    /google\.com\/maps\/dir\/\?api=1&destination=/,
  );

  await page.screenshot({ path: 'e2e/artifacts/seeker-results.png', fullPage: true });
});
