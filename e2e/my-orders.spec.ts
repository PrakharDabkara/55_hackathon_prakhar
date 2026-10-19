import { expect, test } from '@playwright/test';
import { ADDRESS, newCorner, noSidewaysScroll, order, setup } from './orderFlow.js';

// PR E, ADR-0033: after leaving the order page the customer can still find the order, follow it, and reopen it
// after a reload. Two real browsers at 360 px.
test('an order is found again after leaving the order page: My orders, the order page, a reload, delivered', async ({
  browser,
}) => {
  const { shop, shopContext, customer, customerContext, card } = await setup(
    browser,
    'Mere Orders Kirana',
    newCorner(),
  );
  await order(customer, card);

  // Leave the order page: Find shows the order strip, and My orders lists it.
  await customer.goto('/app/');
  const strip = customer.getByRole('link', { name: 'Track' });
  await expect(strip).toBeVisible();
  await expect(customer.getByText(/My Orders Kirana|Mere Orders Kirana/i).first()).toBeVisible();
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/my-orders-home.png', fullPage: true });

  await customer.getByRole('link', { name: /My orders/ }).click();
  await expect(customer).toHaveURL(/\/app\/orders$/);
  const row = customer.getByRole('link', { name: /Mere Orders Kirana/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('Shop accepted')).toBeVisible();
  await expect(customer.getByRole('heading', { name: 'Active' })).toBeVisible();
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/my-orders-list.png', fullPage: true });

  await row.click();
  await expect(customer).toHaveURL(/\/app\/order\/[\w-]+$/);
  await expect(customer.getByText('Shop accepted').first()).toBeVisible();
  await expect(customer.getByText(ADDRESS)).toBeVisible();
  await expect(customer.getByRole('button', { name: 'Cancel order' })).toBeVisible();

  // The shop moves it; the page follows without a reload.
  await expect(shop.getByText(/Customer chose you · /)).toBeVisible({ timeout: 30_000 });
  await shop.getByRole('link', { name: 'View order' }).click();
  const shopCard = shop.locator('article.sh-order');
  await expect(shopCard).toBeVisible();
  await shopCard.getByRole('button', { name: 'Out for delivery' }).click();
  await expect(customer.getByText('Out for delivery').first()).toBeVisible({ timeout: 15_000 });
  await expect(customer.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);

  // A reload of /app/order/<id> shows the same order in the same state.
  await customer.reload();
  await expect(customer.getByText(/Mere Orders Kirana/)).toBeVisible();
  await expect(customer.getByText('Out for delivery').first()).toBeVisible();
  await noSidewaysScroll(customer);

  await customer.getByRole('button', { name: 'I received it' }).click();
  await expect(customer.getByText('Delivered').first()).toBeVisible({ timeout: 15_000 });
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/my-order-delivered.png', fullPage: true });

  // Opened directly, long after: still there.
  await customer.reload();
  await expect(customer.getByText('Delivered').first()).toBeVisible();

  // The shop: this order has moved from Active to Done today.
  await shop.getByRole('button', { name: /Done today · 1/ }).click({ timeout: 15_000 });
  await expect(shop.getByText('Delivered', { exact: true })).toBeVisible();
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/shop-past-orders.png', fullPage: true });

  // The address the customer chose to keep is on Mere orders, and can be deleted.
  await customer.goto('/app/orders');
  await expect(customer.getByText('Saved address')).toBeVisible();
  await customer.getByRole('button', { name: 'Delete' }).click();
  await expect(customer.getByText('Saved address')).toHaveCount(0);

  await shopContext.close();
  await customerContext.close();
});

test('an earlier search opens again from its address, with the replies on the page', async ({
  browser,
}) => {
  const { shopContext, customer, customerContext, card } = await setup(
    browser,
    'Haal Ke Kaam Kirana',
    newCorner(),
  );
  await expect(card).toBeVisible();
  const address = customer.url();
  expect(address).toMatch(/\/app\/request\/[\w-]+$/);
  await customer.goto('/app/');
  await customer.goto(address);
  await expect(
    customer.getByRole('listitem').filter({ hasText: 'Haal Ke Kaam Kirana' }),
  ).toBeVisible();
  await noSidewaysScroll(customer);

  await shopContext.close();
  await customerContext.close();
});
