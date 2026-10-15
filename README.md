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
- `HandoffStore` を実装する（`consume` は原子的に）。
- 全ページのヘッダーに `Referrer-Policy: no-referrer` を付ける（URL に乗せた引換券が漏れないように）。
- 画面と文言（「Safari で続きから遊ぶ」ボタン、メニューの案内、どちらを使うか選ぶ画面、知らせ）。

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
