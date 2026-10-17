import { expect, test } from '@playwright/test';

// A whole errand in a real browser against the real API, Postgres, Redis and five simulated
// grocery shops. The model is scripted (e2e/errand-scenario.json, LLM_PROVIDER=fake), so the run
// is the same every time: it asks one question, resolves three items, asks the shops, waits for
// their answers and hands in the plan. The two plans, the map and the route link are all real.
test('a customer plans an errand: question, waiting, both plans, route on the map', async ({
  page,
}) => {
  await page.goto('/app/');
  await page.getByLabel(/mobile number/i).fill('9810000502');
  await page.getByRole('button', { name: 'OTP bhejo' }).click();
  await page.getByRole('button', { name: 'Demo OTP bharein' }).click();
  await page.getByRole('button', { name: 'Login karein' }).click();

  await page.getByRole('link', { name: 'Poora kaam batao' }).click();
  await expect(page).toHaveURL(/\/app\/errand$/);
  await page.getByLabel('Kya kaam hai?').fill('chai banane ka saaman: chai patti, chini, doodh');
  await page.getByRole('button', { name: 'Demo location (Indore)' }).click();
  await page.getByRole('button', { name: 'Plan banao' }).click();

  // The agent asks one question first; answering it carries on.
  await expect(page.getByText('Kaunsi chai chahiye?')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Patti chai' }).click();

  // Progress lines appear while the shops answer.
  await expect(page.getByText('Samjha: 3 cheezein')).toBeVisible({ timeout: 30_000 });

  // The plan: both tabs, the recommended one open first.
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(2, { timeout: 60_000 });
  await expect(tabs.nth(0)).toContainText('Kam dukaan');
  await expect(tabs.nth(1)).toContainText('Sabse sasta');
  await expect(page.getByText('Recommended')).toHaveCount(1);
  await expect(page.getByRole('tabpanel').locator('li')).toHaveCount(3);
  await expect(page.getByRole('group', { name: 'Kul hisaab' })).toContainText('₹');

  // Numbered stops on the map, in route order, and a link that opens Google Maps with them.
  const stops = page.locator('.leaflet-marker-icon.km-stop');
  await expect(stops.first()).toBeVisible({ timeout: 15_000 });
  await expect(stops.first()).toHaveText('1');
  await expect(page.locator('.leaflet-control-attribution')).toContainText(
    '© OpenStreetMap contributors',
  );
  await expect(page.getByRole('link', { name: 'Raasta kholo' })).toHaveAttribute(
    'href',
    /google\.com\/maps\/dir\/\?api=1&origin=.*&destination=/,
  );

  // The other plan opens too, with its own totals.
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel').locator('li')).toHaveCount(3);

  await tabs.nth(0).click();
  await page.screenshot({ path: 'e2e/artifacts/errand-result.png', fullPage: true });
});
