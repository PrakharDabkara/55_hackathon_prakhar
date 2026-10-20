import { expect, test, type Browser } from '@playwright/test';
import { ask, goTo, login, newCorner, noSidewaysScroll, setup, VIEWPORT } from './orderFlow.js';

// Insights (ADR-0035, ADR-0041): the shop screen counts today's questions, shows what people asked for
// and did not find, and shows the area's demand only once 3 different customers asked.

type Corner = ReturnType<typeof newCorner>;

/** A new customer, standing at the corner, asking for `what`. */
async function customerAsks(browser: Browser, corner: Corner, what: string) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    geolocation: corner,
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  await login(page, '/app/');
  await ask(page, what);
  await expect(page).toHaveURL(/\/app\/request\/[\w-]+$/, { timeout: 30_000 });
  return context;
}

test("the shop sees today's numbers, what was asked for and missed, and the area only from 3 customers", async ({
  browser,
}) => {
  const corner = newCorner();
  const { shop, shopContext, customer, customerContext } = await setup(
    browser,
    'Maang Kirana',
    corner,
  );

  // One question the shop cannot answer: "Not available".
  const second = await customer.context().newPage();
  await second.goto('/app/');
  await ask(second, 'chini');
  await shop.getByRole('button', { name: 'Answer' }).click({ timeout: 30_000 });
  await shop.getByRole('button', { name: 'Not available' }).click();
  await expect(shop.getByText('No requests right now')).toBeVisible();

  await goTo(shop, 'insights');
  await shop.reload();
  const tile = (label: string) => shop.locator('.sh-tile', { hasText: label });
  await expect(tile('Requests')).toContainText('2', { timeout: 15_000 });
  await expect(tile('You answered')).toContainText('2');
  await expect(tile('Said "in stock"')).toContainText('1');
  const missed = shop.getByRole('list', { name: 'You said no to' });
  await expect(missed.getByRole('listitem')).toHaveCount(1);
  // One customer so far: no area numbers.
  await expect(shop.getByText('Not enough nearby requests yet.')).toBeVisible();
  await noSidewaysScroll(shop);

  // A second and a third customer asking for the same thing (the first asked for haldi too).
  const extra = [await customerAsks(browser, corner, 'haldi')];
  await shop.reload();
  await expect(shop.getByText('Not enough nearby requests yet.')).toBeVisible();

  extra.push(await customerAsks(browser, corner, 'haldi'));
  await shop.reload();
  const area = shop.getByRole('list', { name: 'Most asked near you' });
  await expect(area).toBeVisible({ timeout: 15_000 });
  await expect(area.getByRole('listitem').first()).toContainText('3');
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/insights.png', fullPage: true });

  // Nothing about who they were.
  await expect(shop.getByText(/\d{10}/)).toHaveCount(0);

  for (const context of [...extra, customerContext, shopContext]) await context.close();
});
