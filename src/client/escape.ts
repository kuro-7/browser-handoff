import type { EscapePlan } from '../core/escape.js';

export const DEFAULT_GRACE_MS = 2500;

// タイマーがこれ以上遅れたら、ページが止まっていた（外のアプリに切り替わった）とみなす。
// Meta の WebView は visibilitychange を確実に出さないため。
const TICK_MS = 250;
const STALL_MS = 900;

export interface EscapeOptions {
  /** 合図を待つ時間。既定 2,500ms。 */
  graceMs?: number;
  /** 移り方。既定は `location.href` への代入。テストや特殊な開き方のため。 */
  navigate?: (href: string) => void;
}

/**
 * 外のブラウザを開く（経路 A1・A4）。クリックの処理の中で呼ぶこと
 * （Instagram の extbrowser は、タップ以外からの遷移を無視する）。
 *
 * 開けたら 'opened'、猶予のうちに合図が来なければ 'fallback'。
 * 結果待ちの間に何かを表示するかはホストが決める。
 */
export function escapeToBrowser(plan: EscapePlan, opts: EscapeOptions = {}): Promise<'opened' | 'fallback'> {
  const { step } = plan;
  if (step.kind === 'none') return Promise.resolve('fallback');

  const graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
  const navigate =
    opts.navigate ??
    ((href: string) => {
      window.location.href = href;
    });

  return new Promise((resolve) => {
    let settled = false;
    let lastTick = Date.now();
    const stalled = () => Date.now() - lastTick >= STALL_MS;

    const finish = (result: 'opened' | 'fallback') => {
      if (settled) return;
      settled = true;
      window.clearInterval(ticker);
      window.clearTimeout(deadline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('blur', onLeave);
      resolve(result);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') finish('opened');
    };
    const onLeave = () => finish('opened');

    const ticker = window.setInterval(() => {
      if (stalled()) finish('opened');
      lastTick = Date.now();
    }, TICK_MS);
    // ページが止まっている間に期限を過ぎると、戻ったときに期限の処理が先に走ることがある。そのときも遅れを見る。
    const deadline = window.setTimeout(() => finish(stalled() ? 'opened' : 'fallback'), graceMs);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('blur', onLeave);

    navigate(step.href);
  });
}
