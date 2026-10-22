import { expect, test } from '@playwright/test';
import { forgetDemoStock } from './db.js';
import { login } from './orderFlow.js';
import { uniqueWord } from './unique.js';

// The school-project errand, in a real browser at 360 px, against the real API, Postgres, Redis and
// twelve simulated shops (grocery and stationery). The model is scripted, so the run is the same
// every time: the agent offers a checklist with extras, the customer ticks one more, a product the
// catalog does not know ("bead dazzling kit") becomes a new item and is asked of the shops, and the
// plan comes back. The simulated shops answer a new item at random, so the test holds only what is
// true whatever they say (ADR-0028).
// A new item name for every run: the item made last time is no longer new.
const KIT = `bead dazzling kit ${uniqueWord(4)}`;

// It asks at the demo place, where every spec shares the simulated shops: what they learn here
// must not change another spec's search, so they forget it afterwards (db.ts).
test.afterAll(forgetDemoStock);

test('a school-project errand: checklist with extras, a new item, stationery shops, the plan at 360 px', async ({
  page,
}) => {
  await login(page, '/app/');
  await page.getByRole('link', { name: /Plan an errand/ }).click();
  await page
    .getByLabel("What's the job?")
    .fill(`bachche ke project ke liye ${KIT}, chart paper, colours, sketch pens`);
  await page.getByRole('button', { name: 'Use demo location (Indore)' }).click();
  await page.getByRole('button', { name: 'Make my list' }).click();

  // The checklist: the named items ticked, the usual extras offered; the customer adds glue.
  await expect(page.getByRole('heading', { name: /Which of these do you need/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('checkbox', { name: KIT })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'chart paper' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'glue stick' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'scissors' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'glue stick' }).check();
  await page.screenshot({ path: 'e2e/artifacts/school-project-checklist.png', fullPage: true });
  await page.getByRole('button', { name: /Ask shops for these \d+/ }).click();

  // The new item is created and asked of the shops; the timeline says so in plain words.
  await expect(page.getByText('Understood: 5 items')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('New item: asking shops')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(new RegExp(`Asking \\d+ shops?: ${KIT}`))).toBeVisible({
    timeout: 30_000,
  });

  // The plan, whatever the shops said about the new item.
  await expect(page.getByText('Plan ready', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(KIT, { exact: false }).first()).toBeVisible();
  // Nothing is blocked here, so no refusal wording and no dead end.
  await expect(page.getByText('We cannot send this item to shops')).toHaveCount(0);

  // At 360 px nothing scrolls sideways and the plan stays inside the column.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const column = await page.locator('.cu-column').boundingBox();
  expect(column?.width).toBeLessThanOrEqual(360);
  await page.screenshot({ path: 'e2e/artifacts/school-project-plan.png', fullPage: true });
});
