// デモのページが送った記録を KV から読んで、時刻順に並べる。
//   npm run logs                         直近60分。端末が1つならその記録、2つ以上なら端末の一覧だけ
//   npm run logs -- 15                   直近15分
//   npm run logs -- 30 --device 1a2b,c3d4  この端末（頭の文字）の記録だけ
//   npm run logs -- 30 --ua SCG13        ブラウザの名乗り（UA）にこの語を含む端末の記録だけ
//   npm run logs -- 30 --all             全部の端末の記録
//   --max 200                            出す行の上限（既定 300。超えたら新しい方を残す）
// デモは公開されていて、ほかの人の記録も混ざる。読む量を抑えるため、端末が2つ以上なら絞り込みを求める。
// 端末（保存場所）ごとに頭4文字の印を付ける。wrangler にログインしていること。
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : (args[i + 1] ?? '');
};
const minutes = Number(args.find((a, i) => /^\d+$/.test(a) && !String(args[i - 1]).startsWith('--')) ?? 60);
const deviceFilter = flag('--device')?.split(',').filter(Boolean) ?? [];
const uaFilter = flag('--ua')?.toLowerCase();
const showAll = args.includes('--all');
const maxLines = Number(flag('--max') ?? 300);
const since = Date.now() - minutes * 60_000;
const namespaceId = /id\s*=\s*"([0-9a-f]+)"/.exec(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'))?.[1];
if (!namespaceId) throw new Error('wrangler.toml に KV の id がありません');

function wrangler(args) {
  // args は固定の語と一時ファイルのパスだけ。パスは引用符で囲む。
  const command = ['npx wrangler', ...args.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)), '--namespace-id', namespaceId, '--remote'].join(' ');
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

// キーは log:<最初の記録の時刻>:<端末>:<乱数>。少し前から拾い、記録の時刻で絞る。
const keys = JSON.parse(wrangler(['kv', 'key', 'list', '--prefix', 'log:']))
  .map((k) => k.name)
  .filter((name) => Number(name.split(':')[1]) >= since - 10 * 60_000);

if (keys.length === 0) {
  console.log(`直近${minutes}分の記録はありません`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'handoff-logs-'));
const values = {};
try {
  for (let i = 0; i < keys.length; i += 100) {
    const file = join(dir, `keys-${i}.json`);
    writeFileSync(file, JSON.stringify(keys.slice(i, i + 100)));
    Object.assign(values, JSON.parse(wrangler(['kv', 'bulk', 'get', file])));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const devices = new Map(); // device → { ua, count, first, last }
const all = [];
for (const raw of Object.values(values)) {
  if (typeof raw !== 'string') continue;
  const { device, ua, entries } = JSON.parse(raw);
  const d = devices.get(device) ?? { ua, count: 0, first: Infinity, last: 0 };
  for (const e of entries) {
    if (e.at < since) continue;
    all.push({ ...e, device });
    d.count += 1;
    d.first = Math.min(d.first, e.at);
    d.last = Math.max(d.last, e.at);
  }
  if (d.count > 0) devices.set(device, d);
}
all.sort((a, b) => a.at - b.at);

const filtered = deviceFilter.length > 0 || uaFilter !== undefined;
const picked = new Set(
  [...devices.keys()].filter((device) => {
    if (showAll) return true;
    if (!filtered) return devices.size === 1;
    if (deviceFilter.length > 0 && !deviceFilter.some((p) => device.startsWith(p))) return false;
    if (uaFilter !== undefined && !String(devices.get(device).ua).toLowerCase().includes(uaFilter)) return false;
    return true;
  }),
);
let lines = all.filter((e) => picked.has(e.device));
const cut = Math.max(0, lines.length - maxLines);
lines = lines.slice(cut);

const time = (ms) => {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

console.log(`# 直近${minutes}分: 端末 ${devices.size} 個、記録 ${all.length} 件`);
for (const [device, d] of devices) {
  console.log(`${picked.has(device) ? '*' : ' '} 端末 ${device.slice(0, 4)}: ${d.count}件 ${time(d.first)}〜${time(d.last).slice(6)} ${d.ua}`);
}
if (picked.size === 0) {
  console.log('');
  console.log(filtered ? '絞り込みに合う端末がありません。' : '端末が2つ以上あります。--device（頭の文字）か --ua で絞るか、--all を付けてください。');
  process.exit(0);
}
console.log('');
if (cut > 0) console.log(`（古い ${cut} 件は省いた。--max で増やせる）`);
for (const e of lines) console.log(`${time(e.at)} ${e.device.slice(0, 4)} [${e.where}] ${e.text}`);
