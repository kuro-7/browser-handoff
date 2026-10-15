export const DEFAULT_TICKET_PARAM = 'handoff';

// 引換券は 128 ビットの乱数を base64url にしたもの（22 文字）。
const TICKET_FORMAT = /^[A-Za-z0-9_-]{22}$/;

export function isTicketFormat(value: string): boolean {
  return TICKET_FORMAT.test(value);
}

/** URL に引換券を付ける。`url` は絶対 URL。 */
export function withTicket(url: string, ticket: string, param: string = DEFAULT_TICKET_PARAM): string {
  const u = new URL(url);
  u.searchParams.set(param, ticket);
  return u.href;
}

/** URL から引換券を読む。無いか、形式が違えば null。 */
export function readTicket(url: string, param: string = DEFAULT_TICKET_PARAM): string | null {
  const value = new URL(url).searchParams.get(param);
  return value !== null && isTicketFormat(value) ? value : null;
}

/** URL から引換券を外す。 */
export function withoutTicket(url: string, param: string = DEFAULT_TICKET_PARAM): string {
  const u = new URL(url);
  u.searchParams.delete(param);
  return u.href;
}
