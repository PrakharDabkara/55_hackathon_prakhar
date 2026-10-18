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
  await page.getByRole('button', { name: 'Meri location' }).click();
  await page.getByLabel('क्या चाहिए?').fill(what);
  await page.getByRole('button', { name: 'Dhoondho' }).click();
  await page.waitForURL(/\/app\/request\//, { timeout: 30_000 });
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
  await second.getByRole('button', { name: 'Meri location' }).click();
  await second.getByLabel('क्या चाहिए?').fill('chini');
  await second.getByRole('button', { name: 'Dhoondho' }).click();
  await shop.getByRole('button', { name: /Nahi hai/ }).click({ timeout: 30_000 });

  await shop.reload();
  const card = shop.getByRole('region', { name: 'Aaj ki maang' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByLabel('Aaye sawaal: 2')).toBeVisible();
  await expect(card.getByLabel('Jawab diye: 2')).toBeVisible();
  await expect(card.getByLabel('Haan kaha: 1')).toBeVisible();
  const missed = card.getByRole('list', { name: 'Log ye pooch rahe the' });
  await expect(missed.getByRole('listitem')).toHaveCount(1);
  // One customer so far: no area numbers.
  await expect(card.getByRole('list', { name: 'Aas-paas ki maang' })).toHaveCount(0);
  await noSidewaysScroll(shop);

  // A second and a third customer asking for the same thing (the first asked for haldi too).
  const extra = [await customerAsks(browser, corner, 'haldi')];
  await shop.reload();
  await expect(card.getByRole('list', { name: 'Aas-paas ki maang' })).toHaveCount(0);

  extra.push(await customerAsks(browser, corner, 'haldi'));
  await shop.reload();
  const area = card.getByRole('list', { name: 'Aas-paas ki maang' });
  await expect(area).toBeVisible({ timeout: 15_000 });
  await expect(area.getByRole('listitem').first()).toContainText('3 grahak');
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/aaj-ki-maang.png', fullPage: true });

  // Nothing about who they were.
  await expect(card.getByText(/\d{10}/)).toHaveCount(0);

  for (const context of [...extra, customerContext, shopContext]) await context.close();
});
