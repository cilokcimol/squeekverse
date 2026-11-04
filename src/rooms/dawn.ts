import { myCalls, placeCall, profile, keeperLine, serverOnline, type Call } from '../lib/player';
import { currentForecast, live, loadHistory, onLive, test, model } from '../lib/store';
import { ALMANAC_FACE, esc, fmt, type Room } from './ui';
import { roundStart } from '../../shared/chain';

const clock = (round: number) => new Date(roundStart(round) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const dawnRoom: Room = async (el) => {
  await loadHistory();
  let selected: number | null = null;
  let stake = 0;
  let seeds = 0;
  let calls: Call[] = [];
  let error = '';
  let keeper = '';

  const load = async () => {
    const [p, c, k] = await Promise.all([profile(), myCalls(), keeperLine()]);
    seeds = p.seeds; calls = c; keeper = k.text;
  };

  const paint = () => {
    const f = currentForecast();
    if (!f) { el.innerHTML = '<header><h2>Call the dawn</h2><p>The Almanac is still reading the rounds.</p></header>'; return; }
    const dawn = f.kind === 'dawn';
    const open = calls.find((c) => c.actual === null);
    selected ??= open?.target ?? null;
    const max = Math.max(...f.probabilities, 0.0001);
    const settled = calls.filter((c) => c.actual !== null);
    const you = settled.reduce((a, c) => a + (c.points ?? 0), 0), it = settled.reduce((a, c) => a + (c.almanacPoints ?? 0), 0);
    el.innerHTML = `
      <header><h2>${dawn ? 'Call the dawn' : 'Call the dusk'}</h2>
      <p>${dawn ? 'He is asleep. Pick the 10 minute round he wakes up in.' : 'He is running. Pick the round he stops in.'} Beat the Almanac and your stake pays double.</p></header>
      <div class="keeper">${ALMANAC_FACE}<p>${esc(keeper)}</p></div>
      <section>
        <h3>The Almanac's odds</h3>
        <p class="small soft">${f.later > 0.5 ? `It gives ${Math.round(f.later * 100)}% that nothing changes in the next three hours.` : `It calls round ${f.pick}, at ${clock(f.pick)} your time.`}</p>
        <div class="odds" role="group" aria-label="Chance of ${dawn ? 'waking' : 'stopping'} in each round">
          ${f.probabilities.map((p, i) => { const round = f.fromRound + i; const on = selected === round; return `<button data-round="${round}" aria-pressed="${on}" ${open ? 'disabled' : ''} title="Round ${round}, ${clock(round)}: ${(p * 100).toFixed(1)}%" aria-label="Round ${round} at ${clock(round)}, ${(p * 100).toFixed(1)} percent"><i style="height:${Math.max(2, (p / max) * 88)}%"></i>${round === f.pick ? `<span class="mark ${i < 3 ? 'start' : i > 14 ? 'end' : ''}">Almanac</span>` : ''}</button>`; }).join('')}
        </div>
        <div class="axis"><span>${clock(f.fromRound)}</span><span>Tallest bar ${(max * 100).toFixed(1)}%</span><span>${clock(f.fromRound + f.probabilities.length - 1)}</span></div>
      </section>
      <section>
        ${open ? `<h3>Your call is in</h3>
          <p>You called round <b class="num">${open.target}</b>, the Almanac called <b class="num">${open.almanac}</b>. ${open.stake ? `${open.stake} seeds staked.` : ''} SqueekCore answers once the round settles, usually within fifteen minutes of it ending.</p>`
        : `<h3>${selected ? `Round ${selected}, at ${clock(selected)}` : 'Tap a bar to choose a round'}</h3>
          <label class="small">Stake <b class="num">${stake}</b> of your <b class="num">${fmt(seeds)}</b> seeds
            <input type="range" min="0" max="${seeds}" value="${stake}" data-stake ${seeds ? '' : 'disabled'}/></label>
          ${seeds ? '' : '<p class="small soft">Seeds come from holding a shift. You can call for free too.</p>'}
          <div class="row" style="margin-top:10px"><button class="stamp" data-call ${selected ? '' : 'disabled'}>Make this call</button></div>
          ${error ? `<p class="note warm" role="alert" style="margin-top:10px">${esc(error)}</p>` : ''}`}
      </section>
      <section>
        <h3>You against the Almanac</h3>
        ${settled.length ? `<p class="big num">${you} to ${it}</p>
        <table style="margin-top:8px"><thead><tr><th>Called</th><th class="r">You</th><th class="r">Almanac</th><th class="r">Real</th><th class="r">Points</th></tr></thead><tbody>
        ${settled.slice(0, 8).map((c) => `<tr><td>${c.kind}</td><td class="r">${c.target}</td><td class="r">${c.almanac}</td><td class="r">${c.actual}</td><td class="r">${c.points} v ${c.almanacPoints}</td></tr>`).join('')}</tbody></table>` : '<p class="small soft">No settled calls yet. Exact is 100 points, one round off is 60, two is 30.</p>'}
      </section>
      <section>
        <h3>How the Almanac works</h3>
        <p class="small">It is a small statistical model, retrained from every settled round. It learns his chance of waking or stopping for each half hour of the UTC day. Trained on ${fmt(model?.rounds ?? 0)} rounds so far.</p>
        ${test ? `<p class="small" style="margin-top:8px">Tested on rounds it had not seen, its call landed within one round ${Math.round(test.almanacWithin1 * 100)}% of the time, against ${Math.round(test.baselineWithin1 * 100)}% for a flat guess, over ${test.samples} tries.</p>` : ''}
      </section>`;
    el.querySelectorAll<HTMLButtonElement>('[data-round]').forEach((b) => b.addEventListener('click', () => { selected = Number(b.dataset.round); error = ''; paint(); }));
    el.querySelector<HTMLInputElement>('[data-stake]')?.addEventListener('input', (e) => { stake = Number((e.target as HTMLInputElement).value); const b = el.querySelector('label b'); if (b) b.textContent = String(stake); });
    el.querySelector('[data-call]')?.addEventListener('click', async () => {
      if (!selected) return;
      try { await placeCall(selected, stake); await load(); }
      catch (e) { const m = (e as Error).message; error = m === 'call_already_open' ? 'You already have a call waiting on this one.' : m === 'round_out_of_range' ? 'That round has started. Pick a later one.' : m; }
      paint();
    });
  };

  await load();
  void serverOnline();
  paint();
  let lastSky = live.sky;
  const offLive = onLive(() => { if (live.sky !== lastSky) { lastSky = live.sky; selected = null; paint(); } });
  const timer = setInterval(async () => { const scroll = el.scrollTop; await load(); paint(); el.scrollTop = scroll; }, 60_000);
  return () => { offLive(); clearInterval(timer); };
};
