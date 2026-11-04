import { chromium } from 'playwright';
const out = process.argv[2]; const list = process.argv.slice(3);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
for (const spec of list) {
  const [name, path, w, h, wait='2500', scroll='0'] = spec.split('|');
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)); });
  await p.goto('http://localhost:4173/' + path, { waitUntil: 'load' });
  await p.waitForTimeout(+wait);
  if (+scroll) { await p.evaluate((s) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * s), +scroll); await p.waitForTimeout(1800); }
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log(name, errs.length ? errs.slice(0, 4) : 'ok');
  await p.close();
}
await b.close();
