/** The same drawing rules as Sunflower.sol, for the preview before planting. */
export const STAGES = [[0, 'Seed'], [100, 'Sprout'], [2000, 'Bud'], [10000, 'Bloom'], [40000, 'Full head'], [93200, 'Heavy with seed']] as const;

export function stageOf(light: number) { let s = 0; STAGES.forEach(([min], i) => { if (light >= min) s = i; }); return s; }

export function sunflowerSvg(light: number, seed = 7, day = true, leaves = Math.min(12, Math.floor(light / 10000))): string {
  const stage = stageOf(light);
  const count = Math.min(233, Math.floor(light / 400));
  const hue = (seed % 16) + 30;
  const stemTop = 300 - 26 * stage;
  const sky = !day ? '#1a1440' : `hsl(${200 + (seed >> 2) % 40},70%,62%)`;
  let art = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="${sky}"/><path d="M0 330q200-44 400 0v70H0z" fill="#2f8f5b"/><path d="M200 340Q${190 + (seed >> 1) % 20} 300 200 ${stemTop}" stroke="#1f6b43" stroke-width="9" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i < leaves; i++) { const x = i % 2 === 0 ? 213 : 187; const y = 330 - Math.floor(((i + 1) * (330 - stemTop)) / 14); art += `<ellipse cx="${x}" cy="${y}" rx="14" ry="5" fill="#2f8f5b" transform="rotate(${i % 2 === 0 ? -25 : 25} ${x} ${y})"/>`; }
  if (stage === 0) return `${art}<ellipse cx="200" cy="334" rx="11" ry="7" fill="#3a2a1c"/></svg>`;
  const petals = stage < 2 ? 0 : 13 + (seed >> 3) % 13;
  const radius = 18 + 12 * stage;
  art += `<g transform="translate(200 ${stemTop})">`;
  for (let i = 0; i < petals; i++) art += `<ellipse cx="0" cy="-${radius + 16}" rx="9" ry="22" fill="hsl(${hue + 4},96%,56%)" transform="rotate(${(i * 360) / petals})"/>`;
  art += `<circle r="${radius}" fill="#3a2a1c"/>`;
  const spacing = (radius * 100) / 16;
  for (let i = 1; i <= count; i++) {
    const angle = ((i * 13750) % 36000) / 100 * Math.PI / 180;
    const r = spacing * Math.floor(Math.sqrt(i * 100)) / 1000;
    art += `<circle cx="${(Math.cos(angle) * r).toFixed(2)}" cy="${(Math.sin(angle) * r).toFixed(2)}" r="2.2" fill="hsl(${hue - 8},92%,${48 + (i * 3) % 30}%)"/>`;
  }
  return `${art}</g></svg>`;
}
