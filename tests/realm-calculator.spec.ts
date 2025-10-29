import { test, expect } from '@playwright/test';

test.describe('Realm Cost Calculator experience', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('prefills realistic baselines and responds to unit changes', async ({ page }) => {
    const trafficInput = page.locator('#trafficInput');
    const trafficRecommendation = page.locator('#trafficRecommendation');
    const trafficUnit = page.locator('#trafficUnit');
    const eventSizeField = page.locator('[data-role="event-size-field"]');
    const realmCost = page.locator('#realmCost');

    await expect(trafficInput).not.toHaveValue('');
    await expect(trafficRecommendation).toContainText('events/day');
    await expect(eventSizeField).toBeHidden();
    await expect(realmCost).toHaveText(/^\$\d/);

    await trafficUnit.selectOption('gigabytes');
    await expect(eventSizeField).toBeVisible();
    await expect(trafficRecommendation).toContainText('KB per event');

    await trafficUnit.selectOption('events');
    await expect(eventSizeField).toBeHidden();
  });

  test('gates the Cribl comparison behind a business email', async ({ page }) => {
    const revealButton = page.locator('[data-role="cribl-reveal-button"]');
    const criblValue = page.locator('#criblCost');
    const revealForm = page.locator('[data-role="cribl-reveal-form"]');
    const emailInput = page.locator('#criblEmailInput');
    const errorMessage = page.locator('[data-role="cribl-error-message"]');

    await expect(criblValue).toHaveText('--');
    await revealButton.click();
    await expect(revealForm).toBeVisible();

    await emailInput.fill('analyst@gmail.com');
    await revealForm.locator('button[type="submit"]').click();
    await expect(errorMessage).toHaveText(/company email/i);

    await emailInput.fill('analyst@realm.build');
    await revealForm.locator('button[type="submit"]').click();

    await expect(revealButton).toBeDisabled();
    await expect(criblValue).toHaveAttribute('data-unlocked', 'true');
    await expect(criblValue).toHaveText(/^\$\d/);
  });

  test('blocks invalid traffic inputs and re-enables exports once fixed', async ({ page }) => {
    const trafficInput = page.locator('#trafficInput');
    const trafficError = page.locator('#trafficError');
    const exportButton = page.locator('[data-role="export-pdf-button"]');
    const savings = page.locator('#savings');

    await expect(exportButton).toBeEnabled();

    await trafficInput.fill('-10');
    await expect(trafficError).toHaveText(/positive number/i);
    await expect(exportButton).toBeDisabled();
    await expect(savings).toHaveText('--');

    await trafficInput.fill('50000');
    await expect(trafficError).toHaveText('');
    await expect(exportButton).toBeEnabled();
    await expect(savings).toHaveText(/^\$\d/);
  });
});
