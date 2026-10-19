import { expect, test, type Page } from '@playwright/test';
import { newCorner, noSidewaysScroll, setup } from './orderFlow.js';

// "Le liya?" (ADR-0035): a customer taps "Raasta", is asked on the home screen whether they got it,
// and the answer keeps learned stock honest. Two real browsers at 360 px. The server asks at once
// here (PICKUP_ASK_AFTER_MINUTES=0 in playwright.config.ts); in life it waits.

const QUESTION = /Kya aapko .+ par mila\?/;

/** Taps "Raasta" on the shop's card. The map is another site: it is not needed, only the tap. */
async function tapRaasta(customer: Page, card: ReturnType<Page['locator']>) {
  await customer.context().route('https://www.google.com/**', (route) => route.abort());
  const popup = customer.waitForEvent('popup').catch(() => null);
  await card.getByRole('link', { name: 'Raasta' }).click();
  await (await popup)?.close().catch(() => undefined);
}

async function searchAgain(customer: Page) {
  await customer.getByLabel('क्या चाहिए?').fill('haldi');
  const location = customer.getByRole('button', { name: 'Meri location' });
  if (await location.isVisible()) await location.click();
  await customer.getByRole('button', { name: 'Dhoondho' }).click();
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
  await customer.getByRole('button', { name: 'Ho gaya' }).click();

  const question = customer.getByText(QUESTION);
  await expect(question).toBeVisible({ timeout: 15_000 });
  await expect(question).toContainText('Le Liya Kirana');
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/le-liya-question.png', fullPage: true });
  for (const name of ['Mil gaya', 'Wahan nahi tha', 'Gaya nahi'])
    await expect(customer.getByRole('button', { name })).toBeVisible();

  await customer.getByRole('button', { name: 'Mil gaya' }).click();
  await expect(question).toHaveCount(0);

  // Asked once per customer, shop and item: a reload does not ask again.
  await customer.reload();
  await expect(customer.getByLabel('क्या चाहिए?')).toBeVisible();
  await expect(customer.getByText(QUESTION)).toHaveCount(0);

  // The shop's yes now stands as learned stock, marked as confirmed by a customer.
  await searchAgain(customer);
  const again = customer.getByRole('listitem').filter({ hasText: 'Le Liya Kirana' });
  await expect(again.getByText('Grahak ne confirm kiya')).toBeVisible({ timeout: 30_000 });
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
  await customer.getByRole('button', { name: 'Ho gaya' }).click();
  await expect(customer.getByText(QUESTION)).toBeVisible({ timeout: 15_000 });
  await customer.getByRole('button', { name: 'Wahan nahi tha' }).click();
  await expect(customer.getByText(QUESTION)).toHaveCount(0);

  // It is no longer "Likely": a new search does not list the shop from memory.
  await searchAgain(customer);
  await expect(customer.getByText(/Abhi kisi ne haan nahi kaha/)).toBeVisible({ timeout: 30_000 });
  await expect(customer.getByRole('listitem').filter({ hasText: 'Wahan Nahi Kirana' })).toHaveCount(
    0,
  );
  await noSidewaysScroll(customer);

  // Nothing on the shop's screen says anyone reported anything.
  await shop.reload();
  await expect(shop.getByRole('switch', { name: 'Dukaan khuli hai' })).toBeVisible();
  await expect(shop.getByText(/Wahan nahi tha|report|shikayat/i)).toHaveCount(0);
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
  await customer.getByRole('button', { name: 'Ho gaya' }).click();
  await expect(customer.getByText(QUESTION)).toBeVisible({ timeout: 15_000 });
  await customer.getByRole('button', { name: 'Gaya nahi' }).click();
  await expect(customer.getByText(QUESTION)).toHaveCount(0);

  await searchAgain(customer);
  const again = customer.getByRole('listitem').filter({ hasText: 'Gaya Nahi Kirana' });
  await expect(again).toBeVisible({ timeout: 30_000 });
  await expect(again.getByText('Grahak ne confirm kiya')).toHaveCount(0);

  await shopContext.close();
  await customerContext.close();
});
