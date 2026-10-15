import { expect, test } from '@playwright/test';

// The first end-to-end test: a real browser, the real API, Postgres, Redis and five simulated
// grocery shops that answer pings in the background (see global-setup.ts).
test('a customer asks for sugar and watches simulated shops answer on the map', async ({
  page,
}) => {
  await page.goto('/app/');

  // Log in with the Demo mode box: no SMS, the code is filled for us.
  await page.getByLabel(/mobile number/i).fill('9810000501');
  await page.getByRole('button', { name: 'OTP bhejo' }).click();
  await page.getByRole('button', { name: 'Demo OTP bharein' }).click();
  await page.getByRole('button', { name: 'Login karein' }).click();

  // Search "chini" (sugar) near the demo location, having seen it for Rs 60 elsewhere.
  await page.getByRole('button', { name: 'Demo location (Indore)' }).click();
  await page.getByLabel('क्या चाहिए?').fill('chini');
  await page.getByLabel(/Maine ₹__ mein dekha hai/).fill('60');
  await page.getByRole('button', { name: 'Dhoondho' }).click();

  // Within 30 seconds: a pin besides the user's own, a row with a price, and a "haan" in the status.
  const shopPins = page
    .locator('.leaflet-marker-icon.km-pin')
    .filter({ has: page.locator('path') });
  await expect(shopPins.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.result .price').first()).toContainText('₹', { timeout: 30_000 });
  await expect(page.locator('.status-line')).toHaveText(/[1-9]\d* ne haan kaha/, {
    timeout: 30_000,
  });

  // The map really is there, with the attribution OpenStreetMap asks for.
  await expect(page.locator('.leaflet-control-attribution')).toContainText(
    '© OpenStreetMap contributors',
  );
  await expect(page.getByRole('link', { name: 'Raasta' }).first()).toHaveAttribute(
    'href',
    /google\.com\/maps\/dir\/\?api=1&destination=/,
  );

  await page.screenshot({ path: 'e2e/artifacts/seeker-results.png', fullPage: true });
});
