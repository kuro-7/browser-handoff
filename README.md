# browser-handoff

Web アプリの匿名アカウントを、ログインなしで別の保存領域へ移すキット。

- アプリ内ブラウザ（X・LINE・Instagram など）→ 通常のブラウザ
- iOS の Safari → ホーム画面アプリ

設計は [`docs/design.ja.md`](docs/design.ja.md)。実機確認用のデモページは [`demo/`](demo/README.ja.md)。

## 中身

| 入口 | 動く場所 | 持つもの |
|---|---|---|
| `browser-handoff/core` | ブラウザ・サーバー | 場所の判定、外のブラウザの開き方、受け取りの分岐、引換券の URL の扱い |
| `browser-handoff/client` | ブラウザ | 外のブラウザを開く、URL への引換券の付け外し、manifest の差し替え、起動時の受け取り |
| `browser-handoff/server` | Workers・Node・Deno（Web Crypto） | 引換券の発行・照会・受け取り・破棄、manifest の生成 |

キットは画面を描かず、文言も持たない。状態とデータを返すので、何をどう出すかはアプリ側で決める。

## アプリ側でやること

- API の入口（発行・照会・受け取り）を作り、`createHandoffService` を呼ぶ。認証・回数制限はそこでやる。
- `HandoffStore` を実装する（`consume` は原子的に）。Postgres（Supabase）なら [`docs/postgres.ja.md`](docs/postgres.ja.md) に表と実装の例がある。
- 画面と文言（「Safari で続きから遊ぶ」ボタン、メニューの案内、どちらを使うか選ぶ画面、知らせ）。
- 起動時は、ほかの処理より先に `startRedemption` を呼ぶ（下の「起動時の順番」）。
- URL に乗せた引換券を漏らさない（下の「引換券の漏れ」）。

### 外のブラウザへ出す（アプリ内ブラウザで開いたとき）

`createEscapeFlow` が、券の用意と作り直し、ボタンで開く、戻ってからの確かめ、代わりの案内（メニュー・もう一度押す）までを受け持つ。アプリは `state` を見て描き、ボタンで `press` を呼ぶだけでよい。

```ts
const flow = createEscapeFlow(
  { issue: () => api.issueEscape(), peek: (t) => api.peek(t) },
  {
    context,                       // detectContext の結果
    owner: subjectId,              // 券の持ち主。変わったら作り直す
    resume: started?.escapePending ? started.ticket : undefined,
    onChange: (state) => render(state), // 作った直後にも最初の状態で1回呼ばれる
  },
);
button.onclick = () => void flow.press(); // クリックの処理の中で、待たずに呼ぶ
```

React なら `useSyncExternalStore(flow.subscribe, flow.getState)` でそのまま使える（状態が変わったときだけ別のオブジェクトになる）。`owner`・`resume` が変わったら作り直し、外すときに `dispose` する。

外のブラウザで開くのは、既定では今のページから query と hash を除いた URL（流入の `utm_*` を引き継がないため）。query で画面の状態を持つページなら、`targetUrl` で渡す。

| `state.kind` | 出すもの（例） |
|---|---|
| `idle` | ボタン。`flow.plan.step.kind === 'none'` なら「ブラウザで開く方法を見る」 |
| `opening`・`checking` | 「開いています…」 |
| `arrived` | 「ブラウザで続きを遊べます」 |
| `menu`（`reloaded: false`） | 「メニューから開く方法を見る」ボタン。押されたら `flow.prepareMenu()`（券付きの URL で読み込み直す）。読み込み直すと画面の状態が消えるので、キットは勝手には読み込み直さない（自動で開く手段が無いアプリでボタンが押されたときだけ、すぐ読み込み直す） |
| `menu`（`reloaded: true`） | 読み込み直したあと（`resume`）。`state.fallback.menu` を見て、アプリのメニューの場所を案内する |
| `retry` | 「もう一度ボタンを押して、確認で『次へ』」 |
| `unknown`・`issue-failed` | 「うまくいきませんでした。もう一度押してください」 |

戻ってきてからの照会は、1秒・3秒・6秒の3回まで（行き来しても1回押すごとに6回まで）。ホストの API の回数制限に響かないように、回数はキットが決めている。

券の発行と作り直しは、ページが表に出ているときだけ。届いたあと（`arrived`）は、また押されるまで発行しない（アプリ内ブラウザのタブは裏に残ることが多いので）。

### 起動時の順番

`startRedemption`（URL の引換券の読み取り）は、端末の ID を使うほかの処理より先に呼ぶ。

- 受け取る前に古い ID で記録の同期などが走ると、切り替えたあとも古い表示が残る。
- 流入の記録（`utm_source` や referrer を読む処理）より先に呼び、券付きで着いたときは流入として数えない。外のブラウザで開く URL には、元のページの query が残ることがある。

選ぶ画面に並べる概要（レベル・遊んだ回数など）は、`deviceSubject` と `peek` の戻りの `info` に入れれば、`startRedemption` の結果（`deviceInfo`・`ticketInfo`）に通る。キットは中を見ない。

### 引換券の漏れ

引換券は、受け取るまでの短い間だけ URL の query に乗る。

- 他のオリジンへ query を送らない。`Referrer-Policy` は `strict-origin-when-cross-origin`（ブラウザの既定）かそれより強いもの。`no-referrer` までは要らない。
- URL に券がある間は、第三者のスクリプトに URL を渡さない。特に **同じオリジンの iframe**（広告枠など）は、`Referrer-Policy` に関係なく、親ページの URL がそのまま `document.referrer` に入る。券がある間は広告枠を出さないか、iframe に `referrerpolicy="origin"` を付ける。
- 券がある間とは、受け取る前と、メニューの案内のために読み込み直したあと（`escapePending`）。受け取ったり捨てたりすると、キットが URL から消す。

## 開発

```bash
npm install
```

```bash
npm test
```

```bash
npm run check
```

```bash
npm run build
```
