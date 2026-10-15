# デモページ（実機確認用）

設計書 8章「試し方」のためのページ。GeoCutter を通さずに、キット（`../src`）をスマホで動かして確かめる。

画面に出すもの:

- 今いる場所（`detectContext`）
- 外のブラウザの開き方（`planEscape`）と、押した結果（`escapeToBrowser` の opened / fallback）。どの合図（`visibilitychange`・`pagehide`・`blur`・タイマーの遅れ）が何 ms で来たかも出す
- ページを開いたときの受け取りの判断（`startRedemption`）。adopt なら自動で受け取り、choose なら2つのボタンを出す
- ホーム画面用の券と、差し替えた manifest（B1）

押したことと結果は「記録」に残る。「記録をコピー」で全文をコピーできる（アプリ内ブラウザでコピーできないときは、全文の欄を長押しして選ぶ）。記録は保存場所ごとに別なので、アプリ内ブラウザとブラウザの両方でコピーする。

「アカウント」は乱数の ID と記録の数を localStorage に置くだけ。記録の数は券の `payload` に乗せて運ぶ。

## 中身

| 置き場 | 中身 |
|---|---|
| `src/main.ts` | ページ。esbuild で `public/app.js` にまとめる |
| `public/` | `index.html`、アイコン、`_headers`（`Referrer-Policy: no-referrer`） |
| `functions/api/[action].ts` | `POST /api/issue`・`peek`・`redeem`・`discard`（Cloudflare Pages Functions） |
| `functions/manifest.webmanifest.ts` | `GET /manifest.webmanifest?handoff=…`。start_url に券を入れて返す |
| `server/kvStore.ts` | 保存先（Workers KV）。KV が無ければメモリに置く |

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

### A1: iOS の X・LINE・Instagram で、ボタンから Safari が開くか

1. アプリの中でデモの URL を開く。「今いる場所」が「iPhone・iPad の X のアプリ内ブラウザ」のようになるか見る（ならなければ UA ごと記録する）
2. 「外のブラウザで開く」を押す
3. Safari が開いたら、Safari 側の「受け取り」が `adopt` で、ID がアプリ内と同じになるか見る
4. 開く前に「Safari で開きますか？」のような確認が出たら、「開く前に確認が出た」を押す
5. アプリに戻り、結果（opened / fallback と最初の合図）を見て、記録をコピーする

開き方の欄で、ほかのアプリの方法（例: Instagram の中で `x-safari-https://`）も試せる。

### A2・A5: メニューの表が今の版と合っているか

1. 開き方を「手段なし」にして押す（または A1 でだめだったとき）
2. 出てくる案内（「共有ボタン → …」など）のとおりにアプリのメニューを探す
3. 合っていれば「メニューの場所は表のとおり」、違えば「メニューの場所が違った」を押し、実際の場所とアプリの版をメモに書く
4. メニューから開いたブラウザで、受け取りが `adopt` になるか見る

### A3・A4: Android の X が Custom Tabs 型か、`intent://` が効くか

1. X の中で開き、「今いる場所」と ID を見る。Chrome で開いたときと同じ ID なら保存場所が同じ（Custom Tabs 型）
2. アプリ内ブラウザ（`in-app`）と出るアプリで「外のブラウザで開く」を押し、既定のブラウザが開くか見る

### B1: iOS で差し替えた manifest の start_url が使われるか

1. Safari でデモを開き、「ホーム画面用の券を用意する」を押す
2. 共有 →「ホーム画面に追加」（iOS 26 の「Webアプリとして開く」はオン）
3. 追加したアイコンから開く。「受け取り」に「manifest の start_url で開いた」と出て、判断が `adopt` なら届いている
4. 翌日以降に初めて開く場合も試す（もう1台、または ID を作り直してから追加し、日を空けて開く）

「start_url ではない URL で開いた」と出たら、iOS が manifest を使っていない。そのときは「ページを開いたときに自動で用意する」をオンにして読み込み直してから追加し、iOS が manifest を読む時機の違いかを確かめる。

ホーム画面アプリで初めて開いて ID も券も無ければ、記録に「B2: 券が届かなかった」と出る。
