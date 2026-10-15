// ホーム画面アプリの manifest（経路 B1）。`?handoff=` があれば start_url に引換券を入れて返す。
import { readTicket, withTicket } from '../../src/core/index.js';
import { renderManifest } from '../../src/server/index.js';
import { json, type Context } from '../server/http.js';
import { BASE_MANIFEST } from '../server/manifest.js';

export async function onRequestGet({ request }: Context): Promise<Response> {
  const url = new URL(request.url);
  const ticket = readTicket(url.href);
  const manifest =
    ticket === null
      ? BASE_MANIFEST
      : renderManifest(BASE_MANIFEST, withTicket(new URL(BASE_MANIFEST.start_url ?? '/', url).href, ticket));
  return json(manifest, 200, 'application/manifest+json');
}
