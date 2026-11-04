/** Small synthesized sounds. Off until the player turns them on. */
let ctx: AudioContext | null = null;
let on = false;
try { on = localStorage.getItem('sw.sound') === '1'; } catch { /* private window */ }
export const soundOn = () => on;
export function setSound(value: boolean) { on = value; try { localStorage.setItem('sw.sound', value ? '1' : '0'); } catch { /* private window */ } if (value) ctx ??= new AudioContext(); }

function tone(freq: number, to: number, seconds: number, type: OscillatorType, gain: number) {
  if (!on) return;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + seconds);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + seconds);
}

export function sfx(kind: 'burn' | 'eaten' | 'owl' | 'win' | 'dawn' | 'squeak') {
  if (kind === 'burn') tone(880 + Math.random() * 420, 240, 0.14, 'triangle', 0.07);
  if (kind === 'eaten') tone(190, 70, 0.3, 'sawtooth', 0.07);
  if (kind === 'owl') { tone(330, 250, 0.5, 'sine', 0.13); setTimeout(() => tone(290, 210, 0.75, 'sine', 0.13), 420); }
  if (kind === 'win') [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, f, 0.22, 'triangle', 0.1), i * 110));
  if (kind === 'dawn') [392, 523, 659].forEach((f, i) => setTimeout(() => tone(f, f * 1.01, 0.7, 'sine', 0.07), i * 220));
  if (kind === 'squeak') { tone(1900, 2700, 0.09, 'square', 0.03); setTimeout(() => tone(2300, 1700, 0.08, 'square', 0.025), 100); }
}
