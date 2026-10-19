import { expect, test } from '@playwright/test';
import { ADDRESS, newCorner, noSidewaysScroll, order, setup } from './orderFlow.js';

// A delivery order from end to end, in two real browsers at 360 px (ADR-0039, PR J): the customer
// ticks "Deliver to me", the shop says it will deliver, the customer picks it (a fresh offer is
// binding, so the order starts ACCEPTED), the shop sets out and the customer taps Received. And a
// shop that cancels with a reason. Shared steps are in orderFlow.ts.
test('a delivery order: pick, set out, and the customer confirms receipt', async ({ browser }) => {
  const { shop, shopContext, customer, customerContext, card } = await setup(
    browser,
    'Delivery Test Kirana',
    newCorner(),
  );
  await expect(card.getByText(/Will deliver · ₹20/)).toBeVisible();
  await order(customer, card, { note: 'Gate 2, ring the bell' });

  // Chosen, not asked: the shop already has the address and the customer's note.
  const shopCard = shop.locator('article.order-card');
  await expect(shopCard).toBeVisible({ timeout: 30_000 });
  await expect(shopCard.getByText('Grahak', { exact: true })).toBeVisible();
  await expect(shopCard.getByText(/Cash on delivery/)).toBeVisible();
  await expect(shopCard.getByText(/Gate 2, ring the bell/)).toBeVisible();
  await expect(shopCard.getByText(ADDRESS)).toBeVisible();
  const map = shopCard.getByRole('link', { name: 'See on map' });
  await expect(map).toHaveAttribute('href', /google\.com\/maps\/search\/\?api=1&query=2[4-6]\./);
  await expect(shopCard.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(shopCard.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/delivery-shop-accepted.png', fullPage: true });

  await shopCard.getByRole('button', { name: 'On my way' }).click();
  await expect(card.getByText('On its way')).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  // The shop has no Delivered button: only the customer finishes it.
  await expect(shopCard.getByRole('button', { name: 'Delivered' })).toHaveCount(0);
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/delivery-customer-out.png', fullPage: true });

  await card.getByRole('button', { name: 'Received' }).click();
  await expect(card.getByText(/Delivered\. Pay in cash/)).toBeVisible({ timeout: 15_000 });
  await expect(shopCard.getByText('Delivered', { exact: true })).toBeVisible({ timeout: 15_000 });
  await noSidewaysScroll(customer);
  await customer.screenshot({
    path: 'e2e/artifacts/delivery-customer-delivered.png',
    fullPage: true,
  });

  await shopContext.close();
  await customerContext.close();
});

test('a shop that cancels with a reason: the customer is told, and it is pickup', async ({
  browser,
}) => {
  const { shop, shopContext, customer, customerContext, card } = await setup(
    browser,
    'Cancel Test Kirana',
    newCorner(),
  );
  await order(customer, card);

  const shopCard = shop.locator('article.order-card');
  await expect(shopCard).toBeVisible({ timeout: 30_000 });
  await shopCard.getByRole('button', { name: 'Cancel order' }).click();
  await shopCard.getByRole('button', { name: 'Out of stock' }).click();
  await shopCard.getByRole('button', { name: 'Confirm cancel' }).click();
  await expect(shopCard.getByText('The customer cancelled the order')).toBeVisible({
    timeout: 15_000,
  });

  await expect(card.getByText(/The shop cancelled the order/)).toBeVisible({ timeout: 15_000 });
  // It is still a shop to walk to.
  await expect(card.getByRole('link', { name: 'Directions' })).toBeVisible();
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/delivery-shop-cancelled.png', fullPage: true });

  await shopContext.close();
  await customerContext.close();
});
