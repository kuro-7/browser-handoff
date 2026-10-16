# このリポジトリでの決まり

- 実機テストで使うアカウント名は `demo/device/accounts.json`（git に入れない）にある。このファイルは読まない（`.claude/settings.json` で読めないようにしてある）。`demo/device/run.py` が自分で読む。
- 画面の写しや記録にアカウント名が映っても、ドキュメント・コード・コミット・PR に写さない。「自分のアカウント」「自分宛ての DM」と書く。
- コミットのたびに `demo/device/check_secrets.py` が、足される行とコミットのメッセージに accounts.json の値が入っていないか確かめる。clone したら一度だけ次を流す:

  ```bash
  git config core.hooksPath .githooks
  ```
