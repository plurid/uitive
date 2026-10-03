// Captures the README's picture of the Acme Cloud demo after a change, with its banner showing:
// `node tools/build/screenshots.ts [url]`, with the demo running
// (`pnpm --filter @uitive/cloud-console-react dev`). Uses the installed Chrome.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root } from './docs.ts';

interface Page {
  goto(url: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  waitForSelector(selector: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: { path: string }): Promise<unknown>;
}
interface Browser {
  newPage(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    colorScheme: 'light';
    reducedMotion: 'reduce';
  }): Promise<Page>;
  close(): Promise<void>;
}
interface Chromium {
  launch(options: { channel: string; headless: boolean }): Promise<Browser>;
}

// playwright-core is the CLI's, for `discover --chrome`.
const require = createRequire(join(root, 'packages/cli/package.json'));
const { chromium } = require('playwright-core') as { chromium: Chromium };

const url = process.argv[2] ?? 'http://localhost:5171/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await page.goto(url);
  await page.fill('#goal', 'I watch costs and budgets');
  await page.click('button:has-text("Design my console")');
  await page.waitForSelector('uitive-banner section.card');
  await page.waitForTimeout(500);
  const path = join(root, 'docs/assets/acme-cloud.png');
  await page.screenshot({ path });
  console.log(`Wrote ${path}`);
} finally {
  await browser.close();
}
