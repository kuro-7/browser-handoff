# デモページ（実機確認用）

設計書 8章「試し方」のためのページ。GeoCutter を通さずに、キット（`../src`）をスマホで動かして確かめる。

画面には、今いる場所でやることだけを大きく出す。

- アプリ内ブラウザ: 「外のブラウザで開く」ボタン。開けなければ、券付きの URL で読み込み直して、メニューの案内を出す（`reloadWithTicket`）
- 通常のブラウザ・ホーム画面アプリ: 「受け取り」の結果（届きました／券なしで開きました など）。iPhone の Safari では「ホーム画面に追加」も出す
- どこでも: 「記録を送る」（記録をコピー、見たことのボタン、メモ）

場所の判定（`detectContext`）、ID の作り直し、開き方の切り替え（「手段なし」でメニューの練習など）は「詳しい情報・切り替え」に畳んである。合図（`visibilitychange` など）が何 ms で来たかは記録に残る。

記録は自動でサーバー（KV の `log:` で始まるキー、14日で消える）に送るので、試す人はコピーしなくてよい。開発者は次で読む（端末＝保存場所ごとに頭4文字の印が付く）。読む入口は公開していない。

```bash
npm run logs -- 30
```

送れないときのために「記録をコピー」も残してある（直近30分の分）。

「アカウント」は乱数の ID と記録の数を localStorage に置くだけ。記録の数は券の `payload` に乗せて運ぶ。

## 中身

| 置き場 | 中身 |
|---|---|
| `src/main.ts` | ページ。esbuild で `public/app.js` にまとめる |
| `public/` | `index.html`、アイコン、`_headers`（`Referrer-Policy: no-referrer`） |
| `functions/api/[action].ts` | `POST /api/issue`・`peek`・`redeem`・`discard`（Cloudflare Pages Functions） |
| `functions/manifest.webmanifest.ts` | `GET /manifest.webmanifest?handoff=…`。start_url に券を入れて返す |
| `server/kvStore.ts` | 保存先（Workers KV）。KV が無ければメモリに置く |
| `server/log.ts` | `POST /api/log`。ページの記録を KV に置く |
| `scripts/logs.mjs` | `npm run logs`。KV の記録を時刻順に並べる |

デモなので認証は無い。主体の ID は端末が送ってきたものをそのまま信じる。KV には条件付きの書き込みが無いので、`consume` は原子的でない（本番では使わない）。

## ローカルで動かす

```bash
cd demo
```

```bash
npm install
```

```bash
npm run dev
```

http://localhost:8788 で開く。KV はローカルのものが使われる。

## 出す（Cloudflare Pages）

出ている場所: https://browser-handoff-demo.pages.dev

Pages のプロジェクト `browser-handoff-demo` と KV の `HANDOFF_KV` は作ってあり、id は `wrangler.toml` に入っている。直したら:

```bash
npm run deploy
```

ログインが切れていたら、先に `npx wrangler login`。

実機ではこの URL を X・LINE・Instagram の DM や自分宛ての投稿に貼って、アプリの中から開く。

## 確かめること（設計書 8章）

どれも、開いた先の画面に「届きました」と出れば成功。

### ボタンから開けるか（A1・A4）

1. アプリ（X・LINE・Instagram など）の中でデモの URL を開く。いちばん上が「（アプリ名）のアプリ内ブラウザ」になるか見る
2. 「外のブラウザで開く」を押す
3. 開いた先に「届きました」と出るか見る。開く前に確認の画面が出たら、アプリに戻って「開く前に確認が出た」を押す
4. 両方の場所で「記録をコピー」

### メニューから開けるか（A2・A5）

1. アプリの中で「詳しい情報・切り替え」→ 開き方を「手段なし」にする
2. 「外のブラウザで開く」を押す。ページが読み込み直されて、メニューの案内が出る
3. 案内のとおりにアプリのメニューから開く。違っていたら「メニューの場所が違った」を押し、実際の場所をメモに書く
4. 開いた先に「届きました」と出るか見る
5. 終わったら開き方を「自動」に戻す

### Android の X が Custom Tabs 型か（A3）

X の中で開いて、いちばん上の ID が Chrome で開いたときと同じなら、保存場所が同じ（Custom Tabs 型）。

### iPhone のホーム画面アプリに届くか（B1）

1. Safari でデモを開き、「ホーム画面用の券を用意する」を押す
2. 共有 →「ホーム画面に追加」（iOS 26 の「Webアプリとして開く」はオン）
3. 追加したアイコンから開いて、「届きました」と「manifest の start_url で開いた」が出るか見る
4. 翌日以降に初めて開く場合も試す

「start_url ではない URL で開いた」と出たら、iOS が manifest を使っていない。「詳しい情報・切り替え」の「ページを開いたときにホーム画面用の券を自動で用意する」をオンにして読み込み直してから追加し、iOS が manifest を読む時機の違いかを確かめる。
