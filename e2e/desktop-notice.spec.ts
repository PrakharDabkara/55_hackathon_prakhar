import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { screenProblems } from './a11y.js';

// The desktop notice: on a laptop-wide window (1024 px and up) both apps say they are made for
// phones and offer a phone-sized window. Below 1024 px nothing changes.

const APPS = [
  { name: 'buyer', path: '/app/', phrase: 'AskBuy is made for phones.' },
  { name: 'shop', path: '/app/shop', phrase: 'This app is made for phones.' },
] as const;
const TIP = 'Tip: open the shop app in an incognito window, side by side, to watch a request live.';

const notice = (page: Page) => page.getByRole('complementary', { name: 'Use it on a phone' });

interface Opened {
  url: string;
  name: string;
  features: string;
}

/** Replaces window.open before the app loads. `blocked` makes it return null, as a popup blocker does. */
async function stubOpen(page: Page, blocked = false) {
  await page.addInitScript((isBlocked) => {
    const w = window as unknown as { __opened: unknown[]; open: unknown };
    w.__opened = [];
    w.open = (url: string, name: string, features: string) => {
      w.__opened.push({ url: String(url), name, features });
      return isBlocked ? null : ({} as Window);
    };
  }, blocked);
}
const opened = (page: Page) =>
  page.evaluate(() => (window as unknown as { __opened: Opened[] }).__opened);

function featureMap(features: string): Record<string, number> {
  return Object.fromEntries(
    features.split(',').map((f) => {
      const [k, v] = f.split('=');
      return [k?.trim(), Number(v)];
    }),
  );
}

test.describe('at 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const app of APPS) {
    test(`${app.name}: the notice shows, can be dismissed, and stays dismissed`, async ({
      page,
    }) => {
      await page.goto(app.path);
      await expect(notice(page)).toBeVisible();
      await expect(notice(page)).toContainText(app.phrase);
      await expect(notice(page)).toContainText(
        "For the best experience, open it on your phone, or use your browser's device mode (Chrome: F12, then Ctrl+Shift+M).",
      );
      await notice(page).getByRole('button', { name: 'Dismiss' }).click();
      await expect(notice(page)).toHaveCount(0);
      await page.reload();
      await expect(page.locator('#root')).not.toBeEmpty();
      await expect(notice(page)).toHaveCount(0);
    });

    test(`${app.name}: still works and dismisses when storage is blocked`, async ({ page }) => {
      await page.addInitScript(() => {
        const boom = () => {
          throw new DOMException('blocked', 'SecurityError');
        };
        Object.defineProperty(window, 'localStorage', { get: boom });
      });
      await page.goto(app.path);
      await expect(notice(page)).toBeVisible();
      await notice(page).getByRole('button', { name: 'Dismiss' }).click();
      await expect(notice(page)).toHaveCount(0);
    });

    test(`${app.name}: no axe problems, no sideways scroll, buttons 44 px or taller`, async ({
      page,
    }) => {
      for (const width of [1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(app.path);
        await expect(notice(page)).toBeVisible();
        expect(await screenProblems(page), `${app.name} at ${width}`).toEqual([]);
        for (const b of await notice(page).getByRole('button').all()) {
          expect((await b.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        }
      }
    });
  }

  test('the notice is the first thing the keyboard reaches, in reading order', async ({ page }) => {
    await page.goto('/app/');
    await page.keyboard.press('Tab');
    await expect(notice(page).getByRole('button', { name: 'Open as a phone' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      notice(page).getByRole('button', { name: 'Open buyer + shop side by side' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(notice(page).getByRole('button', { name: 'Dismiss' })).toBeFocused();
  });

  for (const app of APPS) {
    test(`${app.name}: "Open as a phone" opens this page in a phone-sized window`, async ({
      page,
    }) => {
      await stubOpen(page);
      await page.goto(app.path);
      await notice(page).getByRole('button', { name: 'Open as a phone' }).click();
      const [call] = await opened(page);
      expect(new URL(call!.url).pathname).toBe(app.path);
      expect(call!.name).toBe(`askbuy-${app.name}`);
      const f = featureMap(call!.features);
      expect(f['width']).toBe(420);
      expect(f['height']).toBeGreaterThanOrEqual(600);
      expect(f['height']).toBeLessThanOrEqual(860);
      expect(f['left']).toBeGreaterThanOrEqual(0);
      expect(f['top']).toBeGreaterThanOrEqual(0);
      await expect(page.getByText(TIP)).toHaveCount(0);
    });
  }

  test('"Open buyer + shop side by side" opens two phone windows next to each other', async ({
    page,
  }) => {
    await stubOpen(page);
    await page.goto('/app/');
    await notice(page).getByRole('button', { name: 'Open buyer + shop side by side' }).click();
    const [buyer, shop] = await opened(page);
    expect(new URL(buyer!.url).pathname).toBe('/app/');
    expect(new URL(shop!.url).pathname).toBe('/app/shop');
    expect(buyer!.name).not.toBe(shop!.name);
    const a = featureMap(buyer!.features);
    const b = featureMap(shop!.features);
    expect(a['width']).toBe(420);
    expect(b['width']).toBe(420);
    expect(a['top']).toBe(b['top']);
    expect(b['left']! - a['left']!).toBeGreaterThanOrEqual(420);
  });

  test('when window.open is blocked, the incognito tip shows instead', async ({ page }) => {
    await stubOpen(page, true);
    await page.goto('/app/shop');
    await expect(page.getByText(TIP)).toHaveCount(0);
    await notice(page).getByRole('button', { name: 'Open as a phone' }).click();
    await expect(page.getByText(TIP)).toBeVisible();
    await page.reload();
    await notice(page).getByRole('button', { name: 'Open buyer + shop side by side' }).click();
    await expect(page.getByText(TIP)).toBeVisible();
  });
});

test.describe('below 1024 px', () => {
  for (const width of [360, 412, 768, 1023]) {
    for (const app of APPS) {
      test(`${app.name}: no notice at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(app.path);
        await expect(page.locator('#root')).not.toBeEmpty();
        await expect(notice(page)).toHaveCount(0);
      });
    }
  }

  test('a phone-sized popup shows no notice, though the screen is wide', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 420, height: 860 } });
    const popup = await context.newPage();
    await popup.goto('/app/');
    await expect(popup.locator('#root')).not.toBeEmpty();
    await expect(notice(popup)).toHaveCount(0);
    await context.close();
  });
});

// Screenshots for the PR: SHOTS_TAG=before|after writes the phone sizes, SHOTS_TAG=desktop the
// notice at 1280. Off unless asked, so the normal run writes nothing outside the repo.
const SHOTS = process.env['SHOTS_TAG'];
const DIR = join(homedir(), 'kahan-tools', 'screens', 'desktop-notice');

test.describe('screenshots', () => {
  test.skip(!SHOTS, 'set SHOTS_TAG to take screenshots');

  test('360 and 412 px', async ({ page }) => {
    mkdirSync(DIR, { recursive: true });
    for (const width of [360, 412]) {
      for (const app of APPS) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(app.path);
        await expect(page.locator('#root')).not.toBeEmpty();
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(DIR, `${SHOTS}-${width}-${app.name}.png`) });
      }
    }
  });

  test('1280 px, light and dark', async ({ page }) => {
    mkdirSync(DIR, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const app of APPS) {
        await page.goto(app.path);
        await expect(notice(page)).toBeVisible();
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(DIR, `1280-${app.name}-${scheme}.png`) });
      }
    }
  });
});
