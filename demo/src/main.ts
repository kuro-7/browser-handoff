// 実機確認用のデモページ（設計書 8章）。
// GeoCutter を通さずに、キットの detectContext・planEscape・escapeToBrowser・startRedemption を動かして記録する。
// 「アカウント」は乱数の ID と記録の数を localStorage に置くだけ。
import {
  detectContext,
  planEscape,
  readTicket,
  withTicket,
  type BrowserContext,
  type EscapePlan,
  type InAppName,
  type MenuHint,
  type Platform,
  type Purpose,
  type RedemptionDecision,
  type TicketLookup,
} from '../../src/core/index.js';
import {
  DEFAULT_GRACE_MS,
  clearTicketFromAddressBar,
  escapeToBrowser,
  overrideManifest,
  putTicketInAddressBar,
  settleTicket,
  startRedemption,
  type RedemptionHost,
} from '../../src/client/index.js';

// ---------- 端末に置くもの ----------

const memory = new Map<string, string>();
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key) ?? memory.get(key);
    return raw === undefined || raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    localStorage.setItem(key, raw);
  } catch {
    // 使えない WebView もある。そのときはこのページを開いている間だけ覚える。
  }
}

interface Subject {
  id: string;
  /** 「記録」の数。0 なら記録なし（図2の D3）。 */
  plays: number;
}
const loadSubject = () => load<Subject | null>('demo.subject', null);
const saveSubject = (s: Subject) => save('demo.subject', s);
function newSubjectId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- 記録 ----------

interface LogEntry {
  at: number;
  where: string;
  text: string;
}
const LOG_KEY = 'demo.log';
const LOG_MAX = 300;
let log: LogEntry[] = load<LogEntry[]>(LOG_KEY, []);
let where = '';

function record(text: string): void {
  log.push({ at: Date.now(), where, text });
  if (log.length > LOG_MAX) log = log.slice(-LOG_MAX);
  save(LOG_KEY, log);
  renderLog();
}

function time(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** 記録や画面に出すときは、引換券を頭の4文字だけにする。 */
function mask(ticket: string): string {
  return `${ticket.slice(0, 4)}…`;
}
function maskUrl(url: string): string {
  const ticket = readTicket(url);
  return ticket === null ? url : url.split(ticket).join(mask(ticket));
}

// ---------- API ----------

async function api<T>(action: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

interface Issued {
  ticket: string;
  expiresAt: number;
  purpose: Purpose;
}
async function issue(purpose: Purpose): Promise<Issued> {
  const subject = ensureSubject();
  const res = await api<{ ticket: string; expiresAt: number }>('issue', {
    subjectId: subject.id,
    purpose,
    payload: JSON.stringify({ plays: subject.plays }),
  });
  record(`券を発行（${purpose}）: ${mask(res.ticket)} 期限 ${time(res.expiresAt)}`);
  return { ...res, purpose };
}

// ---------- 言葉（デモの画面用） ----------

const PLATFORM_NAMES: Record<Platform, string> = { ios: 'iPhone・iPad', android: 'Android', desktop: 'パソコン', other: 'その他' };
const APP_NAMES: Record<InAppName, string> = {
  x: 'X',
  line: 'LINE',
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
  tiktok: 'TikTok',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
  other: '名前の分からないアプリ',
};

function describeContext(c: BrowserContext): { place: string; storage: string } {
  const place =
    c.kind === 'in-app'
      ? `${APP_NAMES[c.app ?? 'other']} のアプリ内ブラウザ`
      : c.kind === 'standalone'
        ? 'ホーム画面アプリ'
        : '通常のブラウザ';
  const other = c.kind === 'in-app' ? '通常のブラウザ' : c.kind === 'standalone' ? 'ブラウザ' : 'ホーム画面アプリ';
  const storage =
    c.storage === 'separate'
      ? `${other}とは保存場所が別（引き継ぎが要る）`
      : c.storage === 'shared'
        ? `${other}と保存場所が同じ（引き継ぎは要らない）`
        : `${other}と保存場所が同じか分からない`;
  return { place: `${PLATFORM_NAMES[c.platform]} の${place}`, storage };
}

function describeMenu(menu: MenuHint | null, platform: Platform): string {
  if (menu === null) return '表に無い（分からない）。「共有」や「⋯」からブラウザで開く項目を探してください';
  const opener = menu.opener === 'share' ? '共有ボタン' : platform === 'android' ? '「⋮」' : '「⋯」';
  const item = menu.item === 'open-in-browser' ? '「（外部）ブラウザで開く」「Safari で開く」' : '「他のアプリで開く」';
  return `${opener} → ${item}`;
}

function describeDecision(d: RedemptionDecision): string {
  switch (d.action) {
    case 'noop':
      return 'noop: 何もしない（同じアカウント、または決着済み）';
    case 'adopt':
      return 'adopt: 黙って受け取る';
    case 'choose':
      return `choose: どちらを使うか選んでもらう（この端末 ${d.deviceSubjectId} ／ 券 ${d.ticketSubjectId}）`;
    case 'notify':
      return `notify: 知らせる（${NOTIFY_REASONS[d.reason]}）`;
  }
}
const NOTIFY_REASONS = {
  expired: '券の期限が切れていた',
  used: '券はもう使われていた',
  'not-transferable': '移せないアカウントだった',
  unknown: '券が見つからなかった',
} as const;

// ---------- 小さな DOM の道具 ----------

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | ((e: Event) => void)>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (v !== undefined) el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
function fill(el: HTMLElement, ...children: Child[]): void {
  el.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}
function dl(rows: Array<[string, Child]>): HTMLDListElement {
  return h('dl', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

// ---------- 今の場所 ----------

const env = {
  userAgent: navigator.userAgent,
  standalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
  displayModeStandalone: matchMedia('(display-mode: standalone)').matches,
  maxTouchPoints: navigator.maxTouchPoints,
};
const context = detectContext(env);
where = [context.platform, context.kind, context.app].filter(Boolean).join('/');
const launchUrl = location.href;

function contextSection(): HTMLElement {
  const d = describeContext(context);
  return h(
    'section',
    {},
    h('h2', {}, '今いる場所', h('span', { class: 'tag' }, 'detectContext')),
    h('p', { class: 'summary' }, d.place),
    h('p', {}, d.storage),
    dl([
      ['platform', context.platform],
      ['kind', context.kind],
      ['app', context.app ?? '—'],
      ['storage', context.storage],
      ['standalone', `navigator.standalone=${env.standalone} / display-mode=${env.displayModeStandalone}`],
      ['タッチ点', String(env.maxTouchPoints)],
    ]),
    h('div', { class: 'mono' }, env.userAgent),
  );
}

// ---------- このページのアカウント ----------

const subjectView = h('div');
function ensureSubject(): Subject {
  let s = loadSubject();
  if (s === null) {
    s = { id: newSubjectId(), plays: 0 };
    saveSubject(s);
    record(`新しい ID を作った: ${s.id}`);
    renderSubject();
  }
  return s;
}
function renderSubject(): void {
  const s = loadSubject();
  fill(
    subjectView,
    h('div', { class: 'big-id' }, s?.id ?? '（まだ無い）'),
    h('p', {}, `記録: ${s?.plays ?? 0} 回`, s && s.plays === 0 ? '（記録なし）' : ''),
    h(
      'div',
      { class: 'row' },
      h('button', { onclick: () => {
        const cur = ensureSubject();
        saveSubject({ ...cur, plays: cur.plays + 1 });
        record(`記録を増やした: ${cur.plays + 1} 回`);
        renderSubject();
      } }, '記録を1つ増やす'),
      h('button', { onclick: () => {
        const next = { id: newSubjectId(), plays: 0 };
        saveSubject(next);
        record(`ID を作り直した: ${next.id}`);
        renderSubject();
        escapeTicket = null;
        renderEscapeTicket();
      } }, '新しい ID にする'),
    ),
  );
}
function subjectSection(): HTMLElement {
  return h(
    'section',
    {},
    h('h2', {}, 'このページのアカウント（デモ）'),
    h('p', { class: 'note' }, '保存場所ごとに別の ID になります。別のアプリやブラウザで同じ ID が出たら、保存場所が同じということです（Android の X が Custom Tabs 型かの確認に使えます）。'),
    subjectView,
  );
}

// ---------- 外のブラウザで開く（A1・A4、うまくいかなければ A2・A5） ----------

interface Method {
  id: string;
  label: string;
  /** このアプリ・OS として planEscape に計画させる。null は「手段なし」。 */
  as?: { platform: Platform; app: InAppName } | null;
}
const METHODS: Method[] = [
  { id: 'auto', label: '自動（今の場所の方法）' },
  { id: 'ios-safari', label: 'x-safari-https://（iOS の X などの方法）', as: { platform: 'ios', app: 'x' } },
  { id: 'ios-instagram', label: 'instagram://extbrowser（iOS の Instagram の方法）', as: { platform: 'ios', app: 'instagram' } },
  { id: 'ios-threads', label: 'barcelona://extbrowser（iOS の Threads の方法）', as: { platform: 'ios', app: 'threads' } },
  { id: 'line', label: 'openExternalBrowser=1（LINE の方法）', as: { platform: context.platform, app: 'line' } },
  { id: 'android', label: 'intent://（Android の方法）', as: { platform: 'android', app: 'other' } },
  { id: 'none', label: '手段なし（メニューの案内だけ）', as: null },
];

let escapeTicket: Issued | null = null;
let preparing: Promise<Issued> | null = null;
const methodSelect = h('select', { id: 'method' }, ...METHODS.map((m) => h('option', { value: m.id }, m.label)));
const graceInput = h('input', { type: 'number', value: String(DEFAULT_GRACE_MS), min: '0', step: '100', inputmode: 'numeric', style: 'width:8em' });
const planView = h('div');
const ticketView = h('span', { class: 'note' });
const escapeButton = h('button', { class: 'primary' }, '外のブラウザで開く');
const escapeResult = h('div');
const signalList = h('ol', { class: 'signals' });

function targetUrl(ticket: string): string {
  return withTicket(location.origin + location.pathname, ticket);
}

function buildPlan(ticket: string): EscapePlan {
  const target = targetUrl(ticket);
  const real = planEscape(context, target);
  const method = METHODS.find((m) => m.id === methodSelect.value) ?? METHODS[0]!;
  if (method.as === undefined) return real;
  if (method.as === null) return { step: { kind: 'none' }, fallback: real.fallback };
  const as: BrowserContext = { platform: method.as.platform, kind: 'in-app', app: method.as.app, storage: 'separate' };
  // 開き方だけ借りて、メニューの案内は今のアプリのものを使う。
  return { step: planEscape(as, target).step, fallback: real.fallback };
}

function renderPlan(): void {
  const plan = buildPlan(escapeTicket?.ticket ?? 'AAAAAAAAAAAAAAAAAAAAAA');
  fill(
    planView,
    dl([
      ['開き方', plan.step.kind === 'navigate' ? h('code', {}, maskUrl(plan.step.href)) : 'none（自動で開く手段が無い）'],
      ['だめなとき', describeMenu(plan.fallback.menu, plan.fallback.platform)],
    ]),
  );
}

function renderEscapeTicket(): void {
  if (escapeTicket === null) {
    fill(ticketView, preparing ? '券を用意しています…' : '券はまだありません（押したときに用意します）');
  } else {
    const left = Math.max(0, escapeTicket.expiresAt - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    fill(ticketView, left > 0 ? `券を用意済み: ${mask(escapeTicket.ticket)}（あと ${m}分${String(s).padStart(2, '0')}秒）` : '券の期限が切れました（押したときに作り直します）');
  }
  renderPlan();
}

/**
 * 押す前に券を用意しておく。押してから発行を待つと、タップから時間が空く。
 * Instagram の extbrowser はタップ以外からの移動を無視するので、押したらすぐ移れるようにする。
 */
function prepareEscapeTicket(): Promise<Issued> {
  preparing ??= issue('escape')
    .then((t) => {
      escapeTicket = t;
      return t;
    })
    .finally(() => {
      preparing = null;
      renderEscapeTicket();
    });
  renderEscapeTicket();
  return preparing;
}

/** escapeToBrowser とは別に、合図を全部見て記録する（どの合図が来たか、いつ戻ってきたか）。 */
function watchSignals(t0: number): { first: () => string | null; stop: () => void } {
  let first: string | null = null;
  let lastTick = Date.now();
  const add = (name: string) => {
    const ms = Date.now() - t0;
    const line = `${name}（${ms}ms）`;
    first ??= line;
    signalList.append(h('li', {}, line));
    record(`合図: ${line}`);
  };
  // Android は裏に回ったページのタイマーを止めずに1秒ごとに動かすので、遅れが続けて来る。
  // 続いている間は最初の1回だけ書き、戻ってきたときに回数をまとめて書く。
  let stalls = 0;
  const flushStalls = () => {
    if (stalls > 1) add(`（タイマーの遅れはその間に計 ${stalls} 回）`);
    stalls = 0;
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') flushStalls();
    add(`visibilitychange → ${document.visibilityState}`);
  };
  const onPageHide = (e: PageTransitionEvent) => add(`pagehide${e.persisted ? '（bfcache）' : ''}`);
  const onPageShow = (e: PageTransitionEvent) => add(`pageshow${e.persisted ? '（bfcache から戻った）' : ''}`);
  const onBlur = () => add('blur');
  const onFocus = () => add('focus');
  const ticker = window.setInterval(() => {
    const gap = Date.now() - lastTick;
    if (gap >= 900) {
      if (stalls === 0) add(`タイマーが ${gap}ms 遅れた`);
      stalls += 1;
    } else if (stalls > 0 && document.visibilityState === 'visible') {
      flushStalls();
    }
    lastTick = Date.now();
  }, 250);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  const stop = () => {
    flushStalls();
    window.clearInterval(ticker);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
  };
  // 戻ってきたときの合図も見たいので、しばらく聞き続ける。
  window.setTimeout(stop, 60_000);
  return { first: () => first, stop };
}

let stopWatching: (() => void) | null = null;

async function onEscapeClick(): Promise<void> {
  const t0 = Date.now();
  stopWatching?.();
  fill(signalList);
  fill(escapeResult);
  const method = methodSelect.value;
  const graceMs = Number(graceInput.value) || DEFAULT_GRACE_MS;

  let ticket = escapeTicket;
  let late = false;
  if (ticket === null || ticket.expiresAt - Date.now() < 30_000) {
    // 用意が間に合っていない。待ってから移るので、タップから時間が空く（Instagram では効かないかもしれない）。
    late = true;
    try {
      ticket = await prepareEscapeTicket();
    } catch (e) {
      record(`券を発行できなかった: ${String(e)}`);
      fill(escapeResult, h('div', { class: 'result warn' }, `券を発行できませんでした: ${String(e)}`));
      return;
    }
  }
  const plan = buildPlan(ticket.ticket);
  record(
    `ボタンを押した: 方法=${method} 猶予=${graceMs}ms${late ? '（券の発行を待ってから移った）' : ''} → ${
      plan.step.kind === 'navigate' ? maskUrl(plan.step.href) : 'none'
    }`,
  );
  const watcher = watchSignals(t0);
  stopWatching = watcher.stop;
  escapeButton.disabled = true;
  fill(escapeResult, h('div', { class: 'result plain' }, '結果を待っています…'));

  const result = await escapeToBrowser(plan, { graceMs });
  escapeButton.disabled = false;
  const first = watcher.first();
  record(`escapeToBrowser: ${result}${first ? `（最初の合図: ${first}）` : '（合図なし）'} ${Date.now() - t0}ms`);

  if (result === 'opened') {
    clearTicketFromAddressBar();
    // 外のブラウザがこの券を受け取る前に新しい券を発行すると、escape は古い券を無効にするので届かなくなる。
    // 次の券は、戻ってきて押したとき（または「券を用意し直す」）に作る。
    escapeTicket = null;
    renderEscapeTicket();
    fill(
      escapeResult,
      h('div', { class: 'result ok' }, h('strong', {}, 'opened: 外に出たようです'), h('br'), `最初の合図: ${first ?? '—'}`),
    );
  } else {
    // ボタンが効かなかった。メニューから開いても届くように、今の URL に券を付ける。
    putTicketInAddressBar(ticket.ticket);
    record(`URL に券を付けた: ${maskUrl(location.href)}`);
    fill(
      escapeResult,
      h(
        'div',
        { class: 'result warn' },
        h('strong', {}, 'fallback: 合図が来ませんでした'),
        h('br'),
        `アプリのメニューから開いてください: ${describeMenu(plan.fallback.menu, plan.fallback.platform)}`,
        h('br'),
        '今のページの URL に券を付けたので、メニューから開いても届くはずです。',
      ),
    );
  }
  // fallback のときは同じ券を使い続ける（URL に付けた券を、新しい発行で無効にしないように）。
}

const OBSERVATIONS = [
  'ブラウザが開いた',
  '開く前に確認が出た（1回余分に押した）',
  '何も起きなかった',
  'このページが読み込み直された',
  'メニューの場所は表のとおり',
  'メニューの場所が違った',
  'メニューから開いたら届いた',
];
const memoInput = h('input', { type: 'text', placeholder: 'アプリ名と版、気づいたこと' });

function escapeSection(): HTMLElement {
  escapeButton.addEventListener('click', () => void onEscapeClick());
  methodSelect.addEventListener('change', () => {
    record(`方法を変えた: ${methodSelect.value}`);
    renderPlan();
    if (escapeTicket === null) void prepareEscapeTicket().catch(() => {});
  });
  return h(
    'section',
    {},
    h('h2', {}, '外のブラウザで開く', h('span', { class: 'tag' }, 'A1・A4 → A2・A5')),
    h('p', { class: 'note' }, 'アプリ内ブラウザで開いて押してください。開けたかの判定（opened / fallback）と、来た合図を記録します。'),
    h('label', { class: 'field', for: 'method' }, '開き方'),
    h('div', { class: 'row' }, methodSelect),
    h('div', { class: 'row' }, h('label', { class: 'note' }, '待つ時間 ', graceInput, ' ms')),
    planView,
    h(
      'div',
      { class: 'row' },
      ticketView,
      h('button', { onclick: () => {
        escapeTicket = null;
        void prepareEscapeTicket().catch((e) => record(`券を用意できなかった: ${String(e)}`));
      } }, '券を用意し直す'),
    ),
    escapeButton,
    escapeResult,
    signalList,
    h('label', { class: 'field' }, '見たことを記録する'),
    h('div', { class: 'chips' }, ...OBSERVATIONS.map((o) => h('button', { onclick: () => record(`観察: ${o}`) }, o))),
    h(
      'div',
      { class: 'row' },
      memoInput,
      h('button', { onclick: () => {
        if (memoInput.value.trim() === '') return;
        record(`メモ: ${memoInput.value.trim()}`);
        memoInput.value = '';
      } }, 'メモを残す'),
    ),
  );
}

// ---------- 受け取り（起動時） ----------

const NOTIFIED_KEY = 'demo.notified';
const host: RedemptionHost<{ subjectId: string }> = {
  async deviceSubject() {
    const s = loadSubject();
    return s ? { id: s.id, hasRecords: s.plays > 0 } : null;
  },
  async peek(ticket) {
    const res = await api<TicketLookup>('peek', { ticket });
    record(`照会: ${res.status}${res.subjectId ? `（主体 ${res.subjectId}）` : ''}`);
    return res;
  },
  async redeem(ticket) {
    const res = await api<{ subjectId: string; payload: string | null } | { error: string }>('redeem', { ticket });
    if ('error' in res) throw new Error(res.error);
    const plays = res.payload ? (JSON.parse(res.payload) as { plays?: number }).plays ?? 0 : 0;
    saveSubject({ id: res.subjectId, plays });
    return { subjectId: res.subjectId };
  },
  async discard(ticket) {
    await api('discard', { ticket });
  },
  wasNotified: (ticket) => load<string[]>(NOTIFIED_KEY, []).includes(ticket),
  markNotified: (ticket) => save(NOTIFIED_KEY, [...load<string[]>(NOTIFIED_KEY, []), ticket].slice(-50)),
};

const redemptionView = h('div');
const hadSubjectAtLaunch = loadSubject() !== null;

async function settle(ticket: string, choice: 'take' | 'keep'): Promise<void> {
  try {
    if (choice === 'take') {
      const r = await settleTicket(host, ticket, 'take');
      record(`settleTicket take: 受け取った（主体 ${r.credential.subjectId}）`);
      redemptionView.append(h('div', { class: 'result ok' }, `受け取りました。この端末の ID は ${r.credential.subjectId} になりました。`));
    } else {
      await settleTicket(host, ticket, 'keep');
      record('settleTicket keep: 今のままにした');
      redemptionView.append(h('div', { class: 'result plain' }, '今のままにしました（券は使用済み）。'));
    }
  } catch (e) {
    record(`settleTicket ${choice} で失敗: ${String(e)}`);
    redemptionView.append(h('div', { class: 'result warn' }, `失敗しました: ${String(e)}`));
  }
  renderSubject();
}

async function runRedemption(): Promise<void> {
  const fromStartUrl = new URL(launchUrl).searchParams.get('src') === 'home-screen';
  const rows: Array<[string, Child]> = [
    ['開いた URL', h('code', {}, maskUrl(launchUrl))],
    ['開いたときの ID', hadSubjectAtLaunch ? 'あった' : '無かった'],
  ];
  if (context.kind === 'standalone') {
    rows.push(['start_url', fromStartUrl ? 'manifest の start_url で開いた' : 'start_url ではない URL で開いた']);
  }
  record(
    `ページを開いた: ${maskUrl(launchUrl)} ID${hadSubjectAtLaunch ? 'あり' : 'なし'}${
      context.kind === 'standalone' ? ` start_url=${fromStartUrl ? 'はい' : 'いいえ'}` : ''
    }`,
  );

  let started: Awaited<ReturnType<typeof startRedemption<{ subjectId: string }>>> = null;
  try {
    started = await startRedemption(host);
  } catch (e) {
    record(`startRedemption で失敗: ${String(e)}`);
    rows.push(['判断', `失敗: ${String(e)}`]);
  }

  if (started === null) {
    rows.push(['判断', '券なし（null）']);
    if (!hadSubjectAtLaunch && context.kind === 'standalone') {
      // 図1の B2: ホーム画面アプリの初回起動で、端末に主体が無く、券も無い。
      record('B2: 券が届かなかった（ホーム画面アプリの初回起動で、ID も券も無い）');
      rows.push(['B2', '届かなかった（ホストならログインで移す案内を出すところ）']);
    }
  } else {
    record(`startRedemption: 券 ${mask(started.ticket)} → ${describeDecision(started.decision)}`);
    rows.push(['券', mask(started.ticket)], ['判断', describeDecision(started.decision)]);
  }
  fill(redemptionView, dl(rows));

  if (started?.decision.action === 'adopt') {
    await settle(started.ticket, 'take');
  } else if (started?.decision.action === 'choose') {
    const { ticket: t } = started;
    const buttons = h(
      'div',
      { class: 'row' },
      h('button', { onclick: () => { buttons.remove(); void settle(t, 'take'); } }, '券のアカウントを引き継ぐ'),
      h('button', { onclick: () => { buttons.remove(); void settle(t, 'keep'); } }, '今のまま'),
    );
    redemptionView.append(buttons);
  }
  ensureSubject();
  renderSubject();
}

function redemptionSection(): HTMLElement {
  return h(
    'section',
    {},
    h('h2', {}, '受け取り', h('span', { class: 'tag' }, 'startRedemption')),
    h('p', { class: 'note' }, 'このページを開いたときに、URL の券を調べた結果です。黙って受け取れるときは自動で受け取ります。'),
    redemptionView,
  );
}

// ---------- ホーム画面に追加（B1） ----------

const PREP_AT_LOAD_KEY = 'demo.homePrepAtLoad';
const homeView = h('div');
let restoreManifest: (() => void) | null = null;

async function prepareHomeScreen(): Promise<void> {
  fill(homeView, h('p', { class: 'note' }, '用意しています…'));
  try {
    const t = await issue('home-screen');
    const manifestUrl = withTicket(new URL('/manifest.webmanifest', location.origin).href, t.ticket);
    restoreManifest?.();
    restoreManifest = overrideManifest(manifestUrl);
    record(`manifest を差し替えた: ${maskUrl(manifestUrl)}`);
    const manifest = (await (await fetch(manifestUrl)).json()) as { id?: string; start_url?: string };
    fill(
      homeView,
      h(
        'div',
        { class: 'result ok' },
        'manifest を差し替えました。このまま 共有 →「ホーム画面に追加」へ進んでください。',
      ),
      dl([
        ['券', `${mask(t.ticket)}（期限 ${time(t.expiresAt)}）`],
        ['id', manifest.id ?? '—'],
        ['start_url', h('code', {}, maskUrl(manifest.start_url ?? '—'))],
      ]),
    );
  } catch (e) {
    record(`ホーム画面用の券を用意できなかった: ${String(e)}`);
    fill(homeView, h('div', { class: 'result warn' }, `失敗しました: ${String(e)}`));
  }
}

function homeSection(): HTMLElement {
  const prepAtLoad = h('input', { type: 'checkbox' });
  prepAtLoad.checked = load(PREP_AT_LOAD_KEY, false);
  prepAtLoad.addEventListener('change', () => {
    save(PREP_AT_LOAD_KEY, prepAtLoad.checked);
    record(`開いたときに自動で用意する: ${prepAtLoad.checked ? 'オン' : 'オフ'}`);
  });
  return h(
    'section',
    {},
    h('h2', {}, 'ホーム画面に追加', h('span', { class: 'tag' }, 'B1')),
    h(
      'p',
      { class: 'note' },
      'iPhone の Safari で使います。ボタンを押してから、共有 →「ホーム画面に追加」。追加したアイコンから初めて開いたとき、上の「受け取り」で届いたかが分かります。翌日以降に初めて開くのも試してください。',
    ),
    h('button', { class: 'primary', onclick: () => void prepareHomeScreen() }, 'ホーム画面用の券を用意する'),
    h('div', { class: 'row' }, h('label', { class: 'note' }, prepAtLoad, ' ページを開いたときに自動で用意する（iOS が manifest を読む時機を確かめる用）')),
    homeView,
  );
}

// ---------- 記録 ----------

const logView = h('div', { class: 'log mono' });
const copyStatus = h('span', { class: 'note' });
const reportArea = h('textarea', { readonly: '', class: 'hidden' });

function renderLog(): void {
  fill(logView, ...log.slice().reverse().map((e) => h('div', {}, `${time(e.at)} [${e.where}] ${e.text}`)));
}

function report(): string {
  const s = loadSubject();
  return [
    '# browser-handoff デモの記録',
    `作成: ${time(Date.now())}`,
    `URL: ${maskUrl(location.href)}`,
    `UA: ${env.userAgent}`,
    `場所: ${where}（storage=${context.storage}） standalone=${env.standalone} display-mode=${env.displayModeStandalone} タッチ点=${env.maxTouchPoints}`,
    `ID: ${s?.id ?? '—'}（記録 ${s?.plays ?? 0} 回）`,
    '',
    ...log.map((e) => `${time(e.at)} [${e.where}] ${e.text}`),
  ].join('\n');
}

async function copyReport(): Promise<void> {
  const text = report();
  reportArea.value = text;
  try {
    await navigator.clipboard.writeText(text);
    fill(copyStatus, 'コピーしました');
    return;
  } catch {
    // アプリ内ブラウザでは clipboard が使えないことがある。
  }
  reportArea.classList.remove('hidden');
  reportArea.focus();
  reportArea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  fill(copyStatus, ok ? 'コピーしました' : '自動でコピーできませんでした。下の欄を長押しして全部選んでコピーしてください');
}

function logSection(): HTMLElement {
  renderLog();
  return h(
    'section',
    {},
    h('h2', {}, '記録'),
    h('p', { class: 'note' }, '記録は保存場所ごとに別です。アプリ内ブラウザとブラウザの両方でコピーしてください。'),
    h(
      'div',
      { class: 'row' },
      h('button', { onclick: () => void copyReport() }, '記録をコピー'),
      h('button', { onclick: () => {
        reportArea.value = report();
        reportArea.classList.toggle('hidden');
      } }, '全文を表示'),
      h('button', { onclick: () => {
        if (!confirm('記録を消しますか？')) return;
        log = [];
        save(LOG_KEY, log);
        renderLog();
      } }, '消す'),
      copyStatus,
    ),
    reportArea,
    logView,
  );
}

// ---------- 始める ----------

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  fill(app, contextSection(), redemptionSection(), subjectSection(), escapeSection(), homeSection(), logSection());
  record(`場所: ${describeContext(context).place}（${context.storage}） UA=${env.userAgent}`);
  renderSubject();
  renderEscapeTicket();
  window.setInterval(() => {
    if (escapeTicket) renderEscapeTicket();
  }, 1000);

  // 受け取りを先に済ませる（済む前に券を発行すると、別の ID で発行してしまう）。
  await runRedemption();

  if (context.kind === 'in-app') void prepareEscapeTicket().catch((e) => record(`券を用意できなかった: ${String(e)}`));
  if (load(PREP_AT_LOAD_KEY, false)) await prepareHomeScreen();
}

void main();
