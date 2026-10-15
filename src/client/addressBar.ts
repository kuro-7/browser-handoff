import { LINE_EXTERNAL_PARAM } from '../core/escape.js';
import { DEFAULT_TICKET_PARAM, withTicket, withoutTicket } from '../core/ticketUrl.js';

// メニューの案内のために読み込み直した引換券。sessionStorage はタブごと・保存領域ごとなので、
// メニューから開いた先（別の保存領域）には渡らない。
const PENDING_KEY = 'browser-handoff:escape-pending';

export interface ReloadWithTicketOptions {
  /** URL のパラメータ名。既定 'handoff'。 */
  param?: string;
  /** 移り方。既定は `location.replace`（戻るボタンで券の無いページに戻らないように）。テストのため。 */
  navigate?: (href: string) => void;
}

/**
 * アプリのメニューから開いても届くように、引換券付きの URL でページを読み込み直す（経路 A2・A5）。
 * 券の漏れを減らすため、メニューの案内を出すときだけ呼ぶ。
 *
 * アプリのメニューは、今の URL ではなく最初に読み込んだ URL を渡すことがある（Android の LINE 26.15.1 で確認）。
 * そのため `history.replaceState` で URL を書き換えるだけでは届かない。
 *
 * 読み込み直すと画面の状態は消える。読み込み直したあとの `startRedemption` は、この券を消さずに
 * `escapePending: true` を返すので、ホストはそれを見てメニューの案内をもう一度出す。
 */
export function reloadWithTicket(ticket: string, opts: ReloadWithTicketOptions = {}): void {
  const param = opts.param ?? DEFAULT_TICKET_PARAM;
  try {
    sessionStorage.setItem(PENDING_KEY, ticket);
  } catch {
    // 使えなければ、読み込み直したあとは普通の受け取りになる（同じ主体なので noop）。
  }
  const href = withTicket(location.href, ticket, param);
  const navigate =
    opts.navigate ??
    ((h: string) => {
      location.replace(h);
    });
  navigate(href);
}

/** この券が、メニューの案内のために読み込み直したものか。 */
export function isEscapePending(ticket: string): boolean {
  try {
    return sessionStorage.getItem(PENDING_KEY) === ticket;
  } catch {
    return false;
  }
}

function forgetEscapePending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // 何もしない。
  }
}

/**
 * 今のページの URL から引換券を消す。ボタン1つで開けたとき、受け取ったとき、捨てたときに呼ぶ。
 * LINE で開き直すときに付けた `openExternalBrowser=1` も一緒に消す。
 * メニューの案内のために読み込み直した印も消す。
 */
export function clearTicketFromAddressBar(param: string = DEFAULT_TICKET_PARAM): void {
  forgetEscapePending();
  const url = new URL(withoutTicket(location.href, param));
  url.searchParams.delete(LINE_EXTERNAL_PARAM);
  const next = url.href;
  if (next !== location.href) history.replaceState(history.state, '', next);
}
