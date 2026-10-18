import { expect, test } from '@playwright/test';
import { ADDRESS, newCorner, noSidewaysScroll, order, setup } from './orderFlow.js';

// A delivery order from end to end, in two real browsers at 360 px (ADR-0031, PR D): the customer
// asks for it at home, the shop accepts, sets out and delivers; and a decline that falls back to
// pickup. Shared steps are in orderFlow.ts.
test('a delivery order: the customer asks, the shop accepts, sets out and delivers', async ({
  browser,
}) => {
  const { shop, shopContext, customer, customerContext, card } = await setup(
    browser,
    'Delivery Test Kirana',
    newCorner(),
  );
  await order(customer, card);

  // The shop sees the order, but not where to go until it says yes.
  const shopCard = shop.locator('article.order-card');
  await expect(shopCard).toBeVisible({ timeout: 30_000 });
  await expect(shopCard.getByText('Grahak', { exact: true })).toBeVisible();
  await expect(shopCard.getByText(/Cash on delivery/)).toBeVisible();
  await expect(shop.getByText(ADDRESS)).toHaveCount(0);
  await expect(shopCard.getByRole('link', { name: 'Map par dekho' })).toHaveCount(0);
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/delivery-shop-new-order.png', fullPage: true });

  await shopCard.getByRole('button', { name: 'Accept' }).click();
  await expect(shopCard.getByText(ADDRESS)).toBeVisible();
  const map = shopCard.getByRole('link', { name: 'Map par dekho' });
  await expect(map).toHaveAttribute('href', /google\.com\/maps\/search\/\?api=1&query=2[4-6]\./);
  await expect(shopCard.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(card.getByText('Dukaan ne order le liya')).toBeVisible({ timeout: 15_000 });
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/delivery-shop-accepted.png', fullPage: true });

  await shopCard.getByRole('button', { name: 'Nikal gaye' }).click();
  await expect(card.getByText('Nikal gaye — raste mein hai')).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole('button', { name: 'Order cancel karo' })).toHaveCount(0);
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/delivery-customer-out.png', fullPage: true });

  await shopCard.getByRole('button', { name: 'Pahuncha diya' }).click();
  await expect(card.getByText(/Pahunch gaya/)).toBeVisible({ timeout: 15_000 });
  await expect(shopCard.getByText('Pahuncha diya gaya')).toBeVisible();
  await noSidewaysScroll(customer);
  await customer.screenshot({
    path: 'e2e/artifacts/delivery-customer-delivered.png',
    fullPage: true,
  });

  await shopContext.close();
  await customerContext.close();
});

test('a shop that declines: the customer is told, and it is pickup', async ({ browser }) => {
  const { shop, shopContext, customer, customerContext, card } = await setup(
    browser,
    'Decline Test Kirana',
    newCorner(),
  );
  await order(customer, card);

  const shopCard = shop.locator('article.order-card');
  await expect(shopCard).toBeVisible({ timeout: 30_000 });
  await shopCard.getByRole('button', { name: 'Decline' }).click();
  await expect(shopCard.getByText('Aapne mana kiya')).toBeVisible();
  await expect(shop.getByText(ADDRESS)).toHaveCount(0);

  await expect(card.getByText(/Dukaan ne mana kiya/)).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText(/khud jaakar/)).toBeVisible();
  // It is still a shop to walk to.
  await expect(card.getByRole('link', { name: 'Raasta' })).toBeVisible();
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/delivery-declined-pickup.png', fullPage: true });

  await shopContext.close();
  await customerContext.close();
});
