import './style.css';
import { STREAM_CAPTION } from '../shared/chain';
import { almanacRoom } from './rooms/almanac';
import { dawnRoom } from './rooms/dawn';
import { deployRoom } from './rooms/deploy';
import { gardenRoom } from './rooms/garden';
import { lastlightRoom } from './rooms/lastlight';
import { marketRoom } from './rooms/market';
import { raidRoom } from './rooms/raid';
import { shedRoom } from './rooms/shed';
import { streamRoom } from './rooms/stream';
import { esc, fmt, type Cleanup, type Room } from './rooms/ui';
import { history, live, loadHistory, nightSeed, nightShare, onLive, preview, previewing, previewOnly, startLive } from './lib/store';
import { sfx } from './lib/sound';
import { World } from './world/scene';
import type { PlaceId } from './world/landmarks';

const app = document.getElementById('app')!;
const canvas = document.getElementById('world') as HTMLCanvasElement;
const webgl = (() => { try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
const world = webgl ? new World(canvas) : (null as unknown as World);
(window as any).__world = world;

const ICONS: Record<string, string> = {
  lastlight: '<path d="M12 2v3M7 8h10l-1 9H8zM9 17v3h6v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12.5" r="2" fill="currentColor"/>',
  dawn: '<path d="M3 17h18M6 17a6 6 0 0 1 12 0M12 5v3M4.5 9.5l2 2M19.5 9.5l-2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  raid: '<path d="M5 4l3 3a6 6 0 0 1 8 0l3-3v9a7 7 0 0 1-14 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="9.5" cy="11" r="1.4" fill="currentColor"/><circle cx="14.5" cy="11" r="1.4" fill="currentColor"/>',
  almanac: '<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 17a2 2 0 0 1 2-2h12M9 8h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  shed: '<path d="M4 20V10l8-6 8 6v10zM9 20v-6h6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  market: '<path d="M4 9l2-5h12l2 5a3 3 0 0 1-5 1 3 3 0 0 1-6 0 3 3 0 0 1-5-1zM6 12v8h12v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  garden: '<circle cx="12" cy="9" r="2.4" fill="currentColor"/><path d="M12 3v1.5M12 13.5V21M6 9h1.5M16.5 9H18M7.8 4.8l1 1M15.2 12.2l1 1M16.2 4.8l-1 1M8.8 12.2l-1 1M12 18c-2 0-3-1-4-2M12 19c2 0 3-1 4-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  stream: '<path d="M12 21V10M8 21h8M8.5 6.5a5 5 0 0 0 0 7M15.5 6.5a5 5 0 0 1 0 7M5.5 4a9 9 0 0 0 0 12M18.5 4a9 9 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};
const PLACES: { id: PlaceId; label: string; room: Room }[] = [
  { id: 'lastlight', label: 'Night shift', room: lastlightRoom(world, () => {}) },
  { id: 'dawn', label: 'Call dawn', room: dawnRoom },
  { id: 'raid', label: 'Raid', room: raidRoom },
  { id: 'almanac', label: 'Almanac', room: almanacRoom },
  { id: 'garden', label: 'Greenhouse', room: gardenRoom },
  { id: 'market', label: 'Market', room: marketRoom },
  { id: 'shed', label: 'Barn', room: shedRoom },
  { id: 'stream', label: 'Stream', room: streamRoom },
];

app.innerHTML = `
  <div class="topbar"><a class="brand" href="#">Squeekverse</a><div class="pulse" role="status"><i></i><span data-pulse>Reading the wheel</span></div></div>
  ${previewOnly ? '<p class="preview-banner">Preview. Live wheel data and wallets are off here, so the sky stays at night until you press Preview daylight.</p>' : ''}
  <main id="main"></main>
  <nav class="dock" aria-label="Places on the planet">
    ${PLACES.map((p) => `<a href="#${p.id}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[p.id]}</svg>${p.label}</a>`).join('')}
  </nav>`;
const main = document.getElementById('main')!;
const pulse = app.querySelector<HTMLElement>('[data-pulse]')!;

function skyLine() {
  if (live.sky === 'day') return { state: 'He is running. It is day here.', pulse: previewing() ? 'Daylight' : `Day, ${fmt(live.rpm)} rpm` };
  if (live.sky === 'lost') return { state: 'No signal from the wheel. The sky has gone grey.', pulse: 'No signal' };
  return { state: 'He is asleep. It is night here.', pulse: 'Night, he is asleep' };
}

function homeHtml() {
  const line = skyLine();
  const share = nightShare();
  return `
  <div class="home">
    <section class="beat hero">
      <h1 aria-label="Squeekverse">${[...'Squeekverse'].map((c, i) => `<span class="reveal-letter" style="animation-delay:${i * 45}ms" aria-hidden="true">${c}</span>`).join('')}</h1>
      <div class="label"><p class="state" data-state>${esc(line.state)}</p>
      <p class="facts">A tiny planet lit by a real hamster on a real wheel. Its sun only rises when he runs.</p>
      <div class="actions">
        <a class="stamp" href="#lastlight" data-cta>${live.sky === 'day' ? 'Work the day shift' : 'Hold the night shift'}</a>
        <a class="stamp quiet" href="#stream">Watch ${esc(STREAM_CAPTION)}</a>
        <button class="link-button" data-preview>${previewing() ? 'Back to the real sky' : live.sky === 'day' ? 'Preview the night' : 'Preview daylight'}</button>
      </div></div>
    </section>
    <section class="beat right"><div class="copy"><h2>The sun here is a wheel.</h2><p>It turns at his real speed, read from the sensor on his wheel${live.rpm ? `: ${fmt(live.rpm)} rpm right now` : ''}. When he stops, the planet stops.</p></div></section>
    <section class="beat"><div class="copy"><h2>He runs, the field opens.</h2><p>Sunflowers lift and turn to the light. Every pass of the magnet is settled on Ethereum and grows the flowers you planted.</p></div></section>
    <section class="beat right"><div class="copy"><h2>He sleeps, the moths come.</h2><p>${share !== null ? `He has slept through ${Math.round(share * 100)}% of all ${fmt(history.frontier)} rounds so far` : 'He sleeps through most rounds'}, so night is the normal state here. Somebody has to hold the lantern.</p></div></section>
    <section class="beat ending"><div class="copy"><h2>Nothing here is scripted.</h2><p>Tonight's moths come from round ${fmt(nightSeed().round)} and the newest settled hash. The boss's health is real kilometres. Sunrise comes when a hamster decides.</p>
      <div class="actions" style="display:flex;flex-wrap:wrap;gap:12px;margin-top:20px"><a class="stamp" href="#lastlight">Hold the night shift</a><a class="stamp quiet" href="#dawn">Call the dawn</a></div></div></section>
  </div>`;
}

let cleanup: Cleanup | void;
let scrollHandler: (() => void) | null = null;

async function route() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  if (scrollHandler) { removeEventListener('scroll', scrollHandler); scrollHandler = null; }
  const id = location.hash.replace(/^#\/?/, '');
  document.querySelectorAll('.dock a').forEach((a) => { if ((a as HTMLAnchorElement).getAttribute('href') === `#${id}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const place = PLACES.find((p) => p.id === id);
  if (place || id === 'deploy') {
    if (previewOnly && id === 'deploy') { location.hash = ''; return; }
    main.innerHTML = '<div class="room" tabindex="-1"></div>';
    const room = main.querySelector<HTMLElement>('.room')!;
    world?.goTo(place?.id ?? 'shed');
    document.title = `${place?.label ?? 'Site setup'}, Squeekverse`;
    room.focus({ preventScroll: true });
    try { cleanup = await (place?.room ?? deployRoom)(room); }
    catch (e) { room.innerHTML = `<header><h2>This place did not load</h2><p>${esc((e as Error).message)}</p><button class="stamp" onclick="location.reload()">Reload</button></header>`; }
  } else {
    main.innerHTML = homeHtml();
    document.title = 'Squeekverse';
    scrollTo(0, 0);
    if (world) {
      world.scrollT = 0;
      world.goHome();
      scrollHandler = () => { const max = document.documentElement.scrollHeight - innerHeight; world.scrollT = max > 0 ? Math.min(1, scrollY / max) : 0; };
      addEventListener('scroll', scrollHandler, { passive: true });
    }
    main.querySelector('[data-preview]')?.addEventListener('click', () => { preview(previewing() ? null : live.sky === 'day' ? 'night' : 'day'); void route(); });
  }
}

let lastSky = live.sky;
onLive(() => {
  const line = skyLine();
  pulse.textContent = previewing() ? `Preview: ${line.pulse.toLowerCase()}` : line.pulse;
  const state = main.querySelector('[data-state]');
  if (state) state.textContent = line.state;
  const cta = main.querySelector('[data-cta]');
  if (cta) cta.textContent = live.sky === 'day' ? 'Work the day shift' : 'Hold the night shift';
  if (world) {
    world.rpm = live.sky === 'day' ? (previewing() && !live.rpm ? 70 : live.rpm) : 0;
    world.lightTarget = live.sky === 'day' ? 1 : live.sky === 'lost' ? 0.28 : 0;
    world.lost = live.sky === 'lost';
    world.setWork(live.work);
  }
  if (lastSky !== live.sky) { if (live.sky === 'day') sfx('dawn'); lastSky = live.sky; }
});

addEventListener('hashchange', route);
startLive();
void loadHistory();
void route();
