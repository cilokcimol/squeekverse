/**
 * Pressed flowers: each real running session draws one flower.
 *
 * Florets sit on the golden-angle spiral, one per magnet passage. The gap before each passage sets
 * the floret's size and warmth, so a steady sprint and a stop-start jog grow visibly different heads.
 */
export interface Session { start: string; end: string; passages: number; gapsMs: number[] }

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface Floret { x: number; y: number; r: number; hue: number; light: number }

export function florets(gaps: number[], limit = 1400): Floret[] {
  const step = gaps.length > limit ? gaps.length / limit : 1;
  const out: Floret[] = [];
  const total = Math.min(gaps.length, limit);
  for (let k = 0; k < total; k++) {
    const gap = gaps[Math.floor(k * step)];
    const speed = Math.min(1, 620 / Math.max(120, gap));
    const radius = Math.sqrt((k + 0.5) / total);
    const angle = k * GOLDEN;
    // Early passes sit at the centre and late ones at the rim, so rests show up as dark rings.
    out.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      r: (0.004 + speed * speed * 0.03) * Math.min(1.8, Math.sqrt(500 / Math.max(total, 60))),
      hue: 6 + speed * 46,
      light: 24 + speed * 50,
    });
  }
  return out;
}

/** Mean speed through the run, one value per petal: the petals are a clock of how he ran. */
export function pace(gaps: number[], slices: number): number[] {
  if (!gaps.length) return Array(slices).fill(0);
  const out: number[] = [];
  for (let i = 0; i < slices; i++) {
    const part = gaps.slice(Math.floor((i / slices) * gaps.length), Math.max(Math.floor(((i + 1) / slices) * gaps.length), Math.floor((i / slices) * gaps.length) + 1));
    const mean = part.reduce((a, b) => a + b, 0) / part.length;
    out.push(Math.min(1, 620 / Math.max(120, mean)));
  }
  return out;
}

export function paintingSvg(session: Session, size = 800): string {
  const items = florets(session.gapsMs);
  const c = size / 2;
  const headRadius = size * (0.13 + Math.min(0.15, Math.log10(Math.max(10, session.passages)) * 0.045));
  const petals = 21;
  const speeds = pace(session.gapsMs, petals);
  const skyHue = 225 + (Date.parse(session.start) / 3600000) % 24 * 2.5;
  let body = '';
  speeds.forEach((speed, i) => {
    const a = (i / petals) * 360;
    const length = headRadius * (0.22 + speed * 0.8);
    body += `<ellipse cx="${c}" cy="${(c - headRadius - length * 0.82).toFixed(1)}" rx="${(headRadius * 0.17).toFixed(1)}" ry="${length.toFixed(1)}" fill="hsl(${(24 + speed * 26).toFixed(0)} 96% ${(46 + speed * 18).toFixed(0)}%)" transform="rotate(${a.toFixed(1)} ${c} ${c})"/>`;
  });
  body += `<circle cx="${c}" cy="${c}" r="${(headRadius * 1.04).toFixed(1)}" fill="#22130c"/>`;
  for (const f of items) {
    body += `<circle cx="${(c + f.x * headRadius).toFixed(1)}" cy="${(c + f.y * headRadius).toFixed(1)}" r="${(f.r * headRadius * 2.2).toFixed(2)}" fill="hsl(${f.hue.toFixed(0)} 90% ${f.light.toFixed(0)}%)"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="hsl(${skyHue.toFixed(0)} 52% 22%)"/>${body}</svg>`;
}

/** Splits run segments into sessions: a gap over five minutes starts a new one. */
export function toSessions(segments: { startAt: string; endAt: string; passages: { at: string }[]; workUnits: string }[]): Session[] {
  const sessions: Session[] = [];
  let current: { start: string; end: string; times: number[] } | null = null;
  for (const segment of segments) {
    const times = segment.passages.map((p) => Date.parse(p.at));
    if (!times.length) continue;
    if (!current || times[0] - current.times[current.times.length - 1] > 5 * 60_000) {
      if (current) sessions.push(close(current));
      current = { start: segment.startAt, end: segment.endAt, times: [] };
    }
    current.times.push(...times);
    current.end = segment.endAt;
  }
  if (current) sessions.push(close(current));
  return sessions.filter((s) => s.passages >= 30);
}

function close(c: { start: string; end: string; times: number[] }): Session {
  const gaps: number[] = [];
  for (let i = 1; i < c.times.length; i++) gaps.push(Math.round(c.times[i] - c.times[i - 1]));
  return { start: c.start, end: c.end, passages: c.times.length, gapsMs: gaps };
}
