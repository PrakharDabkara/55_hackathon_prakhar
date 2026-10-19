import { expect, test } from '@playwright/test';

// PR H: a search the app is not certain about is confirmed before any shop is asked.
test('a typo is confirmed with "Kya aapka matlab…?" before the shops are asked', async ({
  page,
}) => {
  await page.goto('/app/');
  await page.getByLabel(/mobile number/i).fill('9810000511');
  await page.getByRole('button', { name: 'OTP bhejo' }).click();
  await page.getByRole('button', { name: 'Demo OTP bharein' }).click();
  await page.getByRole('button', { name: 'Login karein' }).click();

  await page.getByRole('button', { name: 'Demo location (Indore)' }).click();
  await page.getByLabel('क्या चाहिए?').fill('bottle brsh');
  await page.getByRole('button', { name: 'Dhoondho' }).click();

  // The question, with the understood item, "Haan, yahi" and "Kuch aur likhein"; no results yet.
  await expect(page.getByText('Kya aapka matlab…?')).toBeVisible();
  const yes = page.getByRole('button', { name: /Haan, yahi/ });
  await expect(yes).toContainText('bottle brush');
  await expect(page.getByRole('button', { name: 'Kuch aur likhein' })).toBeVisible();
  await expect(page.locator('.result')).toHaveCount(0);

  // It fits a 360 px phone without sideways scrolling.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'e2e/artifacts/understanding-confirm.png', fullPage: true });

  // "Haan, yahi" asks the shops: the results screen opens with the item.
  await yes.click();
  await expect(page.locator('.status-line')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('बोतल ब्रश');
});

test('"Kuch aur likhein" empties the box and asks nothing', async ({ page }) => {
  await page.goto('/app/');
  await page.getByLabel(/mobile number/i).fill('9810000512');
  await page.getByRole('button', { name: 'OTP bhejo' }).click();
  await page.getByRole('button', { name: 'Demo OTP bharein' }).click();
  await page.getByRole('button', { name: 'Login karein' }).click();

  await page.getByRole('button', { name: 'Demo location (Indore)' }).click();
  await page.getByLabel('क्या चाहिए?').fill('bottle brsh');
  await page.getByRole('button', { name: 'Dhoondho' }).click();
  await page.getByRole('button', { name: 'Kuch aur likhein' }).click();
  await expect(page.getByLabel('क्या चाहिए?')).toBeFocused();
  await expect(page.getByLabel('क्या चाहिए?')).toHaveValue('');
  await expect(page.getByText('Kya aapka matlab…?')).toHaveCount(0);
});
