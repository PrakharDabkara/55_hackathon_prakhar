import { expect, test } from '@playwright/test';
import { ADDRESS, newCorner, noSidewaysScroll, order, setup } from './orderFlow.js';

// PR E, ADR-0033: after "Ho gaya" the customer can still find the order, follow it, and reopen it
// after a reload. Two real browsers at 360 px.
test('an order is found again after "Ho gaya": Mere orders, the order page, a reload, delivered', async ({
  browser,
}) => {
  const { shop, shopContext, customer, customerContext, card } = await setup(
    browser,
    'Mere Orders Kirana',
    newCorner(),
  );
  await order(customer, card);

  // The very gap found live: leave the results screen.
  await customer.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(customer.getByLabel('क्या चाहिए?')).toBeVisible();

  const entry = customer.getByRole('link', { name: /My orders/ });
  await expect(entry.getByLabel('1 active order')).toBeVisible();
  await expect(customer.getByRole('heading', { name: 'Recent' })).toBeVisible();
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/my-orders-home.png', fullPage: true });

  await entry.click();
  await expect(customer).toHaveURL(/\/app\/orders$/);
  const row = customer.getByRole('link', { name: /Mere Orders Kirana/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('The shop accepted your order')).toBeVisible();
  await expect(customer.getByText(ADDRESS)).toBeVisible();
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/my-orders-list.png', fullPage: true });

  await row.click();
  await expect(customer).toHaveURL(/\/app\/order\/[\w-]+$/);
  await expect(customer.getByText('The shop accepted your order')).toBeVisible();
  await expect(customer.getByRole('button', { name: 'Cancel order' })).toBeVisible();

  // The shop moves it; the page follows without a reload.
  await expect(shop.getByText(/Customer chose you · /)).toBeVisible({ timeout: 30_000 });
  await shop.getByRole('link', { name: 'View order' }).click();
  const shopCard = shop.locator('article.sh-order');
  await expect(shopCard).toBeVisible();
  await shopCard.getByRole('button', { name: 'Out for delivery' }).click();
  await expect(customer.getByText('On its way')).toBeVisible({ timeout: 15_000 });
  await expect(customer.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);

  // A reload of /app/order/<id> shows the same order in the same state.
  await customer.reload();
  await expect(customer.getByText('Mere Orders Kirana')).toBeVisible();
  await expect(customer.getByText('On its way')).toBeVisible();
  await noSidewaysScroll(customer);

  await customer.getByRole('button', { name: 'Received' }).click();
  await expect(customer.getByText('Delivered — order complete')).toBeVisible({
    timeout: 15_000,
  });
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/my-order-delivered.png', fullPage: true });

  // Opened directly, long after: still there.
  await customer.reload();
  await expect(customer.getByText('Delivered — order complete')).toBeVisible();

  // The shop: this order has moved from Active to Done today.
  await shop.getByRole('button', { name: /Done today · 1/ }).click({ timeout: 15_000 });
  await expect(shop.getByText('Delivered', { exact: true })).toBeVisible();
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/shop-past-orders.png', fullPage: true });

  // The address the customer chose to keep is on Mere orders, and can be deleted.
  await customer.goto('/app/orders');
  await expect(customer.getByText('Remembered address')).toBeVisible();
  await customer.getByRole('button', { name: 'Delete address' }).click();
  await expect(customer.getByText('Remembered address')).toHaveCount(0);

  await shopContext.close();
  await customerContext.close();
});

test('the search is on "Haal ke kaam" and opens again from there', async ({ browser }) => {
  const { shopContext, customer, customerContext, card } = await setup(
    browser,
    'Haal Ke Kaam Kirana',
    newCorner(),
  );
  await expect(card).toBeVisible();
  await customer.getByRole('button', { name: 'Done', exact: true }).click();
  const recent = customer.getByRole('link', { name: /haldi/ });
  await expect(recent).toBeVisible();
  await recent.click();
  await expect(customer).toHaveURL(/\/app\/request\/[\w-]+$/);
  await expect(
    customer.getByRole('listitem').filter({ hasText: 'Haal Ke Kaam Kirana' }),
  ).toBeVisible();
  await noSidewaysScroll(customer);

  await shopContext.close();
  await customerContext.close();
});
