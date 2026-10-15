// Web Crypto だけを使う（Workers・Node・Deno で動く）。

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 128 ビットの乱数を base64url にする（22 文字）。 */
export function newTicket(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashTicket(ticket: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticket));
  return toBase64Url(new Uint8Array(digest));
}
