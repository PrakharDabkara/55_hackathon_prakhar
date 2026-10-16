import { expect, test, type Page } from '@playwright/test';

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

test('the seeker login: the shopkeeper link is clear of the OTP button', async ({ page }) => {
  await page.goto('/app/');
  const send = page.getByRole('button', { name: 'OTP bhejo' });
  const link = page.getByRole('link', { name: 'Dukaandaar hain? Yahan jaayein' });
  await expect(link).toBeVisible();
  await expectNoOverlap(page);
  const [b, l] = await Promise.all([send.boundingBox(), link.boundingBox()]);
  if (!b || !l) throw new Error('button or link not on the page');
  expect(l.y).toBeGreaterThanOrEqual(b.y + b.height + 8);

  await page.getByLabel(/mobile number/i).fill('9810000502');
  await send.click();
  await expect(page.getByRole('button', { name: 'Demo OTP bharein' })).toBeVisible();
  await expectNoOverlap(page);
});

test('the shop login fits too', async ({ page }) => {
  await page.goto('/app/shop');
  await expect(page.getByLabel(/mobile number/i)).toBeVisible();
  await expectNoOverlap(page);
  await page.getByLabel(/mobile number/i).fill('9810000503');
  await page.getByRole('button', { name: 'OTP bhejo' }).click();
  await expect(page.getByRole('button', { name: 'Demo OTP bharein' })).toBeVisible();
  await expectNoOverlap(page);
});
