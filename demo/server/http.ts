import type { KVLike } from './kvStore.js';

export interface Env {
  /** 引換券の保存先。wrangler.toml か `--kv HANDOFF_KV` で結び付ける。 */
  HANDOFF_KV?: KVLike;
}

/** Pages Functions の context のうち、ここで使う分だけ。 */
export interface Context {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}

const COMMON_HEADERS = {
  'Cache-Control': 'no-store',
  // URL に乗せた引換券が Referer で漏れないように（設計書 6章「券の漏れ」）。
  'Referrer-Policy': 'no-referrer',
};

export function json(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...COMMON_HEADERS, 'Content-Type': `${contentType}; charset=utf-8` },
  });
}
