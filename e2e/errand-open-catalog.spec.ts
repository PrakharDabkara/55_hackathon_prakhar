import { expect, test } from '@playwright/test';
import { uniqueWord } from './unique.js';

// The school-project errand, in a real browser at 360 px, against the real API, Postgres, Redis and
// twelve simulated shops (grocery and stationery). The model is scripted, so the run is the same
// every time: the agent offers a checklist with extras, the customer ticks one more, a product the
// catalog does not know ("bead dazzling kit") becomes a new item and is asked of the shops, and the
// plan comes back. The simulated shops answer a new item at random, so the test holds only what is
// true whatever they say (ADR-0028).
// A new item name for every run: the item made last time is no longer new.
const KIT = `bead dazzling kit ${uniqueWord(4)}`;

test('a school-project errand: checklist with extras, a new item, stationery shops, the plan at 360 px', async ({
  page,
}) => {
  await page.goto('/app/');
  const phone = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  await page.getByLabel(/mobile number/i).fill(phone);
  await page.getByRole('button', { name: 'Send OTP' }).click();
  await page.getByRole('button', { name: 'Fill demo OTP' }).click();
  await page.getByRole('button', { name: 'Log in' }).click();

  await page.getByRole('link', { name: 'Describe a whole errand' }).click();
  await page
    .getByLabel('What is the errand?')
    .fill(`bachche ke project ke liye ${KIT}, chart paper, colours, sketch pens`);
  await page.getByRole('button', { name: 'Demo location (Indore)' }).click();
  await page.getByRole('button', { name: 'Make a plan' }).click();

  // The checklist: the named items ticked, the usual extras offered; the customer adds glue.
  await expect(page.getByRole('checkbox', { name: KIT })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('checkbox', { name: KIT })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'chart paper' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'glue stick' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'scissors' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'glue stick' }).check();
  await page.screenshot({ path: 'e2e/artifacts/school-project-checklist.png', fullPage: true });
  await page.getByRole('button', { name: 'Looks right' }).click();

  // The new item is created and asked of the shops; the timeline says so in plain words.
  await expect(page.getByText('Samjha: 5 cheezein')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('New item: asking the shops')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(new RegExp(`dukaanon se pooch raha hoon: ${KIT}`))).toBeVisible({
    timeout: 30_000,
  });

  // The plan, whatever the shops said about the new item.
  await expect(page.getByText('Plan ready', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.plan-item')).toHaveCount(5);
  await expect(page.getByText(KIT, { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('status', { name: 'Summary' })).toContainText('of 5 items found');
  // Nothing is blocked here, so no refusal wording and no dead end.
  await expect(page.getByText("We can't send this item to shops")).toHaveCount(0);

  // At 360 px nothing scrolls sideways and the plan stays inside the column.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const column = await page.locator('.screen').boundingBox();
  expect(column?.width).toBeLessThanOrEqual(360);
  await page.screenshot({ path: 'e2e/artifacts/school-project-plan.png', fullPage: true });
});
