"""デモの実機確認を、つないだ Android 端末で自動で流す。

    python run.py                          全部
    python run.py line_button ig_back      選んだものだけ

各シナリオは、アプリを開き直してデモのリンクをタップし、ボタンや確認を押して、
画面に出た結果を読んで判定する。失敗したら画面の写しを残す。
アプリで触るのは「リンクを開く・ボタンやメニューを押す・戻る」だけ。投稿や送信はしない。

言語に頼らないように、なるべく文言ではなく名前（id）で探す。
- デモのページ: HTML の id（escape-button、status-arrived など）。WebView はこれを resource-id として出す
- Instagram の確認: Android 標準の確認画面なので android:id/button1（次へ）・button2（戻る）
- Instagram の会話: URL（ig.me）で直接開く
名前の無いもの（LINE のトーク検索、X のメニュー）だけ、端末の言語ごとの言葉（WORDS）を使う。
"""
import json
import os
import sys
import time
import traceback

import phone

LINE = 'jp.naver.line.android'
X = 'com.twitter.android'
IG = 'com.instagram.android'
CHROME = 'com.android.chrome'

DEMO_URL = r'^https://browser-handoff-demo\.pages\.dev/$'
DEMO_HOST = r'^browser-handoff-demo\.pages\.dev$'

# デモのリンクを置いた場所は、流す人のアカウントなので repo に入れない。
# accounts.json（git に入らない）に書く。書き方は accounts.example.json。
# worktree から流すときは、環境変数 HANDOFF_ACCOUNTS で本体の accounts.json を指せる。
ACCOUNTS_FILE = os.environ.get('HANDOFF_ACCOUNTS') or os.path.join(os.path.dirname(__file__), 'accounts.json')


def _accounts():
    try:
        with open(ACCOUNTS_FILE, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


_ACC = _accounts()
IG_THREAD = _ACC.get('instagram_thread_url', '')  # デモのリンクを送った Instagram の会話（https://ig.me/m/…）
X_ACCOUNT_HANDLE = _ACC.get('x_handle', '')         # 自分宛ての DM にデモのリンクがある X のアカウント（@…）
X_ACCOUNT_NAME = _ACC.get('x_display_name', '')     # その表示名（切り替えの部品はこれで呼ばれる）
LINE_CHAT_QUERY = _ACC.get('line_chat_query', 'Keep')  # LINE のトーク検索に入れる語（ASCII のみ）


def need(value, key):
    if not value:
        raise Fail(f'{ACCOUNTS_FILE} に {key} がありません（accounts.example.json を見て書く）')
    return value

# 名前（id）の無い部品の言葉。端末の言語ごと。en は未確認。
WORDS = {
    'ja': {
        'line_search': r'^検索$',
        'line_keep_chat': r'^Keepメモ$',
        'x_drawer': r'^スライドメニューを表示$',
        'x_switch_to': r'^{name}に切り替える$',
        'x_messages': r'^メッセージ$',
        'x_self_thread': r'^自分, ',
    },
    'en': {
        'line_search': r'^Search$',
        'line_keep_chat': r'^Keep Memo$',
        'x_drawer': r'^Show navigation drawer$',
        'x_switch_to': r'^Switch to {name}$',
        'x_messages': r'^Messages$',
        'x_self_thread': r'^You, ',
    },
}

OUT = os.environ.get('HANDOFF_OUT', os.path.join(os.path.dirname(__file__), 'out'))


class Fail(Exception):
    pass


def words():
    locale = phone.shell('getprop persist.sys.locale').strip() or phone.shell('getprop ro.product.locale').strip()
    lang = locale.split('-')[0]
    if lang not in WORDS:
        raise Fail(f'端末の言語 {locale!r} の言葉がありません（run.py の WORDS に足す）')
    return WORDS[lang]


def rid(name):
    """デモのページや Android 標準の部品の id（resource-id の末尾）。"""
    return rf'(^|/){name}$'


def tap_id(name, timeout=15):
    return phone.tap_text(rid(name), timeout=timeout, field='rid')


def demo_ids():
    return [n.rid.split('/')[-1] for n in phone.find(r'(^|/)(status|place)-', field='rid')]


def expect_id(name, timeout=15):
    if not phone.wait_for(rid(name), timeout=timeout, field='rid'):
        raise Fail(f'{name} が出ない（出ているもの: {demo_ids() or "なし"}）')


def in_chrome(timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        if phone.foreground() == CHROME:
            return True
        time.sleep(0.7)
    return False


def chrome_arrived():
    if not in_chrome():
        raise Fail(f'Chrome が開かない（前面: {phone.foreground()}）')
    expect_id('status-arrived', timeout=15)


# ---------- アプリを開いて、デモのページまで行く ----------

def open_line():
    w = words()
    phone.stop(LINE)
    phone.launch(LINE)
    phone.tap_text(w['line_search'], timeout=15, field='text')
    time.sleep(1)
    phone.shell(f'input text {LINE_CHAT_QUERY}')
    phone.tap_text(w['line_keep_chat'], field='text')
    phone.tap_text(DEMO_URL, field='text', index=-1)


def x_open_drawer(w):
    """X は前に開いていた画面（カスタムタブや会話）のまま戻ってくることがあるので、
    メニューのボタンが出るまで「戻る」を押す。"""
    for _ in range(5):
        hits = phone.wait_for(w['x_drawer'], timeout=6, field='desc')
        if hits:
            phone.tap_node(hits[0])
            return
        if phone.foreground() not in (X, CHROME):
            phone.launch(X)
        else:
            phone.back()
        time.sleep(1.5)
    raise Fail(f'X のホームに戻れない（前面: {phone.foreground()}）')


def x_use_account(w):
    need(X_ACCOUNT_HANDLE, 'x_handle')
    need(X_ACCOUNT_NAME, 'x_display_name')
    """X で別のアカウントが開いていても、リンクを置いたアカウントに切り替える。
    メニューの頭に今のアカウントの @名前 が出るので、それで確かめる。"""
    for _ in range(3):
        x_open_drawer(w)
        time.sleep(1.5)
        if phone.find(rf'^{X_ACCOUNT_HANDLE}$', field='text'):
            phone.back()
            time.sleep(1)
            return
        switch = phone.find(w['x_switch_to'].format(name=X_ACCOUNT_NAME), field='desc')
        if not switch:
            raise Fail(f'X のメニューに {X_ACCOUNT_HANDLE} への切り替えが無い')
        phone.tap_node(switch[0])
        time.sleep(4)
    raise Fail(f'X を {X_ACCOUNT_HANDLE} に切り替えられない')


def open_x():
    w = words()
    phone.stop(X)
    phone.launch(X)
    x_use_account(w)
    phone.tap_text(w['x_messages'], field='desc')
    phone.tap_text(w['x_self_thread'], field='desc')
    phone.tap_text(DEMO_HOST, field='text', index=-1)


def open_instagram():
    # ホーム画面は動き続けていて読めないので、会話に URL で直接飛ぶ。
    # 止めた直後に飛ぶと会話が読み込まれないことがあるので、先に起動しておき、出なければ飛び直す。
    need(IG_THREAD, 'instagram_thread_url')
    phone.stop(IG)
    phone.launch(IG)
    time.sleep(6)
    for _ in range(3):
        phone.shell(f'am start -a android.intent.action.VIEW -d {IG_THREAD} -p {IG} >/dev/null 2>&1')
        if phone.wait_for(DEMO_URL, timeout=10, field='text'):
            break
        phone.back()
        time.sleep(2)
    phone.tap_text(DEMO_URL, timeout=5, field='text', index=-1)


def at_demo(kind='in-app'):
    expect_id(f'place-{kind}', timeout=20)


# ---------- シナリオ ----------

def line_button():
    open_line()
    at_demo()
    tap_id('escape-button')
    chrome_arrived()
    phone.launch(LINE)
    expect_id('status-arrived', timeout=12)
    return 'ボタン → Chrome で受け取り、LINE に戻ると「届きました」'


def ig_next():
    open_instagram()
    at_demo()
    tap_id('escape-button')
    tap_id('button1', timeout=10)  # 確認の「次へ」
    chrome_arrived()
    phone.back()  # Chrome から Instagram に戻る
    time.sleep(2)
    expect_id('status-arrived', timeout=12)
    return 'ボタン → 確認で「次へ」→ Chrome で受け取り、戻ると「届きました」'


def ig_back():
    open_instagram()
    at_demo()
    tap_id('escape-button')
    tap_id('button2', timeout=10)  # 確認の「戻る」
    expect_id('status-button-failed', timeout=15)
    return 'ボタン → 確認で「戻る」→「ボタンでは開けませんでした」'


def ig_away():
    open_instagram()
    at_demo()
    tap_id('escape-button')
    phone.wait_for(rid('button1'), timeout=10, field='rid')
    phone.home()
    time.sleep(3)
    phone.launch(IG)
    # 戻っても確認が出たままで、その裏は読めない。確認を「戻る」で閉じてから読む。
    time.sleep(6)
    tap_id('button2', timeout=10)
    expect_id('status-not-arrived', timeout=15)
    return 'ボタン → 確認のままほかのアプリへ → 戻ると「まだ届いていません」'


def x_link():
    open_x()
    if not phone.wait_for(r'(^|/)place-', timeout=20, field='rid'):
        raise Fail(f'デモが開かない（前面: {phone.foreground()}）')
    places = [p for p in demo_ids() if p.startswith('place-')]
    if 'place-browser' in places:
        return 'リンクは Chrome のカスタムタブで開いた（保存場所が Chrome と同じ。引き継ぎ不要）'
    if 'place-in-app' in places:
        return 'リンクは X のアプリ内ブラウザで開いた（メニューの案内になる）'
    raise Fail(f'どこで開いたか分からない（{places}）')


# ---------- 画面の寸法を測る（デモの「画面の寸法を測る」） ----------
# 値はデモが記録に残すので、ここでは操作と画面の写しだけ。結果は `npm run logs -- 15 --ua <アプリ>` で読む。

def scroll_page(direction, times=1):
    """ページを動かす。'down' は下の方を見る（指を上へ）。"""
    for _ in range(times):
        if direction == 'down':
            phone.shell('input swipe 540 1700 540 700 300')
        else:
            phone.shell('input swipe 540 700 540 1700 300')
        time.sleep(1.2)


def find_id_scrolling(*names, max_scrolls=10):
    """どれかの部品が画面の中に見えるまで下へ動かす。見えた名前と部品を返す。"""
    for _ in range(max_scrolls):
        nodes = phone.dump()
        for name in names:
            hits = phone.find(rid(name), nodes, field='rid')
            if hits and 250 < hits[0].center[1] < 2050:
                return name, hits[0]
        scroll_page('down')
    raise Fail(f'{"・".join(names)} が見つからない')


def tap_id_scrolling(name):
    phone.tap_node(find_id_scrolling(name)[1])


def snap(label):
    return phone.screenshot(os.path.join(OUT, f'{label}.png'))


def measure_here(app):
    """今開いているデモで、寸法を測る（cover あり・なし、上と下へのスクロール）。"""
    name, node = find_id_scrolling('measure-start', 'measure-stop')
    if name == 'measure-start':
        phone.tap_node(node)  # オンにすると読み込み直す
        time.sleep(4)
    else:
        scroll_page('up', 6)
    shots = []
    for fit in ('cover', 'nofit'):
        time.sleep(2)
        shots.append(snap(f'measure_{app}_{fit}_top'))
        scroll_page('down', 3)
        shots.append(snap(f'measure_{app}_{fit}_scrolled'))
        scroll_page('up', 5)
        time.sleep(2)
        tap_id_scrolling('measure-fit')  # cover を切り替えて読み込み直す
        time.sleep(4)
    # 元に戻す（cover あり・測るのをやめる）。
    tap_id_scrolling('measure-stop')
    time.sleep(3)
    return f'測った（画面の写し {len(shots)} 枚: {os.path.dirname(shots[0])}）'


def measure_x():
    open_x()
    phone.wait_for(r'(^|/)place-', timeout=20, field='rid')
    return measure_here('x')


def measure_line():
    open_line()
    at_demo()
    return measure_here('line')


def measure_ig():
    open_instagram()
    at_demo()
    return measure_here('instagram')


SCENARIOS = {f.__name__: f for f in [line_button, ig_next, ig_back, ig_away, x_link]}
# 寸法は、名前を指定したときだけ流す（python run.py measure_x measure_line measure_ig）。
MEASURE = {f.__name__: f for f in [measure_x, measure_line, measure_ig]}


def main(names):
    os.makedirs(OUT, exist_ok=True)
    results = []
    for name in names or SCENARIOS:
        scenario = SCENARIOS.get(name) or MEASURE[name]
        started = time.strftime('%H:%M:%S')
        try:
            phone.wake()
            note = scenario()
            results.append((name, 'OK', note))
        except Exception as e:  # noqa: BLE001
            shot = phone.screenshot(os.path.join(OUT, f'{name}.png'))
            detail = str(e) if isinstance(e, (Fail, LookupError)) else traceback.format_exc(limit=2)
            results.append((name, 'NG', f'{detail}（画面: {shot}）'))
        print(f'{started} {results[-1][0]}: {results[-1][1]} {results[-1][2]}', flush=True)
        phone.home()
        time.sleep(1)
    print()
    print(f'{sum(r[1] == "OK" for r in results)}/{len(results)} OK')


if __name__ == '__main__':
    main(sys.argv[1:])
