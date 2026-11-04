import { spellLength, spellLine, spells } from '../../shared/chronicle';
import { paintingSvg } from '../../shared/painting';
import { api, serverOnline } from '../lib/player';
import { history, loadHistory, sessionCount, sessions } from '../lib/store';
import { esc, fmt, type Room } from './ui';

const dataUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export const almanacRoom: Room = async (el) => {
  await loadHistory();
  let entries: { from: number; to: number; kind: string; work: number; text: string }[] = [];
  if (await serverOnline()) entries = (await api.get<{ entries: typeof entries }>('/chronicle').catch(() => ({ entries: [] }))).entries;
  if (!entries.length) entries = spells(history.active, history.frontier).slice(-40).reverse().map((s) => ({ from: s.from, to: s.to, kind: s.kind, work: s.work, text: spellLine(s) }));
  const recent = [...sessions].reverse();
  el.innerHTML = `
    <header><h2>The Almanac</h2><p>The planet's record. Every entry is written from rounds settled on SqueekCore, and each day he runs presses one flower into the book.</p></header>
    <section><h3>Pressed flowers</h3>
    <p class="small soft">Each one is a real running session. One floret per magnet pass, from the centre out, so his rests show as dark rings. Each petal is how fast he was going in that slice of the run. ${fmt(sessionCount)} sessions so far.</p>
    <div class="gallery" style="margin-top:10px">${recent.slice(0, 12).map((s, i) => `<figure><a href="#" data-save="${i}" aria-label="Save this flower"><img alt="Flower drawn from ${fmt(s.passages)} wheel passes on ${new Date(s.start).toDateString()}" loading="lazy" src="${dataUri(paintingSvg(s, 400))}"/></a><figcaption>${new Date(s.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${fmt(s.passages)} passes</figcaption></figure>`).join('')}</div>
    <p class="small soft" style="margin-top:8px">Tap a flower to save it.</p></section>
    <section><h3>The story so far</h3>
    <ol class="chron">${entries.map((e) => `<li class="${e.kind === 'day' ? 'day' : ''}"><small>${e.kind === 'day' ? 'Day' : 'Night'}, rounds ${e.from} to ${e.to}, ${spellLength(e.to - e.from + 1)}</small>${esc(e.text)}</li>`).join('')}</ol></section>`;
  el.querySelectorAll<HTMLAnchorElement>('[data-save]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const s = recent[Number(a.dataset.save)];
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([paintingSvg(s, 1600)], { type: 'image/svg+xml' }));
    link.download = `squeekverse-flower-${s.start.slice(0, 10)}.svg`;
    link.click();
  }));
};
