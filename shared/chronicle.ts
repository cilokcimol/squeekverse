/** The living story. One entry per real day and night on the wheel, written from settled rounds. */
import { rng, hashString } from './seed';
import type { ActiveRound } from './almanac';

export interface Spell { kind: 'day' | 'night'; from: number; to: number; work: number; hash?: string }

/** Turns active rounds into alternating runs of day and night. */
export function spells(active: ActiveRound[], frontier: number, first = 1): Spell[] {
  const out: Spell[] = [];
  const sorted = [...active].sort((a, b) => a.round - b.round);
  let cursor = first;
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i].round;
    if (start > cursor) out.push({ kind: 'night', from: cursor, to: start - 1, work: 0 });
    let end = start, work = 0, hash: string | undefined;
    while (i < sorted.length && sorted[i].round === end + (work ? 1 : 0)) {
      end = sorted[i].round; work += sorted[i].work; hash = sorted[i].hash; i++;
    }
    out.push({ kind: 'day', from: start, to: end, work, hash });
    cursor = end + 1;
  }
  if (cursor <= frontier) out.push({ kind: 'night', from: cursor, to: frontier, work: 0 });
  return out;
}

const DAY = [
  (w: number, m: string) => `The wheel turned for ${m} and laid down ${w} work. The eastern rows opened before anyone had finished their tea.`,
  (w: number, m: string) => `He ran ${m}. ${w} passes of the magnet, and the frost let go of the barn roof.`,
  (w: number, m: string) => `A ${m} day, ${w} work. The bees came back confused and stayed anyway.`,
  (w: number, m: string) => `Light for ${m}. The field counted ${w} work and the seed sacks got heavier.`,
  (w: number, m: string) => `${w} work in ${m}. The weathervane spun so hard that the Almanac wrote it down twice.`,
];
const NIGHT = [
  (m: string) => `Dark for ${m}. The lanterns held, and something large walked the far ridge.`,
  (m: string) => `He slept ${m}. Moths took the low rows, and the night shift took them back.`,
  (m: string) => `${m} of night. Nobody on the planet could say whether he was resting or the wire had come loose.`,
  (m: string) => `A ${m} night. The sunflowers bowed and waited, as they do.`,
  (m: string) => `The sky stayed shut for ${m}. The Almanac sharpened a pencil and revised its odds.`,
];

export function spellLength(rounds: number): string {
  const minutes = rounds * 10;
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? 'an hour' : `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
}

export function spellLine(spell: Spell): string {
  const pick = rng(hashString(`${spell.kind}:${spell.from}:${spell.hash ?? ''}`))();
  const span = spell.to - spell.from + 1;
  if (spell.kind === 'day') return DAY[Math.floor(pick * DAY.length)](spell.work, spellLength(span));
  return NIGHT[Math.floor(pick * NIGHT.length)](spellLength(span));
}
