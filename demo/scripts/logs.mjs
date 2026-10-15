// デモのページが送った記録を KV から読んで、時刻順に並べる。
//   npm run logs            直近60分
//   npm run logs -- 15      直近15分
// 端末（保存場所）ごとに頭4文字の印を付ける。wrangler にログインしていること。
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const minutes = Number(process.argv[2] ?? 60);
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

const devices = new Map();
const lines = [];
for (const raw of Object.values(values)) {
  if (typeof raw !== 'string') continue;
  const { device, ua, entries } = JSON.parse(raw);
  devices.set(device, ua);
  for (const e of entries) if (e.at >= since) lines.push({ ...e, device });
}
lines.sort((a, b) => a.at - b.at);

const time = (ms) => {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

console.log(`# 直近${minutes}分（${lines.length}件）`);
for (const [device, ua] of devices) console.log(`端末 ${device.slice(0, 4)}: ${ua}`);
console.log('');
for (const e of lines) console.log(`${time(e.at)} ${e.device.slice(0, 4)} [${e.where}] ${e.text}`);
