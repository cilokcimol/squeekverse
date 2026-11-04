import './style.css';
import { raidBoss, raidWeek } from '../shared/raid';
import { API, STREAM_CAPTION } from '../shared/chain';
import { currentForecast, live, loadHistory, onLive, startLive } from './lib/store';
import { esc, fmt } from './rooms/ui';
import { World } from './world/scene';

const params = new URLSearchParams(location.search);
const show = new Set((params.get('show') ?? 'sky,raid,planet').split(','));
const corner = ['tl', 'tr', 'bl', 'br'].includes(params.get('corner') ?? '') ? params.get('corner')! : 'bl';
const canvas = document.getElementById('world') as HTMLCanvasElement;
const root = document.getElementById('overlay')!;
let world: World | null = null;
if (show.has('planet')) {
  world = new World(canvas, { overlay: true });
  world.overlayPose(params.get('planet') ?? { tl: 'br', tr: 'bl', bl: 'br', br: 'bl' }[corner]!);
} else canvas.style.display = 'none';

let raid = { name: '', left: 0, hp: 0, done: 0 };
async function loadRaid() {
  try {
    const stats = await (await fetch(`${API}/v1/measurement/stats?range=30d`)).json() as { activity: { days: { date: string; distanceMm: string | null }[] } };
    const week = raidWeek(Date.now());
    const start = new Date(week.startMs).toISOString().slice(0, 10);
    const km = (d: { distanceMm: string | null }) => Number(d.distanceMm ?? 0) / 1e6;
    const before = stats.activity.days.filter((d) => d.date < start && d.distanceMm).slice(-7);
    const boss = raidBoss(week.index, before.length ? before.reduce((a, d) => a + km(d), 0) / before.length : 8);
    const done = stats.activity.days.filter((d) => d.date >= start).reduce((a, d) => a + km(d), 0);
    raid = { name: boss.name, left: Math.max(0, boss.hpKm - done), hp: boss.hpKm, done };
  } catch { /* the card keeps its last value */ }
}

function paint() {
  const day = live.sky === 'day';
  const cards: string[] = [];
  if (show.has('sky')) cards.push(`<div><b>${day ? `${fmt(live.rpm)} rpm` : live.sky === 'lost' ? 'No signal' : 'Asleep'}</b>${day ? `It is day on Squeekverse. ${fmt(live.todayKm, 2)} km today.` : `Night on Squeekverse. ${fmt(live.todayKm, 2)} km today.`}<div class="small" style="opacity:.8">${esc(STREAM_CAPTION)}</div></div>`);
  if (show.has('block')) cards.push(`<div><b>Block ${fmt(live.height + 1)}</b>${fmt(live.progress * 100)}% mined<div class="bar"><i style="width:${live.progress * 100}%"></i></div></div>`);
  if (show.has('almanac')) {
    const f = currentForecast();
    if (f) cards.push(`<div><b>The Almanac</b>${f.later > 0.5 ? `No ${f.kind} in sight for three hours.` : `Calls ${f.kind} at round ${f.pick}.`}</div>`);
  }
  if (show.has('raid') && raid.name) cards.push(`<div><b>${esc(raid.name)}</b>${fmt(raid.left, 1)} km of health left<div class="bar"><i style="width:${Math.min(100, (raid.done / raid.hp) * 100)}%"></i></div></div>`);
  root.innerHTML = cards.length ? `<div class="ov-card ov-${corner} ${day ? 'day' : ''}" style="display:grid;gap:.8em">${cards.join('')}</div>` : '';
  if (world) { world.rpm = day ? live.rpm : 0; world.lightTarget = day ? 1 : live.sky === 'lost' ? 0.28 : 0; world.lost = live.sky === 'lost'; world.setWork(live.work); }
}

onLive(paint);
startLive();
void loadHistory().then(paint);
void loadRaid().then(paint);
setInterval(loadRaid, 300_000);
