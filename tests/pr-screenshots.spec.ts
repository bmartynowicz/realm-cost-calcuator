import { test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const screenshotDir = path.join(process.cwd(), 'pr-screenshots');

test.describe('PR screenshots', () => {
  test.skip(!!process.env.CI, 'PR screenshots are generated locally and committed.');

  test.beforeAll(async () => {
    await fs.mkdir(screenshotDir, { recursive: true });
  });

  test('home', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#destinationSelect option[value="splunk-es"]', { state: 'attached' });
    await page.addStyleTag({
      content: `*{transition:none!important;animation:none!important} html{scroll-behavior:auto!important}`,
    });
    await page.screenshot({ path: path.join(screenshotDir, 'home.png'), fullPage: true });
  });

  test('scenario-filled', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#destinationSelect option[value="splunk-es"]', { state: 'attached' });
    await page.addStyleTag({
      content: `*{transition:none!important;animation:none!important} html{scroll-behavior:auto!important}`,
    });

    await page.locator('#destinationSelect').selectOption('splunk-es');
    await page.locator('[data-source-id="fortinet-fortigate"]').click();
    await page.locator('#trafficUnit').selectOption('terabytes');
    await page.locator('#trafficInput').fill('10');
    await page.locator('#realmCost').waitFor({ state: 'visible' });

    await page.screenshot({ path: path.join(screenshotDir, 'scenario-filled.png'), fullPage: true });
  });
});

