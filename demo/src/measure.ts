// 画面の寸法を測る（アプリ内ブラウザのバーとページの寸法の関係を調べる）。
// ホストのアプリの下のボタンが、アプリ内ブラウザのバーに潜る件の調査用。
//
// 測るもの: env(safe-area-inset-*)、innerHeight、visualViewport、clientHeight、screen、devicePixelRatio、
// 100vh・100dvh・100svh・100lvh。スクロールやバーの出入りで変わるかを見るため、常に出しておき、変わるたびに書き直す。
// 変わった値は記録にも残す（開発者が `npm run logs` で読む）。

const MEASURE_KEY = 'demo.measure';
const FIT_KEY = 'demo.fitCover';

function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 使えなければ、この回だけ。
  }
}

/** viewport の meta に viewport-fit=cover が入っているか（index.html の頭で、保存した設定から書き換えている）。 */
function fitCover(): boolean {
  return /viewport-fit\s*=\s*cover/.test(document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '');
}

/** CSS の長さを px で読む。env() や dvh は getComputedStyle で解決された値になる。 */
function makeProbe(): (css: string, prop: 'padding-top' | 'height') => number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;';
  document.body.append(probe);
  return (css, prop) => {
    probe.style.paddingTop = '0';
    probe.style.height = '0';
    probe.style.setProperty(prop, css);
    const value = getComputedStyle(probe).getPropertyValue(prop);
    return Math.round(parseFloat(value) * 10) / 10;
  };
}

type Values = Record<string, number | string>;

function measure(px: ReturnType<typeof makeProbe>): Values {
  const vv = window.visualViewport;
  return {
    'safe-top': px('env(safe-area-inset-top)', 'padding-top'),
    'safe-bottom': px('env(safe-area-inset-bottom)', 'padding-top'),
    'safe-left': px('env(safe-area-inset-left)', 'padding-top'),
    'safe-right': px('env(safe-area-inset-right)', 'padding-top'),
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    'vv.height': vv ? Math.round(vv.height * 10) / 10 : '—',
    'vv.offsetTop': vv ? Math.round(vv.offsetTop * 10) / 10 : '—',
    'vv.width': vv ? Math.round(vv.width * 10) / 10 : '—',
    clientHeight: document.documentElement.clientHeight,
    'screen.height': screen.height,
    'screen.width': screen.width,
    'screen.availHeight': screen.availHeight,
    dpr: window.devicePixelRatio,
    '100vh': px('100vh', 'height'),
    '100dvh': px('100dvh', 'height'),
    '100svh': px('100svh', 'height'),
    '100lvh': px('100lvh', 'height'),
    scrollY: Math.round(window.scrollY),
  };
}

// 記録に残すときは、スクロールの位置だけが変わったものは省く（量を抑える）。
const IGNORE_IN_LOG = new Set(['scrollY']);

function describe(values: Values): string {
  return Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

/** 寸法を測る欄。`record` はデモの記録に1行足す関数。 */
export function measureCard(record: (text: string) => void): HTMLElement {
  const on = stored(MEASURE_KEY, '0') === '1';
  const section = document.createElement('section');
  section.id = 'measure';
  const title = document.createElement('h2');
  title.textContent = '画面の寸法を測る';
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = on
    ? '値は右上の枠に出ています。上下にスクロールして、アプリのバーが隠れたり出たりしたときに値が変わるか見てください。変わった値は自動で記録に残ります。赤い線が画面の一番下（bottom: 0）、緑の線が env(safe-area-inset-bottom) の高さです。'
    : 'アプリ内ブラウザのバーとページの寸法の関係を調べるときに使います。オンにすると、値を画面に出し続け、ページを縦に長くします。';
  const toggle = document.createElement('button');
  toggle.id = 'measure-toggle';
  toggle.textContent = on ? '測るのをやめる' : '測る';
  toggle.onclick = () => {
    store(MEASURE_KEY, on ? '0' : '1');
    location.reload();
  };
  const fit = document.createElement('button');
  fit.id = 'measure-fit';
  fit.textContent = fitCover() ? 'viewport-fit=cover を外して読み込み直す' : 'viewport-fit=cover を付けて読み込み直す';
  fit.onclick = () => {
    store(FIT_KEY, fitCover() ? '0' : '1');
    location.reload();
  };
  const fitNote = document.createElement('p');
  fitNote.className = 'note';
  fitNote.textContent = `今の viewport: ${document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '—'}`;
  const row = document.createElement('div');
  row.className = 'row';
  row.append(toggle, fit);
  section.append(title, note, row, fitNote);
  if (!on) return section;

  // 縦に長くして、スクロールでバーが出入りするようにする。
  const spacer = document.createElement('div');
  spacer.style.cssText = 'height:250vh;border-left:4px dashed var(--line);margin:12px 0 0 8px;';
  spacer.textContent = '（スクロール用の余白）';
  section.append(spacer);

  const box = document.createElement('pre');
  box.id = 'measure-values';
  box.style.cssText =
    'position:fixed;right:6px;top:calc(env(safe-area-inset-top) + 6px);z-index:50;margin:0;padding:6px 8px;' +
    'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;background:rgba(0,0,0,.78);color:#fff;border-radius:8px;pointer-events:none;';
  const bottomLine = document.createElement('div');
  bottomLine.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:3px;background:#e5484d;z-index:49;pointer-events:none;';
  const safeLine = document.createElement('div');
  safeLine.style.cssText =
    'position:fixed;left:0;right:0;bottom:env(safe-area-inset-bottom);height:3px;background:#30a46c;z-index:49;pointer-events:none;';
  document.body.append(box, bottomLine, safeLine);

  const px = makeProbe();
  let last = '';
  let pending: number | undefined;
  let scheduled = false;
  const update = () => {
    scheduled = false;
    const values = measure(px);
    box.textContent = `viewport-fit=${fitCover() ? 'cover' : 'なし'}\n` + Object.entries(values).map(([k, v]) => `${k} ${v}`).join('\n');
    const forLog = Object.fromEntries(Object.entries(values).filter(([k]) => !IGNORE_IN_LOG.has(k)));
    const key = describe(forLog);
    if (key !== last) {
      last = key;
      // 続けて変わる間はまとめ、落ち着いてから1行残す。
      window.clearTimeout(pending);
      pending = window.setTimeout(() => record(`寸法: fit=${fitCover() ? 'cover' : 'なし'} ${describe(values)}`), 800);
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  // バーの出入りがイベントにならないアプリのため、毎秒も測る（requestAnimationFrame は裏では動かないので直接）。
  window.setInterval(update, 1000);
  update();
  return section;
}
