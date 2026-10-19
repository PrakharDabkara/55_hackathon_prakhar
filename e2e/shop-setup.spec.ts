import { expect, test } from '@playwright/test';
import { login, VIEWPORT } from './orderFlow.js';
import { uniqueName } from './unique.js';

// Set-up when the phone will not say where the shop is (ADR-0041): the pin starts on the city
// centre, nothing is saved until the shop has moved it, and the arrow keys move it.
test('a shop that cannot be located must place the pin, and the arrow keys place it', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: VIEWPORT, permissions: [] });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (message) => {
    // The page's Content-Security-Policy refuses inline style attributes and outside scripts.
    if (/content security policy/i.test(message.text())) problems.push(message.text());
  });

  await login(page, '/app/shop');
  await page.getByLabel('Shop name').fill(uniqueName('Pin Kirana'));
  await page.getByRole('button', { name: 'Grocery' }).click();
  await expect(page.getByText('Set your shop location to continue.')).toBeVisible();

  await page.getByRole('button', { name: 'Use my current location' }).click();
  await expect(page.getByText('Drag the pin to your shop.')).toBeVisible();
  const start = page.getByRole('button', { name: 'Start getting requests' });
  await expect(start).toBeDisabled();

  const map = page.getByRole('group', { name: /Shop location map/ });
  await expect(map).toBeVisible();
  await map.focus();
  await expect(map).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(start).toBeEnabled();
  await expect(page.getByText('Stand inside your shop, or drag the pin to it.')).toBeVisible();

  // The map controls are big enough to hit.
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  const box = await zoomIn.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  expect(problems).toEqual([]);
  await context.close();
});
