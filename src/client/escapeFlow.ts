import { planEscape, type EscapeFallback, type EscapePlan } from '../core/escape.js';
import { DEFAULT_TICKET_PARAM, withTicket } from '../core/ticketUrl.js';
import type { BrowserContext, TicketLookup, TicketStatus } from '../core/types.js';
import { clearTicketFromAddressBar, reloadWithTicket } from './addressBar.js';
import { escapeToBrowser } from './escape.js';

/** ホストの発行の API が返すもの（用途は `escape`）。 */
export interface IssuedTicket {
  ticket: string;
  /** ミリ秒の時刻。 */
  expiresAt: number;
}

/** 外のブラウザへ出す流れでキットが呼ぶ、ホストの関数。 */
export interface EscapeFlowHost {
  /** ホストの API を呼び、`escape` の引換券を発行する。 */
  issue(): Promise<IssuedTicket>;
  /** ホストの API を呼び、引換券を照会する（外のブラウザに届いたかを確かめる）。 */
  peek(ticket: string): Promise<TicketLookup>;
}

/** 届かなかった理由。`no-button`: このアプリには自動で開く手段が無い。`button-failed`: ボタンで開けなかった。`not-arrived`: 開いたように見えたが、券が使われていない。 */
export type EscapeMissReason = 'no-button' | 'button-failed' | 'not-arrived';

export type EscapeState =
  /** まだ何もしていない。ボタンを出しておく。 */
  | { kind: 'idle' }
  /** ボタンが押され、外のブラウザを開いている。 */
  | { kind: 'opening' }
  /** 開いたように見えた。戻ってきたら、届いたかを確かめる。 */
  | { kind: 'checking' }
  /** 外のブラウザが受け取った。 */
  | { kind: 'arrived' }
  /**
   * アプリのメニューから開いてもらう。
   * `reloaded: false` のときは、まだ URL に券が無いので、メニューから開いても届かない。ホストは「メニューから開く方法を見る」のような
   * ボタンを出し、押されたら `prepareMenu` を呼ぶ（券付きの URL で読み込み直す）。読み込み直したあとは `resume` で
   * `reloaded: true` から始まるので、そこでメニューの場所を案内する。
   * `no-button`（自動で開く手段が無いアプリでボタンが押された）のときは、押されたのが案内を見るためのボタンなので、すぐ読み込み直す。
   */
  | { kind: 'menu'; fallback: Extract<EscapeFallback, { kind: 'menu' }>; reason: EscapeMissReason; reloaded: boolean }
  /** もう一度ボタンを押してもらう（メニューでは券が届かないアプリ）。 */
  | { kind: 'retry'; fallback: Extract<EscapeFallback, { kind: 'retry' }>; reason: EscapeMissReason }
  /** 届いたか分からない（券が期限切れになった、照会できなかったなど）。もう一度押してもらう。 */
  | { kind: 'unknown'; status: TicketStatus }
  /** 押されたが、券を発行できなかった。 */
  | { kind: 'issue-failed'; error: unknown };

export interface EscapeFlowOptions {
  context: BrowserContext;
  /** 外のブラウザで開くページ（券は付けない）。既定は今のページから query と hash を除いたもの。 */
  targetUrl?: () => string;
  /** URL のパラメータ名。既定 'handoff'。 */
  param?: string;
  /**
   * 券の持ち主（ホストの主体の ID）。保存した券の持ち主と違えば（受け取りで切り替わったなど）、その券は使わない。
   * 持ち主が変わったら、流れを作り直す。
   */
  owner?: string;
  /** `startRedemption` が `escapePending` を返したときの券。渡すと、メニューの案内の状態から始める。 */
  resume?: string;
  /** 開き方を差し替える（試験用）。既定は `planEscape`。 */
  plan?: (context: BrowserContext, target: string) => EscapePlan;
  /** 状態が変わったとき。作った直後にも、最初の状態で1回呼ぶ。`subscribe` と同じ。 */
  onChange?: (state: EscapeState) => void;
  /** 何が起きたかの短い記録（調べもの用）。 */
  onLog?: (message: string) => void;
  /** 移り方（テストのため）。外のブラウザを開くときと、読み込み直すときに使う。 */
  navigate?: (href: string) => void;
}

export interface EscapeFlow {
  readonly state: EscapeState;
  /** 今の状態。`subscribe` と組み合わせて React の `useSyncExternalStore` に渡せる（状態が変わったときだけ別のオブジェクトになる）。 */
  getState(): EscapeState;
  /** 状態が変わったら呼ぶ。止める関数を返す。 */
  subscribe(listener: (state: EscapeState) => void): () => void;
  /** 今の券で開くときの方法。`step.kind === 'none'` なら、ボタンは「開く方法を見る」のような文言にする。 */
  readonly plan: EscapePlan;
  /** 用意してある券（調べもの用）。無ければ null。 */
  readonly ticket: IssuedTicket | null;
  /** ボタンが押されたとき。クリックの処理の中で、待たずに呼ぶこと（Instagram はタップ以外からの移動を無視する）。 */
  press(): Promise<void>;
  /**
   * メニューから開いても届くように、券付きの URL でページを読み込み直す。`menu` で `reloaded: false` のときに、
   * 利用者が案内を見ると決めたら呼ぶ（読み込み直すと画面の状態が消えるので、キットは勝手には呼ばない）。
   */
  prepareMenu(): Promise<void>;
  /** 用意した券を捨てて作り直す（試験用）。開いている途中やメニューの案内の間は何もしない。 */
  renew(): Promise<void>;
  /** タイマーと見張りを止める。 */
  dispose(): void;
}

// 券は押す前に用意し、期限が近づいたら押される前に作り直す（設計書 4章）。
// ただし、ページが表に出ているときだけ。外のブラウザへ移ったあとも、アプリ内ブラウザのタブは裏に残り、
// Android は裏のタイマーも動かすので、そのままでは発行が続く。
const STORE_KEY = 'browser-handoff:escape-ticket';
const MIN_LEFT_MS = 30_000;
const REFRESH_BEFORE_MS = 60_000;
const TIMER_MS = 10_000;
// メニューの案内のため読み込み直したとき、保存した期限が無ければこれだけ使えるとみなす（escape は 5 分）。
const RESUME_LEFT_MS = 4 * 60_000;

/**
 * 戻ってきてから照会する時刻（ms）。合図だけでは、外のブラウザに移ったのか、ほかのアプリに切り替えたのか見分けられないので、
 * 券が使用済みになったか（外のブラウザが受け取ったか）を確かめる。ホストの API の回数制限に響かないよう、回数は決めておく。
 */
export const ARRIVAL_CHECKS_MS: readonly number[] = [1_000, 3_000, 6_000];
// 裏と表を行き来すると見張り直すが、1回押すごとの照会はこれまで。
const MAX_PEEKS = 6;

interface Saved extends IssuedTicket {
  owner: string | null;
  reason?: EscapeMissReason;
}

function readSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function writeSaved(saved: Saved | null): void {
  try {
    if (saved) sessionStorage.setItem(STORE_KEY, JSON.stringify(saved));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    // 使えなければ、読み込み直したあとに券を作り直すだけ。
  }
}

const visible = () => document.visibilityState === 'visible';

/**
 * アプリ内ブラウザから外のブラウザへ出す流れ（経路 A1・A2・A4・A5）。
 * 券の用意と作り直し、ボタンで開く、戻ってからの確かめ、代わりの案内（メニュー・もう一度押す）までを受け持つ。
 * ホストは `state` を見て描き、ボタンのクリックで `press` を呼ぶだけでよい。
 *
 * メニューの案内では、券付きの URL でページを読み込み直す（`prepareMenu`）。読み込み直したあと、`startRedemption` が
 * `escapePending` を返したら、その券を `resume` に渡して流れを作り直す。
 */
export function createEscapeFlow(host: EscapeFlowHost, opts: EscapeFlowOptions): EscapeFlow {
  const param = opts.param ?? DEFAULT_TICKET_PARAM;
  const owner = opts.owner ?? null;
  const log = opts.onLog ?? (() => {});
  const targetUrl = opts.targetUrl ?? (() => location.origin + location.pathname);
  const makePlan = opts.plan ?? planEscape;
  const navigateOpts = opts.navigate ? { navigate: opts.navigate } : {};

  let state: EscapeState = { kind: 'idle' };
  let ticket: IssuedTicket | null = null;
  let preparing: Promise<IssuedTicket> | null = null;
  let disposed = false;
  // 届いたあとは、また押されるまで券を用意しない（もう外のブラウザに移っている）。
  let resting = false;
  let stopArrival: (() => void) | null = null;
  const listeners = new Set<(state: EscapeState) => void>();
  if (opts.onChange) listeners.add(opts.onChange);

  const setState = (next: EscapeState) => {
    state = next;
    listeners.forEach((fn) => fn(next));
  };
  const planFor = (t: string | null) => {
    const target = targetUrl();
    return makePlan(opts.context, t === null ? target : withTicket(target, t, param));
  };
  const left = (t: IssuedTicket) => t.expiresAt - Date.now();
  const keep = (t: IssuedTicket | null, reason?: EscapeMissReason) => {
    ticket = t;
    writeSaved(t && { ...t, owner, ...(reason ? { reason } : {}) });
  };

  const prepare = (): Promise<IssuedTicket> => {
    preparing ??= host
      .issue()
      .then((t) => {
        if (!disposed) {
          keep(t);
          log('券を用意した');
        }
        return t;
      })
      .finally(() => {
        preparing = null;
      });
    return preparing;
  };

  // 届く途中の券（開いている・確かめている・メニューの案内）は作り直さない。escape は新しく発行すると古い券を無効にするので。
  const busy = () => state.kind === 'opening' || state.kind === 'checking' || state.kind === 'menu';
  /** 押される前に券を用意しておく（無い、または期限が近いとき）。表に出ているときだけ。 */
  const keepReady = () => {
    if (disposed || resting || busy() || preparing || !visible()) return;
    if (ticket !== null && left(ticket) >= REFRESH_BEFORE_MS) return;
    if (ticket) log('券の期限が近いので作り直す');
    prepare().catch((e: unknown) => log(`券を用意できなかった: ${String(e)}`));
  };
  const timer = window.setInterval(keepReady, TIMER_MS);
  const onPageVisibility = () => keepReady();
  document.addEventListener('visibilitychange', onPageVisibility);

  const reloadForMenu = (t: IssuedTicket, reason: EscapeMissReason) => {
    log(`メニューの案内のため読み込み直す（${reason}）`);
    keep(t, reason);
    reloadWithTicket(t.ticket, { param, ...navigateOpts });
  };

  const miss = (plan: EscapePlan, t: IssuedTicket, reason: EscapeMissReason) => {
    const { fallback } = plan;
    if (fallback.kind === 'retry') {
      // メニューでは券が届かないアプリ。読み込み直さず、同じ券のままもう一度押してもらう。
      log(`もう一度押してもらう（${reason}）`);
      setState({ kind: 'retry', fallback, reason });
      return;
    }
    keep(t, reason);
    setState({ kind: 'menu', fallback, reason, reloaded: false });
    // 押されたのが「開く方法を見る」なら、すぐ読み込み直してよい。それ以外は、ホストが prepareMenu を呼ぶまで待つ。
    if (reason === 'no-button') reloadForMenu(t, reason);
    else log(`メニューの案内を待つ（${reason}）`);
  };

  const settleArrival = (status: TicketStatus) => {
    // 使われた（または使えなくなった）券は使い回せない。
    keep(null);
    if (status === 'used') {
      log('届いた（券が使用済みになった）');
      resting = true;
      setState({ kind: 'arrived' });
    } else {
      log(`届いたか分からない（券の状態: ${status}）`);
      setState({ kind: 'unknown', status });
      keepReady();
    }
  };

  const watchArrival = (plan: EscapePlan, t: IssuedTicket) => {
    let timers: number[] = [];
    let peeks = 0;
    const clear = () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers = [];
    };
    const stop = () => {
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
      stopArrival = null;
    };
    const check = async (last: boolean) => {
      if (stopArrival !== stop) return;
      peeks += 1;
      let status: TicketStatus | null;
      try {
        status = (await host.peek(t.ticket)).status;
      } catch (e) {
        log(`照会できなかった: ${String(e)}`);
        status = null;
      }
      if (stopArrival !== stop || !visible()) return;
      if (status !== null && status !== 'valid') {
        stop();
        settleArrival(status);
      } else if (last || peeks >= MAX_PEEKS) {
        stop();
        if (status === null) settleArrival('unknown');
        else miss(plan, t, 'not-arrived');
      }
    };
    // 表に出ているときだけ数える。裏に回ったら止め、戻ってきたら最初から（照会の回数には上限がある）。
    const schedule = () => {
      clear();
      if (!visible()) return;
      timers = ARRIVAL_CHECKS_MS.map((ms, i) =>
        window.setTimeout(() => void check(i === ARRIVAL_CHECKS_MS.length - 1), ms),
      );
    };
    const onVisibility = () => schedule();
    document.addEventListener('visibilitychange', onVisibility);
    stopArrival = stop;
    schedule();
  };

  /** 期限に余裕のある券。無ければ発行を待つ。 */
  const ensureTicket = async (): Promise<IssuedTicket | null> => {
    if (ticket !== null && left(ticket) >= MIN_LEFT_MS) return ticket;
    // 用意が間に合っていない。待ってから移るので、タップから時間が空く（Instagram では効かないかもしれない）。
    log('券の用意を待つ');
    try {
      return await prepare();
    } catch (error) {
      log(`券を発行できなかった: ${String(error)}`);
      setState({ kind: 'issue-failed', error });
      return null;
    }
  };

  const press = async () => {
    if (disposed || state.kind === 'opening') return;
    stopArrival?.();
    resting = false;

    const t = await ensureTicket();
    if (t === null || disposed) return;
    const plan = planFor(t.ticket);
    if (plan.step.kind === 'none') {
      miss(plan, t, 'no-button');
      return;
    }
    setState({ kind: 'opening' });
    const result = await escapeToBrowser(plan, navigateOpts);
    if (disposed) return;
    log(`開いた結果: ${result}`);
    if (result === 'opened') {
      clearTicketFromAddressBar(param);
      setState({ kind: 'checking' });
      watchArrival(plan, t);
    } else {
      miss(plan, t, 'button-failed');
    }
  };

  const prepareMenu = async () => {
    if (disposed || state.kind !== 'menu' || state.reloaded) return;
    const { reason } = state;
    const t = await ensureTicket();
    if (t === null || disposed) return;
    reloadForMenu(t, reason);
  };

  // 始め方: 保存した券があれば使い続ける（読み込み直しても、届く途中の券を無効にしないため）。
  const saved = readSaved();
  const usable = saved !== null && saved.owner === owner && left(saved) > MIN_LEFT_MS ? saved : null;
  if (opts.resume !== undefined) {
    const t: IssuedTicket =
      usable?.ticket === opts.resume
        ? { ticket: usable.ticket, expiresAt: usable.expiresAt }
        : { ticket: opts.resume, expiresAt: Date.now() + RESUME_LEFT_MS };
    keep(t, usable?.reason);
    const plan = planFor(t.ticket);
    const reason = usable?.reason ?? (plan.step.kind === 'none' ? 'no-button' : 'button-failed');
    state =
      plan.fallback.kind === 'menu'
        ? { kind: 'menu', fallback: plan.fallback, reason, reloaded: true }
        : { kind: 'retry', fallback: plan.fallback, reason };
    log('メニューの案内の続き');
  } else if (usable) {
    keep({ ticket: usable.ticket, expiresAt: usable.expiresAt });
  } else {
    keep(null);
    keepReady();
  }
  // 最初の状態も onChange で届ける（作った関数が返ってから）。
  queueMicrotask(() => {
    if (!disposed) opts.onChange?.(state);
  });

  return {
    get state() {
      return state;
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get plan() {
      return planFor(ticket?.ticket ?? null);
    },
    get ticket() {
      return ticket;
    },
    press,
    prepareMenu,
    async renew() {
      if (busy()) return;
      keep(null);
      await prepare();
    },
    dispose() {
      disposed = true;
      listeners.clear();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onPageVisibility);
      stopArrival?.();
    },
  };
}
