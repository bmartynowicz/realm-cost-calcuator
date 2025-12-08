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

  test('surfaces ROI and reduction for single and multiple sources', async ({ page }) => {
    const sourceSelect = page.locator('#sourceSelect');
    const destinationSelect = page.locator('#destinationSelect');
    const trafficUnit = page.locator('#trafficUnit');
    const trafficInput = page.locator('#trafficInput');

    const standardCost = page.locator('#standardCost');
    const realmCost = page.locator('#realmCost');
    const savings = page.locator('#savings');
    const roi = page.locator('#roiMultiple');
    const reduction = page.locator('#dataReduction');
    const roiTooltip = page.locator('#roiBreakdown');
    const reductionTooltip = page.locator('#reductionBreakdown');
    const roiTrigger = page.locator('[data-tooltip-target="roiBreakdown"]');
    const reductionTrigger = page.locator('[data-tooltip-target="reductionBreakdown"]');
    const pricingNote = page.locator('.metrics__note');

    await destinationSelect.selectOption('splunk-es');
    await trafficUnit.selectOption('terabytes');

    // Single-source scenario (Fortinet)
    await sourceSelect.selectOption({ label: 'Fortinet - Fortigate' });
    await trafficInput.fill('10');

    await expect(standardCost).toHaveText('$5,000,000');
    await expect(realmCost).toHaveText('$210,000');
    await expect(savings).toHaveText('$4,790,000');
    await expect(roi).toHaveText('22.8x');
    await expect(reduction).toHaveText(/7(\.0)?\s*TB \(70\.0% less\)/);
    await expect(roiTrigger).toBeVisible();
    await expect(reductionTrigger).toBeVisible();
    await expect(roiTooltip).toContainText('savings ($4,790,000) divided by Realm cost ($210,000)');
    await expect(reductionTooltip).toContainText('10 TB/day in raw telemetry reduced by 70.0% to 3');
    await expect(pricingNote).toContainText('$70k per TB of optimized volume');
    await expect(pricingNote).toContainText('$500k per TB of raw SIEM ingest');

    // Multi-source scenario (Fortinet + Okta) blends reductions
    await sourceSelect.selectOption([
      { label: 'Fortinet - Fortigate' },
      { label: 'Okta' },
    ]);
    await trafficInput.fill('10');

    await expect(standardCost).toHaveText('$5,000,000');
    await expect(realmCost).toHaveText('$280,000');
    await expect(savings).toHaveText('$4,720,000');
    await expect(roi).toHaveText('16.9x');
    await expect(reduction).toHaveText(/6(\.0)?\s*TB \(60\.0% less\)/);
    await expect(roiTooltip).toContainText('savings ($4,720,000) divided by Realm cost ($280,000)');
    await expect(reductionTooltip).toContainText('10 TB/day in raw telemetry reduced by 60.0% to 4');
  });
});
