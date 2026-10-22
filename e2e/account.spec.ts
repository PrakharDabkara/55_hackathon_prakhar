import { screenProblems } from './a11y.js';
import { expect, test, type Page } from '@playwright/test';
import { login, newCorner, noSidewaysScroll, order, setup, sheetLogin } from './orderFlow.js';

// PR S, ADR-0054: the customer's Account screen. Every test that logs out or deletes logs in with
// a phone of its own (login() draws a fresh number), so no other spec's session is touched.

const ADDRESS = '12, Palasia Square, Indore';

async function noSeriousViolations(page: Page, label: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    expect.soft(await screenProblems(page), `${label} in ${theme}`).toEqual([]);
  }
}

const openAccount = async (page: Page) => {
  await page.goto('/app/');
  await page.getByRole('link', { name: 'Account' }).click();
  await expect(page).toHaveURL(/\/app\/account$/);
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
};

test('Account opens from the header, shows the phone partly hidden, and fits 360 px', async ({
  page,
}) => {
  await login(page, '/app/');
  await openAccount(page);
  await expect(page.getByText('Logged in as')).toBeVisible();
  await expect(page.getByText(/^\+91 \d{2}••• ••\d{3}$/)).toBeVisible();
  await expect(page.getByText('No address yet')).toBeVisible();
  await expect(page.getByText('Shopkeeper? Open the shop app')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the shop app' })).toHaveAttribute(
    'href',
    '/app/shop',
  );
  await noSidewaysScroll(page);
  await noSeriousViolations(page, 'Account');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/app\/?$/);
});

test('the header icon asks a signed-out customer to log in, then lands on Account', async ({
  page,
}) => {
  await page.goto('/app/');
  await page.getByRole('link', { name: 'Account' }).click();
  await sheetLogin(page);
  await expect(page).toHaveURL(/\/app\/account$/);
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
});

test('the address edit persists after a reload', async ({ page }) => {
  await login(page, '/app/');
  await openAccount(page);
  await page.getByRole('button', { name: 'Add address' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add address' });
  await sheet.getByLabel('Address').fill(ADDRESS);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(ADDRESS)).toBeVisible();
  await page.reload();
  await expect(page.getByText(ADDRESS)).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit address' });
  await expect(edit.getByLabel('Address')).toHaveValue(ADDRESS);
  await noSeriousViolations(page, 'address sheet');
  await noSidewaysScroll(page);
  await edit.getByRole('button', { name: 'Close' }).click();
});

test('Dark persists after a reload and sets data-theme; System removes it', async ({ page }) => {
  await login(page, '/app/');
  await openAccount(page);
  const html = page.locator('html');
  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  // The shop app is the same origin and picks up the same choice.
  await page.goto('/app/shop');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.goto('/app/account');
  await page.getByRole('radio', { name: 'Light' }).check();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radio', { name: 'System' }).check();
  await expect(html).not.toHaveAttribute('data-theme', /.*/);
});

test('"What shops can see" opens, says what the code does, and passes the scan', async ({
  page,
}) => {
  await login(page, '/app/');
  await openAccount(page);
  await page.getByRole('button', { name: 'What shops can see' }).click();
  const sheet = page.getByRole('dialog', { name: 'What shops can see' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(/never see your phone number/i)).toBeVisible();
  await noSeriousViolations(page, 'what shops can see');
  await noSidewaysScroll(page);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
});

test('log out returns to Home, and Account then asks for a login', async ({ page }) => {
  await login(page, '/app/');
  await openAccount(page);
  const token = await page.evaluate(() => localStorage.getItem('km-seeker-token'));
  expect(token).toBeTruthy();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/app\/?$/);
  expect(await page.evaluate(() => localStorage.getItem('km-seeker-token'))).toBeNull();
  // The old token no longer works on the server.
  const res = await page.request.get('/orders', { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(401);
  await page.goto('/app/account');
  await expect(page.getByRole('dialog', { name: /Log in/ })).toBeVisible();
});

test('delete my account: refused with an open order, then it erases and logs out', async ({
  browser,
}) => {
  const { shop, shopContext, customer, customerContext, card } = await setup(
    browser,
    'Account Delete Kirana',
    newCorner(),
  );
  await order(customer, card);

  await customer.goto('/app/account');
  await customer.getByRole('button', { name: 'Delete my account' }).click();
  const sheet = customer.getByRole('dialog', { name: 'Delete your account?' });
  await expect(
    sheet.getByText(/Shops keep their past order records, without your number/),
  ).toBeVisible();
  await noSeriousViolations(customer, 'delete sheet');
  await noSidewaysScroll(customer);
  await sheet.getByRole('button', { name: 'Delete account' }).click();
  await expect(sheet.getByText('Finish or cancel your open order first.')).toBeVisible();
  // Still logged in.
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(customer.getByText(/^\+91 \d{2}••• ••\d{3}$/)).toBeVisible();

  // Cancel the order from My orders, then delete.
  await customer.getByRole('link', { name: 'My orders' }).first().click();
  await customer.getByRole('link', { name: /Account Delete Kirana/ }).click();
  await customer.getByRole('button', { name: 'Cancel order' }).click();
  await customer.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click();
  await expect(customer.getByText('You cancelled this order').first()).toBeVisible({
    timeout: 15_000,
  });

  // The search itself is live for a few minutes and blocks the delete too. The customer app has no
  // button to close it, so the test closes it the way the app's own client would (/requests/:id/close).
  const token = await customer.evaluate(() => localStorage.getItem('km-seeker-token'));
  const headers = { Authorization: `Bearer ${token}` };
  const searches = (await (await customer.request.get('/requests', { headers })).json()) as {
    id: string;
  }[];
  for (const search of searches) {
    expect((await customer.request.post(`/requests/${search.id}/close`, { headers })).ok()).toBe(
      true,
    );
  }

  await customer.goto('/app/account');
  await customer.getByRole('button', { name: 'Delete my account' }).click();
  await customer
    .getByRole('dialog', { name: 'Delete your account?' })
    .getByRole('button', { name: 'Delete account' })
    .click();
  await expect(customer).toHaveURL(/\/app\/?$/);
  expect(await customer.evaluate(() => localStorage.getItem('km-seeker-token'))).toBeNull();
  await customer.goto('/app/account');
  await expect(customer.getByRole('dialog', { name: /Log in/ })).toBeVisible();

  await shopContext.close();
  await customerContext.close();
  void shop;
});

// Phone-sized pictures for the PR (390 px wide). Only when ACCOUNT_SHOTS_DIR names a folder.
test('screenshots of Account and the delete sheet at 390 px', async ({ page }) => {
  const dir = process.env['ACCOUNT_SHOTS_DIR'];
  test.skip(!dir, 'set ACCOUNT_SHOTS_DIR to write the pictures');
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, '/app/');
  await openAccount(page);
  await page.getByRole('button', { name: 'Add address' }).click();
  await page.getByRole('textbox', { name: 'Address' }).fill(ADDRESS);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(ADDRESS)).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${dir}/account-${theme}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete your account?' })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${dir}/delete-sheet-${theme}.png` });
  }
});
