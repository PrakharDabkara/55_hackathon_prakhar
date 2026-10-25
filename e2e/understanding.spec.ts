import { expect, test } from '@playwright/test';
import { ask, login, useDemoLocation } from './orderFlow.js';

// PR H: a search the app is not certain about is confirmed before any shop is asked.
test('a typo is confirmed with "Did you mean…?" before the shops are asked', async ({ page }) => {
  await login(page, '/app/');
  await useDemoLocation(page);
  await ask(page, 'bottle brsh');

  // The question, with the understood item first and a way to say it differently; no replies yet.
  const sheet = page.getByRole('dialog', { name: /Did you mean/ });
  await expect(sheet).toBeVisible();
  const yes = sheet.getByRole('button', { name: /Yes, this one/ });
  await expect(yes).toContainText(/bottle brush/i);
  await expect(sheet.getByLabel('Something else')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/$/);

  // It fits a 360 px phone without sideways scrolling.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'e2e/artifacts/understanding-confirm.png', fullPage: true });

  // "Yes, this one" asks the shops: the replies screen opens with the item on the parchi.
  await yes.click();
  await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
  // The item they chose is the request; their own words are small underneath (C-11).
  await expect(page.locator('.sh-parchi__item')).toContainText(/bottle brush/i);
  await expect(page.locator('.sh-parchi__alias')).toHaveText('you typed: bottle brsh');
});

test('"Something else" searches those words exactly, as typed, and opens the replies', async ({
  page,
}) => {
  await login(page, '/app/');
  await useDemoLocation(page);
  await ask(page, 'bottle brsh');
  const sheet = page.getByRole('dialog', { name: /Did you mean/ });
  await sheet.getByLabel('Something else').fill('blue glitter pen');
  await sheet.getByRole('button', { name: 'Search again' }).click();
  await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
  await expect(page.locator('.sh-parchi__item')).toContainText('blue glitter pen');
});

test('"Search for exactly what I typed" is the first choice, and a refusal stays in the sheet', async ({
  page,
}) => {
  await login(page, '/app/');
  await useDemoLocation(page);
  await ask(page, 'bottle brsh');
  const sheet = page.getByRole('dialog', { name: /Did you mean/ });
  const exact = sheet.getByRole('button', {
    name: 'Search for exactly what I typed: "bottle brsh"',
  });
  await expect(exact).toBeVisible();
  // The safety checks still run: this text is no product the classifier knows, so it is refused,
  // and the customer is not dropped back on Find.
  await exact.click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/couldn't understand/i);
  await expect(page).toHaveURL(/\/app\/$/);
});
