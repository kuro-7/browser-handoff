// デモを開ける・止める。
//   npm run demo:on    API 付きで出す（テストするとき）
//   npm run demo:off   API の無い「停止中」のページだけにする（ふだん）
// どちらも、出したもの以外のデプロイを消す。Pages は過去のデプロイも個別の URL
// （<id>.browser-handoff-demo.pages.dev）で動き続けるので、残すと止めたことにならない。
//
// 止めておく理由: デモは誰でも開ける。API（Pages Functions）は断る処理も1回の実行として数えられ、
// bot に連打されると料金がかかる。静的なページは何回開かれても料金がかからない。
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'on' && mode !== 'off') {
  console.error('使い方: node scripts/switch.mjs on|off');
  process.exit(1);
}

const demoDir = new URL('..', import.meta.url);
const project = /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(new URL('wrangler.toml', demoDir), 'utf8'))?.[1];
if (!project) throw new Error('wrangler.toml に name がありません');

// デモが入れた wrangler を使う（一時フォルダで npx すると、別の版が使われてログインが見つからない）。
const wrangler = `node "${fileURLToPath(new URL('node_modules/wrangler/bin/wrangler.js', demoDir))}"`;

// 一時フォルダには wrangler のアカウントの控えが無く、どのアカウントか選べずに止まる。デモの控えから渡す。
function accountId() {
  try {
    const cached = JSON.parse(readFileSync(new URL('node_modules/.cache/wrangler/wrangler-account.json', demoDir), 'utf8'));
    return cached.account?.id;
  } catch {
    return undefined;
  }
}
const env = { ...process.env, ...(accountId() && !process.env.CLOUDFLARE_ACCOUNT_ID ? { CLOUDFLARE_ACCOUNT_ID: accountId() } : {}) };

function run(command, cwd) {
  return execSync(command, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
}

const OFF_PAGE = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>browser-handoff デモ（停止中）</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px 16px;background:#f6f7f9;color:#222;line-height:1.7}main{max-width:36rem;margin:auto}</style>
</head>
<body>
<main>
<h1>browser-handoff デモ</h1>
<p>いまは止めています。試すときだけ開けています。</p>
<p><a href="https://github.com/kuro-7/browser-handoff">github.com/kuro-7/browser-handoff</a></p>
</main>
</body>
</html>
`;

let output;
if (mode === 'on') {
  run('npm run build', demoDir);
  output = run(`${wrangler} pages deploy public --project-name ${project} --branch main --commit-dirty=true`, demoDir);
} else {
  // functions フォルダの無いところから出す（API を含めない）。デモのフォルダの中（git に入らない .wrangler）に作る。
  // OS の一時フォルダで wrangler を動かすと、ホームに .wrangler を作り、それをログインの置き場所と取り違えて止まる。
  const base = fileURLToPath(new URL('.wrangler/', demoDir));
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'off-site-'));
  try {
    writeFileSync(join(dir, 'index.html'), OFF_PAGE);
    writeFileSync(join(dir, '404.html'), OFF_PAGE);
    writeFileSync(join(dir, '_headers'), '/*\n  X-Robots-Tag: noindex\n  Referrer-Policy: no-referrer\n');
    output = run(`${wrangler} pages deploy . --project-name ${project} --branch main --commit-dirty=true`, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const url = /https:\/\/([0-9a-f]{8})\.[\w-]+\.pages\.dev/.exec(output);
if (!url) throw new Error(`デプロイの URL が読めません:\n${output}`);
const keepPrefix = url[1];
console.log(`出した: ${url[0]}（${mode === 'on' ? 'API あり' : '停止中'}）`);

const deployments = JSON.parse(run(`${wrangler} pages deployment list --project-name ${project} --json`, demoDir));
const old = deployments.filter((d) => !d.Id.startsWith(keepPrefix));
for (const d of old) {
  run(`${wrangler} pages deployment delete ${d.Id} --project-name ${project} --force`, demoDir);
}
console.log(`古いデプロイを ${old.length} 個消した`);
