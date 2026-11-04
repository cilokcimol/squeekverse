/** Small deterministic helpers. The same round gives every player the same night. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MothSpawn { at: number; lat: number; lon: number; speed: number; kind: 'moth' | 'hawk'; target: number }

/** The wave for a night. `seedText` is the round number plus the newest settled data hash. */
export function buildWave(seedText: string, flowers: number, seconds = 75, deep = false): { spawns: MothSpawn[]; owlAt: number; seedNumber: number } {
  const seedNumber = hashString(seedText);
  const r = rng(seedNumber);
  const spawns: MothSpawn[] = [];
  let t = 1.2;
  while (t < seconds - 2) {
    const progress = t / seconds;
    const hawk = progress > (deep ? 0.15 : 0.35) && r() < (deep ? 0.22 : 0.12) + progress * 0.14;
    spawns.push({ at: t, lat: r() * Math.PI * 2, lon: r() * 0.9 + 0.25, speed: (hawk ? 0.34 : 0.2) + r() * 0.08 + progress * 0.1, kind: hawk ? 'hawk' : 'moth', target: Math.floor(r() * flowers) });
    t += Math.max(deep ? 0.3 : 0.42, (1.6 - progress * 1.05) * (0.55 + r() * 0.9) * (deep ? 0.72 : 1));
  }
  return { spawns, owlAt: seconds * (0.68 + r() * 0.12), seedNumber };
}

export const GAME_LIMITS = { seconds: 75, flowers: 18, maxScore: 60000 } as const;
