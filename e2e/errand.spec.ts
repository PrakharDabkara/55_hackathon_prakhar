import { expect, test } from '@playwright/test';
import { login } from './orderFlow.js';

// A whole errand in a real browser against the real API, Postgres, Redis and five simulated
// grocery shops. The model is scripted (e2e/errand-scenario.json, LLM_PROVIDER=fake), so the run
// is the same every time: it proposes the usual items of a vague goal and asks the customer to
// confirm them (a multi-select), resolves the three, asks the shops, waits for their answers and
// hands in the plan. The two plans, the map and the route link are all real. The run is at
// 360 px, the phone the app is built for (playwright.config.ts).
test('a customer plans an errand: question, waiting, both plans, route on the map', async ({
  page,
}) => {
  // A new number each run (one OTP login per phone). The errand uses items the sugar search in
  // seeker.spec.ts does not (its shops would otherwise already know the answer).
  await login(page, '/app/');
  await page.getByRole('link', { name: /Plan an errand/ }).click();
  await expect(page).toHaveURL(/\/app\/errand$/);
  await page.getByLabel("What's the job?").fill('chai banane ka saaman');
  await page.getByRole('button', { name: 'Use demo location (Indore)' }).click();
  await page.getByRole('button', { name: 'Make my list' }).click();

  // The agent proposes the usual items and asks once: defaults ticked, the customer adds one. The
  // heading is the agent's own question, in English (ADR-0048).
  await expect(page.getByRole('heading', { name: 'Which of these do you need?' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('checkbox', { name: 'chai patti' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'doodh' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'adrak' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'adrak' }).check();
  await expect(page.getByText('AI made this list and can make mistakes.')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'e2e/artifacts/errand-question.png', fullPage: true });

  await page.getByRole('button', { name: /Ask shops for these \d+/ }).click();

  // Progress lines appear while the shops answer.
  await expect(page.getByText('Understood: 3 items')).toBeVisible({ timeout: 30_000 });

  // The plan. The simulated shops answer at random, so the two plans are sometimes the same
  // (shown once) and sometimes differ ("See other options").
  await expect(page.getByText('Plan ready', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('chai patti').first()).toBeVisible();
  const tiles = page.getByRole('region', { name: 'Plan at a glance' });
  await expect(tiles).toContainText('₹');
  await expect(page.getByText(/AI picked this plan for the shortest trip/)).toBeVisible();
  const other = page.getByRole('button', { name: 'See other options' });
  const hasOther = (await other.count()) > 0;
  await expect(page.getByRole('list', { name: 'Stops in order' })).toBeVisible();

  // Numbered stops on the map, in route order, and a link that opens Google Maps with them.
  const stops = page
    .locator('.leaflet-marker-icon.cu-errand-pin')
    .filter({ has: page.locator('.cu-errand-pin__num') });
  await expect(stops.first()).toBeVisible({ timeout: 15_000 });
  await expect(stops.first()).toHaveText('1');
  // Every numbered pin is on the map, inside its frame: the map fits all stops.
  const frame = await page.locator('.cu-errand-map').boundingBox();
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
  await expect(page.getByRole('link', { name: 'Start route' })).toHaveAttribute(
    'href',
    /google\.com\/maps\/dir\/\?api=1&origin=.*&destination=/,
  );

  // The other plan opens too, with its own totals.
  if (hasOther) {
    await other.click();
    await expect(page.getByRole('button', { name: 'Back to the suggested plan' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to the suggested plan' }).click();
  }

  // A reload shows the same errand: its id is in the address.
  await expect(page).toHaveURL(/\/app\/errand\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(page.getByText('Plan ready', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('chai patti').first()).toBeVisible();
  await expect(page.getByLabel("What's the job?")).toHaveCount(0);

  await page.screenshot({ path: 'e2e/artifacts/errand-result.png', fullPage: true });
});
