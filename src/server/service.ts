import type { Purpose, TicketLookup, TicketStatus } from '../core/types.js';
import { isTicketFormat } from '../core/ticketUrl.js';
import { hashTicket, newTicket } from './crypto.js';
import type { HandoffStore, TicketRecord } from './store.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const DEFAULT_TTL_MS: Readonly<Record<Purpose, number>> = {
  escape: 5 * MINUTE,
  'home-screen': 30 * DAY,
};

// 同じ主体・同じ用途で残す未使用の引換券の数（設計書 6章）。
// home-screen は、追加の手順を何度か出したあとで、前に追加したアイコンを開いても届くように残す。
const KEEP_LATEST: Readonly<Record<Purpose, number>> = {
  escape: 1,
  'home-screen': 5,
};

export const MAX_PAYLOAD_BYTES = 2048;

export type HandoffErrorCode = 'not-transferable' | 'payload-too-large';

export class HandoffError extends Error {
  readonly code: HandoffErrorCode;
  constructor(code: HandoffErrorCode) {
    super(code);
    this.name = 'HandoffError';
    this.code = code;
  }
}

export interface HandoffServiceOptions {
  store: HandoffStore;
  ttlMs?: Partial<Record<Purpose, number>>;
  /** 移してよい主体か（例: 発行後に元がログインしたら false）。発行・照会・受け取りのときに呼ぶ。 */
  isTransferable?: (subjectId: string) => Promise<boolean>;
  now?: () => number;
}

export type RedeemResult =
  | { subjectId: string; payload: string | null }
  | { error: Exclude<TicketStatus, 'valid'> };

export interface HandoffService {
  /** 引換券を発行する。移せない主体なら HandoffError('not-transferable')。 */
  issue(subjectId: string, purpose: Purpose, payload?: string): Promise<{ ticket: string; expiresAt: number }>;
  /** 引換券を照会する。使用済みにはしない。 */
  peek(ticket: string): Promise<TicketLookup>;
  /** 引換券を使用済みにして、主体を返す。 */
  redeem(ticket: string): Promise<RedeemResult>;
  /** 引換券を使用済みにする（「今のまま」を選んだとき）。 */
  discard(ticket: string): Promise<void>;
}

export function createHandoffService(opts: HandoffServiceOptions): HandoffService {
  const { store } = opts;
  const ttlMs = { ...DEFAULT_TTL_MS, ...opts.ttlMs };
  const isTransferable = opts.isTransferable ?? (async () => true);
  const now = opts.now ?? Date.now;

  async function find(ticket: string): Promise<TicketRecord | null> {
    if (!isTicketFormat(ticket)) return null;
    return store.get(await hashTicket(ticket));
  }

  async function statusOf(record: TicketRecord | null, at: number): Promise<TicketStatus> {
    if (record === null) return 'unknown';
    if (record.usedAt !== null) return 'used';
    if (record.expiresAt <= at) return 'expired';
    if (!(await isTransferable(record.subjectId))) return 'not-transferable';
    return 'valid';
  }

  return {
    async issue(subjectId, purpose, payload) {
      if (payload !== undefined && new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES) {
        throw new HandoffError('payload-too-large');
      }
      if (!(await isTransferable(subjectId))) throw new HandoffError('not-transferable');

      const at = now();
      const ticket = newTicket();
      const expiresAt = at + ttlMs[purpose];
      await store.put({
        ticketHash: await hashTicket(ticket),
        subjectId,
        purpose,
        issuedAt: at,
        expiresAt,
        usedAt: null,
        payload: payload ?? null,
      });
      await store.revokeBySubject(subjectId, purpose, KEEP_LATEST[purpose], at);
      return { ticket, expiresAt };
    },

    async peek(ticket) {
      const record = await find(ticket);
      const status = await statusOf(record, now());
      return record ? { status, subjectId: record.subjectId } : { status };
    },

    async redeem(ticket) {
      const record = await find(ticket);
      if (record === null) return { error: 'unknown' };
      const status = await statusOf(record, now());
      if (status !== 'valid') return { error: status };

      const consumed = await store.consume(record.ticketHash, now());
      if (consumed === null) {
        // 照会と受け取りの間に、ほかで使われたか期限が切れた。
        const latest = await store.get(record.ticketHash);
        const after = await statusOf(latest, now());
        return { error: after === 'valid' ? 'used' : after };
      }
      return { subjectId: consumed.subjectId, payload: consumed.payload };
    },

    async discard(ticket) {
      if (!isTicketFormat(ticket)) return;
      await store.consume(await hashTicket(ticket), now());
    },
  };
}
