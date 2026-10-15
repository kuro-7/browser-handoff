import type { BrowserContext, InAppName, Platform } from './types.js';

export type EscapeStep =
  /** この URL へ移ると外のブラウザが開く（`x-safari-https://`、`intent://` など）。 */
  | { kind: 'navigate'; href: string }
  /** 自動で開く手段が無い。 */
  | { kind: 'none' };

/**
 * アプリの「ブラウザで開く」メニューの場所。文言や図はホストが決める。
 * - opener: `share` は共有ボタン、`more` は「⋯」「⋮」のボタン
 * - item: `open-in-browser` は「Safari で開く」「（外部）ブラウザで開く」、`open-in-other-app` は「他のアプリで開く」
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
}

// 設計書 4章「アプリのメニュー」の表。まだ実機で確かめていない。
const MENU_HINTS: Partial<Record<Platform, Partial<Record<InAppName, MenuHint>>>> = {
  ios: {
    line: { opener: 'share', item: 'open-in-browser' },
    x: { opener: 'share', item: 'open-in-browser' },
    instagram: { opener: 'more', item: 'open-in-browser' },
    threads: { opener: 'more', item: 'open-in-browser' },
    facebook: { opener: 'more', item: 'open-in-browser' },
  },
  android: {
    line: { opener: 'more', item: 'open-in-other-app' },
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
  return { step: escapeStep(context.platform, app, new URL(targetUrl)), fallback };
}

function escapeStep(platform: Platform, app: InAppName, target: URL): EscapeStep {
  // LINE は iOS・Android とも、このパラメータで外のブラウザに開き直す。
  if (app === 'line') {
    const url = new URL(target);
    url.searchParams.set('openExternalBrowser', '1');
    return { kind: 'navigate', href: url.href };
  }

  if (platform === 'ios') {
    if (app === 'instagram') return { kind: 'navigate', href: `instagram://extbrowser/?url=${encodeURIComponent(target.href)}` };
    if (app === 'threads') return { kind: 'navigate', href: `barcelona://extbrowser/?url=${encodeURIComponent(target.href)}` };
    // それ以外は Safari のスキーム。http（開発中）なら x-safari-http。
    return { kind: 'navigate', href: `x-safari-${target.href}` };
  }

  if (platform === 'android') {
    // 既定のブラウザで開く。
    const scheme = target.protocol.replace(/:$/, '');
    const rest = target.href.slice(target.protocol.length + 2); // "//" の後ろ
    return { kind: 'navigate', href: `intent://${rest}#Intent;scheme=${scheme};end` };
  }

  return { kind: 'none' };
}
