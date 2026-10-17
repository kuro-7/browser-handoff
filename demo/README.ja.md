# デモページ（実機確認用）

設計書 8章「試し方」のためのページ。GeoCutter を通さずに、キット（`../src`）をスマホで動かして確かめる。

画面には、今いる場所でやることだけを大きく出す。

- アプリ内ブラウザ: 「外のブラウザで開く」ボタン。開けなければ、券付きの URL で読み込み直して、メニューの案内を出す（`reloadWithTicket`）
- 通常のブラウザ・ホーム画面アプリ: 「受け取り」の結果（届きました／券なしで開きました など）。iPhone のブラウザ（Safari・Chrome など）では「ホーム画面に追加」も出す
- どこでも: 「記録を送る」（記録をコピー、見たことのボタン、メモ）

「画面の寸法を測る」を押すと、アプリ内ブラウザのバーとページの寸法（`env(safe-area-inset-*)`、`innerHeight`、`visualViewport` など）を画面の右上に出し続け、変わるたびに記録に残す（設計書 4章「アプリ内ブラウザのバーとページの寸法」）。`viewport-fit=cover` のありなしも切り替えられる。iPhone では「Chrome で開く」ボタンも出る。

場所の判定（`detectContext`）、ID の作り直し、開き方の切り替え（「手段なし」でメニューの練習など）は「詳しい情報・切り替え」に畳んである。合図（`visibilitychange` など）が何 ms で来たかは記録に残る。

記録は自動でサーバー（KV の `log:` で始まるキー、14日で消える）に送るので、試す人はコピーしなくてよい。開発者は次で読む（端末＝保存場所ごとに頭4文字の印が付く）。読む入口は公開していない。

```bash
npm run logs -- 30
```

デモは誰でも開けるので、ほかの人の記録も混ざる。端末が2つ以上あると端末の一覧だけを出すので、`--device`（端末の頭の文字、カンマ区切り）か `--ua`（ブラウザの名乗りに含まれる語。例 `SCG13`）で絞る。全部見るなら `--all`。出す行は既定で 300 まで（`--max`）。

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
| `scripts/logs.mjs` | `npm run logs`。KV の記録を時刻順に並べる（端末で絞れる） |
| `scripts/switch.mjs` | `npm run demo:on`・`demo:off`。デモを開ける・止める |

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

Pages のプロジェクト `browser-handoff-demo` と KV の `HANDOFF_KV` は作ってあり、id は `wrangler.toml` に入っている。

**ふだんは止めておく。** デモは誰でも開けて、API（Pages Functions）は断る処理も1回の実行として数えられる。bot に連打されると料金がかかるので、ふだんは API の無い「停止中」のページだけを出しておき、試すときだけ開ける。静的なページは何回開かれても料金がかからない。

```bash
npm run demo:on
```

```bash
npm run demo:off
```

どちらも、出したもの以外のデプロイを消す。Pages は過去のデプロイも個別の URL（`<id>.browser-handoff-demo.pages.dev`）で動き続けるので、残すと止めたことにならない。試し終わったら必ず `demo:off` に戻す。

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

1. iPhone のブラウザ（Safari・Chrome など）でデモを開き、「ホーム画面用の券を用意する」を押す
2. 共有 →「ホーム画面に追加」（iOS 26 の「Webアプリとして開く」はオン。Chrome は共有ボタンから）
3. 追加したアイコンから開いて、「届きました」と「manifest の start_url で開いた」が出るか見る
4. 翌日以降に初めて開く場合も試す

「start_url ではない URL で開いた」と出たら、iOS が manifest を使っていない。「詳しい情報・切り替え」の「ページを開いたときにホーム画面用の券を自動で用意する」をオンにして読み込み直してから追加し、iOS が manifest を読む時機の違いかを確かめる。それでもだめなら「用意したとき、ページの URL にも券を付ける」をオンにして追加し、追加したときの URL で開いたら届くか（起動 URL が「追加したときのページの URL で開いた」）を見る。

### iPhone でまとめて確かめる

iPhone で確かめる項目（A1・A2、Chrome をふだん使いにしたとき、寸法、B1、リンクを引き取らないこと）は、当日上から順に進められるチェックリストにしてある: [`docs/ios-check.ja.md`](../docs/ios-check.ja.md)。

- いちばん上の場所の表示には、通常のブラウザならどのブラウザか（Safari・Chrome など）も出る。Chrome をふだん使いにした iPhone で、どれが開いたかを見るため
- iOS の X のように、アプリの中なのに「通常のブラウザ」と判定されたときは、その下の「アプリの中で開いているのに『通常のブラウザ』と出たとき」で、アプリ内ブラウザとして扱える（その保存場所だけに残る。「元に戻す」で戻す）
- 「画面の寸法を測る」では、赤（`bottom: 0`）・緑（`env(safe-area-inset-bottom)`）に加えて、青（`100vh` の下端）・橙（`100dvh` の下端）の線と、左端に 50px ごとの目盛りを出す。画面の写しから位置を読むため

## Android 実機で自動で確かめる（`device/`）

USB デバッグでつないだ Android 端末で、LINE・Instagram・X の動きを自動で流します（Python と adb が要ります）。

```
cd device
python run.py                 # 全部
python run.py ig_next x_link  # 選んだものだけ
```

- アプリで触るのは「リンクを開く・ボタンや確認を押す・戻る」だけで、投稿や送信はしません。流している間は端末が勝手に動きます。
- 文言ではなく名前で探します。デモのページは HTML の id（`escape-button`、`status-arrived`、`place-in-app` など）、Instagram の確認は Android 標準の `button1`（次へ）・`button2`（戻る）、Instagram の会話は URL で直接開きます。
- 名前の無い LINE のトーク検索と X のメニューだけは、端末の言語ごとの言葉（`run.py` の `WORDS`）を使います。確かめたのは日本語だけです。
- デモのリンクを置いた場所（Instagram の会話、X のアカウント、LINE のトーク）は、`device/accounts.json` に書きます（git には入りません）。書き方は `device/accounts.example.json` を見てください。
- 環境変数: `ADB`（adb の場所）、`HANDOFF_OUT`（失敗したときの画面の写しの置き場所）。
