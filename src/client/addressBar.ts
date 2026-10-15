import { DEFAULT_TICKET_PARAM, withTicket, withoutTicket } from '../core/ticketUrl.js';

/**
 * アプリのメニューから開いても届くように、今のページの URL に引換券を付ける（経路 A2・A5）。
 * 券の漏れを減らすため、メニューの案内を出すときだけ呼ぶ。
 */
export function putTicketInAddressBar(ticket: string, param: string = DEFAULT_TICKET_PARAM): void {
  history.replaceState(history.state, '', withTicket(location.href, ticket, param));
}

/** 今のページの URL から引換券を消す。ボタン1つで開けたとき、受け取ったとき、捨てたときに呼ぶ。 */
export function clearTicketFromAddressBar(param: string = DEFAULT_TICKET_PARAM): void {
  const next = withoutTicket(location.href, param);
  if (next !== location.href) history.replaceState(history.state, '', next);
}
