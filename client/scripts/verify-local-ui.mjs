import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const origin = process.env.LOCAL_VERIFY_CLIENT || 'http://127.0.0.1:15173';
const output = resolve(process.env.LOCAL_VERIFY_DIRECTORY || '../.local-verification');
await mkdir(output, { recursive: true });
assert.equal((await readdir(output)).length, 0, 'Select a new LOCAL_VERIFY_DIRECTORY; existing screenshots are never overwritten');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const evidence = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const unexpected = [];
    await context.route(/^https?:/, route => {
      const url = new URL(route.request().url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['15173', '18090'].includes(url.port)) {
        unexpected.push(`${url.origin}${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByRole('heading', { name: 'Welcome to machinal local.' }).waitFor();
    await page.screenshot({ path: resolve(output, `welcome-${viewport.width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Continue without AI' }).click();
    await page.getByRole('button', { name: 'Open settings' }).waitFor();
    await page.screenshot({ path: resolve(output, `editor-${viewport.width}.png`), fullPage: true });
    assert.equal(await page.locator('a[href="/login"],a[href="/membership"],a[href="/api-keys"]').count(), 0);
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: 'OpenRouter API key', exact: true }).click();
    await page.getByRole('heading', { name: 'OpenRouter connection' }).waitFor();
    await page.getByRole('button', { name: 'Close OpenRouter settings' }).click();
    await page.goto(`${origin}/login`);
    await page.getByText('The page you requested could not be found.').waitFor();
    assert.deepEqual(unexpected, [], 'UI contacted a service outside this isolated installation');
    evidence.push({ viewport, externalRequests: unexpected.length, status: 'passed' });
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify(evidence));
