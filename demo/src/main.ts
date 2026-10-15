// 実機確認用のデモページ（設計書 8章）。
// GeoCutter を通さずに、キットの detectContext・planEscape・escapeToBrowser・startRedemption を動かして記録する。
// 「アカウント」は乱数の ID と記録の数を localStorage に置くだけ。
//
// 画面は「今いる場所でやること」だけを大きく出し、細かい情報や切り替えは「詳しい情報」に畳む。
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
  reloadWithTicket,
  settleTicket,
  startRedemption,
  type RedemptionHost,
  type StartRedemptionResult,
} from '../../src/client/index.js';

// ---------- 端末に置くもの ----------

const memory = new Map<string, string>();
function load<T>(key: string, fallback: T, storage: 'local' | 'session' = 'local'): T {
  try {
    const raw = (storage === 'local' ? localStorage : sessionStorage).getItem(key) ?? memory.get(`${storage}:${key}`);
    return raw === undefined || raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown, storage: 'local' | 'session' = 'local'): void {
  const raw = JSON.stringify(value);
  memory.set(`${storage}:${key}`, raw);
  try {
    (storage === 'local' ? localStorage : sessionStorage).setItem(key, raw);
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
  /** サーバーに送ったか。 */
  sent?: boolean;
}
const LOG_KEY = 'demo.log';
const LOG_MAX = 300;
let log: LogEntry[] = load<LogEntry[]>(LOG_KEY, []);
let where = '';

// 記録は自動でサーバー（KV）にも送る。開発者が `npm run logs` で読み、操作を見て次の手順を伝えられるように。
// 端末 ID は保存場所ごとの乱数（アカウントの ID とは別）。
const DEVICE_KEY = 'demo.device';
let device = load<string | null>(DEVICE_KEY, null);
if (device === null) {
  device = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  save(DEVICE_KEY, device);
  // 送るようになる前の記録は送らない（前に試した分が混ざらないように）。
  for (const e of log) e.sent = true;
  save(LOG_KEY, log);
}
const deviceId = device;

function record(text: string): void {
  log.push({ at: Date.now(), where, text });
  if (log.length > LOG_MAX) log = log.slice(-LOG_MAX);
  save(LOG_KEY, log);
  renderLog();
  scheduleSend();
}

let sendTimer: number | undefined;
let sending = false;
const sendStatus = h('span', { class: 'note' });

function scheduleSend(): void {
  window.clearTimeout(sendTimer);
  sendTimer = window.setTimeout(() => void sendLog(), 800);
}

function sendBody(entries: LogEntry[]): string {
  return JSON.stringify({ device: deviceId, ua: navigator.userAgent, entries: entries.map(({ at, where: w, text }) => ({ at, where: w, text })) });
}

function renderSendStatus(): void {
  const unsent = log.filter((e) => !e.sent).length;
  fill(sendStatus, unsent === 0 ? '記録は自動で送っています（送信済み）' : `記録は自動で送っています（未送信 ${unsent} 件）`);
}

async function sendLog(): Promise<void> {
  if (sending) return;
  const pending = log.filter((e) => !e.sent).slice(0, 50);
  if (pending.length === 0) return renderSendStatus();
  sending = true;
  try {
    const res = await fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: sendBody(pending), keepalive: true });
    if (res.ok) {
      for (const e of pending) e.sent = true;
      save(LOG_KEY, log);
    }
  } catch {
    // 次に記録したとき、または次に開いたときに送り直す。
  } finally {
    sending = false;
    renderSendStatus();
  }
  if (log.some((e) => !e.sent)) scheduleSend();
}

/** ページが隠れる・離れるときは sendBeacon で送る（fetch は途中で切られることがある）。 */
function sendLogNow(): void {
  const pending = log.filter((e) => !e.sent).slice(0, 50);
  if (pending.length === 0) return;
  if (navigator.sendBeacon?.('/api/log', new Blob([sendBody(pending)], { type: 'application/json' }))) {
    for (const e of pending) e.sent = true;
    save(LOG_KEY, log);
  }
}
window.addEventListener('pagehide', sendLogNow);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') sendLogNow();
});

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
  subjectId: string;
}
async function issue(purpose: Purpose): Promise<Issued> {
  const subject = ensureSubject();
  const res = await api<{ ticket: string; expiresAt: number }>('issue', {
    subjectId: subject.id,
    purpose,
    payload: JSON.stringify({ plays: subject.plays }),
  });
  record(`券を発行（${purpose}）: ${mask(res.ticket)} 期限 ${time(res.expiresAt)}`);
  return { ...res, subjectId: subject.id };
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

function describePlace(c: BrowserContext): string {
  const place =
    c.kind === 'in-app'
      ? `${APP_NAMES[c.app ?? 'other']} のアプリ内ブラウザ`
      : c.kind === 'standalone'
        ? 'ホーム画面アプリ'
        : '通常のブラウザ';
  return `${PLATFORM_NAMES[c.platform]} の${place}`;
}

// 設計書 4章の表の、実際の項目名。キットは場所の種類（MenuHint）しか返さないので、画面の言葉はホスト（ここ）が持つ。
const MENU_WORDS: Partial<Record<Platform, Partial<Record<InAppName, string>>>> = {
  ios: {
    line: '共有ボタン →「Safari で開く」',
    x: '共有ボタン →「Safari で開く」',
    instagram: '「⋯」→「外部ブラウザで開く」',
    threads: '「⋯」→「外部ブラウザで開く」',
    facebook: '「⋯」→「外部ブラウザで開く」',
  },
  android: {
    line: '「⋮」→「デフォルトのブラウザで開く」',
    x: '「⋮」→「ブラウザで開く」',
    instagram: '「⋮」→「Chrome で開く」',
    threads: '「⋮」→「外部ブラウザで開く」',
    facebook: '「⋮」→「外部ブラウザで開く」',
  },
};

function describeMenu(app: InAppName, platform: Platform, menu: MenuHint | null): string {
  const words = MENU_WORDS[platform]?.[app];
  if (words) return words;
  if (menu === null) return '「共有」や「⋯」「⋮」の中から、ブラウザで開く項目を探してください';
  const opener = menu.opener === 'share' ? '共有ボタン' : platform === 'android' ? '「⋮」' : '「⋯」';
  return `${opener} →「ブラウザで開く」のような項目`;
}

function describeDecision(d: RedemptionDecision): string {
  switch (d.action) {
    case 'noop':
      return 'noop（何もしない）';
    case 'adopt':
      return 'adopt（黙って受け取る）';
    case 'choose':
      return `choose（どちらか選ぶ: この端末 ${d.deviceSubjectId} ／ 券 ${d.ticketSubjectId}）`;
    case 'notify':
      return `notify（${NOTIFY_REASONS[d.reason]}）`;
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
// 結果の見出しごとの、言語に頼らない名前。実機の自動テスト（device/run.py）は文言ではなくこの id で読む。
const STATUS_IDS: Record<string, string> = {
  '券を発行できませんでした': 'issue-failed',
  '開いています…': 'opening',
  '外のブラウザに移ったようです': 'checking',
  '届きました': 'arrived',
  '届いたか分かりませんでした': 'unknown',
  'ボタンでは開けませんでした': 'button-failed',
  'まだ届いていません': 'not-arrived',
  'メニューから開いてください': 'menu-guide',
  '受け取りに失敗しました': 'receive-failed',
  '受け取りの確認に失敗しました': 'receive-failed',
  'メニューから開いてもらう途中です': 'menu-pending',
  '券なしで開きました': 'no-ticket',
  '受け取っています…': 'receiving',
  '届きました。どちらを使うか選んでください': 'choose',
  '券は届きましたが、使えませんでした': 'notify',
  '用意できました': 'home-ready',
  '用意できませんでした': 'home-failed',
};

/** 結果の大きな表示。tone は ok（うまくいった）・warn（要注意）・ng（だめ）・plain。 */
function status(tone: 'ok' | 'warn' | 'ng' | 'plain', title: string, ...body: Child[]): HTMLElement {
  return h(
    'div',
    { class: `status ${tone}` },
    h('p', { class: 'status-title', id: `status-${STATUS_IDS[title] ?? 'other'}` }, title),
    ...body.map((b) => (typeof b === 'string' ? h('p', {}, b) : b)),
  );
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
const hadSubjectAtLaunch = loadSubject() !== null;

// ---------- アカウント（ID） ----------

const idChip = h('span', { class: 'id-chip' });
const idDetail = h('div');
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
  fill(idChip, `ID ${s?.id ?? '—'}`);
  fill(
    idDetail,
    h('p', {}, `ID: `, h('code', {}, s?.id ?? '（まだ無い）'), ` ／ 記録 ${s?.plays ?? 0} 回`),
    h('p', { class: 'note' }, '保存場所ごとに別の ID になります。別のアプリやブラウザで同じ ID が出たら、保存場所が同じということです。'),
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
        forgetEscapeTicket();
        renderSubject();
      } }, '新しい ID にする'),
    ),
  );
}

// ---------- 外のブラウザで開く（A1・A4、だめならメニュー A2・A5） ----------

interface Method {
  id: string;
  label: string;
  /** このアプリ・OS として planEscape に計画させる。null は「手段なし」。 */
  as?: { platform: Platform; app: InAppName } | null;
}
const METHODS: Method[] = [
  { id: 'auto', label: '自動（今の場所の方法）' },
  { id: 'none', label: '手段なし（メニューから開く練習）', as: null },
  { id: 'ios-safari', label: 'x-safari-https://（iOS の X などの方法）', as: { platform: 'ios', app: 'x' } },
  { id: 'ios-instagram', label: 'instagram://extbrowser（iOS の Instagram の方法）', as: { platform: 'ios', app: 'instagram' } },
  { id: 'ios-threads', label: 'barcelona://extbrowser（iOS の Threads の方法）', as: { platform: 'ios', app: 'threads' } },
  { id: 'line', label: 'openExternalBrowser=1（LINE の方法）', as: { platform: context.platform, app: 'line' } },
  { id: 'android', label: 'intent://（Android の方法）', as: { platform: 'android', app: 'other' } },
];
const METHOD_KEY = 'demo.method';
const ESCAPE_TICKET_KEY = 'demo.escapeTicket';

// 押す前に用意しておく券。読み込み直しても使い続けられるように sessionStorage にも置く
// （作り直すと、escape は古い券を無効にするので、URL に付けた券が届かなくなる）。
let escapeTicket: Issued | null = null;
let preparing: Promise<Issued> | null = null;

const methodSelect = h('select', { id: 'method' }, ...METHODS.map((m) => h('option', { value: m.id }, m.label)));
const graceInput = h('input', { type: 'number', placeholder: '自動', min: '0', step: '100', inputmode: 'numeric', style: 'width:7em' });
const planView = h('div');
const ticketView = h('span', { class: 'note' });
const escapeButton = h('button', { class: 'primary', id: 'escape-button' }, '外のブラウザで開く');
const escapeResult = h('div');
const escapeIntro = h('p');

function forgetEscapeTicket(): void {
  escapeTicket = null;
  save(ESCAPE_TICKET_KEY, null, 'session');
  renderEscapeTicket();
}

function restoreEscapeTicket(): void {
  const saved = load<Issued | null>(ESCAPE_TICKET_KEY, null, 'session');
  const subject = loadSubject();
  if (saved && subject && saved.subjectId === subject.id && saved.expiresAt - Date.now() > 30_000) escapeTicket = saved;
}

function targetUrl(ticket: string): string {
  return withTicket(location.origin + location.pathname, ticket);
}

function buildPlan(ticket: string): EscapePlan {
  const target = targetUrl(ticket);
  const real = planEscape(context, target);
  const method = METHODS.find((m) => m.id === methodSelect.value) ?? METHODS[0]!;
  if (method.as === undefined) return real;
  // 「手段なし」はメニューの練習なので、代わりはいつもメニューにする。
  if (method.as === null) {
    const { app, platform } = real.fallback;
    const fallback = real.fallback.kind === 'menu' ? real.fallback : { kind: 'menu' as const, app, platform, menu: null };
    return { step: { kind: 'none' }, fallback };
  }
  const as: BrowserContext = { platform: method.as.platform, kind: 'in-app', app: method.as.app, storage: 'separate' };
  // 開き方だけ借りて、メニューの案内は今のアプリのものを使う。
  return { step: planEscape(as, target).step, fallback: real.fallback };
}

function menuWords(plan: EscapePlan): string {
  const f = plan.fallback;
  if (f.kind === 'retry') return `もう一度ボタンを押して、${APP_NAMES[f.app]} の確認で「次へ」を選ぶ（メニューでは届かない）`;
  return describeMenu(f.app, f.platform, f.menu);
}

function renderPlan(): void {
  const plan = buildPlan(escapeTicket?.ticket ?? 'AAAAAAAAAAAAAAAAAAAAAA');
  const auto = plan.step.kind === 'navigate';
  fill(escapeButton, auto ? '外のブラウザで開く' : 'ブラウザで開く方法を見る');
  fill(
    escapeIntro,
    auto
      ? 'ボタンを押してください。外のブラウザが開いて、そちらの画面に「届きました」と出れば成功です。'
      : 'このアプリでは自動で開けません。ボタンを押すと、アプリのメニューから開く方法が出ます。',
  );
  fill(
    planView,
    dl([
      ['開き方', plan.step.kind === 'navigate' ? h('code', {}, maskUrl(plan.step.href)) : 'なし（メニューから開いてもらう）'],
      ['だめなとき', menuWords(plan)],
    ]),
  );
}

function renderEscapeTicket(): void {
  if (escapeTicket === null) {
    fill(ticketView, preparing ? '券を用意しています…' : '券はまだありません');
  } else {
    const left = Math.max(0, escapeTicket.expiresAt - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    fill(ticketView, left > 0 ? `券 ${mask(escapeTicket.ticket)}（あと ${m}分${String(s).padStart(2, '0')}秒）` : '券の期限が切れました');
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
      save(ESCAPE_TICKET_KEY, t, 'session');
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
    const line = `${name}（${Date.now() - t0}ms）`;
    first ??= line;
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

/** メニューから開いてもらう案内（読み込み直したあとにも出す）。 */
function showMenuGuide(plan: EscapePlan): void {
  fill(
    escapeResult,
    status(
      'warn',
      plan.step.kind === 'none' ? 'メニューから開いてください' : 'ボタンでは開けませんでした',
      h('p', {}, 'アプリのメニューから開いてください:'),
      h('p', { class: 'menu-words' }, menuWords(plan)),
      '開いた先の画面に「届きました」と出れば成功です。メニューが違ったら、下の「見たこと」で教えてください。',
    ),
  );
}

async function onEscapeClick(): Promise<void> {
  const t0 = Date.now();
  stopWatching?.();
  window.clearInterval(arrivalTimer);
  watchingArrival = false;
  const method = methodSelect.value;
  // 空なら計画の目安（Instagram は長め）、それも無ければキットの既定。
  const graceMs = Number(graceInput.value) || undefined;

  let ticket = escapeTicket;
  let late = false;
  if (ticket === null || ticket.expiresAt - Date.now() < 30_000) {
    // 用意が間に合っていない。待ってから移るので、タップから時間が空く（Instagram では効かないかもしれない）。
    late = true;
    try {
      ticket = await prepareEscapeTicket();
    } catch (e) {
      record(`券を発行できなかった: ${String(e)}`);
      fill(escapeResult, status('ng', '券を発行できませんでした', String(e)));
      return;
    }
  }
  const plan = buildPlan(ticket.ticket);
  record(
    `ボタンを押した: 方法=${method} 猶予=${graceMs ?? plan.graceMs ?? DEFAULT_GRACE_MS}ms${late ? '（券の発行を待ってから移った）' : ''} → ${
      plan.step.kind === 'navigate' ? maskUrl(plan.step.href) : 'なし'
    }`,
  );
  const watcher = watchSignals(t0);
  stopWatching = watcher.stop;
  escapeButton.disabled = true;
  fill(escapeResult, status('plain', '開いています…'));

  const result = await escapeToBrowser(plan, graceMs === undefined ? {} : { graceMs });
  escapeButton.disabled = false;
  const first = watcher.first();
  record(`escapeToBrowser: ${result}${first ? `（最初の合図: ${first}）` : '（合図なし）'} ${Date.now() - t0}ms`);

  if (result === 'opened') {
    clearTicketFromAddressBar();
    fill(escapeResult, status('plain', '外のブラウザに移ったようです', '届いたか確かめています…', h('p', { class: 'note' }, `最初の合図: ${first ?? '—'}`)));
    watchArrival(plan, ticket);
  } else {
    showFallback(plan, ticket, 'ボタンでは開けませんでした');
  }
}

/** ボタンで届かなかったときの代わり。retry はもう一度押してもらい、menu は読み込み直してメニューを案内する。 */
function showFallback(plan: EscapePlan, ticket: Issued, title: string): void {
  if (plan.fallback.kind === 'retry') {
    // メニューでは届かないアプリ。読み込み直さず、同じ券のままもう一度押してもらう。
    record(`もう一度押してもらう案内を出した（retry）: ${title}`);
    fill(
      escapeResult,
      status(
        'warn',
        title,
        h('p', {}, 'もう一度ボタンを押して、確認の画面で「次へ」を選んでください。'),
        h('p', { class: 'note' }, 'このアプリはメニューから開くと届かないので、ボタンから開いてください。'),
      ),
    );
    return;
  }
  // メニューから開いても届くように、券付きの URL で読み込み直す。
  // 読み込み直したあとは startRedemption が escapePending を返すので、そこで案内を出す。
  record(`メニューのために、券付きの URL で読み込み直す: ${maskUrl(withTicket(location.href, ticket.ticket))}（${title}）`);
  reloadWithTicket(ticket.ticket);
}

// 合図（ページが隠れた）だけでは、外のブラウザに移ったのか、ほかのアプリに切り替えたのか見分けられない。
// そこで戻ってきたら、券が使用済みになったか（外のブラウザが受け取ったか）をサーバーに照会して確かめる。
const ARRIVAL_WAIT_MS = 4_000;
let arrivalTimer: number | undefined;
let watchingArrival = false;

function watchArrival(plan: EscapePlan, ticket: Issued): void {
  window.clearInterval(arrivalTimer);
  watchingArrival = true;
  let visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
  const onVisibility = () => {
    visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
  };
  document.addEventListener('visibilitychange', onVisibility);
  const stop = () => {
    window.clearInterval(arrivalTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    watchingArrival = false;
  };
  let checking = false;
  const check = async () => {
    if (visibleSince === null || checking || !watchingArrival) return; // 裏にいる間・照会中は聞かない
    checking = true;
    let res: TicketLookup;
    try {
      res = await api<TicketLookup>('peek', { ticket: ticket.ticket });
    } catch {
      return;
    } finally {
      checking = false;
    }
    if (!watchingArrival) return;
    if (res.status === 'valid') {
      // まだ使われていない。戻ってきてしばらく経っても使われていなければ、届いていない。
      if (visibleSince !== null && Date.now() - visibleSince >= ARRIVAL_WAIT_MS) {
        stop();
        record('届いたかの確認: まだ使われていない（ほかのアプリに切り替えただけか、ブラウザが開かなかった）');
        showFallback(plan, ticket, 'まだ届いていません');
      }
      return;
    }
    stop();
    // 使われた（または切れた）券は、もう使い回せない。次に押すときのために新しい券を用意する。
    forgetEscapeTicket();
    void prepareEscapeTicket().catch((e) => record(`券を用意できなかった: ${String(e)}`));
    if (res.status === 'used') {
      record('届いたかの確認: 券が使用済みになった（外のブラウザが受け取った）');
      fill(escapeResult, status('ok', '届きました', '外のブラウザが受け取りました。'));
    } else {
      record(`届いたかの確認: 券の状態 ${res.status}`);
      fill(escapeResult, status('warn', '届いたか分かりませんでした', `券の状態: ${res.status}。もう一度ボタンを押してください。`));
    }
  };
  arrivalTimer = window.setInterval(() => void check(), 1_500);
}

function escapeCard(): HTMLElement {
  escapeButton.addEventListener('click', () => void onEscapeClick());
  return h(
    'section',
    {},
    h('h2', {}, '外のブラウザで開く'),
    escapeIntro,
    escapeButton,
    escapeResult,
  );
}

function escapeSettings(): HTMLElement {
  methodSelect.value = load(METHOD_KEY, 'auto');
  if (methodSelect.value === '') methodSelect.value = 'auto';
  methodSelect.addEventListener('change', () => {
    save(METHOD_KEY, methodSelect.value);
    record(`開き方を変えた: ${methodSelect.value}`);
    renderPlan();
  });
  return h(
    'div',
    {},
    h('h3', {}, '開き方を変える'),
    h('p', { class: 'note' }, '「手段なし」にすると、ボタンを押したときにメニューの案内が出ます（メニューから開く練習）。'),
    h('div', { class: 'row' }, methodSelect),
    h('div', { class: 'row' }, h('label', { class: 'note' }, '合図を待つ時間 ', graceInput, ' ms')),
    planView,
    h(
      'div',
      { class: 'row' },
      ticketView,
      h('button', { onclick: () => {
        forgetEscapeTicket();
        void prepareEscapeTicket().catch((e) => record(`券を用意できなかった: ${String(e)}`));
      } }, '券を用意し直す'),
    ),
  );
}

// ---------- 受け取り（ページを開いたとき） ----------

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

const receiveView = h('div');
const receiveFacts = h('div', { class: 'note' });

async function settle(ticket: string, choice: 'take' | 'keep'): Promise<void> {
  try {
    if (choice === 'take') {
      const r = await settleTicket(host, ticket, 'take');
      record(`settleTicket take: 受け取った（主体 ${r.credential.subjectId}）`);
      fill(receiveView, status('ok', '届きました', `アカウントを引き継ぎました。この画面の ID は ${r.credential.subjectId} になりました。`));
    } else {
      await settleTicket(host, ticket, 'keep');
      record('settleTicket keep: 今のままにした');
      fill(receiveView, status('ok', '届きました', '「今のまま」を選んだので、アカウントはそのままです（券は使用済み）。'));
    }
  } catch (e) {
    record(`settleTicket ${choice} で失敗: ${String(e)}`);
    fill(receiveView, status('ng', '受け取りに失敗しました', String(e)));
  }
  renderSubject();
}

/** ページを開いたときの受け取り。メニューの案内の途中（escapePending）なら、その結果を返す。 */
async function runRedemption(): Promise<StartRedemptionResult | null> {
  const fromStartUrl = new URL(launchUrl).searchParams.get('src') === 'home-screen';
  record(
    `ページを開いた: ${maskUrl(launchUrl)} ID${hadSubjectAtLaunch ? 'あり' : 'なし'}${
      context.kind === 'standalone' ? ` start_url=${fromStartUrl ? 'はい' : 'いいえ'}` : ''
    }`,
  );
  const facts: Array<[string, Child]> = [['開いた URL', h('code', {}, maskUrl(launchUrl))]];
  if (context.kind === 'standalone') {
    facts.push(['起動 URL', fromStartUrl ? 'manifest の start_url で開いた' : 'start_url ではない URL で開いた']);
  }

  let started: StartRedemptionResult | null = null;
  try {
    started = await startRedemption(host);
  } catch (e) {
    record(`startRedemption で失敗: ${String(e)}`);
    fill(receiveView, status('ng', '受け取りの確認に失敗しました', String(e)));
    fill(receiveFacts, dl(facts));
    return null;
  }

  if (started?.escapePending) {
    record(`startRedemption: 券 ${mask(started.ticket)} → メニューの案内の途中（escapePending）`);
    fill(receiveView, status('plain', 'メニューから開いてもらう途中です', 'この画面自身が付けた券なので、受け取りはしません。'));
    return started;
  }

  if (started === null) {
    record('startRedemption: 券なし');
    if (!hadSubjectAtLaunch && context.kind === 'standalone') {
      // 図1の B2: ホーム画面アプリの初回起動で、端末に主体が無く、券も無い。
      record('B2: 券が届かなかった（ホーム画面アプリの初回起動で、ID も券も無い）');
    }
    if (context.kind !== 'in-app') {
      fill(receiveView, status('plain', '券なしで開きました', 'アプリから移ってきてこれが出たなら、券は届いていません。'));
    }
  } else {
    const { ticket, decision } = started;
    record(`startRedemption: 券 ${mask(ticket)} → ${describeDecision(decision)}`);
    facts.push(['判断', describeDecision(decision)]);
    switch (decision.action) {
      case 'adopt':
        fill(receiveView, status('plain', '受け取っています…'));
        await settle(ticket, 'take');
        break;
      case 'noop':
        fill(receiveView, status('ok', '届きました', 'もう同じアカウントなので、そのままにしました。'));
        break;
      case 'choose': {
        const buttons = h(
          'div',
          { class: 'row' },
          h('button', { id: 'choose-take', onclick: () => void settle(ticket, 'take') }, '券のアカウントにする'),
          h('button', { id: 'choose-keep', onclick: () => void settle(ticket, 'keep') }, '今のまま'),
        );
        fill(
          receiveView,
          status('warn', '届きました。どちらを使うか選んでください', `この画面の ID ${decision.deviceSubjectId} と、券の ID ${decision.ticketSubjectId} の両方に記録があります。`, buttons),
        );
        break;
      }
      case 'notify':
        fill(receiveView, status('warn', '券は届きましたが、使えませんでした', NOTIFY_REASONS[decision.reason]));
        break;
    }
  }
  fill(receiveFacts, dl(facts));
  return started;
}

function receiveCard(): HTMLElement {
  return h('section', {}, h('h2', {}, '受け取り'), receiveView, receiveFacts);
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
      status('ok', '用意できました', 'このまま 共有 →「ホーム画面に追加」へ進んでください。'),
      h(
        'details',
        {},
        h('summary', {}, '中身'),
        dl([
          ['券', `${mask(t.ticket)}（期限 ${time(t.expiresAt)}）`],
          ['id', manifest.id ?? '—'],
          ['start_url', h('code', {}, maskUrl(manifest.start_url ?? '—'))],
        ]),
      ),
    );
  } catch (e) {
    record(`ホーム画面用の券を用意できなかった: ${String(e)}`);
    fill(homeView, status('ng', '用意できませんでした', String(e)));
  }
}

function homeCard(): HTMLElement {
  return h(
    'section',
    {},
    h('h2', {}, 'ホーム画面に追加'),
    h('p', {}, '① 下のボタンを押す ② 共有 →「ホーム画面に追加」③ 追加したアイコンから開いて、「届きました」と出るか見る。翌日以降に初めて開くのも試してください。'),
    h('button', { class: 'primary', id: 'home-button', onclick: () => void prepareHomeScreen() }, 'ホーム画面用の券を用意する'),
    homeView,
  );
}

function homeSettings(): HTMLElement {
  const prepAtLoad = h('input', { type: 'checkbox' });
  prepAtLoad.checked = load(PREP_AT_LOAD_KEY, false);
  prepAtLoad.addEventListener('change', () => {
    save(PREP_AT_LOAD_KEY, prepAtLoad.checked);
    record(`開いたときに自動で用意する: ${prepAtLoad.checked ? 'オン' : 'オフ'}`);
  });
  return h(
    'div',
    { class: 'row' },
    h('label', { class: 'note' }, prepAtLoad, ' ページを開いたときにホーム画面用の券を自動で用意する（iOS が manifest を読む時機を確かめる用）'),
  );
}

// ---------- 記録 ----------

const logView = h('div', { class: 'log mono' });
const copyStatus = h('span', { class: 'note' });
const reportArea = h('textarea', { readonly: '', class: 'hidden' });

function renderLog(): void {
  fill(logView, ...log.slice().reverse().map((e) => h('div', {}, `${time(e.at)} [${e.where}] ${e.text}`)));
}

// 記録は消すまで貯まるので、ふだんは直近の分だけコピーする（前に試した分が混ざらないように）。
const RECENT_MS = 30 * 60_000;

function report(all: boolean): string {
  const s = loadSubject();
  const since = all ? 0 : Date.now() - RECENT_MS;
  const entries = log.filter((e) => e.at >= since);
  return [
    '# browser-handoff デモの記録',
    `作成: ${time(Date.now())}（${all ? '全部' : '直近30分'}）`,
    `URL: ${maskUrl(location.href)}`,
    `UA: ${env.userAgent}`,
    `場所: ${where}（storage=${context.storage}） standalone=${env.standalone} display-mode=${env.displayModeStandalone} タッチ点=${env.maxTouchPoints}`,
    `ID: ${s?.id ?? '—'}（記録 ${s?.plays ?? 0} 回）`,
    '',
    ...entries.map((e) => `${time(e.at)} [${e.where}] ${e.text}`),
  ].join('\n');
}

async function copyReport(all = false): Promise<void> {
  const text = report(all);
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

const OBSERVATIONS = ['開く前に確認が出た', '何も起きなかった', 'メニューの場所が違った', 'メニューが無かった'];
const memoInput = h('input', { type: 'text', placeholder: '気づいたこと（アプリの版など）' });

function logCard(): HTMLElement {
  renderLog();
  return h(
    'section',
    {},
    h('h2', {}, '記録を送る'),
    h('p', {}, sendStatus),
    h('p', { class: 'note' }, '記録は自動で開発者に届くので、ふだんはコピーしなくて大丈夫です。送れないときだけ、ここでコピーして貼ってください（直近30分の分）。'),
    h('div', { class: 'row' }, h('button', { class: 'secondary', onclick: () => void copyReport() }, '記録をコピー（直近30分）'), copyStatus),
    reportArea,
    h('p', { class: 'field' }, '見たこと（押すと記録に残ります）'),
    h('div', { class: 'chips' }, ...OBSERVATIONS.map((o) => h('button', { onclick: () => {
      record(`観察: ${o}`);
      fill(copyStatus, `「${o}」を記録しました`);
    } }, o))),
    h(
      'div',
      { class: 'row' },
      memoInput,
      h('button', { onclick: () => {
        if (memoInput.value.trim() === '') return;
        record(`メモ: ${memoInput.value.trim()}`);
        fill(copyStatus, 'メモを記録しました');
        memoInput.value = '';
      } }, 'メモを残す'),
    ),
    h(
      'details',
      {},
      h('summary', {}, '記録の中身を見る'),
      h(
        'div',
        { class: 'row' },
        h('button', { onclick: () => void copyReport(true) }, '全部コピー'),
        h('button', { onclick: () => {
          if (!confirm('この場所の記録を消しますか？')) return;
          log = [];
          save(LOG_KEY, log);
          renderLog();
        } }, '記録を消す'),
      ),
      logView,
    ),
  );
}

// ---------- 詳しい情報 ----------

function detailsCard(extra: HTMLElement[]): HTMLElement {
  return h(
    'section',
    {},
    h(
      'details',
      {},
      h('summary', {}, '詳しい情報・切り替え'),
      h('h3', {}, '場所の判定（detectContext）'),
      dl([
        ['platform', context.platform],
        ['kind', context.kind],
        ['app', context.app ?? '—'],
        ['storage', context.storage],
        ['standalone', `navigator.standalone=${env.standalone} / display-mode=${env.displayModeStandalone}`],
        ['タッチ点', String(env.maxTouchPoints)],
      ]),
      h('div', { class: 'mono' }, env.userAgent),
      h('h3', {}, 'アカウント'),
      idDetail,
      ...extra,
    ),
  );
}

// ---------- 始める ----------

/** この場所でいちばんにやること。 */
function mainHint(): string {
  if (context.kind === 'in-app') return 'アプリ内ブラウザです。「外のブラウザで開く」を試してください。';
  if (context.kind === 'standalone') return 'ホーム画面アプリです。下の「受け取り」で、券が届いたかを見てください。';
  if (context.storage === 'separate') return '通常のブラウザです。外から来たなら「受け取り」を、ホーム画面に追加するなら「ホーム画面に追加」を見てください。';
  return '通常のブラウザです。外から来たなら「受け取り」を見てください。ここから試すことは特にありません（アプリの中でこのページを開いてください）。';
}

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const inApp = context.kind === 'in-app';
  const homeMain = context.kind === 'browser' && context.storage === 'separate';
  const escapeExtras = [h('h3', {}, '外のブラウザで開く'), escapeSettings()];
  const homeExtras = [h('h3', {}, 'ホーム画面に追加'), homeSettings()];

  fill(
    app,
    h('section', { class: 'hero' }, h('p', { class: 'place', id: `place-${context.kind}` }, describePlace(context)), h('p', {}, mainHint()), idChip),
    inApp ? escapeCard() : receiveCard(),
    inApp ? null : homeMain ? homeCard() : null,
    logCard(),
    detailsCard([
      ...(inApp ? escapeExtras : [escapeCard(), ...escapeExtras]),
      ...(homeMain ? homeExtras : [homeCard(), ...homeExtras]),
    ]),
  );
  record(`場所: ${describePlace(context)}（${context.storage}） UA=${env.userAgent} 端末=${deviceId}`);
  renderSubject();
  restoreEscapeTicket();
  renderEscapeTicket();
  window.setInterval(() => {
    if (!escapeTicket) return;
    renderEscapeTicket();
    // 期限が近ければ、押される前に作り直しておく（押してから発行を待つと、タップから時間が空いて Instagram が無視する）。
    if (inApp && !watchingArrival && !preparing && escapeTicket.expiresAt - Date.now() < 60_000) {
      record('券の期限が近いので作り直す');
      forgetEscapeTicket();
      void prepareEscapeTicket().catch((e) => record(`券を用意できなかった: ${String(e)}`));
    }
  }, 1000);

  // 受け取りを先に済ませる（済む前に券を発行すると、別の ID で発行してしまう）。
  const started = await runRedemption();
  ensureSubject();
  renderSubject();

  if (started?.escapePending) {
    // メニューの案内のために読み込み直したところ。同じ券を使い続け、案内をもう一度出す。
    restoreEscapeTicket();
    if (escapeTicket?.ticket !== started.ticket) {
      const subject = ensureSubject();
      escapeTicket = { ticket: started.ticket, expiresAt: Date.now() + 5 * 60_000, subjectId: subject.id };
    }
    renderEscapeTicket();
    showMenuGuide(buildPlan(started.ticket));
  } else if (inApp && escapeTicket === null) {
    void prepareEscapeTicket().catch((e) => record(`券を用意できなかった: ${String(e)}`));
  }
  if (load(PREP_AT_LOAD_KEY, false)) await prepareHomeScreen();
}

void main();
