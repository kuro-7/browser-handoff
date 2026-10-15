"""Android 端末を adb で操作する小さな道具（デモの実機確認用）。

画面の部品は `uiautomator dump` で読み、文字や説明で探して押す。端末にアプリは入れない。
"""
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ADB = os.environ.get('ADB', 'adb')


def adb(*args, check=True, text=True):
    r = subprocess.run([ADB, *args], capture_output=True, text=text, encoding='utf-8' if text else None, errors='replace' if text else None)
    if check and r.returncode != 0:
        raise RuntimeError(f'adb {" ".join(args)}: {r.stderr}')
    return r.stdout


def shell(cmd, check=True):
    return adb('shell', cmd, check=check)


def screenshot(path):
    data = subprocess.run([ADB, 'exec-out', 'screencap', '-p'], capture_output=True).stdout
    with open(path, 'wb') as f:
        f.write(data)
    return path


class Node:
    def __init__(self, el):
        self.text = el.get('text', '')
        self.desc = el.get('content-desc', '')
        self.rid = el.get('resource-id', '')
        self.cls = el.get('class', '')
        self.pkg = el.get('package', '')
        self.clickable = el.get('clickable') == 'true'
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', el.get('bounds', '[0,0][0,0]'))
        self.x1, self.y1, self.x2, self.y2 = map(int, m.groups())

    @property
    def center(self):
        return (self.x1 + self.x2) // 2, (self.y1 + self.y2) // 2

    def __repr__(self):
        return f'<{self.cls.split(".")[-1]} text={self.text!r} desc={self.desc!r} id={self.rid.split("/")[-1]!r} {self.center}>'


def dump():
    """今の画面の部品を返す。"""
    for _ in range(3):
        # 前の結果が残っていると古い画面を読むので、先に消す（Instagram などは動き続けていて dump が失敗しやすい）。
        out = shell('rm -f /sdcard/handoff-ui.xml; uiautomator dump /sdcard/handoff-ui.xml >/dev/null 2>&1; cat /sdcard/handoff-ui.xml 2>/dev/null', check=False)
        if out.strip().startswith('<?xml'):
            root = ET.fromstring(out[out.index('<?xml'):].encode('utf-8'))
            return [Node(el) for el in root.iter('node')]
        time.sleep(0.5)
    raise RuntimeError('画面を読めませんでした')


def find(pattern, nodes=None, field=None):
    """text・content-desc・resource-id のどれかが正規表現に合う部品。"""
    nodes = nodes if nodes is not None else dump()
    rx = re.compile(pattern)
    fields = [field] if field else ['text', 'desc', 'rid']
    return [n for n in nodes if any(rx.search(getattr(n, f) or '') for f in fields)]


def tap(x, y):
    shell(f'input tap {x} {y}')


def tap_node(node):
    tap(*node.center)


def wait_for(pattern, timeout=10, field=None, interval=0.7):
    end = time.time() + timeout
    while time.time() < end:
        hits = find(pattern, field=field)
        if hits:
            return hits
        time.sleep(interval)
    return []


def tap_text(pattern, timeout=10, field=None, index=0):
    hits = wait_for(pattern, timeout, field)
    if not hits:
        raise LookupError(f'見つかりません: {pattern}')
    tap_node(hits[index])
    return hits[index]


def back():
    shell('input keyevent KEYCODE_BACK')


def home():
    shell('input keyevent KEYCODE_HOME')


def launch(package):
    shell(f'monkey -p {package} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1')


def foreground():
    """前面のアプリ。アプリを切り替えている途中は、前面が無いことがある（空を返す）。"""
    out = shell('dumpsys activity activities | grep -m1 topResumedActivity', check=False)
    m = re.search(r'u0 ([\w.]+)/', out)
    return m.group(1) if m else out.strip()


def stop(package):
    shell(f'am force-stop {package}')


if __name__ == '__main__':
    # python phone.py dump  → 今の画面の部品を出す
    if sys.argv[1:] == ['dump']:
        for n in dump():
            if n.text or n.desc:
                print(n)
