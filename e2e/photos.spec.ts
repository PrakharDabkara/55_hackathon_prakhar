import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { login, newCorner, onboardShop, shopContextAt } from './orderFlow.js';
import { uniqueName } from './unique.js';

// Photos on both sides, in two real browsers at 360 px against the real API and Postgres: a
// customer attaches a photo to a search, the shopkeeper sees it on the request card and answers
// with a photo of their own, and the customer sees that one on the result. Both pictures start as
// big GPS-tagged JPEGs; what the other side receives is small and carries no metadata (ADR-0030).
const VIEWPORT = { width: 360, height: 740 };
// Far from the simulated shops (around the demo location, 12 km away), so only the real shop below
// is asked and nobody answers before it can.
const ELSEWHERE = newCorner();
test.use({ geolocation: ELSEWHERE, permissions: ['geolocation'] });

/** A 3000 x 2000 photo with a GPS position and a camera name, as a phone makes it. */
const phonePhoto = (name: string) =>
  sharp({
    create: { width: 3000, height: 2000, channels: 3, background: { r: 40, g: 140, b: 90 } },
  })
    .jpeg({ quality: 95 })
    .withMetadata({
      exif: {
        IFD0: { Make: `Phone-${name}` },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '22/1 43/1 11/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '75/1 51/1 28/1',
        },
      },
    })
    .toBuffer();

const noSidewaysScroll = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

/** The bytes behind the first picture of this kind on the page, read from its data: URL. */
async function pictureBytes(page: Page, name: string) {
  const src = await page.getByRole('img', { name }).first().getAttribute('src');
  expect(src).toMatch(/^data:image\/jpeg;base64,/);
  return Buffer.from((src as string).split(',')[1] as string, 'base64');
}

async function expectClean(bytes: Buffer) {
  const meta = await sharp(bytes).metadata();
  expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1024);
  expect(bytes.length).toBeLessThan(400 * 1024);
  expect(meta.exif).toBeUndefined();
  expect(bytes.toString('latin1')).not.toContain('Phone-');
}

test("a customer and a shop each attach a photo, and each sees the other's, at 360 px", async ({
  page,
  browser,
}) => {
  // The shop: a kirana in that quiet corner, the only shop near the customer.
  const shopContext = await shopContextAt(browser, ELSEWHERE);
  const shop = await shopContext.newPage();
  await onboardShop(shop, uniqueName('Photo Test Kirana'));
  await expect(shop.getByText('No requests right now')).toBeVisible();

  // The customer asks for turmeric with a photo.
  await login(page, '/app/');
  await page.getByRole('button', { name: 'Use my location' }).click();
  await page.getByLabel('क्या चाहिए?').fill('haldi');
  const asking = phonePhoto('customer');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'IMG_1.jpg', mimeType: 'image/jpeg', buffer: await asking });
  await expect(page.getByRole('button', { name: 'Photo hatayein' })).toBeVisible({
    timeout: 20_000,
  });
  await noSidewaysScroll(page);
  await page.screenshot({ path: 'e2e/artifacts/photo-customer-attached.png', fullPage: true });
  await page.getByRole('button', { name: 'Search' }).click();

  // The shop sees the customer's photo on the request card: small, clean, tap to enlarge.
  const theirs = shop.getByRole('button', { name: 'Photo of what the customer wants: enlarge' });
  await expect(theirs).toBeVisible({ timeout: 30_000 });
  await expectClean(await pictureBytes(shop, 'Photo of what the customer wants'));
  await noSidewaysScroll(shop);
  await theirs.click();
  const big = shop.getByRole('dialog');
  await expect(big).toBeVisible();
  const box = await big.locator('img').boundingBox();
  expect(box?.width).toBeLessThanOrEqual(VIEWPORT.width);
  await shop.screenshot({ path: 'e2e/artifacts/photo-shop-sees-customer.png' });
  await shop.getByRole('button', { name: 'Close' }).click();

  // The shop says yes with a photo of what it has.
  await shop.getByRole('button', { name: 'Answer' }).click();
  const sheet = shop.getByRole('dialog');
  await sheet
    .locator('input[type="file"]')
    .setInputFiles({ name: 'IMG_2.jpg', mimeType: 'image/jpeg', buffer: await phonePhoto('shop') });
  await expect(sheet.getByRole('button', { name: 'Remove photo' })).toBeVisible({
    timeout: 20_000,
  });
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/photo-shop-attached.png', fullPage: true });
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();

  // The customer sees the shop's photo on that shop's result card.
  const shops = page.getByRole('button', { name: "Shop's photo: enlarge" });
  await expect(shops.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.result', { hasText: 'Photo Test Kirana' })).toBeVisible();
  await expectClean(await pictureBytes(page, "Shop's photo"));
  await noSidewaysScroll(page);
  await shops.first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/photo-customer-sees-shop.png' });
  await page.getByRole('button', { name: 'Close' }).click();

  await shopContext.close();
});

test('a search needs no photo: the button is there and the search works without it', async ({
  page,
}) => {
  await login(page, '/app/');
  await expect(page.getByRole('button', { name: 'Photo jodein' })).toBeVisible();
  await page.getByRole('button', { name: 'Demo location (Indore)' }).click();
  await page.getByLabel('क्या चाहिए?').fill('namak');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.status-line')).toBeVisible({ timeout: 30_000 });
});
