import { decideRedemption, type RedemptionDecision } from '../core/redemption.js';
import { DEFAULT_TICKET_PARAM, readTicket } from '../core/ticketUrl.js';
import type { TicketLookup } from '../core/types.js';
import { clearTicketFromAddressBar, isEscapePending } from './addressBar.js';

/** 受け取りの流れでキットが呼ぶ、ホストの関数。 */
export interface RedemptionHost<Credential> {
  /** 移った先（この端末）の主体。無ければ null。 */
  deviceSubject(): Promise<{ id: string; hasRecords: boolean } | null>;
  /** ホストの API を呼び、引換券を照会する。 */
  peek(ticket: string): Promise<TicketLookup>;
  /** ホストの API を呼び、資格情報を受け取って保存する。キットは中身を見ない。 */
  redeem(ticket: string): Promise<Credential>;
  /** ホストの API を呼び、引換券を使用済みにする。無ければ端末に「知らせ済み」と控えるだけ。 */
  discard?(ticket: string): Promise<void>;
  /** この引換券について、もう知らせたか・決着したか（端末に控えたもの）。 */
  wasNotified(ticket: string): boolean;
  markNotified(ticket: string): void;
}

export interface TicketParamOptions {
  /** URL のパラメータ名。既定 'handoff'。 */
  param?: string;
}

export interface StartRedemptionOptions extends TicketParamOptions {
  /** 既定は今のページの URL。 */
  url?: string;
}

export interface StartRedemptionResult {
  ticket: string;
  decision: RedemptionDecision;
  /**
   * この券は、このページが `reloadWithTicket` で付けたもの（メニューの案内のために読み込み直した）。
   * 受け取りはせず（decision は noop）、URL の券も消さない。ホストはメニューの案内をもう一度出す。
   */
  escapePending?: true;
}

/**
 * 起動時に呼ぶ。URL に引換券が無ければ null。
 * `adopt`・`choose` のときは、続けて `settleTicket` を呼ぶ（choose は利用者が選んだあと）。
 */
export async function startRedemption<C>(
  host: RedemptionHost<C>,
  opts: StartRedemptionOptions = {},
): Promise<StartRedemptionResult | null> {
  const param = opts.param ?? DEFAULT_TICKET_PARAM;
  const ticket = readTicket(opts.url ?? location.href, param);
  if (ticket === null) return null;
  // メニューから開いてもらうために、このページ自身が付けた券。消すとメニューから届かなくなる。
  if (isEscapePending(ticket)) return { ticket, decision: { action: 'noop' }, escapePending: true };

  // ホーム画面アプリはアイコンを押すたびに同じ引換券で開く。決着済みなら照会もしない。
  if (host.wasNotified(ticket)) {
    clearTicketFromAddressBar(param);
    return { ticket, decision: { action: 'noop' } };
  }

  const [device, lookup] = await Promise.all([host.deviceSubject(), host.peek(ticket)]);
  const decision = decideRedemption({
    deviceSubjectId: device?.id ?? null,
    deviceHasRecords: device?.hasRecords ?? false,
    ticket: lookup,
    notifiedBefore: false,
  });

  if (decision.action === 'notify') host.markNotified(ticket);
  if (decision.action === 'noop' || decision.action === 'notify') clearTicketFromAddressBar(param);
  return { ticket, decision };
}

/**
 * `adopt` のとき（'take'）、または `choose` で利用者が選んだあとに呼ぶ。
 * 'take' は host.redeem、'keep' は host.discard を呼び、どちらも決着済みと控えて URL から引換券を消す。
 */
export function settleTicket<C>(
  host: RedemptionHost<C>,
  ticket: string,
  choice: 'take',
  opts?: TicketParamOptions,
): Promise<{ result: 'taken'; credential: C }>;
export function settleTicket<C>(
  host: RedemptionHost<C>,
  ticket: string,
  choice: 'keep',
  opts?: TicketParamOptions,
): Promise<{ result: 'kept' }>;
export async function settleTicket<C>(
  host: RedemptionHost<C>,
  ticket: string,
  choice: 'take' | 'keep',
  opts: TicketParamOptions = {},
): Promise<{ result: 'taken'; credential: C } | { result: 'kept' }> {
  const param = opts.param ?? DEFAULT_TICKET_PARAM;
  if (choice === 'take') {
    const credential = await host.redeem(ticket);
    host.markNotified(ticket);
    clearTicketFromAddressBar(param);
    return { result: 'taken', credential };
  }
  await host.discard?.(ticket);
  host.markNotified(ticket);
  clearTicketFromAddressBar(param);
  return { result: 'kept' };
}
