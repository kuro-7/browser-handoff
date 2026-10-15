import { LINE_EXTERNAL_PARAM } from '../core/escape.js';
import { DEFAULT_TICKET_PARAM, withTicket, withoutTicket } from '../core/ticketUrl.js';

/**
 * アプリのメニューから開いても届くように、今のページの URL に引換券を付ける（経路 A2・A5）。
 * 券の漏れを減らすため、メニューの案内を出すときだけ呼ぶ。
 */
export function putTicketInAddressBar(ticket: string, param: string = DEFAULT_TICKET_PARAM): void {
  history.replaceState(history.state, '', withTicket(location.href, ticket, param));
}

/**
 * 今のページの URL から引換券を消す。ボタン1つで開けたとき、受け取ったとき、捨てたときに呼ぶ。
 * LINE で開き直すときに付けた `openExternalBrowser=1` も一緒に消す。
 */
export function clearTicketFromAddressBar(param: string = DEFAULT_TICKET_PARAM): void {
  const url = new URL(withoutTicket(location.href, param));
  url.searchParams.delete(LINE_EXTERNAL_PARAM);
  const next = url.href;
  if (next !== location.href) history.replaceState(history.state, '', next);
}
