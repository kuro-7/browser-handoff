import type { BrowserContext, InAppName, Platform, StorageRelation } from './types.js';

export interface ContextEnv {
  userAgent: string;
  /** iOS の `navigator.standalone`。 */
  standalone?: boolean;
  /** `matchMedia('(display-mode: standalone)').matches`。 */
  displayModeStandalone?: boolean;
  /** `navigator.maxTouchPoints`。デスクトップ表示の iPad（UA が Mac と同じ）を見分けるのに使う。 */
  maxTouchPoints?: number;
}

// 上から順に照らす。Threads・Instagram は Facebook の印（FBAN など）も持つことがあるので先に置く。
const IN_APP_PATTERNS: ReadonlyArray<readonly [InAppName, RegExp]> = [
  ['threads', /\bBarcelona\b/i],
  ['instagram', /\bInstagram\b/i],
  ['facebook', /\b(FBAN|FBAV|FBIOS|FB4A|FB_IAB)\b/],
  ['line', /\bLine\/\d/i],
  ['x', /\bTwitter\b|TwitterAndroid/i],
  ['tiktok', /\b(musical_ly|BytedanceWebview|TikTok|trill)\b/i],
  ['telegram', /\bTelegram\b/i],
  ['whatsapp', /\bWhatsApp\b/i],
  ['linkedin', /\bLinkedInApp\b/i],
];

function detectPlatform(env: ContextEnv): Platform {
  const ua = env.userAgent;
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return 'ios';
  // iPadOS の既定の UA は Mac と同じ。タッチ点の数で見分ける。
  if (/\bMacintosh\b/.test(ua) && (env.maxTouchPoints ?? 0) > 1) return 'ios';
  if (/\bAndroid\b/.test(ua)) return 'android';
  if (/\b(Windows NT|Macintosh|CrOS|X11|Linux)\b/.test(ua)) return 'desktop';
  return 'other';
}

function detectInApp(ua: string, platform: Platform): InAppName | null {
  for (const [name, pattern] of IN_APP_PATTERNS) {
    if (pattern.test(ua)) return name;
  }
  // 名前の分からない WebView。
  // Android は WebView の印 `; wv)` がある。iOS の WKWebView は `Safari/` の印が無い。
  if (platform === 'android' && /;\s*wv\)/.test(ua)) return 'other';
  if (platform === 'ios' && /\bAppleWebKit\b/.test(ua) && /\bMobile\//.test(ua) && !/\bSafari\//.test(ua)) {
    return 'other';
  }
  // Google アプリ（iOS）は Safari の印を持つが、保存領域が別。
  if (platform === 'ios' && /\bGSA\//.test(ua)) return 'other';
  return null;
}

function isMacSafari(ua: string): boolean {
  return (
    /\bMacintosh\b/.test(ua) &&
    /\bVersion\/[\d.]+.*\bSafari\//.test(ua) &&
    !/\b(Chrome|Chromium|CriOS|Edg|EdgiOS|Firefox|FxiOS|OPR)\//.test(ua)
  );
}

/**
 * 今いる場所を判定する。
 *
 * Android の Custom Tabs 型のアプリ内ブラウザは UA が Chrome と同じなので `browser` になる。
 * Custom Tabs は Chrome と保存領域が同じなので、それで正しい（経路 A3: 何もしない）。
 */
export function detectContext(env: ContextEnv): BrowserContext {
  const ua = env.userAgent;
  const platform = detectPlatform(env);

  if (env.standalone === true || env.displayModeStandalone === true) {
    // ホーム画面アプリの中。storage にはブラウザとの関係を入れる。
    return { platform, kind: 'standalone', storage: browserToHomeScreen(platform, ua) };
  }

  const app = detectInApp(ua, platform);
  if (app !== null) {
    // アプリ内ブラウザ（WebView・SFSafariViewController）は、通常のブラウザと保存領域が別。
    return { platform, kind: 'in-app', app, storage: platform === 'other' ? 'unknown' : 'separate' };
  }

  // 通常のブラウザ。移る先はホーム画面アプリ。
  return { platform, kind: 'browser', storage: browserToHomeScreen(platform, ua) };
}

/** ブラウザとホーム画面アプリの保存領域が同じか。iOS と Mac の Safari は別。 */
function browserToHomeScreen(platform: Platform, ua: string): StorageRelation {
  switch (platform) {
    case 'ios':
      return 'separate';
    case 'android':
      return 'shared';
    case 'desktop':
      return isMacSafari(ua) ? 'separate' : 'shared';
    case 'other':
      return 'unknown';
  }
}
