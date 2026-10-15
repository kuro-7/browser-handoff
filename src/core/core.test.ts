import { describe, expect, it } from 'vitest';
import {
  decideRedemption,
  detectContext,
  planEscape,
  readTicket,
  withTicket,
  withoutTicket,
  type BrowserContext,
  type InAppName,
  type RedemptionInput,
} from './index.js';

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const IOS_SAFARI = `${IOS} Version/18.5 Mobile/15E148 Safari/604.1`;
const IOS_WEBVIEW = `${IOS} Mobile/22F76`;
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

describe('detectContext', () => {
  it.each<[string, string, BrowserContext]>([
    ['iOS Safari', IOS_SAFARI, { platform: 'ios', kind: 'browser', storage: 'separate' }],
    ['iOS Chrome', `${IOS} CriOS/140.0.0.0 Mobile/15E148 Safari/604.1`, { platform: 'ios', kind: 'browser', storage: 'separate' }],
    ['iOS Instagram', `${IOS_WEBVIEW} Instagram 385.0.0.0.0 (iPhone15,2; iOS 18_5; ja_JP)`, { platform: 'ios', kind: 'in-app', app: 'instagram', storage: 'separate' }],
    ['iOS Threads', `${IOS_WEBVIEW} Barcelona 380.0.0.0 Instagram 385.0.0.0.0`, { platform: 'ios', kind: 'in-app', app: 'threads', storage: 'separate' }],
    ['iOS Facebook', `${IOS_WEBVIEW} [FBAN/FBIOS;FBAV/500.0.0.0;FBBV/1]`, { platform: 'ios', kind: 'in-app', app: 'facebook', storage: 'separate' }],
    ['iOS LINE', `${IOS_WEBVIEW} Safari Line/15.10.0`, { platform: 'ios', kind: 'in-app', app: 'line', storage: 'separate' }],
    ['iOS X', `${IOS_WEBVIEW} Twitter for iPhone/10.80`, { platform: 'ios', kind: 'in-app', app: 'x', storage: 'separate' }],
    ['iOS TikTok', `${IOS_WEBVIEW} musical_ly_40.0.0 BytedanceWebview/d8a21c6`, { platform: 'ios', kind: 'in-app', app: 'tiktok', storage: 'separate' }],
    ['iOS 名前の分からない WebView', IOS_WEBVIEW, { platform: 'ios', kind: 'in-app', app: 'other', storage: 'separate' }],
    ['iOS Google アプリ', `${IOS} GSA/380.0 Mobile/15E148 Safari/604.1`, { platform: 'ios', kind: 'in-app', app: 'other', storage: 'separate' }],
    ['Android Chrome（Custom Tabs も同じ）', ANDROID_CHROME, { platform: 'android', kind: 'browser', storage: 'shared' }],
    ['Android 名前の分からない WebView', ANDROID_WEBVIEW, { platform: 'android', kind: 'in-app', app: 'other', storage: 'separate' }],
    ['Android Instagram', `${ANDROID_WEBVIEW} Instagram 385.0.0.0.0 Android`, { platform: 'android', kind: 'in-app', app: 'instagram', storage: 'separate' }],
    ['Android LINE', `${ANDROID_WEBVIEW} Line/15.10.0/IAB`, { platform: 'android', kind: 'in-app', app: 'line', storage: 'separate' }],
    ['Android X', `${ANDROID_WEBVIEW} TwitterAndroid`, { platform: 'android', kind: 'in-app', app: 'x', storage: 'separate' }],
    ['Mac Safari', MAC_SAFARI, { platform: 'desktop', kind: 'browser', storage: 'separate' }],
    ['Mac Chrome', MAC_CHROME, { platform: 'desktop', kind: 'browser', storage: 'shared' }],
    ['Windows Edge', WINDOWS_EDGE, { platform: 'desktop', kind: 'browser', storage: 'shared' }],
  ])('%s', (_label, userAgent, expected) => {
    expect(detectContext({ userAgent })).toEqual(expected);
  });

  it('デスクトップ表示の iPad を iOS とみなす', () => {
    expect(detectContext({ userAgent: MAC_SAFARI, maxTouchPoints: 5 })).toEqual({
      platform: 'ios',
      kind: 'browser',
      storage: 'separate',
    });
  });

  it('ホーム画面アプリの中', () => {
    expect(detectContext({ userAgent: IOS_WEBVIEW, standalone: true })).toEqual({
      platform: 'ios',
      kind: 'standalone',
      storage: 'separate',
    });
    expect(detectContext({ userAgent: ANDROID_CHROME, displayModeStandalone: true })).toEqual({
      platform: 'android',
      kind: 'standalone',
      storage: 'shared',
    });
  });
});

describe('planEscape', () => {
  const target = 'https://example.com/play?level=3';
  const inApp = (platform: 'ios' | 'android', app: InAppName): BrowserContext => ({
    platform,
    kind: 'in-app',
    app,
    storage: 'separate',
  });

  it.each<[InAppName, string]>([
    ['x', 'x-safari-https://example.com/play?level=3'],
    ['whatsapp', 'x-safari-https://example.com/play?level=3'],
    ['telegram', 'x-safari-https://example.com/play?level=3'],
    ['facebook', 'x-safari-https://example.com/play?level=3'],
    ['other', 'x-safari-https://example.com/play?level=3'],
    ['instagram', 'instagram://extbrowser/?url=https%3A%2F%2Fexample.com%2Fplay%3Flevel%3D3'],
    ['threads', 'barcelona://extbrowser/?url=https%3A%2F%2Fexample.com%2Fplay%3Flevel%3D3'],
    ['line', 'https://example.com/play?level=3&openExternalBrowser=1'],
  ])('iOS %s', (app, href) => {
    expect(planEscape(inApp('ios', app), target).step).toEqual({ kind: 'navigate', href });
  });

  it('iOS の http（開発中）は x-safari-http', () => {
    expect(planEscape(inApp('ios', 'x'), 'http://localhost:5173/').step).toEqual({
      kind: 'navigate',
      href: 'x-safari-http://localhost:5173/',
    });
  });

  it('Android Instagram は確認が出るので長めに待つ', () => {
    expect(planEscape(inApp('android', 'instagram'), target).graceMs).toBe(10_000);
    expect(planEscape(inApp('android', 'line'), target).graceMs).toBeUndefined();
  });

  it('Android X は自動で開かない（メニューに任せる）', () => {
    expect(planEscape(inApp('android', 'x'), target).step).toEqual({ kind: 'none' });
  });

  it.each<[InAppName, string]>([
    ['instagram', 'intent://example.com/play?level=3#Intent;scheme=https;end'],
    ['other', 'intent://example.com/play?level=3#Intent;scheme=https;end'],
    ['line', 'https://example.com/play?level=3&openExternalBrowser=1'],
  ])('Android %s', (app, href) => {
    expect(planEscape(inApp('android', app), target).step).toEqual({ kind: 'navigate', href });
  });

  it('メニューの場所のデータを返す', () => {
    expect(planEscape(inApp('ios', 'instagram'), target).fallback).toEqual({
      kind: 'menu',
      app: 'instagram',
      platform: 'ios',
      menu: { opener: 'more', item: 'open-in-browser' },
    });
    expect(planEscape(inApp('android', 'line'), target).fallback.menu).toEqual({
      opener: 'more',
      item: 'open-in-browser',
    });
    expect(planEscape(inApp('ios', 'tiktok'), target).fallback.menu).toBeNull();
  });

  it('アプリ内ブラウザでなければ何もしない', () => {
    const plan = planEscape({ platform: 'ios', kind: 'browser', storage: 'separate' }, target);
    expect(plan.step).toEqual({ kind: 'none' });
  });
});

describe('decideRedemption', () => {
  const base: RedemptionInput = {
    deviceSubjectId: null,
    deviceHasRecords: false,
    ticket: { status: 'valid', subjectId: 'A' },
    notifiedBefore: false,
  };

  it('D1: 端末の主体が引換券と同じなら noop', () => {
    expect(decideRedemption({ ...base, deviceSubjectId: 'A', deviceHasRecords: true })).toEqual({ action: 'noop' });
    // 使用済みでも、同じ主体なら黙る（受け取ったあとにアイコンから開いた）。
    expect(
      decideRedemption({ ...base, deviceSubjectId: 'A', ticket: { status: 'used', subjectId: 'A' } }),
    ).toEqual({ action: 'noop' });
  });

  it.each(['expired', 'used', 'not-transferable', 'unknown'] as const)('D2: %s なら notify', (status) => {
    expect(decideRedemption({ ...base, ticket: { status, subjectId: 'A' } })).toEqual({
      action: 'notify',
      reason: status,
    });
  });

  it('知らせ済みなら黙る', () => {
    expect(decideRedemption({ ...base, ticket: { status: 'expired' }, notifiedBefore: true })).toEqual({
      action: 'noop',
    });
    expect(
      decideRedemption({ ...base, deviceSubjectId: 'B', deviceHasRecords: true, notifiedBefore: true }),
    ).toEqual({ action: 'noop' });
  });

  it('有効なのに主体が分からなければ unknown', () => {
    expect(decideRedemption({ ...base, ticket: { status: 'valid' } })).toEqual({ action: 'notify', reason: 'unknown' });
  });

  it('D3: 移った先に主体が無い・記録が無いなら adopt', () => {
    expect(decideRedemption(base)).toEqual({ action: 'adopt' });
    expect(decideRedemption({ ...base, deviceSubjectId: 'B', deviceHasRecords: false })).toEqual({ action: 'adopt' });
  });

  it('D3: 移った先に記録があれば choose', () => {
    expect(decideRedemption({ ...base, deviceSubjectId: 'B', deviceHasRecords: true })).toEqual({
      action: 'choose',
      deviceSubjectId: 'B',
      ticketSubjectId: 'A',
    });
  });
});

describe('ticket URL', () => {
  const ticket = 'AAAAAAAAAAAAAAAAAAAAAA';

  it('付けて、読んで、外す', () => {
    const url = withTicket('https://example.com/play?x=1#top', ticket);
    expect(url).toBe(`https://example.com/play?x=1&handoff=${ticket}#top`);
    expect(readTicket(url)).toBe(ticket);
    expect(withoutTicket(url)).toBe('https://example.com/play?x=1#top');
  });

  it('形式の違う値は読まない', () => {
    expect(readTicket('https://example.com/?handoff=short')).toBeNull();
    expect(readTicket('https://example.com/')).toBeNull();
  });

  it('パラメータ名を変えられる', () => {
    const url = withTicket('https://example.com/', ticket, 't');
    expect(readTicket(url, 't')).toBe(ticket);
    expect(readTicket(url)).toBeNull();
  });
});
