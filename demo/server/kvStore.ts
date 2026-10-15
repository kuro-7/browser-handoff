import type { Purpose } from '../../src/core/index.js';
import { memoryStore, type HandoffStore, type TicketRecord } from '../../src/server/index.js';

/** Workers KV のうち、ここで使う分だけ。 */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

// 期限が切れても少し残す。古い引換券で開いたときに `expired` と主体が分かるように（図2の D1）。
const KEEP_AFTER_EXPIRY_S = 7 * 24 * 60 * 60;

/**
 * KV に置く保存先。デモ用。
 * KV には条件付きの書き込みが無いので、`consume` は原子的ではない（同時に2回受け取ると両方通ることがある）。
 * 本番ではホストが原子的な保存先（GeoCutter なら Supabase の条件付き UPDATE）を使う。
 */
export function kvStore(kv: KVLike): HandoffStore {
  const ticketKey = (hash: string) => `t:${hash}`;
  const subjectKey = (subjectId: string, purpose: Purpose) => `s:${purpose}:${subjectId}`;

  async function read(hash: string): Promise<TicketRecord | null> {
    const raw = await kv.get(ticketKey(hash));
    return raw === null ? null : (JSON.parse(raw) as TicketRecord);
  }

  async function write(record: TicketRecord): Promise<void> {
    const ttl = Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000) + KEEP_AFTER_EXPIRY_S);
    await kv.put(ticketKey(record.ticketHash), JSON.stringify(record), { expirationTtl: ttl });
  }

  return {
    async put(record) {
      await write(record);
      // 主体ごとの引換券の一覧（revokeBySubject のため）。
      const key = subjectKey(record.subjectId, record.purpose);
      const hashes = JSON.parse((await kv.get(key)) ?? '[]') as string[];
      hashes.push(record.ticketHash);
      await kv.put(key, JSON.stringify(hashes.slice(-20)), { expirationTtl: 40 * 24 * 60 * 60 });
    },
    get: read,
    async consume(ticketHash, now) {
      const record = await read(ticketHash);
      if (!record || record.usedAt !== null || record.expiresAt <= now) return null;
      record.usedAt = now;
      await write(record);
      return record;
    },
    async revokeBySubject(subjectId, purpose, keepLatest, now) {
      const hashes = JSON.parse((await kv.get(subjectKey(subjectId, purpose))) ?? '[]') as string[];
      const records = await Promise.all(hashes.map(read));
      const live = records
        .filter((r): r is TicketRecord => r !== null && r.usedAt === null && r.expiresAt > now)
        .sort((a, b) => b.issuedAt - a.issuedAt);
      await Promise.all(live.slice(keepLatest).map((r) => write({ ...r, expiresAt: now })));
    },
  };
}

let fallback: HandoffStore | undefined;

/** KV が結び付いていなければメモリに置く（ローカルで試すとき用。本番では isolate ごとに別れるので使わない）。 */
export function storeFor(kv: KVLike | undefined): HandoffStore {
  if (kv) return kvStore(kv);
  fallback ??= memoryStore();
  return fallback;
}
