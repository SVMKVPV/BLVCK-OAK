import { expect, test } from '@playwright/test';

const pages = ['/', '/portfolio.html', '/marketplace.html', '/quote.html', '/contact.html', '/book.html', '/audit.html', '/automation.html'];

for (const path of pages) {
  test(`${path} renders without script errors`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('homepage links to a working self-quote builder', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('a[href="quote.html"]')).not.toHaveCount(0);
  await page.goto('/quote.html');
  await expect(page.locator('[data-self-quote-form]')).toBeVisible();
});

test('marketplace shortlist persists on this device', async ({ page }) => {
  await page.goto('/marketplace.html');
  const add = page.locator('[data-cart-add]').first();
  await add.click();
  await expect(add).toContainText('Shortlisted');
  await page.reload();
  await expect(page.locator('[data-cart-add]').first()).toContainText('Shortlisted');
});
