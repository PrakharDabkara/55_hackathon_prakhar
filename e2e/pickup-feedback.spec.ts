import { expect, test, type Page } from '@playwright/test';
import { newCorner, noSidewaysScroll, setup } from './orderFlow.js';

// "Le liya?" (ADR-0035): a customer taps "Raasta", is asked on the home screen whether they got it,
// and the answer keeps learned stock honest. Two real browsers at 360 px. The server asks at once
// here (PICKUP_ASK_AFTER_MINUTES=0 in playwright.config.ts); in life it waits.

const QUESTION = /Did you find .+ at .+\?/;

/** Taps "Raasta" on the shop's card. The map is another site: it is not needed, only the tap. */
async function tapRaasta(customer: Page, card: ReturnType<Page['locator']>) {
  await customer.context().route('https://www.google.com/**', (route) => route.abort());
  const popup = customer.waitForEvent('popup').catch(() => null);
  await card.getByRole('link', { name: 'Directions' }).click();
  await (await popup)?.close().catch(() => undefined);
}

async function searchAgain(customer: Page) {
  await customer.getByLabel('क्या चाहिए?').fill('haldi');
  const location = customer.getByRole('button', { name: 'Use my location' });
  if (await location.isVisible()) await location.click();
  await customer.getByRole('button', { name: 'Search' }).click();
}

test('"Mil gaya" refreshes the answer: the next customer sees "Grahak ne confirm kiya"', async ({
  browser,
}) => {
  const { shopContext, customer, customerContext, card } = await setup(
    browser,
    'Le Liya Kirana',
    newCorner(),
  );
  await tapRaasta(customer, card);
  await customer.getByRole('button', { name: 'Done', exact: true }).click();

  const question = customer.getByText(QUESTION);
  await expect(question).toBeVisible({ timeout: 15_000 });
  await expect(question).toContainText('Le Liya Kirana');
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/le-liya-question.png', fullPage: true });
  for (const name of ['Found it', 'Not there', "Didn't go"])
    await expect(customer.getByRole('button', { name })).toBeVisible();

  await customer.getByRole('button', { name: 'Found it' }).click();
  await expect(question).toHaveCount(0);

  // Asked once per customer, shop and item: a reload does not ask again.
  await customer.reload();
  await expect(customer.getByLabel('क्या चाहिए?')).toBeVisible();
  await expect(customer.getByText(QUESTION)).toHaveCount(0);

  // The shop's yes now stands as learned stock, marked as confirmed by a customer.
  await searchAgain(customer);
  const again = customer.getByRole('listitem').filter({ hasText: 'Le Liya Kirana' });
  await expect(again.getByText('Confirmed by a customer')).toBeVisible({ timeout: 30_000 });
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/le-liya-verified.png', fullPage: true });

  await shopContext.close();
  await customerContext.close();
});

test('"Wahan nahi tha" takes the shop\'s answer off the map at once, and the shop never learns who', async ({
  browser,
}) => {
  const { shop, shopContext, customer, customerContext, card } = await setup(
    browser,
    'Wahan Nahi Kirana',
    newCorner(),
  );
  await tapRaasta(customer, card);
  await customer.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(customer.getByText(QUESTION)).toBeVisible({ timeout: 15_000 });
  await customer.getByRole('button', { name: 'Not there' }).click();
  await expect(customer.getByText(QUESTION)).toHaveCount(0);

  // It is no longer "Likely": a new search does not list the shop from memory.
  await searchAgain(customer);
  await expect(customer.getByText(/No shop has said yes yet/)).toBeVisible({ timeout: 30_000 });
  await expect(customer.getByRole('listitem').filter({ hasText: 'Wahan Nahi Kirana' })).toHaveCount(
    0,
  );
  await noSidewaysScroll(customer);

  // Nothing on the shop's screen says anyone reported anything.
  await shop.reload();
  await expect(shop.getByRole('switch', { name: 'Open' })).toBeVisible();
  await expect(shop.getByText(/Not there|report|shikayat/i)).toHaveCount(0);
  await noSidewaysScroll(shop);

  await shopContext.close();
  await customerContext.close();
});

test('"Gaya nahi" changes nothing', async ({ browser }) => {
  const { shopContext, customer, customerContext, card } = await setup(
    browser,
    'Gaya Nahi Kirana',
    newCorner(),
  );
  await tapRaasta(customer, card);
  await customer.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(customer.getByText(QUESTION)).toBeVisible({ timeout: 15_000 });
  await customer.getByRole('button', { name: "Didn't go" }).click();
  await expect(customer.getByText(QUESTION)).toHaveCount(0);

  await searchAgain(customer);
  const again = customer.getByRole('listitem').filter({ hasText: 'Gaya Nahi Kirana' });
  await expect(again).toBeVisible({ timeout: 30_000 });
  await expect(again.getByText('Confirmed by a customer')).toHaveCount(0);

  await shopContext.close();
  await customerContext.close();
});
