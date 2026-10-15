import type { BrowserContext, InAppName, Platform } from './types.js';

export type EscapeStep =
  /** この URL へ移ると外のブラウザが開く（`x-safari-https://`、`intent://` など）。 */
  | { kind: 'navigate'; href: string }
  /** 自動で開く手段が無い。 */
  | { kind: 'none' };

/**
 * アプリの「ブラウザで開く」メニューの場所。文言や図はホストが決める。
 * - opener: `share` は共有ボタン、`more` は「⋯」「⋮」のボタン
 * - item: `open-in-browser` は「Safari で開く」「（外部・デフォルトの）ブラウザで開く」、`open-in-other-app` は「他のアプリで開く」
 */
export interface MenuHint {
  opener: 'share' | 'more';
  item: 'open-in-browser' | 'open-in-other-app';
}

export interface EscapeFallback {
  kind: 'menu';
  app: InAppName;
  platform: Platform;
  /** 分からない、またはメニューが無いときは null。 */
  menu: MenuHint | null;
}

export interface EscapePlan {
  step: EscapeStep;
  fallback: EscapeFallback;
  /**
   * 開けたかの合図を待つ時間の目安（ms）。無ければ escapeToBrowser の既定。
   * 開く前にアプリが確認を出すとき、利用者が押すまで合図が来ないので長めにする。
   */
  graceMs?: number;
}

// Android の Instagram は intent:// の前に「アプリから退出しようとしています」を出し、
// 「次へ」を押すまで合図が来ない（2026-10-16 確認。2.5 秒では押す前に fallback になった）。
const CONFIRM_GRACE_MS = 10_000;

// 設計書 4章「アプリのメニュー」の表。実機で確かめたものは日付と版を書く。
const MENU_HINTS: Partial<Record<Platform, Partial<Record<InAppName, MenuHint>>>> = {
  ios: {
    line: { opener: 'share', item: 'open-in-browser' },
    x: { opener: 'share', item: 'open-in-browser' },
    instagram: { opener: 'more', item: 'open-in-browser' },
    threads: { opener: 'more', item: 'open-in-browser' },
    facebook: { opener: 'more', item: 'open-in-browser' },
  },
  android: {
    // 2026-10-16 LINE 26.15.1 で確認:「⋮」→「デフォルトのブラウザで開く」。
    line: { opener: 'more', item: 'open-in-browser' },
    x: { opener: 'more', item: 'open-in-browser' },
    instagram: { opener: 'more', item: 'open-in-browser' },
    threads: { opener: 'more', item: 'open-in-browser' },
    facebook: { opener: 'more', item: 'open-in-browser' },
  },
};

/** 外のブラウザの開き方を決める。実行は client の `escapeToBrowser`。 */
export function planEscape(context: BrowserContext, targetUrl: string): EscapePlan {
  const app = context.app ?? 'other';
  const fallback: EscapeFallback = {
    kind: 'menu',
    app,
    platform: context.platform,
    menu: MENU_HINTS[context.platform]?.[app] ?? null,
  };
  if (context.kind !== 'in-app') return { step: { kind: 'none' }, fallback };
  const step = escapeStep(context.platform, app, new URL(targetUrl));
  if (step.kind === 'navigate' && context.platform === 'android' && app === 'instagram') {
    return { step, fallback, graceMs: CONFIRM_GRACE_MS };
  }
  return { step, fallback };
}

/** LINE が外のブラウザで開き直す合図のパラメータ。開いた先では要らないので、引換券と一緒に消す。 */
export const LINE_EXTERNAL_PARAM = 'openExternalBrowser';

function escapeStep(platform: Platform, app: InAppName, target: URL): EscapeStep {
  // LINE は iOS・Android とも、このパラメータで外のブラウザに開き直す。
  if (app === 'line') {
    const url = new URL(target);
    url.searchParams.set(LINE_EXTERNAL_PARAM, '1');
    return { kind: 'navigate', href: url.href };
  }

  if (platform === 'ios') {
    if (app === 'instagram') return { kind: 'navigate', href: `instagram://extbrowser/?url=${encodeURIComponent(target.href)}` };
    if (app === 'threads') return { kind: 'navigate', href: `barcelona://extbrowser/?url=${encodeURIComponent(target.href)}` };
    // それ以外は Safari のスキーム。http（開発中）なら x-safari-http。
    return { kind: 'navigate', href: `x-safari-${target.href}` };
  }

  if (platform === 'android') {
    // X の WebView は intent:// も googlechrome:// も開けない（2026-10-16 確認）。
    // intent:// では X が「このアクションを実行できるアプリはありません」を出して利用者を不安にさせるので、メニューに任せる。
    if (app === 'x') return { kind: 'none' };
    // 既定のブラウザで開く。
    const scheme = target.protocol.replace(/:$/, '');
    const rest = target.href.slice(target.protocol.length + 2); // "//" の後ろ
    return { kind: 'navigate', href: `intent://${rest}#Intent;scheme=${scheme};end` };
  }

  return { kind: 'none' };
}
