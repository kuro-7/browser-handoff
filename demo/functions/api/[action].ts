// 引換券の API（デモ用）。GeoCutter なら 7章の `/api/handoff/*` に当たる。
// デモなので認証は無い。主体の ID は端末が送ってきたものをそのまま信じる。
import { createHandoffService, HandoffError, type Purpose } from '../../../src/server/index.js';
import { json, type Context } from '../../server/http.js';
import { storeFor } from '../../server/kvStore.js';

const PURPOSES: readonly Purpose[] = ['escape', 'home-screen'];

export async function onRequestPost({ request, env, params }: Context): Promise<Response> {
  const service = createHandoffService({ store: storeFor(env.HANDOFF_KV) });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'bad-request' }, 400);
  }
  const ticket = typeof body.ticket === 'string' ? body.ticket : '';

  try {
    switch (params.action) {
      case 'issue': {
        const { subjectId, purpose, payload } = body;
        if (typeof subjectId !== 'string' || subjectId.length === 0 || subjectId.length > 64) {
          return json({ error: 'bad-request' }, 400);
        }
        if (!PURPOSES.includes(purpose as Purpose)) return json({ error: 'bad-request' }, 400);
        if (payload !== undefined && typeof payload !== 'string') return json({ error: 'bad-request' }, 400);
        return json(await service.issue(subjectId, purpose as Purpose, payload));
      }
      case 'peek':
        return json(await service.peek(ticket));
      case 'redeem':
        return json(await service.redeem(ticket));
      case 'discard':
        await service.discard(ticket);
        return json({});
      default:
        return json({ error: 'not-found' }, 404);
    }
  } catch (e) {
    if (e instanceof HandoffError) return json({ error: e.code }, 409);
    throw e;
  }
}
