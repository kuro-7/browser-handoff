import type { Purpose } from '../core/types.js';

export interface TicketRecord {
  /** 引換券の SHA-256（base64url）。引換券そのものは保存しない。 */
  ticketHash: string;
  subjectId: string;
  purpose: Purpose;
  issuedAt: number;
  expiresAt: number;
  usedAt: number | null;
  /** ホストが一緒に運ぶ小さなデータ。上限 2KB。 */
  payload: string | null;
}

/** 引換券の保存先。ホストが実装する（GeoCutter なら Supabase の表）。 */
export interface HandoffStore {
  put(record: TicketRecord): Promise<void>;
  get(ticketHash: string): Promise<TicketRecord | null>;
  /**
   * 未使用で期限内なら使用済み（usedAt = now）にして返す。そうでなければ null。
   * 原子的に行うこと（同じ引換券で2回呼ぶと、2回目は null）。
   */
  consume(ticketHash: string, now: number): Promise<TicketRecord | null>;
  /**
   * その主体・用途の未使用の引換券のうち、新しい順に `keepLatest` 枚を残し、残りを期限切れにする（expiresAt = now）。
   */
  revokeBySubject(subjectId: string, purpose: Purpose, keepLatest: number, now: number): Promise<void>;
}

/** テスト・試作用。プロセスのメモリに置く。 */
export function memoryStore(): HandoffStore {
  const records = new Map<string, TicketRecord>();
  return {
    async put(record) {
      records.set(record.ticketHash, { ...record });
    },
    async get(ticketHash) {
      const record = records.get(ticketHash);
      return record ? { ...record } : null;
    },
    async consume(ticketHash, now) {
      const record = records.get(ticketHash);
      if (!record || record.usedAt !== null || record.expiresAt <= now) return null;
      record.usedAt = now;
      return { ...record };
    },
    async revokeBySubject(subjectId, purpose, keepLatest, now) {
      const live = [...records.values()]
        .filter((r) => r.subjectId === subjectId && r.purpose === purpose && r.usedAt === null && r.expiresAt > now)
        .sort((a, b) => b.issuedAt - a.issuedAt);
      for (const record of live.slice(keepLatest)) record.expiresAt = now;
    },
  };
}
