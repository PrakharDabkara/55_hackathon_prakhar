import { expect, test, type Browser } from '@playwright/test';
import { login, newCorner, noSidewaysScroll, setup, VIEWPORT } from './orderFlow.js';

// "Aaj ki maang" (ADR-0035): the shop screen counts today's questions, shows what people asked for
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
  await page.getByRole('button', { name: 'Use my location' }).click();
  await page.getByLabel('क्या चाहिए?').fill(what);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible({
    timeout: 30_000,
  });
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

  // One question the shop cannot answer: "Nahi hai".
  const second = await customer.context().newPage();
  await second.goto('/app/');
  await second.getByRole('button', { name: 'Use my location' }).click();
  await second.getByLabel('क्या चाहिए?').fill('chini');
  await second.getByRole('button', { name: 'Search' }).click();
  await shop.getByRole('button', { name: 'No', exact: true }).click({ timeout: 30_000 });

  await shop.reload();
  const card = shop.getByRole('region', { name: "Today's demand" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByLabel('Questions received: 2')).toBeVisible();
  await expect(card.getByLabel('Answered: 2')).toBeVisible();
  await expect(card.getByLabel('Said yes: 1')).toBeVisible();
  const missed = card.getByRole('list', { name: 'People were asking for' });
  await expect(missed.getByRole('listitem')).toHaveCount(1);
  // One customer so far: no area numbers.
  await expect(card.getByRole('list', { name: 'Demand nearby' })).toHaveCount(0);
  await noSidewaysScroll(shop);

  // A second and a third customer asking for the same thing (the first asked for haldi too).
  const extra = [await customerAsks(browser, corner, 'haldi')];
  await shop.reload();
  await expect(card.getByRole('list', { name: 'Demand nearby' })).toHaveCount(0);

  extra.push(await customerAsks(browser, corner, 'haldi'));
  await shop.reload();
  const area = card.getByRole('list', { name: 'Demand nearby' });
  await expect(area).toBeVisible({ timeout: 15_000 });
  await expect(area.getByRole('listitem').first()).toContainText('3 customers');
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/aaj-ki-maang.png', fullPage: true });

  // Nothing about who they were.
  await expect(card.getByText(/\d{10}/)).toHaveCount(0);

  for (const context of [...extra, customerContext, shopContext]) await context.close();
});
