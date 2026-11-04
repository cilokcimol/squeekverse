import { raidBoss, raidWeek } from '../../shared/raid';
import { API } from '../../shared/chain';
import { api, profile, serverOnline, updateProfile } from '../lib/player';
import { live } from '../lib/store';
import { esc, fmt, until, type Room } from './ui';

interface Raid { boss: string; hpKm: number; doneKm: number; endMs: number; paceKmPerDay: number; defeated: boolean; crews: { crew: string; score: number; players: number }[] }

async function localRaid(): Promise<Raid> {
  const stats = await (await fetch(`${API}/v1/measurement/stats?range=30d`)).json() as { activity: { days: { date: string; distanceMm: string | null }[] } };
  const week = raidWeek(Date.now());
  const start = new Date(week.startMs).toISOString().slice(0, 10);
  const km = (d: { distanceMm: string | null }) => Number(d.distanceMm ?? 0) / 1e6;
  const inWeek = stats.activity.days.filter((d) => d.date >= start);
  const before = stats.activity.days.filter((d) => d.date < start && d.distanceMm).slice(-7);
  const pace = before.length ? before.reduce((a, d) => a + km(d), 0) / before.length : 8;
  const boss = raidBoss(week.index, pace);
  const doneKm = inWeek.reduce((a, d) => a + km(d), 0);
  return { boss: boss.name, hpKm: boss.hpKm, doneKm, endMs: week.endMs, paceKmPerDay: pace, defeated: doneKm >= boss.hpKm, crews: [] };
}

export const raidRoom: Room = async (el) => {
  const shared = await serverOnline();
  let raid: Raid;
  try { raid = shared ? await api.get<Raid>('/raid') : await localRaid(); }
  catch (e) { el.innerHTML = `<header><h2>The raid</h2><p>The week's record could not be read: ${esc((e as Error).message)}. Try again in a minute.</p></header>`; return; }
  const me = await profile();
  const left = Math.max(0, raid.hpKm - raid.doneKm);
  const share = Math.min(1, raid.doneKm / raid.hpKm);
  const daysLeft = (raid.endMs - Date.now()) / 86400_000;
  const needed = daysLeft > 0 ? left / daysLeft : 0;
  el.innerHTML = `
    <header><h2>${esc(raid.boss)}</h2><p>This week's boss has real kilometres for health. Only the hamster's own distance hurts it, so you cannot grind it down. You can only hope, and hold the line.</p></header>
    <section>
      <p class="big num">${raid.defeated ? 'Defeated' : `${fmt(left, 1)} km left`}</p>
      <div class="bar" role="img" aria-label="${fmt(share * 100)} percent of ${esc(raid.boss)}'s health is gone" style="margin:10px 0"><i style="width:${share * 100}%"></i></div>
      <p class="small">${fmt(raid.doneKm, 1)} of ${fmt(raid.hpKm)} km run this week, with ${until(raid.endMs)} on the clock. ${raid.defeated ? 'He did it.' : `He needs about ${fmt(needed, 1)} km a day to win.`} The health is set from his pace last week, ${fmt(raid.paceKmPerDay, 1)} km a day, so a lazy week loses.</p>
      <p class="small soft" style="margin-top:6px">Today so far: ${fmt(live.todayKm, 2)} km.</p>
    </section>
    <section>
      <h3>Your crew</h3>
      ${shared ? `<p class="small">Crews stand the shifts. Your Last Light scores this week count for your crew.</p>
      <form class="row" data-crew style="margin-top:10px"><input type="text" maxlength="24" aria-label="Crew name" placeholder="Crew name" value="${esc(me.crew ?? '')}" style="flex:1 1 180px"/><button class="stamp quiet">Join crew</button></form>
      ${raid.crews.length ? `<table style="margin-top:12px"><thead><tr><th>Crew</th><th class="r">Keepers</th><th class="r">Shift score</th></tr></thead><tbody>${raid.crews.map((c) => `<tr><td>${esc(c.crew)}</td><td class="r">${c.players}</td><td class="r">${fmt(c.score)}</td></tr>`).join('')}</tbody></table>` : '<p class="small soft" style="margin-top:10px">No crew on the board yet this week.</p>'}` : '<p class="small soft">Crews need a Squeekverse server, because they are shared between players. The boss and its health above are live either way.</p>'}
    </section>
    <section>
      <h3>Play it from your chat</h3>
      <p class="small">Squeekverse's bot posts each sunrise and nightfall to Discord and answers in Telegram groups: <code>/sky</code>, <code>/raid</code>, <code>/almanac</code> and <code>/top</code>.</p>
    </section>`;
  el.querySelector('[data-crew]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = (e.target as HTMLElement).querySelector('input')!;
    await updateProfile({ crew: input.value });
    void raidRoom(el);
  });
};
