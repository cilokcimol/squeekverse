import { LastLight, type Hud, type Result } from '../game/lastlight';
import { leaderboard, submitRun, serverOnline } from '../lib/player';
import { API } from '../../shared/chain';
import { live, nightSeed, loadHistory, previewing, previewOnly } from '../lib/store';
import { connect, hasWallet, wallet } from '../lib/wallet';
import { setSound, sfx, soundOn } from '../lib/sound';
import { esc, fmt, type Room } from './ui';
import type { World } from '../world/scene';

export const lastlightRoom = (world: World, leave: () => void): Room => async (el) => {
  await loadHistory();
  let game: LastLight | null = null;
  let hudEl: HTMLElement | null = null;
  let holderNote = '';

  /** Deep night is for wallets holding a Squeek. It returns the level of their best one. */
  const bestLevel = async (): Promise<number> => {
    if (!wallet.address) await connect();
    const res = await fetch(`${API}/v1/accounts/${wallet.address!.toLowerCase()}?limit=100`);
    const account = await res.json() as { status: string; tokens?: { level: number }[] };
    if (account.status !== 'available') throw new Error('Squeekchain cannot confirm your Squeeks right now. Try again shortly.');
    return Math.max(0, ...(account.tokens ?? []).map((t) => t.level));
  };

  const list = (rows: { name: string; score: number }[]) => rows.length
    ? `<table><tbody>${rows.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.name)}</td><td class="r">${fmt(r.score)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="soft small">Nobody has held this shift yet. Be first.</p>';

  const lobby = async (result?: Result, rank?: number | null) => {
    const seed = nightSeed();
    const top = await leaderboard(seed.round);
    const shared = await serverOnline();
    const day = live.sky === 'day';
    el.innerHTML = `
      <header><h2>${day ? 'Day shift' : 'Last light'}</h2>
      <p>${day ? 'He is running, so the moths come in slower and each one drops double seeds.' : 'He is asleep and the moths are out. Hold your lantern over the field until morning.'}</p></header>
      ${result ? `<section aria-live="polite"><p class="big num">${fmt(result.score)}</p>
        <p>${result.flowers} of 18 flowers lived. ${result.burned} moths burned. ${result.owl ? 'You turned the owl back.' : 'The owl got through.'} You earned ${result.seeds} seeds.${rank ? ` You are number ${rank} this round.` : ''}</p>
        ${result.running ? '<p class="soft small">He was running during your shift, so your lantern charged faster.</p>' : ''}</section>` : ''}
      <section><div class="row"><button class="stamp" data-start>${result ? 'Hold another shift' : 'Start the shift'}</button>
      <label class="row small"><input type="checkbox" data-sound ${soundOn() ? 'checked' : ''}/> Sound</label></div>
      <p class="small soft" style="margin-top:12px">Press and drag to shine the lantern. It drains while lit and refills when you let go. On a keyboard, use the arrow keys and hold space.</p></section>
      <section class="holder"><h3 style="margin-top:0">Deep night, for Squeek holders</h3>
      <p class="small">More moths, and hawks from the start. Your lantern reaches further with the level of your best Squeek, and you score half as much again with double seeds.</p>
      <div class="row" style="margin-top:10px"><button class="stamp quiet" data-deep ${previewOnly ? 'disabled' : ''}>${wallet.address ? 'Start deep night' : 'Connect wallet for deep night'}</button></div>
      ${holderNote ? `<p class="note warm" role="status" style="margin-top:10px">${esc(holderNote)}</p>` : ''}</section>
      <section><h3>Tonight's field, round ${seed.round}</h3>
      <p class="small soft">Everyone playing this round gets the same night. It is seeded from the round number and ${seed.hash ? `the newest settled data hash, <span class="num">${esc(seed.hash.slice(0, 10))}…</span>` : 'the settled record'}.</p>
      ${list(top.rows)}</section>
      <section><h3>Best shifts ${shared ? '' : 'on this device'}</h3>${list(top.allTime)}
      ${shared ? '' : '<p class="small soft" style="margin-top:8px">Scores stay on this device until a Squeekverse server is connected.</p>'}</section>`;
    el.querySelector('[data-start]')!.addEventListener('click', () => start());
    el.querySelector('[data-deep]')?.addEventListener('click', async () => {
      if (!hasWallet()) { holderNote = 'No browser wallet found. Install one such as MetaMask or Rabby, then reload this page.'; void lobby(result, rank); return; }
      try {
        const level = await bestLevel();
        if (!level) { holderNote = 'This wallet holds no Squeeks. The official Sepolia app hands out test ones for free at sepolia.squeekchain.com.'; void lobby(result, rank); return; }
        holderNote = '';
        start(level);
      } catch (e) { holderNote = (e as Error).message.slice(0, 160); void lobby(result, rank); }
    });
    el.querySelector<HTMLInputElement>('[data-sound]')!.addEventListener('change', (e) => { setSound((e.target as HTMLInputElement).checked); sfx('squeak'); });
  };

  const start = (holderLevel = 0) => {
    const base = nightSeed();
    const seed = holderLevel ? { ...base, text: `${base.text}:deep` } : base;
    document.body.classList.add('playing');
    el.style.display = 'none';
    world.goToField();
    hudEl = document.createElement('div');
    hudEl.innerHTML = `<div class="hud" role="status"><div><b class="num" data-score>0</b><span data-combo>Score</span></div><div style="text-align:center"><b class="num" data-time>75</b><span>seconds</span></div><div class="right"><b class="num" data-flowers>18</b><span>flowers</span></div></div>
      <div class="battery" data-bat><span data-batlabel>Lantern</span><div class="track"><div class="fill" data-fill style="width:100%"></div></div></div>
      <button class="stamp quiet quit" data-quit>End shift</button>`;
    document.body.append(hudEl);
    const q = <T extends HTMLElement>(s: string) => hudEl!.querySelector<T>(s)!;
    const message = (m: string) => { const n = document.createElement('div'); n.className = 'floatmsg'; n.textContent = m; document.body.append(n); setTimeout(() => n.remove(), 1800); };
    const hud = (h: Hud) => {
      q('[data-score]').textContent = fmt(h.score);
      q('[data-combo]').textContent = h.combo > 1 ? `Score, combo ×${h.combo.toFixed(1)}` : 'Score';
      q('[data-time]').textContent = String(Math.ceil(h.time));
      q('[data-flowers]').textContent = String(h.flowers);
      q('[data-fill]').style.width = `${h.battery}%`;
      q('[data-bat]').classList.toggle('fast', h.fast);
      q('[data-batlabel]').textContent = h.owl !== null ? `Owl ${Math.round(h.owl * 100)}%` : h.fast ? 'Lantern: he is running, fast charge' : 'Lantern';
    };
    q('[data-quit]').addEventListener('click', () => game?.endNow());
    message(holderLevel ? `Deep night. Your level ${holderLevel} lantern is lit.` : live.sky === 'day' ? 'Day shift. Hold the field.' : 'Night shift. Hold the field.');
    game = new LastLight(world, {
      seedText: seed.text, round: seed.round, rpm: () => live.rpm, holderLevel: holderLevel || undefined, dayShift: live.sky === 'day', onHud: hud, onMessage: message,
      onEnd: async (result) => {
        finish();
        // A shift that was only a preview stays off the board.
        const rank = previewing() ? null : (await submitRun({ round: result.round, score: result.score, flowers: result.flowers, seeds: result.seeds }).catch(() => ({ rank: null }))).rank;
        await lobby(result, rank);
      },
    });
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('qa')) (window as any).__game = game;
  };

  const finish = () => {
    document.body.classList.remove('playing');
    hudEl?.remove(); hudEl = null;
    game?.destroy(); game = null;
    el.style.display = '';
    world.goTo('lastlight');
  };

  await lobby();
  return () => { if (game) finish(); void leave; };
};
