import { describe, expect, it } from 'vitest';
import { isTicketFormat } from '../core/ticketUrl.js';
import { createHandoffService, HandoffError, memoryStore, renderManifest, type HandoffServiceOptions } from './index.js';

const MINUTE = 60_000;

function setup(overrides: Partial<HandoffServiceOptions> = {}) {
  let time = 1_000_000;
  const store = memoryStore();
  const service = createHandoffService({ store, now: () => time, ...overrides });
  return {
    store,
    service,
    advance(ms: number) {
      time += ms;
    },
  };
}

describe('createHandoffService', () => {
  it('発行した引換券を照会し、受け取る', async () => {
    const { service } = setup();
    const { ticket, expiresAt } = await service.issue('A', 'escape', '{"fav":[1]}');
    expect(isTicketFormat(ticket)).toBe(true);
    expect(expiresAt).toBe(1_000_000 + 5 * MINUTE);

    expect(await service.peek(ticket)).toEqual({ status: 'valid', subjectId: 'A' });
    expect(await service.redeem(ticket)).toEqual({ subjectId: 'A', payload: '{"fav":[1]}' });
    // 2回目は使えない。照会では主体が分かる。
    expect(await service.redeem(ticket)).toEqual({ error: 'used' });
    expect(await service.peek(ticket)).toEqual({ status: 'used', subjectId: 'A' });
  });

  it('引換券そのものは保存しない', async () => {
    const { service, store } = setup();
    const { ticket } = await service.issue('A', 'escape');
    expect(await store.get(ticket)).toBeNull();
  });

  it('期限が切れたら使えない', async () => {
    const { service, advance } = setup();
    const { ticket } = await service.issue('A', 'escape');
    advance(5 * MINUTE);
    expect(await service.peek(ticket)).toEqual({ status: 'expired', subjectId: 'A' });
    expect(await service.redeem(ticket)).toEqual({ error: 'expired' });
  });

  it('home-screen の既定の期限は 30日', async () => {
    const { service, advance } = setup();
    const { ticket } = await service.issue('A', 'home-screen');
    advance(29 * 24 * 60 * MINUTE);
    expect((await service.peek(ticket)).status).toBe('valid');
    advance(24 * 60 * MINUTE);
    expect((await service.peek(ticket)).status).toBe('expired');
  });

  it('期限を変えられる', async () => {
    const { service, advance } = setup({ ttlMs: { escape: MINUTE } });
    const { ticket } = await service.issue('A', 'escape');
    advance(MINUTE);
    expect((await service.peek(ticket)).status).toBe('expired');
  });

  it('escape は新しく発行すると古い引換券が無効になる', async () => {
    const { service, advance } = setup();
    const first = await service.issue('A', 'escape');
    advance(1);
    const second = await service.issue('A', 'escape');
    expect((await service.peek(first.ticket)).status).toBe('expired');
    expect((await service.peek(second.ticket)).status).toBe('valid');
  });

  it('home-screen は新しい順に5枚まで残す', async () => {
    const { service, advance } = setup();
    const tickets: string[] = [];
    for (let i = 0; i < 6; i++) {
      tickets.push((await service.issue('A', 'home-screen')).ticket);
      advance(1);
    }
    const statuses = await Promise.all(tickets.map(async (t) => (await service.peek(t)).status));
    expect(statuses).toEqual(['expired', 'valid', 'valid', 'valid', 'valid', 'valid']);
  });

  it('用途や主体が違えば、ほかの引換券に触らない', async () => {
    const { service, advance } = setup();
    const home = await service.issue('A', 'home-screen');
    const other = await service.issue('B', 'escape');
    advance(1);
    await service.issue('A', 'escape');
    expect((await service.peek(home.ticket)).status).toBe('valid');
    expect((await service.peek(other.ticket)).status).toBe('valid');
  });

  it('移せない主体', async () => {
    let transferable = true;
    const { service } = setup({ isTransferable: async () => transferable });
    const { ticket } = await service.issue('A', 'escape');

    transferable = false; // 発行後に元がログインした
    expect(await service.peek(ticket)).toEqual({ status: 'not-transferable', subjectId: 'A' });
    expect(await service.redeem(ticket)).toEqual({ error: 'not-transferable' });
    await expect(service.issue('A', 'escape')).rejects.toThrow(HandoffError);
  });

  it('知らない引換券・形式の違う引換券', async () => {
    const { service } = setup();
    expect(await service.peek('AAAAAAAAAAAAAAAAAAAAAA')).toEqual({ status: 'unknown' });
    expect(await service.peek('not a ticket')).toEqual({ status: 'unknown' });
    expect(await service.redeem('not a ticket')).toEqual({ error: 'unknown' });
  });

  it('payload は 2KB まで', async () => {
    const { service } = setup();
    await expect(service.issue('A', 'escape', 'x'.repeat(2048))).resolves.toBeDefined();
    await expect(service.issue('A', 'escape', 'x'.repeat(2049))).rejects.toMatchObject({ code: 'payload-too-large' });
  });

  it('discard すると使えなくなる', async () => {
    const { service } = setup();
    const { ticket } = await service.issue('A', 'escape');
    await service.discard(ticket);
    expect(await service.redeem(ticket)).toEqual({ error: 'used' });
  });

  it('同時に受け取っても、受け取れるのは1回だけ', async () => {
    const { service } = setup();
    const { ticket } = await service.issue('A', 'escape');
    const results = await Promise.all([service.redeem(ticket), service.redeem(ticket)]);
    expect(results.filter((r) => 'subjectId' in r)).toHaveLength(1);
    expect(results.filter((r) => 'error' in r)).toEqual([{ error: 'used' }]);
  });
});

describe('renderManifest', () => {
  it('start_url を替え、id は元の start_url にする', () => {
    const base = { name: 'Game', start_url: '/play', display: 'standalone' };
    expect(renderManifest(base, '/play?handoff=T')).toEqual({
      name: 'Game',
      id: '/play',
      start_url: '/play?handoff=T',
      display: 'standalone',
    });
  });

  it('元に id があれば変えない', () => {
    expect(renderManifest({ id: 'game', start_url: '/' }, '/?handoff=T').id).toBe('game');
  });

  it('start_url も id も無ければ id は "/"', () => {
    expect(renderManifest({ name: 'Game' }, '/?handoff=T').id).toBe('/');
  });
});
