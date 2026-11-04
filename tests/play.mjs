// Plays a real shift through the browser: moves the lantern, checks the score, ends the shift.
import { chromium } from 'playwright';
const out = process.argv[2], base = process.argv[3] ?? 'http://localhost:4173/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(base + '?sky=night#lastlight'); await p.waitForSelector('[data-start]', { timeout: 30000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: out + '/lobby.png' });
await p.click('[data-start]');
await p.waitForSelector('.hud'); await p.waitForTimeout(2500);
await p.mouse.move(640, 400); await p.mouse.down();
let peak = 0;
for (let i = 0; i < 26; i++) {
  await p.mouse.move(640 + Math.cos(i * .7) * 170, 400 + Math.sin(i * .7) * 130, { steps: 4 });
  await p.waitForTimeout(650);
  if (i === 8 || i === 18) { await p.mouse.up(); await p.waitForTimeout(1400); await p.mouse.down(); }
  if (i === 12) await p.screenshot({ path: out + '/game.png' });
  peak = Number((await p.textContent('[data-score]')).replace(/,/g, ''));
}
await p.mouse.up();
const flowers = await p.textContent('[data-flowers]'); const time = await p.textContent('[data-time]');
console.log({ score: peak, flowers, time, fps: await p.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; performance.now() - t > 1000 ? r(n) : requestAnimationFrame(f); }; f(); })) });
await p.click('[data-quit]');
await p.waitForTimeout(2000);
console.log('result:', (await p.textContent('.room section')).trim().slice(0, 160));
await p.screenshot({ path: out + '/after.png' });
console.log('errors', errs);
await b.close();
