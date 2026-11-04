export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const fmt = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const sqk = (wei: bigint, digits = 2) => { const whole = Number(wei / 10n ** 14n) / 1e4; return fmt(whole, digits); };
export type Cleanup = () => void;
export type Room = (el: HTMLElement) => Cleanup | void | Promise<Cleanup | void>;
export const ALMANAC_FACE = `<svg viewBox="0 0 44 44" aria-hidden="true"><rect x="7" y="5" width="30" height="35" rx="3" fill="#ffc62b"/><rect x="11" y="5" width="3" height="35" fill="#ff8a3d"/><circle cx="25" cy="18" r="6.5" fill="none" stroke="#23194f" stroke-width="2"/><path d="M25 8.5v3M25 24.5v3M15.5 18h3M31.5 18h3" stroke="#23194f" stroke-width="2"/><path d="M18 32h13" stroke="#23194f" stroke-width="2"/></svg>`;
export function timeAgo(ms: number) { const m = Math.round((Date.now() - ms) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; }
export const until = (ms: number) => { const m = Math.max(0, Math.round((ms - Date.now()) / 60000)); return m < 60 ? `${m} minutes` : m < 2880 ? `${Math.round(m / 60)} hours` : `${Math.round(m / 1440)} days`; };
