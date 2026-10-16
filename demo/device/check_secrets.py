"""コミットにアカウント名が入っていないか確かめる（git のフックから呼ぶ）。

accounts.json の値と、コミットに足される行（またはコミットのメッセージ）を比べる。
見つけても値そのものは出さない（どの項目と同じかだけ出す）。accounts.json が無ければ何もしない。

  python demo/device/check_secrets.py            # 足される行（git diff --cached）を見る
  python demo/device/check_secrets.py <file>     # ファイルの中身（コミットのメッセージ）を見る
"""

import json
import pathlib
import re
import subprocess
import sys

ACCOUNTS_FILE = pathlib.Path(__file__).with_name('accounts.json')
# アプリ自身のチャット名など、個人を指さない項目。
NOT_SECRET = {'line_chat_query'}
MIN_LEN = 3


def secrets():
    try:
        data = json.loads(ACCOUNTS_FILE.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return []
    found = []
    for key, value in data.items():
        if key in NOT_SECRET or not isinstance(value, str):
            continue
        words = {value.strip(), value.strip().lstrip('@')}
        # URL なら最後の区切り（アカウントの名前）も。
        words.add(value.rstrip('/').rsplit('/', 1)[-1])
        for word in words:
            if len(word) >= MIN_LEN:
                found.append((key, word.lower()))
    return found


def added_lines():
    out = subprocess.run(
        ['git', 'diff', '--cached', '-U0', '--no-color'],
        capture_output=True, text=True, encoding='utf-8', errors='replace', check=True,
    ).stdout
    file = '?'
    for line in out.splitlines():
        if line.startswith('+++ '):
            file = re.sub(r'^\+\+\+ (b/)?', '', line)
        elif line.startswith('+'):
            yield file, line[1:]


def main():
    sys.stderr.reconfigure(encoding='utf-8')
    found = secrets()
    if not found:
        return 0
    if len(sys.argv) > 1:
        text = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8', errors='replace')
        lines = [('コミットのメッセージ', line) for line in text.splitlines() if not line.startswith('#')]
    else:
        lines = list(added_lines())
    hits = set()
    for where, line in lines:
        low = line.lower()
        for key, word in found:
            if word in low:
                hits.add((where, key))
    for where, key in sorted(hits):
        print(f'アカウント名が入っています: {where}（accounts.json の {key} と同じ）', file=sys.stderr)
    if hits:
        print('「自分のアカウント」などに書き換えてください。', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
