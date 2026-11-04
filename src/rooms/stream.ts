import { API, roundStart, STREAM_CAPTION, STREAM_ID, STREAM_STATE_URL, streamEmbed } from '../../shared/chain';
import { live, onLive, previewOnly } from '../lib/store';
import { esc, fmt, type Room } from './ui';

const WIDGETS: [string, string][] = [['sky', 'Sky and wheel'], ['block', 'Next Squeek block'], ['raid', 'Raid boss'], ['almanac', "The Almanac's call"], ['planet', '3D planet']];

/** Plays the broadcast Squeekchain lists as live. Between runs it plays the saved broadcast. */
async function currentBroadcast(): Promise<{ id: string; live: boolean }> {
  try {
    const res = await fetch(STREAM_STATE_URL, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const state = await res.json() as { schemaVersion?: number; state?: string; validUntil?: string; playback?: { kind?: string; broadcastId?: string } };
      const id = state.playback?.broadcastId ?? '';
      if (state.state === 'live' && state.playback?.kind === 'x' && /^[A-Za-z0-9]{13,16}$/.test(id) && Date.parse(state.validUntil ?? '') > Date.now()) return { id, live: true };
    }
  } catch { /* the saved broadcast still plays */ }
  return { id: STREAM_ID, live: false };
}

interface FeedEvent { id: string; type: string; occurredAt: string; payload: Record<string, string> }
const km = (mm: string) => fmt(Number(mm) / 1e6, 0);
const kmh = (mmS: string) => fmt((Number(mmS) * 3.6) / 1000, 1);
function describe(e: FeedEvent): string {
  const p = e.payload;
  if (e.type === 'measurement.distance_milestone') return `He passed ${km(p.thresholdDistanceMm)} km in his lifetime.`;
  if (e.type === 'measurement.daily_distance_milestone') return `${km(p.thresholdDistanceMm)} km in one day.`;
  if (e.type === 'measurement.speed_milestone') return `He hit ${kmh(p.thresholdSpeedMmPerSecond)} km/h.`;
  if (e.type === 'measurement.speed_record') return `New top speed: ${kmh(p.recordMmPerSecond)} km/h.`;
  if (e.type === 'measurement.distance_streak') return `${p.days} days in a row over ${km(p.minimumDailyDistanceMm)} km.`;
  if (e.type === 'system.settlement_completed') return `Rounds up to ${p.settledThroughRound} settled on Ethereum, with ${p.workAdded} work.`;
  return e.type.replace(/[._]/g, ' ');
}

export const streamRoom: Room = async (el) => {
  const broadcast = await currentBroadcast();
  const chosen = new Set(['sky', 'raid', 'planet']);
  let corner = 'bl';
  const base = new URL('overlay.html', location.href.split('#')[0].split('?')[0]).href;
  const url = () => `${base}?show=${[...chosen].join(',')}&corner=${corner}`;
  const stats = () => live.sky === 'day' ? `${fmt(live.rpm)} rpm, ${fmt(live.speedMmS / 1000, 2)} m/s, ${fmt(live.todayKm, 2)} km today` : live.sky === 'lost' ? 'No signal from the wheel' : `Asleep, ${fmt(live.todayKm, 2)} km today`;

  let feed: FeedEvent[] = [];
  const second = () => {
    const end = roundStart(live.round + 1) * 1000;
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    return `<h3>Second screen</h3>
      <div class="stack small">
        <div><div class="row spread"><span>Next Squeek block</span><span class="num">${fmt(live.height + 1)}, ${fmt(live.progress * 100)}%</span></div><div class="bar" style="height:12px;margin-top:4px"><i style="width:${live.progress * 100}%"></i></div></div>
        <div class="row spread"><span>Round ${fmt(live.round)} ends in</span><span class="num">${Math.floor(left / 60)}m ${String(left % 60).padStart(2, '0')}s</span></div>
        <div class="row spread"><span>Settled through round</span><span class="num">${fmt(live.frontier)}</span></div>
      </div>
      ${feed.length ? `<ul class="feed" style="margin-top:12px">${feed.map((e) => `<li>${esc(describe(e))}<small>${esc(new Date(e.occurredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</small></li>`).join('')}</ul>` : ''}`;
  };
  const loadFeed = async () => {
    try {
      const [m, s] = await Promise.all(['measurement', 'protocol'].map((c) => fetch(`${API}/v1/events?category=${c}&limit=6`).then((r) => r.json())));
      feed = [...(m.events ?? []), ...(s.events ?? []).filter((e: FeedEvent) => e.type === 'system.settlement_completed' && Number(e.payload.workAdded) > 0)].sort((a: FeedEvent, b: FeedEvent) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 6);
    } catch { feed = []; }
    const box = el.querySelector('[data-second]'); if (box) box.innerHTML = second();
  };

  const paint = () => {
    el.innerHTML = `
      <header><h2>Radio mast</h2><p>Watch the real wheel here, and put the planet on your own stream.</p></header>
      <section>
        ${previewOnly ? `<a class="stamp" href="https://x.com/i/broadcasts/${broadcast.id}" target="_blank" rel="noopener">Watch on X</a><p class="small soft" style="margin-top:8px">The video plays right here on the real site. This preview cannot show other sites.</p>` : `<iframe class="player" src="${streamEmbed(broadcast.id)}" title="${esc(STREAM_CAPTION)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`}
        <p style="margin-top:10px"><b>${esc(STREAM_CAPTION)}</b></p>
        <p class="small" data-stats>${esc(stats())}</p>
        <p class="small soft" style="margin-top:6px">${broadcast.live ? 'Live now.' : 'The stream is offline, so this is the saved broadcast. Squeekchain usually goes live around 21:00 UTC.'} <a href="https://x.com/i/broadcasts/${broadcast.id}" target="_blank" rel="noopener">Open on X</a></p>
      </section>
      <section data-second>${second()}</section>
      <section>
        <h3>OBS overlay</h3>
        <p class="small">Add this as a Browser Source. The background is transparent, and it updates itself.</p>
        <div class="stack" style="margin-top:10px">
          ${WIDGETS.map(([id, label]) => `<label class="row small"><input type="checkbox" data-widget="${id}" ${chosen.has(id) ? 'checked' : ''}/> ${label}</label>`).join('')}
        </div>
        <div class="row" style="margin-top:12px">${[['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']].map(([id, label]) => `<label class="row small"><input type="radio" name="corner" data-corner="${id}" ${corner === id ? 'checked' : ''}/> ${label}</label>`).join('')}</div>
        <input type="text" readonly aria-label="Overlay address" value="${esc(url())}" data-url style="margin-top:12px"/>
        <div class="row" style="margin-top:10px"><button class="stamp" data-copy>Copy address</button><a class="stamp quiet" href="${esc(url())}" target="_blank" rel="noopener">Open overlay</a></div>
      </section>`;
    el.querySelectorAll<HTMLInputElement>('[data-widget]').forEach((c) => c.addEventListener('change', () => { if (c.checked) chosen.add(c.dataset.widget!); else chosen.delete(c.dataset.widget!); paint(); }));
    el.querySelectorAll<HTMLInputElement>('[data-corner]').forEach((c) => c.addEventListener('change', () => { corner = c.dataset.corner!; paint(); }));
    el.querySelector('[data-copy]')!.addEventListener('click', async (e) => {
      const button = e.target as HTMLButtonElement;
      const input = el.querySelector<HTMLInputElement>('[data-url]')!;
      try { await navigator.clipboard.writeText(input.value); button.textContent = 'Copied'; }
      catch { input.select(); button.textContent = 'Press copy on your keyboard'; }
    });
  };
  paint();
  const off = onLive(() => { const s = el.querySelector('[data-stats]'); if (s) s.textContent = stats(); const box = el.querySelector('[data-second]'); if (box) box.innerHTML = second(); });
  void loadFeed();
  const timer = setInterval(() => { void loadFeed(); }, 60_000);
  return () => { off(); clearInterval(timer); };
};
