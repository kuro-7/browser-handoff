import type { TicketLookup, TicketStatus } from './types.js';

export interface RedemptionInput {
  /** 移った先にある主体の ID。無ければ null。 */
  deviceSubjectId: string | null;
  /** 移った先の主体に記録があるか（ホストが判定する）。 */
  deviceHasRecords: boolean;
  ticket: TicketLookup;
  /** この引換券について、もう知らせたか・決着したか（端末に控える）。 */
  notifiedBefore: boolean;
}

export type NotifyReason = Exclude<TicketStatus, 'valid'>;

export type RedemptionDecision =
  | { action: 'noop' }
  | { action: 'notify'; reason: NotifyReason }
  | { action: 'adopt' }
  /** 両方に記録がある。ホストが2つの概要を調べて並べ、利用者に選んでもらう。 */
  | { action: 'choose'; deviceSubjectId: string; ticketSubjectId: string };

/** 受け取りの分岐（設計書 図2）。 */
export function decideRedemption(input: RedemptionInput): RedemptionDecision {
  const { deviceSubjectId, deviceHasRecords, ticket, notifiedBefore } = input;

  // D1: もう同じ主体がいる（受け取り済み、または同じ保存領域）。
  if (ticket.subjectId !== undefined && deviceSubjectId === ticket.subjectId) return { action: 'noop' };

  // ホーム画面アプリはアイコンを押すたびに同じ引換券付きの URL で開く。2回目からは黙る。
  if (notifiedBefore) return { action: 'noop' };

  // D2: 引換券は有効か。
  if (ticket.status !== 'valid') return { action: 'notify', reason: ticket.status };
  if (ticket.subjectId === undefined) return { action: 'notify', reason: 'unknown' };

  // D3: 移った先に記録があるか。
  if (deviceSubjectId === null || !deviceHasRecords) return { action: 'adopt' };
  return { action: 'choose', deviceSubjectId, ticketSubjectId: ticket.subjectId };
}
