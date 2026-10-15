// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EscapePlan } from '../core/escape.js';
import type { TicketLookup } from '../core/types.js';
import {
  clearTicketFromAddressBar,
  escapeToBrowser,
  overrideManifest,
  reloadWithTicket,
  settleTicket,
  startRedemption,
  type RedemptionHost,
} from './index.js';

const TICKET = 'AAAAAAAAAAAAAAAAAAAAAA';

const plan: EscapePlan = {
  step: { kind: 'navigate', href: 'x-safari-https://example.com/' },
  fallback: { kind: 'menu', app: 'x', platform: 'ios', menu: null },
};

describe('escapeToBrowser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('移る先へ移り、合図が来なければ fallback', async () => {
    const navigate = vi.fn();
    const result = escapeToBrowser(plan, { navigate });
    expect(navigate).toHaveBeenCalledWith('x-safari-https://example.com/');
    await vi.advanceTimersByTimeAsync(2500);
    await expect(result).resolves.toBe('fallback');
  });

  it.each(['pagehide', 'blur'])('%s が来たら opened', async (event) => {
    const result = escapeToBrowser(plan, { navigate: () => window.dispatchEvent(new Event(event)) });
    await expect(result).resolves.toBe('opened');
  });

  it('visibilitychange（hidden）が来たら opened', async () => {
    const result = escapeToBrowser(plan, { navigate: () => {} });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await expect(result).resolves.toBe('opened');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('タイマーが大きく遅れたら opened（ページが止まっていた）', async () => {
    const result = escapeToBrowser(plan, { navigate: () => {} });
    await vi.advanceTimersByTimeAsync(250);
    vi.setSystemTime(Date.now() + 1500); // タイマーが動かないまま時間だけ進む
    await vi.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toBe('opened');
  });

  it('計画に待つ時間があれば、それだけ待つ', async () => {
    const result = escapeToBrowser({ ...plan, graceMs: 10_000 }, { navigate: () => {} });
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(2500);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(7500);
    await expect(result).resolves.toBe('fallback');
  });

  it('自動で開く手段が無ければ、すぐ fallback', async () => {
    const navigate = vi.fn();
    await expect(escapeToBrowser({ ...plan, step: { kind: 'none' } }, { navigate })).resolves.toBe('fallback');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('決着したら、あとの合図を聞かない', async () => {
    const result = escapeToBrowser(plan, { navigate: () => {}, graceMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe('fallback');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('address bar', () => {
  beforeEach(() => {
    history.replaceState(null, '', 'https://example.com/play?x=1');
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('引換券付きの URL で読み込み直す', () => {
    const navigate = vi.fn();
    reloadWithTicket(TICKET, { navigate });
    expect(navigate).toHaveBeenCalledWith(`https://example.com/play?x=1&handoff=${TICKET}`);
  });

  it('URL から引換券を消す', () => {
    history.replaceState(null, '', `https://example.com/play?x=1&handoff=${TICKET}`);
    clearTicketFromAddressBar();
    expect(location.href).toBe('https://example.com/play?x=1');
  });

  it('LINE の openExternalBrowser も一緒に消す', () => {
    history.replaceState(null, '', `https://example.com/play?x=1&handoff=${TICKET}&openExternalBrowser=1`);
    clearTicketFromAddressBar();
    expect(location.href).toBe('https://example.com/play?x=1');
  });
});

describe('overrideManifest', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('既にある link を差し替えて、戻す', () => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest">';
    const restore = overrideManifest(`/manifest.webmanifest?handoff=${TICKET}`);
    const link = document.querySelector('link[rel="manifest"]');
    expect(link?.getAttribute('href')).toBe(`/manifest.webmanifest?handoff=${TICKET}`);
    restore();
    expect(link?.getAttribute('href')).toBe('/manifest.webmanifest');
  });

  it('link が無ければ作って、戻すときに消す', () => {
    const restore = overrideManifest('/m.json');
    expect(document.querySelectorAll('link[rel="manifest"]')).toHaveLength(1);
    restore();
    expect(document.querySelectorAll('link[rel="manifest"]')).toHaveLength(0);
  });
});

describe('startRedemption / settleTicket', () => {
  function fakeHost(opts: {
    device?: { id: string; hasRecords: boolean } | null;
    lookup?: TicketLookup;
  }) {
    const notified = new Set<string>();
    const host = {
      deviceSubject: vi.fn(async () => opts.device ?? null),
      peek: vi.fn(async () => opts.lookup ?? { status: 'valid' as const, subjectId: 'A' }),
      redeem: vi.fn(async () => ({ token: 'credential-for-A' })),
      discard: vi.fn(async () => {}),
      wasNotified: (t: string) => notified.has(t),
      markNotified: (t: string) => {
        notified.add(t);
      },
    } satisfies RedemptionHost<{ token: string }>;
    return { host, notified };
  }

  beforeEach(() => {
    history.replaceState(null, '', `https://example.com/play?handoff=${TICKET}`);
  });

  it('メニューのために読み込み直したページでは、受け取らずに券を残す', async () => {
    reloadWithTicket(TICKET, { navigate: (href) => history.replaceState(null, '', href) });
    const { host } = fakeHost({});
    expect(await startRedemption(host)).toEqual({ ticket: TICKET, decision: { action: 'noop' }, escapePending: true });
    expect(host.peek).not.toHaveBeenCalled();
    expect(location.href).toContain('handoff=');
    // ボタン1つで開けたなどで URL から消したら、印も消える。
    clearTicketFromAddressBar();
    history.replaceState(null, '', `https://example.com/play?handoff=${TICKET}`);
    expect((await startRedemption(host))?.escapePending).toBeUndefined();
  });

  it('引換券が無ければ null', async () => {
    history.replaceState(null, '', 'https://example.com/play');
    const { host } = fakeHost({});
    expect(await startRedemption(host)).toBeNull();
    expect(host.peek).not.toHaveBeenCalled();
  });

  it('adopt → take で資格情報を受け取る', async () => {
    const { host, notified } = fakeHost({});
    const started = await startRedemption(host);
    expect(started).toEqual({ ticket: TICKET, decision: { action: 'adopt' } });
    // 受け取るまでは URL に残す（読み込み直しても続けられるように）。
    expect(location.href).toContain('handoff=');

    const settled = await settleTicket(host, TICKET, 'take');
    expect(settled).toEqual({ result: 'taken', credential: { token: 'credential-for-A' } });
    expect(notified.has(TICKET)).toBe(true);
    expect(location.href).toBe('https://example.com/play');
  });

  it('choose → keep で引換券を捨てる', async () => {
    const { host } = fakeHost({ device: { id: 'B', hasRecords: true } });
    const started = await startRedemption(host);
    expect(started?.decision).toEqual({ action: 'choose', deviceSubjectId: 'B', ticketSubjectId: 'A' });

    expect(await settleTicket(host, TICKET, 'keep')).toEqual({ result: 'kept' });
    expect(host.discard).toHaveBeenCalledWith(TICKET);
    expect(host.redeem).not.toHaveBeenCalled();
    expect(location.href).toBe('https://example.com/play');
  });

  it('notify は1回だけ。2回目は照会もせずに noop', async () => {
    const { host } = fakeHost({ lookup: { status: 'expired', subjectId: 'A' } });
    expect((await startRedemption(host))?.decision).toEqual({ action: 'notify', reason: 'expired' });
    expect(location.href).toBe('https://example.com/play');

    history.replaceState(null, '', `https://example.com/play?handoff=${TICKET}`);
    expect((await startRedemption(host))?.decision).toEqual({ action: 'noop' });
    expect(host.peek).toHaveBeenCalledTimes(1);
  });

  it('受け取ったあとにアイコンから開くと noop', async () => {
    const { host } = fakeHost({});
    await startRedemption(host);
    await settleTicket(host, TICKET, 'take');

    history.replaceState(null, '', `https://example.com/play?handoff=${TICKET}`);
    expect((await startRedemption(host))?.decision).toEqual({ action: 'noop' });
  });

  it('discard が無くても keep できる', async () => {
    const { host } = fakeHost({ device: { id: 'B', hasRecords: true } });
    const { discard: _discard, ...withoutDiscard } = host;
    expect(await settleTicket(withoutDiscard, TICKET, 'keep')).toEqual({ result: 'kept' });
    expect(withoutDiscard.wasNotified(TICKET)).toBe(true);
  });
});
