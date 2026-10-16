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

/** ボタン1つで開けなかったときの代わり。 */
export type EscapeFallback =
  /**
   * アプリのメニューから開いてもらう。ホストは `reloadWithTicket` で券付きの URL に読み込み直してから案内する。
   */
  | {
      kind: 'menu';
      app: InAppName;
      platform: Platform;
      /** 分からない、またはメニューが無いときは null。 */
      menu: MenuHint | null;
    }
  /**
   * メニューでは券が届かない（最初に開いたリンクの URL を渡すアプリ）。
   * もう一度ボタンを押して、アプリが出す確認で進んでもらう。読み込み直さなくてよい。
   */
  | { kind: 'retry'; app: InAppName; platform: Platform };

/**
 * 開く先のブラウザ。`default` は OS のふだん使いのブラウザ（Android の intent://、アプリが既定のブラウザに渡す方法）。
 * iOS ではふだん使いのブラウザを Chrome にしていても、`x-safari-https://` は Safari を開く。
 */
export type EscapeBrowser = 'default' | 'safari' | 'chrome';

export interface EscapePlan {
  step: EscapeStep;
  /** `step` で開くブラウザ。`step.kind === 'none'` のときは無い。 */
  browser?: EscapeBrowser;
  /**
   * `step` の代わりに選べる開き方（iOS の「Chrome で開く」など）。ホストは利用者に選んでもらうボタンを出してよい。
   * iOS の Chrome は Safari と保存領域が別なので、Chrome をふだん使いにしている人は Safari に移しても、
   * あとで Chrome で開くとまた最初からになる。iOS からは、ふだん使いのブラウザも Chrome が入っているかも分からない。
   * 入っていない Chrome を選ぶと、何も起きずに合図が来ないので、ふつうの「ボタンでは開けなかった」になる。
   */
  alternatives?: Partial<Record<Exclude<EscapeBrowser, 'default'>, EscapeStep>>;
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
// メニューが最初に開いたリンクの URL を渡すので、券が届かないアプリ（2026-10-16 確認）。
// Android の Instagram は「⋮」→「Chrome で開く」が、読み込み直したあとでも最初のリンクを渡す。
function menuDropsTicket(platform: Platform, app: InAppName): boolean {
  return platform === 'android' && app === 'instagram';
}

export function planEscape(context: BrowserContext, targetUrl: string): EscapePlan {
  const app = context.app ?? 'other';
  const fallback: EscapeFallback = menuDropsTicket(context.platform, app)
    ? { kind: 'retry', app, platform: context.platform }
    : { kind: 'menu', app, platform: context.platform, menu: MENU_HINTS[context.platform]?.[app] ?? null };
  if (context.kind !== 'in-app') return { step: { kind: 'none' }, fallback };
  const target = new URL(targetUrl);
  const { step, browser } = escapeStep(context.platform, app, target);
  const plan: EscapePlan = { step, fallback };
  if (step.kind === 'navigate') plan.browser = browser;
  if (step.kind === 'navigate' && context.platform === 'android' && app === 'instagram') plan.graceMs = CONFIRM_GRACE_MS;
  // iOS は Chrome でも開けるようにする（要確認: アプリ内ブラウザから googlechromes:// へ移れるか）。
  if (context.platform === 'ios') plan.alternatives = { chrome: chromeStep(target) };
  return plan;
}

/** iOS の Chrome で開く（https は googlechromes://、http は googlechrome://）。 */
function chromeStep(target: URL): EscapeStep {
  const scheme = target.protocol === 'http:' ? 'googlechrome' : 'googlechromes';
  return { kind: 'navigate', href: `${scheme}://${target.href.slice(target.protocol.length + 2)}` };
}

/** LINE が外のブラウザで開き直す合図のパラメータ。開いた先では要らないので、引換券と一緒に消す。 */
export const LINE_EXTERNAL_PARAM = 'openExternalBrowser';

function escapeStep(platform: Platform, app: InAppName, target: URL): { step: EscapeStep; browser: EscapeBrowser } {
  // LINE は iOS・Android とも、このパラメータで外のブラウザに開き直す（どのブラウザかは LINE が決める。要確認）。
  if (app === 'line') {
    const url = new URL(target);
    url.searchParams.set(LINE_EXTERNAL_PARAM, '1');
    return { step: { kind: 'navigate', href: url.href }, browser: 'default' };
  }

  if (platform === 'ios') {
    // extbrowser がどのブラウザを開くか（ふだん使いか Safari か）は要確認。
    if (app === 'instagram') {
      return { step: { kind: 'navigate', href: `instagram://extbrowser/?url=${encodeURIComponent(target.href)}` }, browser: 'default' };
    }
    if (app === 'threads') {
      return { step: { kind: 'navigate', href: `barcelona://extbrowser/?url=${encodeURIComponent(target.href)}` }, browser: 'default' };
    }
    // それ以外は Safari のスキーム。http（開発中）なら x-safari-http。
    return { step: { kind: 'navigate', href: `x-safari-${target.href}` }, browser: 'safari' };
  }

  if (platform === 'android') {
    // X の WebView は intent:// も googlechrome:// も開けない（2026-10-16 確認）。
    // intent:// では X が「このアクションを実行できるアプリはありません」を出して利用者を不安にさせるので、メニューに任せる。
    if (app === 'x') return { step: { kind: 'none' }, browser: 'default' };
    // 既定のブラウザで開く。
    const scheme = target.protocol.replace(/:$/, '');
    const rest = target.href.slice(target.protocol.length + 2); // "//" の後ろ
    return { step: { kind: 'navigate', href: `intent://${rest}#Intent;scheme=${scheme};end` }, browser: 'default' };
  }

  return { step: { kind: 'none' }, browser: 'default' };
}
