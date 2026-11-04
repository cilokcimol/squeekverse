/** The weekly boss. Its health is real kilometres: only the hamster's own distance can bring it down. */
export const RAID_BOSSES = ['Old Barn Owl', 'The Grey Stoat', 'Mother Frost', 'The Night Heron', 'Grimalkin', 'The Long Shadow'];

/** Raid weeks start Monday 12:00 UTC, in line with Squeekchain's noon-to-noon days. */
export function raidWeek(nowMs: number): { index: number; startMs: number; endMs: number } {
  const week = 7 * 86400_000;
  const anchor = Date.UTC(2026, 9, 26, 12); // Monday 26 Oct 2026, the first day the wheel reported work
  const index = Math.floor((nowMs - anchor) / week);
  const startMs = anchor + index * week;
  return { index, startMs, endMs: startMs + week };
}

export function raidBoss(index: number, baselineKmPerDay: number) {
  const name = RAID_BOSSES[((index % RAID_BOSSES.length) + RAID_BOSSES.length) % RAID_BOSSES.length];
  // Sized from his real recent pace, so a good week wins and a lazy one does not.
  const hpKm = Math.max(20, Math.round(baselineKmPerDay * 7 * 1.1));
  return { name, hpKm };
}
