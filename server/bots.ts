/**
 * Community bots. Discord posts through a channel webhook; Telegram answers commands in a group.
 * Set DISCORD_WEBHOOK_URL and TELEGRAM_BOT_TOKEN to turn each one on. Neither is required.
 */
import { roundAt } from '../shared/chain';
import { all } from './db';

const DISCORD = process.env.DISCORD_WEBHOOK_URL;
const TELEGRAM = process.env.TELEGRAM_BOT_TOKEN;
const SITE = process.env.PUBLIC_SITE_URL ?? '';
const chats = new Set<number>();

export async function announce(text: string) {
  const tasks: Promise<unknown>[] = [];
  if (DISCORD) tasks.push(fetch(DISCORD, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }) }));
  if (TELEGRAM) for (const chat of chats) tasks.push(tg('sendMessage', { chat_id: chat, text }));
  await Promise.allSettled(tasks);
}

const TELEGRAM_BASE = process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org';
const tg = (method: string, body: unknown) => fetch(`${TELEGRAM_BASE}/bot${TELEGRAM}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(40_000) });

type Deps = { world: { awake: boolean; fresh: boolean; status: any }; raid: () => any; forecast: () => any };

export function reply(command: string, deps: Deps): string | null {
  const s = deps.world.status?.measurement;
  switch (command) {
    case '/sky': {
      if (!deps.world.status) return 'Still reading the wheel. Ask again in a moment.';
      if (!deps.world.fresh) return 'No signal from the wheel right now. Could be a nap, could be a loose wire.';
      return deps.world.awake ? `Day. He is running at ${(s.rpmMilli / 1000).toFixed(0)} rpm. ${(s.distanceMm / 1e6).toFixed(2)} km so far today.` : `Night. He is resting. ${(s.distanceMm / 1e6).toFixed(2)} km so far today.`;
    }
    case '/raid': {
      const r = deps.raid();
      if (!r.ready) return 'Still reading this week\'s distance. Ask again in a moment.';
      const left = Math.max(0, r.hpKm - r.doneKm);
      return r.defeated ? `${r.boss} is down this week. He did it in ${r.doneKm.toFixed(1)} km.` : `${r.boss}: ${left.toFixed(1)} km of ${r.hpKm} left. Only real distance hurts it.`;
    }
    case '/almanac': {
      const f = deps.forecast();
      if (!f) return 'The Almanac is still reading.';
      return `Round ${roundAt(Date.now() / 1000)}. The Almanac calls ${f.kind} at round ${f.pick}, about ${Math.round(f.expectedRounds * 10)} minutes out.`;
    }
    case '/top': {
      const top = all<{ name: string; score: number }>('SELECT p.name AS name, MAX(r.score) AS score FROM runs r JOIN players p ON p.id = r.player GROUP BY r.player ORDER BY score DESC LIMIT 5');
      return top.length ? top.map((t, i) => `${i + 1}. ${t.name} ${t.score.toLocaleString('en-US')}`).join('\n') : 'Nobody has held a shift yet.';
    }
    case '/start':
    case '/help':
      return `Commands: /sky /raid /almanac /top${SITE ? `\nPlay: ${SITE}` : ''}`;
    default:
      return null;
  }
}

export function startBots(deps: Deps) {
  if (!TELEGRAM) return;
  let offset = 0;
  const poll = async () => {
    try {
      const res = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      const body = await res.json() as { result?: { update_id: number; message?: { chat: { id: number }; text?: string } }[] };
      for (const update of body.result ?? []) {
        offset = update.update_id + 1;
        const message = update.message;
        if (!message?.text?.startsWith('/')) continue;
        chats.add(message.chat.id);
        const answer = reply(message.text.split(/[ @]/)[0], deps);
        if (answer) await tg('sendMessage', { chat_id: message.chat.id, text: answer });
      }
    } catch (e) { console.error('[telegram]', (e as Error).message); await new Promise((r) => setTimeout(r, 5000)); }
    void poll();
  };
  void poll();
}
