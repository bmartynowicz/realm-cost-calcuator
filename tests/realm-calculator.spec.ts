import { test, expect } from '@playwright/test';

test.describe('Realm Cost Calculator experience', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('prefills realistic baselines and responds to unit changes', async ({ page }) => {
    const trafficInput = page.locator('#trafficInput');
    const trafficRecommendation = page.locator('#trafficRecommendation');
    const trafficUnit = page.locator('#trafficUnit');
    const realmCost = page.locator('#realmCost');

    await expect(trafficUnit).toHaveValue('gigabytes');
    await expect(trafficInput).not.toHaveValue('');
    await expect(trafficRecommendation).toContainText('GB per day');
    await expect(realmCost).toHaveText(/^\$\d/);

    await trafficUnit.selectOption('events');
    await expect(trafficInput).toHaveAttribute('placeholder', 'e.g. 2500000');
    await expect(trafficRecommendation).toContainText('events');

    await trafficUnit.selectOption('terabytes');
    await expect(trafficInput).toHaveAttribute('placeholder', 'e.g. 6.5');
  });

  test('omits the Cribl benchmark UI entirely', async ({ page }) => {
    const comparisonCard = page.locator('[data-role="cribl-comparison"]');
    await expect(comparisonCard).toHaveCount(0);
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
