import { expect, test } from '@playwright/test';

// A whole errand in a real browser against the real API, Postgres, Redis and five simulated
// grocery shops. The model is scripted (e2e/errand-scenario.json, LLM_PROVIDER=fake), so the run
// is the same every time: it proposes the usual items of a vague goal and asks the customer to
// confirm them (a multi-select), resolves the three, asks the shops, waits for their answers and
// hands in the plan. The two plans, the map and the route link are all real. The run is at
// 360 px, the phone the app is built for (playwright.config.ts).
test('a customer plans an errand: question, waiting, both plans, route on the map', async ({
  page,
}) => {
  await page.goto('/app/');
  // A new number each run, so a local re-run never meets the OTP limit. The errand uses items the
  // sugar search in seeker.spec.ts does not (its shops would otherwise already know the answer).
  const phone = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  await page.getByLabel(/mobile number/i).fill(phone);
  await page.getByRole('button', { name: 'OTP bhejo' }).click();
  await page.getByRole('button', { name: 'Demo OTP bharein' }).click();
  await page.getByRole('button', { name: 'Login karein' }).click();

  await page.getByRole('link', { name: 'Poora kaam batao' }).click();
  await expect(page).toHaveURL(/\/app\/errand$/);
  await page.getByLabel('Kya kaam hai?').fill('chai banane ka saaman');
  await page.getByRole('button', { name: 'Demo location (Indore)' }).click();
  await page.getByRole('button', { name: 'Plan banao' }).click();

  // The agent proposes the usual items and asks once: defaults ticked, the customer adds one.
  // (The timeline can name the question a moment before the box opens: wait for the box.)
  await expect(page.getByRole('checkbox', { name: 'chai patti' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('checkbox', { name: 'chai patti' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'doodh' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'adrak' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'adrak' }).check();

  // At 360 px the long status chip sits under the title: the title keeps the full width.
  const title = await page.locator('.errand-task').boundingBox();
  const chip = await page.locator('.state-chip').boundingBox();
  const column = await page.locator('.screen').boundingBox();
  expect(chip?.y).toBeGreaterThanOrEqual((title?.y ?? 0) + (title?.height ?? 0) - 1);
  expect(title?.width).toBeGreaterThan((column?.width ?? 0) * 0.8);
  expect(title?.height).toBeLessThan(40); // one line, not one word per line
  await page.screenshot({ path: 'e2e/artifacts/errand-question.png', fullPage: true });

  await page.getByRole('button', { name: 'Theek hai' }).click();

  // Progress lines appear while the shops answer.
  await expect(page.getByText('Samjha: 3 cheezein')).toBeVisible({ timeout: 30_000 });

  // The plan. The simulated shops answer at random, so the two plans are sometimes the same
  // (shown once, no tabs, no badge) and sometimes differ (two tabs, one Recommended).
  await expect(page.getByText('Plan taiyaar', { exact: true })).toBeVisible({ timeout: 60_000 });
  const tabs = page.getByRole('tab');
  const plans = (await tabs.count()) === 0 ? 1 : 2;
  if (plans === 2) {
    await expect(tabs.nth(0)).toContainText('Kam dukaan');
    await expect(tabs.nth(1)).toContainText('Sabse sasta');
    await expect(page.getByText('Recommended')).toHaveCount(1);
  } else {
    await expect(page.getByText('Recommended')).toHaveCount(0);
  }
  await expect(page.locator('.plan-item')).toHaveCount(3);
  // The summary is built from the plan, not the model's sentence.
  await expect(page.getByRole('status', { name: 'Saaransh' })).toContainText(
    '3 mein se 3 cheezein mili',
  );
  await expect(page.getByText(/Confirmed|Pichhla jawab/).first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Kul hisaab' })).toContainText('₹');

  // Numbered stops on the map, in route order, and a link that opens Google Maps with them.
  const stops = page.locator('.leaflet-marker-icon.km-stop');
  await expect(stops.first()).toBeVisible({ timeout: 15_000 });
  await expect(stops.first()).toHaveText('1');
  // Every numbered pin is on the map, inside its frame: the map fits all stops.
  const frame = await page.locator('.results-map').boundingBox();
  const pins = await stops.evaluateAll((els) =>
    els.map((el) => ({ text: el.textContent, box: el.getBoundingClientRect().toJSON() })),
  );
  expect(pins.length).toBeGreaterThanOrEqual(1);
  expect(pins.map((p) => p.text)).toEqual(pins.map((_, i) => String(i + 1)));
  for (const { box } of pins) {
    expect(box.left).toBeGreaterThanOrEqual((frame?.x ?? 0) - 1);
    expect(box.right).toBeLessThanOrEqual((frame?.x ?? 0) + (frame?.width ?? 0) + 1);
    expect(box.top).toBeGreaterThanOrEqual((frame?.y ?? 0) - 1);
    expect(box.bottom).toBeLessThanOrEqual((frame?.y ?? 0) + (frame?.height ?? 0) + 1);
  }
  await expect(page.locator('.leaflet-control-attribution')).toContainText(
    '© OpenStreetMap contributors',
  );
  await expect(page.getByRole('link', { name: 'Raasta kholo' })).toHaveAttribute(
    'href',
    /google\.com\/maps\/dir\/\?api=1&origin=.*&destination=/,
  );

  // The other plan opens too, with its own totals.
  if (plans === 2) {
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.plan-item')).toHaveCount(3);
    await tabs.nth(0).click();
  }

  // A reload shows the same errand: its id is in the address.
  await expect(page).toHaveURL(/\/app\/errand\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(page.getByText('Plan taiyaar', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('tab')).toHaveCount(plans === 2 ? 2 : 0);
  await expect(page.locator('.plan-item')).toHaveCount(3);
  await expect(page.getByLabel('Kya kaam hai?')).toHaveCount(0);

  await page.screenshot({ path: 'e2e/artifacts/errand-result.png', fullPage: true });
});
