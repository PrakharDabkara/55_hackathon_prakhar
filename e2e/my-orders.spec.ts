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
  await order(customer, card, { remember: true });

  // The very gap found live: leave the results screen.
  await customer.getByRole('button', { name: 'Ho gaya' }).click();
  await expect(customer.getByLabel('क्या चाहिए?')).toBeVisible();

  const entry = customer.getByRole('link', { name: /Mere orders/ });
  await expect(entry.getByLabel('1 order chal rahe hain')).toBeVisible();
  await expect(customer.getByRole('heading', { name: 'Haal ke kaam' })).toBeVisible();
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/my-orders-home.png', fullPage: true });

  await entry.click();
  await expect(customer).toHaveURL(/\/app\/orders$/);
  const row = customer.getByRole('link', { name: /Mere Orders Kirana/ });
  await expect(row).toBeVisible();
  await expect(row.getByText(/jawab ka intezaar/)).toBeVisible();
  await expect(customer.getByText(ADDRESS)).toBeVisible();
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/my-orders-list.png', fullPage: true });

  await row.click();
  await expect(customer).toHaveURL(/\/app\/order\/[\w-]+$/);
  await expect(customer.getByText(/jawab ka intezaar/)).toBeVisible();
  await expect(customer.getByRole('button', { name: 'Order cancel karo' })).toBeVisible();

  // The shop moves it; the page follows without a reload.
  const shopCard = shop.locator('article.order-card');
  await expect(shopCard).toBeVisible({ timeout: 30_000 });
  await shopCard.getByRole('button', { name: 'Accept' }).click();
  await expect(customer.getByText('Dukaan ne order le liya')).toBeVisible({ timeout: 15_000 });
  await shopCard.getByRole('button', { name: 'Nikal gaye' }).click();
  await expect(customer.getByText('Nikal gaye — raste mein hai')).toBeVisible({ timeout: 15_000 });
  await expect(customer.getByRole('button', { name: 'Order cancel karo' })).toHaveCount(0);

  // A reload of /app/order/<id> shows the same order in the same state.
  await customer.reload();
  await expect(customer.getByText('Mere Orders Kirana')).toBeVisible();
  await expect(customer.getByText('Nikal gaye — raste mein hai')).toBeVisible();
  await noSidewaysScroll(customer);

  await shopCard.getByRole('button', { name: 'Pahuncha diya' }).click();
  await expect(customer.getByText('Pahuncha diya — order poora hua')).toBeVisible({
    timeout: 15_000,
  });
  await noSidewaysScroll(customer);
  await customer.screenshot({ path: 'e2e/artifacts/my-order-delivered.png', fullPage: true });

  // Opened directly, long after: still there.
  await customer.reload();
  await expect(customer.getByText('Pahuncha diya — order poora hua')).toBeVisible();

  // The shop: this order is now below the active ones, under "Pichhle orders".
  await expect(shop.getByRole('heading', { name: 'Pichhle orders' })).toBeVisible({
    timeout: 15_000,
  });
  await noSidewaysScroll(shop);
  await shop.screenshot({ path: 'e2e/artifacts/shop-past-orders.png', fullPage: true });

  // The address the customer chose to keep is on Mere orders, and can be deleted.
  await customer.goto('/app/orders');
  await expect(customer.getByText('Yaad rakha hua pata')).toBeVisible();
  await customer.getByRole('button', { name: 'Pata hatayein' }).click();
  await expect(customer.getByText('Yaad rakha hua pata')).toHaveCount(0);

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
  await customer.getByRole('button', { name: 'Ho gaya' }).click();
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
