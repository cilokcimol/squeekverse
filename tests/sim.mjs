// Simulates a whole shift at full speed: an attentive player, then a player who never lights the lantern.
import { chromium } from 'playwright';
const SITE = process.argv[2] ?? 'http://localhost:4173/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const play = async (skilled) => {
  await p.goto(SITE + '?sky=night&qa=1#lastlight'); await p.reload(); await p.waitForSelector('[data-start]', { timeout: 40000 });
  await p.click('[data-start]'); await p.waitForSelector('.hud');
  const out = await p.evaluate(async (skilled) => {
    const g = window.__game; let t = 0, ends = false;
    const end = g.opts.onEnd; let result = null; g.opts.onEnd = (r) => { result = r; end(r); };
    g.world.onFrame = null;
    while (!result && t < 200) {
      if (skilled) {
        const alive = g.moths.filter((m) => m.alive && m.pos.length() < 1.6);
        const target = g.owl.active ? g.owl.pos : alive[0]?.pos;
        if (target && g.battery > 8) { g.aim.copy(target); g.lit = true; } else g.lit = false;
      }
      g.update(1 / 30, t); t += 1 / 30;
    }
    return { result, seconds: t, spawned: g.moths.length };
  }, skilled);
  await p.waitForSelector('[data-start]', { timeout: 15000 });
  return out;
};
console.log('skilled', JSON.stringify(await play(true)));
console.log('idle', JSON.stringify(await play(false)));
console.log('errors', errs);
await b.close();
