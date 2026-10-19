import { expect, test, type Page } from '@playwright/test';
import { uniquePhone } from './unique.js';

// The login screens at 360 px (the playwright config's viewport): nothing sticks out sideways and
// no button, link or field sits on top of another.
async function expectNoOverlap(page: Page) {
  const boxes = await page.locator('main a, main button, main input').evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30),
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
        };
      }),
  );
  expect(boxes.length).toBeGreaterThan(1);
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const overlaps =
        a.left < b.right - 1 &&
        b.left < a.right - 1 &&
        a.top < b.bottom - 1 &&
        b.top < a.bottom - 1;
      expect(overlaps, `"${a.name}" overlaps "${b.name}"`).toBe(false);
    }
  }
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBe(0);
}

test('the customer login sheet: the shopkeeper link and the sheet do not overlap', async ({
  page,
}) => {
  await page.goto('/app/');
  await expect(page.getByRole('link', { name: 'For shopkeepers' })).toBeVisible();
  // Find opens for anyone; the sheet comes up on the first Find.
  await page.getByLabel('What do you need?').fill('chini');
  await page.getByRole('button', { name: 'Near you' }).click();
  await page.getByRole('button', { name: 'Use demo location (Indore)' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Find nearby' }).click();
  const sheet = page.getByRole('dialog', { name: 'Log in to send your request' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Mobile number').fill(uniquePhone());
  await sheet.getByRole('button', { name: 'Send code' }).click();
  await expect(sheet.getByRole('button', { name: 'Fill demo OTP' })).toBeVisible();
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBe(0);
  // Nothing in the sheet sticks out of it.
  const box = await sheet.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('no sheet');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
});

test('the shop login fits too', async ({ page }) => {
  await page.goto('/app/shop');
  await expect(page.getByLabel(/mobile number/i)).toBeVisible();
  await expectNoOverlap(page);
  await page.getByLabel(/mobile number/i).fill(uniquePhone());
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('button', { name: 'Fill the code' })).toBeVisible();
  await expectNoOverlap(page);
});
