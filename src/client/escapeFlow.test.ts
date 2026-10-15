// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, TicketStatus } from '../core/types.js';
import { createEscapeFlow, startRedemption, type EscapeFlow, type EscapeFlowHost, type EscapeState } from './index.js';

const T1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const T2 = 'BBBBBBBBBBBBBBBBBBBBBB';

const line: BrowserContext = { platform: 'android', kind: 'in-app', app: 'line', storage: 'separate' };
const instagram: BrowserContext = { platform: 'android', kind: 'in-app', app: 'instagram', storage: 'separate' };
const x: BrowserContext = { platform: 'android', kind: 'in-app', app: 'x', storage: 'separate' };

function setVisible(visible: boolean) {
  Object.defineProperty(document, 'visibilityState', { value: visible ? 'visible' : 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function fakeHost(statuses: TicketStatus[] = []) {
  const tickets = [T1, T2];
  const host: EscapeFlowHost & { issued: number; peeks: number } = {
    issued: 0,
    peeks: 0,
    async issue() {
      const ticket = tickets[host.issued % tickets.length]!;
      host.issued += 1;
      return { ticket, expiresAt: Date.now() + 5 * 60_000 };
    },
    async peek() {
      host.peeks += 1;
      return { status: statuses.shift() ?? 'valid' };
    },
  };
  return host;
}

let flow: EscapeFlow | null = null;

describe('createEscapeFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    history.replaceState(null, '', 'https://example.com/play');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  afterEach(() => {
    flow?.dispose();
    flow = null;
    vi.useRealTimers();
  });

  it('押す前に券を用意する', async () => {
    const host = fakeHost();
    flow = createEscapeFlow(host, { context: line, navigate: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(host.issued).toBe(1);
    expect(flow.ticket?.ticket).toBe(T1);
    expect(flow.state).toEqual({ kind: 'idle' });
    expect(flow.plan.step).toEqual({
      kind: 'navigate',
      href: `https://example.com/play?handoff=${T1}&openExternalBrowser=1`,
    });
  });

  it('開いて、戻ってきたら照会し、使用済みなら届いた。届いたあとは券を用意しない', async () => {
    const host = fakeHost(['valid', 'used']);
    const states: EscapeState['kind'][] = [];
    flow = createEscapeFlow(host, { context: line, onChange: (s) => states.push(s.kind), navigate: () => setVisible(false) });
    await vi.advanceTimersByTimeAsync(0);
    await flow.press();
    expect(flow.state.kind).toBe('checking');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(host.peeks).toBe(0); // 裏にいる間は聞かない
    setVisible(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(host.peeks).toBe(2);
    expect(flow.state).toEqual({ kind: 'arrived' });
    expect(states).toEqual(['idle', 'opening', 'checking', 'arrived']);
    expect(flow.ticket).toBeNull();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(host.issued).toBe(1);
  });

  it('届いたあとにまた押されたら、券を用意して開く', async () => {
    const host = fakeHost(['used']);
    const navigate = vi.fn(() => setVisible(false));
    flow = createEscapeFlow(host, { context: line, navigate });
    await vi.advanceTimersByTimeAsync(0);
    await flow.press();
    setVisible(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flow.state.kind).toBe('arrived');
    await flow.press();
    expect(host.issued).toBe(2);
    expect(navigate).toHaveBeenLastCalledWith(`https://example.com/play?handoff=${T2}&openExternalBrowser=1`);
  });

  it('裏にいる間は券を発行しない。表に出たら用意する', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const host = fakeHost();
    flow = createEscapeFlow(host, { context: line, navigate: () => {} });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(host.issued).toBe(0);
    setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.issued).toBe(1);
  });

  it('戻っても使われないまま照会を終えたら、メニューの案内。読み込み直すのはホストが prepareMenu を呼んだとき', async () => {
    const host = fakeHost();
    const navigate = vi.fn((href: string) => {
      if (href.includes('openExternalBrowser')) setVisible(false);
    });
    flow = createEscapeFlow(host, { context: line, navigate });
    await vi.advanceTimersByTimeAsync(0);
    await flow.press();
    setVisible(true);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(host.peeks).toBe(3);
    expect(flow.state).toMatchObject({ kind: 'menu', reason: 'not-arrived', reloaded: false });
    expect(navigate).toHaveBeenCalledTimes(1); // 勝手には読み込み直さない
    await vi.advanceTimersByTimeAsync(60_000);
    expect(host.issued).toBe(1); // 届く途中の券は作り直さない
    await flow.prepareMenu();
    expect(navigate).toHaveBeenLastCalledWith(`https://example.com/play?handoff=${T1}`);
  });

  it('裏と表を行き来しても、照会は1回押すごとに上限まで', async () => {
    const host = fakeHost();
    flow = createEscapeFlow(host, { context: line, navigate: () => setVisible(false) });
    await vi.advanceTimersByTimeAsync(0);
    await flow.press();
    for (let i = 0; i < 5; i += 1) {
      setVisible(true);
      await vi.advanceTimersByTimeAsync(3_500);
      setVisible(false);
    }
    setVisible(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(host.peeks).toBe(6);
  });

  it('メニューでは届かないアプリは、読み込み直さずにもう一度押してもらう', async () => {
    const host = fakeHost();
    const navigate = vi.fn();
    flow = createEscapeFlow(host, { context: instagram, navigate });
    await vi.advanceTimersByTimeAsync(0);
    const pressing = flow.press();
    await vi.advanceTimersByTimeAsync(10_000);
    await pressing;
    expect(flow.state).toMatchObject({ kind: 'retry', reason: 'button-failed' });
    expect(navigate).toHaveBeenCalledTimes(1); // intent:// だけ
  });

  it('自動で開く手段が無いアプリは、押すとすぐメニューの案内（読み込み直す）', async () => {
    const host = fakeHost();
    const navigate = vi.fn();
    flow = createEscapeFlow(host, { context: x, navigate });
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.plan.step.kind).toBe('none');
    await flow.press();
    expect(flow.state).toMatchObject({ kind: 'menu', reason: 'no-button', reloaded: false });
    expect(navigate).toHaveBeenCalledWith(`https://example.com/play?handoff=${T1}`);
  });

  it('読み込み直したあとは、同じ券と理由のままメニューの案内から始まる', async () => {
    const host = fakeHost();
    const navigate = vi.fn((href: string) => history.replaceState(null, '', href));
    flow = createEscapeFlow(host, { context: x, owner: 'u1', navigate });
    await vi.advanceTimersByTimeAsync(0);
    await flow.press();
    flow.dispose();

    const started = await startRedemption({
      deviceSubject: async () => ({ id: 'u1', hasRecords: true }),
      peek: async () => ({ status: 'valid', subjectId: 'u1' }),
      redeem: async () => null,
      wasNotified: () => false,
      markNotified: () => {},
    });
    expect(started?.escapePending).toBe(true);
    const first = vi.fn();
    flow = createEscapeFlow(host, { context: x, owner: 'u1', resume: started!.ticket, navigate, onChange: first });
    expect(flow.state).toMatchObject({ kind: 'menu', reason: 'no-button', reloaded: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toHaveBeenCalledWith(flow.state); // 最初の状態も onChange で届く
    expect(flow.ticket?.ticket).toBe(T1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(host.issued).toBe(1);
  });

  it('保存した券の持ち主が違えば使わない', async () => {
    const host = fakeHost();
    flow = createEscapeFlow(host, { context: line, owner: 'u1', navigate: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    flow.dispose();
    flow = createEscapeFlow(host, { context: line, owner: 'u1', navigate: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(host.issued).toBe(1);
    flow.dispose();
    flow = createEscapeFlow(host, { context: line, owner: 'u2', navigate: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(host.issued).toBe(2);
  });

  it('期限が近づいたら、押される前に作り直す', async () => {
    const host = fakeHost();
    flow = createEscapeFlow(host, { context: line, navigate: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 10_000);
    expect(host.issued).toBe(2);
    expect(flow.ticket?.ticket).toBe(T2);
  });

  it('券を発行できなければ、押したときに issue-failed', async () => {
    const host: EscapeFlowHost = {
      issue: () => Promise.reject(new Error('down')),
      peek: async () => ({ status: 'valid' }),
    };
    flow = createEscapeFlow(host, { context: line, navigate: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    await flow.press();
    expect(flow.state.kind).toBe('issue-failed');
  });
});

describe('createEscapeFlow の subscribe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  afterEach(() => {
    flow?.dispose();
    flow = null;
    vi.useRealTimers();
  });

  it('状態が変わったときだけ別のオブジェクトになり、止めたら呼ばれない', async () => {
    const host = fakeHost();
    flow = createEscapeFlow(host, { context: x, navigate: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    const before = flow.getState();
    expect(flow.getState()).toBe(before);
    const seen: string[] = [];
    const off = flow.subscribe((s) => seen.push(s.kind));
    await flow.press();
    expect(flow.getState()).not.toBe(before);
    expect(seen).toEqual(['menu']);
    off();
    await flow.press();
    expect(seen).toEqual(['menu']);
  });
});
