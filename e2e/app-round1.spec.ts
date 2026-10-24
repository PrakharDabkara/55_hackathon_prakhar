import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { screenProblems } from './a11y.js';
import { forgetDemoStock } from './db.js';
import {
  ask,
  goTo,
  login,
  newCorner,
  newPhone,
  onboardShop,
  sheetLogin,
  VIEWPORT,
} from './orderFlow.js';
import { uniqueName } from './unique.js';

// App round 1: the fixes from the two-phone test (login in both apps, shop set-up, the customer's
// "nothing nearby", and maps that stay under menus and sheets). Screenshots at two phone sizes in
// both themes go to SCREENS_DIR (not committed).
const OUT = process.env['SCREENS_DIR'] ?? join('e2e', 'artifacts', 'app-round1');
const SIZES = [
  { name: '360x800', width: 360, height: 800 },
  { name: '412x915', width: 412, height: 915 },
] as const;
const THEMES = ['light', 'dark'] as const;
const DEMO = "AskBuy is in demo mode. Real numbers can't receive codes yet.";
const BAD = "That doesn't look like an Indian mobile number.";

test.setTimeout(240_000);

/** A tall picture, like a phone screenshot, as PNG bytes made by the browser itself. */
async function tallPng(page: Page): Promise<Buffer> {
  const url = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 640;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    context.fillStyle = '#c44';
    context.fillRect(0, 0, 120, 640);
    context.fillStyle = '#fff';
    context.fillRect(10, 10, 100, 40);
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(url.split(',')[1] ?? '', 'base64');
}

/** Overlays (a drawer, a sheet) are fixed to the window, so they are shot as the window shows them. */
async function shoot(page: Page, name: string, fullPage = true) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
}

test.describe('login in both apps (A-01..A-06, A-09)', () => {
  test('the shop login: upbeat line, demo mode, bad numbers, Change number, Back', async ({
    page,
  }) => {
    await page.goto('/app/shop');
    await expect(page.getByText("Let's lift your shutter online!")).toBeVisible();
    await expect(page.getByText(DEMO)).toBeVisible();

    const number = page.getByLabel(/mobile number/i);
    for (const bad of ['9999999999', '1234567890']) {
      await number.fill(bad);
      await page.getByRole('button', { name: 'Send code' }).click();
      await expect(page.getByText(BAD)).toBeVisible();
      await expect(page.getByLabel('6-digit code')).toHaveCount(0);
    }

    await number.fill(newPhone());
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByLabel('6-digit code')).toBeVisible();
    await page.getByRole('button', { name: 'Change number' }).click();
    await expect(page.getByLabel('6-digit code')).toHaveCount(0);
    await expect(number).toBeEditable();

    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByLabel('6-digit code')).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel('6-digit code')).toHaveCount(0);
    await expect(number).toBeEditable();
  });

  test('a wrong code stays on screen with the tries left until it is edited', async ({ page }) => {
    await page.goto('/app/shop');
    // Without a demo phone on the list the server answers any number in the test run.
    await page.getByLabel(/mobile number/i).fill(newPhone());
    await page.getByRole('button', { name: 'Send code' }).click();
    const code = page.getByLabel('6-digit code');
    await code.fill('000000');
    await page.getByRole('button', { name: 'Log in' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('4 tries left.');
    await page.waitForTimeout(500);
    await expect(alert).toContainText('4 tries left.');
    await code.fill('00000');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the customer sheet: demo mode, Change number, Back', async ({ page }) => {
    await page.goto('/app/orders');
    const sheet = page.getByRole('dialog', { name: 'Log in to send your request' });
    await expect(sheet.getByText(DEMO)).toBeVisible();
    const number = sheet.getByLabel('Mobile number');
    await number.fill('9999999999');
    await sheet.getByRole('button', { name: 'Send code' }).click();
    await expect(sheet.getByText(BAD)).toBeVisible();
    await number.fill(newPhone());
    await sheet.getByRole('button', { name: 'Send code' }).click();
    await expect(sheet.getByLabel('6-digit code')).toBeVisible();
    await sheet.getByRole('button', { name: 'Change number' }).click();
    await expect(sheet.getByLabel('6-digit code')).toHaveCount(0);
    await expect(number).toBeEditable();
  });

  test('the phone on Account sits behind an eye button, in both apps', async ({ page }) => {
    await login(page, '/app/account');
    await expect(page.getByText('Logged in as')).toBeVisible();
    await expect(page.getByText(/^\+91 \d\d••• ••\d{3}$/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Show phone number' }).click();
    await expect(page.getByText(/^\+91 \d\d••• ••\d{3}$/)).toBeVisible();
    await page.getByRole('button', { name: 'Hide phone number' }).click();
    await expect(page.getByText(/^\+91 \d\d••• ••\d{3}$/)).toHaveCount(0);
  });
});

test.describe('after a shop logs in (A-08)', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a shutter rolls up and is gone within a second', async ({ page }) => {
    await page.goto('/app/shop');
    await page.getByLabel(/mobile number/i).fill(newPhone());
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByRole('button', { name: 'Fill the code' }).click();
    await page.getByRole('button', { name: 'Log in' }).click();
    const shutter = page.getByTestId('shutter-intro');
    await expect(shutter).toBeVisible();
    await expect(shutter).toHaveCount(0, { timeout: 2000 });
    await expect(page.getByRole('heading', { name: 'Set up your shop' })).toBeVisible();
  });
});

test.describe('after a shop logs in, with reduced motion (A-08)', () => {
  test.use({ reducedMotion: 'reduce' });

  test('there is no shutter at all', async ({ page }) => {
    await page.goto('/app/shop');
    await page.getByLabel(/mobile number/i).fill(newPhone());
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByRole('button', { name: 'Fill the code' }).click();
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your shop' })).toBeVisible();
    await expect(page.getByTestId('shutter-intro')).toHaveCount(0);
  });
});

test.describe('shop set-up (S-01..S-04)', () => {
  test('required marks, what is missing, optional delivery, a tall logo that stays in its circle', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      reducedMotion: 'reduce',
      geolocation: newCorner(),
      permissions: ['geolocation'],
    });
    const page = await context.newPage();
    await login(page, '/app/shop');
    await expect(page.getByRole('heading', { name: 'Set up your shop' })).toBeVisible();

    await expect(page.getByLabel('Shop name')).toHaveAttribute('aria-required', 'true');
    await expect(page.getByText('Upload logo')).toBeVisible();
    await expect(page.getByText(/Upload logo · optional/)).toHaveCount(0);
    const missing = page.locator('.sh-missing');
    await expect(missing).toContainText('Add your shop name');
    await expect(missing).toContainText(
      'Set your shop location: use your location or drag the pin',
    );
    const start = page.getByRole('button', { name: 'Start getting requests' });
    await expect(start).toBeDisabled();

    // A phone screenshot as the logo: the preview stays inside its circle.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'screenshot.png',
      mimeType: 'image/png',
      buffer: await tallPng(page),
    });
    const circle = page.locator('.sh-logopick__circle');
    const image = circle.locator('img.sh-logopick__img');
    await expect(image).toBeVisible();
    const c = await circle.boundingBox();
    const i = await image.boundingBox();
    if (!c || !i) throw new Error('no boxes');
    expect(i.width).toBeLessThanOrEqual(c.width + 1);
    expect(i.height).toBeLessThanOrEqual(c.height + 1);
    expect(Math.abs(i.x - c.x)).toBeLessThanOrEqual(3);

    // "I deliver" is collapsed; its row has no tap highlight and room around the label.
    const toggle = page.getByRole('button', { name: /I deliver/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    const row = page.getByRole('switch', { name: 'I deliver' });
    await expect(row).toBeVisible();
    const highlight = await row.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('-webkit-tap-highlight-color'),
    );
    expect(highlight).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    const label = await row.locator('.sh-switch__label').boundingBox();
    const rowBox = await row.boundingBox();
    if (!label || !rowBox) throw new Error('no switch');
    expect(label.x - rowBox.x).toBeGreaterThanOrEqual(3);

    await page.getByLabel('Shop name').fill(uniqueName('Round One Kirana'));
    await page.getByRole('button', { name: 'Grocery' }).click();
    await page.getByRole('button', { name: 'Use my current location' }).click();
    await expect(start).toBeEnabled();
    await expect(page.locator('.sh-missing')).toHaveCount(0);
    expect(await screenProblems(page)).toEqual([]);
    await context.close();
  });
});

test.describe('a map stays under the menu and the sheets (X-02)', () => {
  /** Where the map pokes through `selector`; `overlaps` is false when the map is not behind it at all. */
  const coveredByMap = (page: Page, selector: string) =>
    page.evaluate((sel) => {
      const box = document.querySelector(sel)?.getBoundingClientRect();
      const map = document.querySelector('.leaflet-container')?.getBoundingClientRect();
      if (!box || !map) return { bad: ['missing'], overlaps: false };
      const overlaps =
        map.left < box.right &&
        box.left < map.right &&
        map.top < box.bottom &&
        box.top < map.bottom;
      const bad: string[] = [];
      for (const fx of [0.2, 0.5, 0.8]) {
        for (const fy of [0.15, 0.4, 0.65, 0.9]) {
          const hit = document.elementFromPoint(box.x + box.width * fx, box.y + box.height * fy);
          if (hit?.closest('.leaflet-container')) bad.push(`${fx},${fy}`);
        }
      }
      return { bad, overlaps };
    }, selector);

  test('the shop drawer over Settings, and the customer sheet over the replies map', async ({
    browser,
  }) => {
    const corner = newCorner();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      reducedMotion: 'reduce',
      geolocation: corner,
      permissions: ['geolocation'],
    });
    const shop = await context.newPage();
    await onboardShop(shop, uniqueName('Round One Maps'));
    await goTo(shop, 'settings');
    await expect(shop.locator('.leaflet-container')).toBeVisible();
    await shop.locator('.leaflet-container').scrollIntoViewIfNeeded();
    await shop.getByRole('button', { name: 'Menu' }).click();
    await expect(shop.getByRole('dialog', { name: 'Main menu' })).toBeVisible();
    await shop.waitForTimeout(500); // the drawer slides in
    expect(await coveredByMap(shop, '.sh-drawer')).toEqual({ bad: [], overlaps: true });
    await context.close();

    const customerContext = await browser.newContext({
      viewport: VIEWPORT,
      reducedMotion: 'reduce',
      geolocation: corner,
      permissions: ['geolocation'],
    });
    const customer = await customerContext.newPage();
    await login(customer, '/app/');
    await ask(customer, 'haldi');
    await expect(customer).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
    await customer.getByRole('button', { name: 'Map' }).click();
    await expect(customer.locator('.leaflet-container')).toBeVisible();
    await customer.getByRole('button', { name: 'Stop asking' }).click();
    await expect(customer.getByRole('dialog')).toBeVisible();
    await customer.waitForTimeout(500); // the sheet slides up
    expect(await coveredByMap(customer, '.sh-sheet')).toEqual({ bad: [], overlaps: true });
    await customerContext.close();
  });
});

test.describe('Find: nothing nearby says why (C-03, C-04)', () => {
  test('far from every shop, the search explains itself and offers a next step', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      reducedMotion: 'reduce',
      geolocation: newCorner(),
      permissions: ['geolocation'],
    });
    const customer = await context.newPage();
    await login(customer, '/app/');
    await ask(customer, 'haldi');
    await expect(customer).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
    await expect(customer.getByText('No shops asked · 2 km')).toBeVisible();
    await expect(
      customer.getByText('No open shops within 2 km sell this kind of item yet'),
    ).toBeVisible();
    await expect(customer.getByRole('button', { name: 'Try different words' })).toBeVisible();
    await expect(customer.getByRole('button', { name: 'Search 5 km' })).toBeVisible();
    expect(await screenProblems(customer)).toEqual([]);
    await context.close();
  });
});

test.describe('screenshots of the changed screens', () => {
  for (const size of SIZES) {
    for (const theme of THEMES) {
      test(`${size.name} ${theme}`, async ({ browser }) => {
        const corner = newCorner();
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          colorScheme: theme,
          reducedMotion: 'reduce',
          geolocation: corner,
          permissions: ['geolocation'],
        });
        const page = await context.newPage();
        const tag = `${size.name}-${theme}`;

        await page.goto('/app/shop');
        await expect(page.getByText(DEMO)).toBeVisible();
        await shoot(page, `shop-login-${tag}`);
        await page.getByLabel(/mobile number/i).fill(newPhone());
        await page.getByRole('button', { name: 'Send code' }).click();
        await expect(page.getByRole('button', { name: 'Change number' })).toBeVisible();
        await shoot(page, `shop-login-code-${tag}`);
        await page.getByRole('button', { name: 'Fill the code' }).click();
        await page.getByRole('button', { name: 'Log in' }).click();

        await expect(page.getByRole('heading', { name: 'Set up your shop' })).toBeVisible();
        await page.locator('input[type="file"]').setInputFiles({
          name: 'screenshot.png',
          mimeType: 'image/png',
          buffer: await tallPng(page),
        });
        await page.getByRole('button', { name: /I deliver/ }).click();
        await page.getByRole('switch', { name: 'I deliver' }).click();
        await shoot(page, `shop-setup-${tag}`);
        await page.getByLabel('Shop name').fill(uniqueName('Shot Kirana'));
        await page.getByRole('button', { name: 'Grocery' }).click();
        await page.getByRole('button', { name: 'Use my current location' }).click();
        await page.getByRole('button', { name: 'Start getting requests' }).click();
        await expect(page.getByRole('switch', { name: 'Open' })).toBeVisible({ timeout: 15_000 });
        await goTo(page, 'settings');
        await expect(page.locator('.leaflet-container')).toBeVisible();
        await shoot(page, `shop-settings-${tag}`);
        await page.getByRole('button', { name: 'Menu' }).click();
        await expect(page.getByRole('dialog', { name: 'Main menu' })).toBeVisible();
        await page.waitForTimeout(500); // the drawer slides in
        await shoot(page, `shop-drawer-over-map-${tag}`, false);

        const customer = await context.newPage();
        await customer.goto('/app/');
        await shoot(customer, `customer-find-${tag}`);
        await customer.goto('/app/orders');
        await shoot(customer, `customer-login-${tag}`);
        await sheetLogin(customer);
        await customer.goto('/app/account');
        await customer.getByRole('button', { name: 'Show phone number' }).click();
        await shoot(customer, `customer-account-${tag}`);
        await customer.goto('/app/');
        await ask(customer, 'haldi');
        await expect(customer).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
        await shoot(customer, `customer-nothing-nearby-${tag}`);
        await context.close();
      });
    }
  }
});

test.describe('the demo area (X-01)', () => {
  test.beforeEach(forgetDemoStock);

  /** One of the ten demo customer numbers, so a rerun within ten minutes rarely meets a used one. */
  const demoPhone = () => `9000000${201 + Math.floor(Math.random() * 10)}`;

  test('a demo customer starts in Vijay Nagar with a banner; Change gives the choice back', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      reducedMotion: 'reduce',
      geolocation: newCorner(),
      permissions: ['geolocation'],
    });
    const page = await context.newPage();
    await page.goto('/app/orders');
    const sheet = page.getByRole('dialog', { name: 'Log in to send your request' });
    await sheet.getByLabel('Mobile number').fill(demoPhone());
    await sheet.getByRole('button', { name: 'Send code' }).click();
    await sheet.getByRole('button', { name: 'Fill demo OTP' }).click();
    await sheet.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible();

    await page.goto('/app/');
    await expect(page.getByText('Demo area: Vijay Nagar, Indore')).toBeVisible();
    await ask(page, 'chini');
    await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
    await expect(page.getByText(/^Sent to [1-9]\d* shops? · 2 km$/)).toBeVisible();

    await page.goto('/app/');
    await page.getByRole('button', { name: 'Change' }).click();
    await expect(page.getByRole('dialog', { name: 'Change location' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText(/Demo area:/)).toHaveCount(0);
    // The choice sticks for the session.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Find nearby' })).toBeVisible();
    await expect(page.getByText(/Demo area:/)).toHaveCount(0);
    expect(await screenProblems(page)).toEqual([]);
    await context.close();
  });

  test('nothing nearby offers the demo area, and it finds the demo shops', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      reducedMotion: 'reduce',
      geolocation: newCorner(),
      permissions: ['geolocation'],
    });
    const page = await context.newPage();
    await login(page, '/app/');
    await ask(page, 'chini');
    await expect(page.getByText('No shops asked · 2 km')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Use the demo area (Indore)' }).click();
    await expect(page.getByText(/^Sent to [1-9]\d* shops? · 2 km$/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Use the demo area (Indore)' })).toHaveCount(0);
    await context.close();
  });
});
