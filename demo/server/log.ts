// デモの記録を KV に置く（POST /api/log）。開発者が `npm run logs` で読む。
// 読む入口は作らない（KV を直接読むので、記録は外から見えない）。
import { json } from './http.js';
import type { KVLike } from './kvStore.js';

const MAX_ENTRIES = 50;
const MAX_TEXT = 2000;
const KEEP_S = 14 * 24 * 60 * 60;

interface Entry {
  at: number;
  where: string;
  text: string;
}

export async function saveLog(kv: KVLike | undefined, body: Record<string, unknown>): Promise<Response> {
  if (!kv) return json({ error: 'no-store' }, 503);
  const { device, ua, entries } = body;
  if (typeof device !== 'string' || !/^[0-9a-f]{6,16}$/.test(device)) return json({ error: 'bad-request' }, 400);
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ENTRIES) return json({ error: 'bad-request' }, 400);
  const clean: Entry[] = [];
  for (const e of entries as unknown[]) {
    const { at, where, text } = (e ?? {}) as Record<string, unknown>;
    if (typeof at !== 'number' || typeof where !== 'string' || typeof text !== 'string') return json({ error: 'bad-request' }, 400);
    clean.push({ at, where: where.slice(0, 64), text: text.slice(0, MAX_TEXT) });
  }
  // キーは時刻順に並ぶようにする（list は名前順に返る）。
  const first = clean[0]!.at;
  const key = `log:${String(first).padStart(13, '0')}:${device}:${crypto.randomUUID().slice(0, 8)}`;
  await kv.put(key, JSON.stringify({ device, ua: typeof ua === 'string' ? ua.slice(0, 400) : '', entries: clean }), {
    expirationTtl: KEEP_S,
  });
  return json({});
}
