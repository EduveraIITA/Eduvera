import { chromium } from 'playwright';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

// Actual, read-only UI recordings from the local synthetic campus. Never point
// this at a production institution or supply personal browser/session state.
const origin = process.env.CAPTURE_ORIGIN ?? 'http://127.0.0.1:8000';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) {
  throw new Error('Motion capture is restricted to the local synthetic demo.');
}
const rawDirectory = 'screenshots/motion-source';
const outputDirectory = 'public/demos';
await mkdir(rawDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });
const portrait = await readFile('../frontend/public/assets/aarav-sharma.png');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const wait = (page, milliseconds = 1000) => page.waitForTimeout(milliseconds);
const settle = async page => { await page.locator('body').waitFor({ state: 'visible' }); await wait(page, 1200); await page.evaluate(() => document.fonts.ready); };
const smoothScroll = async (page, y) => { await page.evaluate(top => window.scrollTo({ top, behavior: 'smooth' }), y); await wait(page, 850); };

async function capture({ name, role, size, route, prepare, perform }) {
  if (process.argv.length > 2 && !process.argv.slice(2).includes(name)) return;
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'no-preference', recordVideo: { dir: rawDirectory, size } });
  const failures = [];
  await context.request.get(`${origin}/api/v1/auth/csrf/`);
  const csrf = (await context.cookies(origin)).find(cookie => cookie.name === 'csrftoken')?.value;
  const login = await context.request.post(`${origin}/api/v1/auth/demo-session/`, { data: { role }, headers: { 'X-CSRFToken': csrf } });
  if (!login.ok()) throw new Error(`Synthetic demo login failed: ${login.status()}`);
  // Guard against accidental writes from a changed UI or capture selector.
  await context.route('**/api/**', async request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.request().method())) {
      failures.push(`Blocked school-data mutation: ${request.request().method()} ${request.request().url()}`);
      await request.abort();
    } else await request.continue();
  });
  // Restore the repository's exact original synthetic portrait for a missing
  // development asset, without changing a record or personal profile.
  await context.route('**/assets/aarav-sharma.png', request => request.fulfill({ status: 200, contentType: 'image/png', body: portrait }));
  const startedAt = Date.now();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && response.url().includes('/api/')) failures.push(`API ${response.status()}: ${response.url()}`); });
  await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  if (prepare) await prepare(page);
  await wait(page, 500);
  const clipStart = (Date.now() - startedAt) / 1000;
  const poster = await page.screenshot();
  await sharp(poster).webp({ quality: 85 }).toFile(`${outputDirectory}/${name}-poster.webp`);
  await wait(page, 1100); await perform(page); await wait(page, 1300);
  const duration = (Date.now() - startedAt) / 1000 - clipStart;
  const video = page.video();
  await context.close();
  const rawPath = await video.path();
  if (failures.length) throw new Error(`${name}: ${failures.join('\n')}`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', clipStart.toFixed(3), '-i', rawPath, '-t', duration.toFixed(3), '-an', '-vf', 'fps=24', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${outputDirectory}/${name}.mp4`]);
  const bytes = (await stat(`${outputDirectory}/${name}.mp4`)).size;
  if (bytes > 1_500_000) throw new Error(`${name} exceeds the 1.5 MB clip budget.`);
  console.log(JSON.stringify({ name, width: size.width, height: size.height, seconds: Number(duration.toFixed(1)), bytes, failures }));
}

try {
  await capture({
    name: 'attendance', role: 'admin', size: { width: 430, height: 760 }, route: '/principal/attendance',
    prepare: async page => { await page.getByRole('button', { name: 'By period', exact: true }).waitFor(); },
    perform: async page => {
      await page.getByRole('button', { name: 'By class', exact: true }).click(); await wait(page, 1400);
      const group = page.locator('summary').filter({ hasText: 'Class 7A' });
      await group.scrollIntoViewIfNeeded(); await wait(page, 650); await group.click(); await wait(page, 1200);
      await page.getByRole('link', { name: /Mathematics, Period 1/ }).click(); await settle(page); await smoothScroll(page, 350);
    },
  });
  await capture({
    name: 'timetable', role: 'admin', size: { width: 1440, height: 900 }, route: '/principal/timetable',
    prepare: async page => {
      await page.getByRole('combobox', { name: 'Filter by class' }).selectOption({ label: 'Class 7A' });
      await page.getByRole('radio', { name: 'Week', exact: true }).click(); await wait(page, 1000);
    },
    perform: async page => {
      await page.getByRole('radio', { name: 'Day', exact: true }).click(); await wait(page, 1600);
      await page.getByText('Mathematics', { exact: true }).click(); await wait(page, 2200);
      await page.keyboard.press('Escape'); await wait(page, 700);
      await page.getByRole('radio', { name: 'Week', exact: true }).click(); await wait(page, 1400);
    },
  });
  await capture({
    name: 'family', role: 'parent', size: { width: 430, height: 760 }, route: '/parent',
    prepare: async page => { await page.getByText('Aarav Sharma', { exact: true }).first().waitFor(); },
    perform: async page => {
      await smoothScroll(page, 390); await wait(page, 900);
      await page.getByRole('link', { name: 'Attendance', exact: true }).click(); await settle(page);
      await page.locator('.calendar-grid').scrollIntoViewIfNeeded(); await wait(page, 1000);
      await page.locator('.calendar-day--present').first().click(); await smoothScroll(page, 220); await wait(page, 1000);
    },
  });
} finally { await browser.close(); }
