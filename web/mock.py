#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""回放电台 v5.0 本地 mock 服务。

只用于浏览器里的几何 / 交互验证：不连接 B 站、不读真实数据，
所有节目 / 弹幕 / 直播数据都是固定种子生成的假数据。验证完 Ctrl-C 即可。

    python3 mock.py                 # 0.0.0.0:18801
    python3 mock.py --port 18999    # 换端口

静态文件从本文件所在目录读取。index.html / app.css 由前端作者维护，
mock 不生成、不覆盖它们；素材放在同目录 mockdata/ 下。
"""

import argparse
import base64
import datetime as dt
import hashlib
import json
import mimetypes
import os
import random
import socket
import struct
import threading
import time
import urllib.parse
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
ASSET_DIR = os.path.join(ROOT, "mockdata")

VERSION = "8.2.0"
BUILD = "apk-820"
DEFAULT_PORT = 18801

# ---------------------------------------------------------------- 线程与状态

STATE_LOCK = threading.Lock()      # STATIONS / 请求计数
PROGRAM_LOCK = threading.Lock()    # PROGRAM_CACHE
SSE_LOCK = threading.Lock()        # SSE 客户端数 / 全局序号

STATIONS = [
    {
        "id": "1001", "name": "夜航星", "short": "夜航", "mid": "1001",
        "room": "2233", "face": "", "main": True, "has_programs": True,
        "tag": "", "site": "bilibili", "accent": "#ff3b4e", "weibo": "",
        "series": {"id": "s1", "source": "series", "name": "直播回放",
                   "total": 0, "error": ""},
    },
    {
        "id": "1002", "name": "雾岛听风", "short": "雾岛", "mid": "1002",
        "room": "3344", "face": "", "main": False, "has_programs": True,
        "tag": "", "site": "bilibili", "accent": "#3ba7ff", "weibo": "",
        "series": {"id": "s2", "source": "series", "name": "直播回放",
                   "total": 0, "error": ""},
    },
    {
        "id": "1003", "name": "南岸未眠", "short": "南岸", "mid": "1003",
        "room": "5566", "face": "", "main": False, "has_programs": True,
        "tag": "", "site": "bilibili", "accent": "#f5a623", "weibo": "",
        "series": {"id": "s3", "source": "series", "name": "直播回放",
                   "total": 0, "error": ""},
    },
]

PROGRAM_CACHE = {}
SSE_STATE = {"clients": 0, "seq": 0}
REQUEST_COUNT = [0]

# ---------------------------------------------------------------- 固定素材

DM_COLORS = [16777215, 16777215, 16777215, 16711680, 65280, 255, 16744192]

DM_TEXTS = [
    "这段太好听了",
    "来了来了",
    "主播今天状态不错",
    "这首歌点播的有吗",
    "耳机党表示很满足",
    "刚下班，赶上了",
    "这个转音绝了",
    "求歌名！",
    "背景音乐是什么",
    "循环一整晚",
    "声音再大一点点",
    "晚安各位，明天见",
    "这首好久没听到了",
    "有没有人一起听",
    "这期能出切片吗",
    "主播别急着下播",
    "刚进来，前面唱到哪了",
    "今天人好多",
    "这段和声好稳",
    "已三连，等回放",
]

SSE_NAMES = [
    "夜航的小话筒", "追光的鲸", "三点睡不着的猫", "阿柚不熬夜",
    "冬眠中的灯塔", "路人甲乙丙", "听风的人", "薄荷汽水",
    "慢半拍", "雨落在窗台", "千层酥", "海边旧收音机",
    "星屑收集者", "半个柠檬", "猫咪监护人", "老式卡带",
    "第七次路过", "月亮邮差", "深夜食堂常客", "一只白噪音",
    "提词器坏了", "睡前一小时", "云层以下", "断线的耳机",
    "木木不吃香菜", "北纬三十度", "凌晨四点的便利店", "橘色信号灯",
]

SSE_TEXTS = [
    "这段太好听了", "来了来了", "主播今天状态不错", "这首歌点播的有吗",
    "耳机党狂喜", "刚下班赶上了", "声音再大一点", "这个转音绝了",
    "循环一整晚", "求歌名", "背景音乐是什么", "晚安各位",
    "明天还播吗", "这首歌好久没听", "有没有人一起听", "音量刚刚好",
    "求个回放链接", "这期能出切片吗", "主播别下播", "刚进来，唱到哪了",
    "灯牌亮了", "今天人好多", "这段和声好稳", "已三连",
]

SUPERCHAT_TEXTS = [
    "生日回快乐！", "点一首《晚风》可以吗", "辛苦啦，今晚很好听",
    "给主播加个鸡腿", "明天也要开心",
]

CATEGORIES = ["歌回", "杂谈", "游戏", "联动"]

CATEGORY_TITLES = {
    "歌回": [
        "点歌台｜今晚只唱你们点的那些",
        "凌晨的吉他弹唱，声音放轻一点",
        "老歌专场：从 2000 年一路唱到现在",
        "把上次没唱完的几首补上",
        "随机歌单，抽到哪首唱哪首",
        "深夜歌回：这一首送给还没睡的人",
        "粤语歌专场，这次尽量不跑调",
        "和声练习：一个人拆成两轨",
        "唱到嗓子有点哑就下播",
    ],
    "杂谈": [
        "深夜杂谈：最近在循环的几张专辑",
        "你们问什么我就答什么，别太狠",
        "近况汇报：这周过得有点快",
        "聊聊回放电台接下来想做的事",
        "被弹幕问住的十个问题",
        "睡前碎碎念，说完就真的下播",
        "那些年追过的番，现在还会重看吗",
        "评论区点题：一个人怎么过周末",
        "二十三点的客厅，随便聊聊近况",
    ],
    "游戏": [
        "今晚把这张地图打通再睡",
        "恐怖游戏：灯别关，我有点怕",
        "排位日记：从青铜开始重新打",
        "联机摸金，队友别在关键时刻掉线",
        "休闲游戏专场，输了就唱歌",
        "第一次玩这个，你们别笑我",
        "速通练习：这次能进四十分钟吗",
        "被小怪追着跑了三条街",
        "合作解谜：到底是谁在拖后腿",
    ],
    "联动": [
        "四联动：今晚谁先破防",
        "联动歌会：三个人一台戏",
        "跨区联动，信号好像不太行",
        "联机猜歌，输的人请奶茶",
        "和友台一起过周末",
        "五人联机：分工全靠吼",
        "联动杂谈：两边粉丝互问互答",
        "联动挑战：惩罚环节放在最后",
        "临时联动：隔壁主播突然敲门",
    ],
}

PART_NAMES = {
    1: ["全场"],
    2: ["上半场", "下半场"],
    3: ["上半场", "中场", "安可"],
}

BASE_TIME = dt.datetime(2026, 11, 24, 21, 30,
                        tzinfo=dt.timezone(dt.timedelta(hours=8)))
BVID_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _png_chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def _make_pixel_png(rgb=(0x2B, 0x2B, 0x2B)):
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = bytes((0,)) + bytes(rgb)
    return (b"\x89PNG\r\n\x1a\n"
            + _png_chunk(b"IHDR", ihdr)
            + _png_chunk(b"IDAT", zlib.compress(raw, 9))
            + _png_chunk(b"IEND", b""))


PIXEL_PNG = _make_pixel_png()

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
}


# ---------------------------------------------------------------- 工具函数

def _deepcopy(obj):
    return json.loads(json.dumps(obj, ensure_ascii=False))


def _stations_locked():
    """已有 STATE_LOCK 时调用。"""
    main = next((s["id"] for s in STATIONS if s.get("main")), "")
    if not main and STATIONS:
        main = STATIONS[0]["id"]
    return {
        "ok": True,
        "main": main,
        "stations": _deepcopy(STATIONS),
    }


def stations_snapshot():
    with STATE_LOCK:
        return _stations_locked()


def find_station(key):
    """按 id / mid / 系列 id 找站，找不到回落到主站。"""
    key = str(key or "").strip()
    with STATE_LOCK:
        for s in STATIONS:
            if key and key in (s["id"], s["mid"], s["series"]["id"]):
                return _deepcopy(s)
        for s in STATIONS:
            if s.get("main"):
                return _deepcopy(s)
        return _deepcopy(STATIONS[0]) if STATIONS else None


def _seed_for(mid):
    if str(mid).isdigit():
        return 20261114 + int(mid) * 17
    return 20261114 + (zlib.crc32(str(mid).encode("utf-8")) & 0xFFFF)


def _mock_bvid(mid, index):
    digest = hashlib.sha1(("%s:%s:rr500" % (mid, index)).encode("utf-8")).hexdigest()
    n = int(digest[:20], 16)
    chars = []
    for _ in range(9):
        chars.append(BVID_ALPHABET[n % len(BVID_ALPHABET)])
        n //= len(BVID_ALPHABET)
    return "BV1" + "".join(chars)


def build_programs(station):
    """固定种子生成 36 个节目；同一站每次得到完全相同的数据。"""
    mid = station["mid"]
    rng = random.Random(_seed_for(mid))
    crc = zlib.crc32(str(mid).encode("utf-8"))
    programs = []

    for i in range(36):
        category = CATEGORIES[i % len(CATEGORIES)]
        title = CATEGORY_TITLES[category][i // len(CATEGORIES)]

        total = rng.randint(30, 120) * 60          # 1800 ~ 7200 秒
        part_count = rng.randint(1, 3)
        weights = [rng.uniform(0.75, 1.30) for _ in range(part_count)]
        weight_sum = sum(weights)
        durations = [int(total * w / weight_sum) for w in weights]
        durations[-1] += total - sum(durations)

        parts = []
        for pi, part_duration in enumerate(durations):
            page = pi + 1
            parts.append({
                "cid": str(100000000 + (crc % 90) * 10000 + i * 100 + page),
                "page": page,
                "part": PART_NAMES[part_count][pi],
                "duration": int(part_duration),
                "dm_total": max(80, int(part_duration) // 6 + rng.randint(0, 600)),
            })

        dm_total = sum(p["dm_total"] for p in parts)
        pub = BASE_TIME - dt.timedelta(days=i, minutes=(i * 37) % 240)
        bvid = _mock_bvid(mid, i)
        view = max(1200, 96000 - i * 1600 + rng.randint(0, 24000))

        programs.append({
            "bvid": bvid,
            "aid": 70000000 + (crc % 90000) + i,
            "title": title,
            "raw_title": title,
            "category": category,
            "pubdate": int(pub.timestamp()),
            "date": pub.strftime("%Y-%m-%d %H:%M"),
            "duration": sum(p["duration"] for p in parts),
            "parts": parts,
            "cover": "",
            "thumb": "",
            "url": "https://www.bilibili.com/video/%s" % bvid,
            "view": view,
            "danmaku": dm_total,
            "reply": rng.randint(20, 300),
            "like": max(80, view // rng.randint(10, 30)),
            "dm_total": dm_total,
        })

    return programs


def get_programs(station):
    key = station["id"]
    with PROGRAM_LOCK:
        progs = PROGRAM_CACHE.get(key)
        if progs is None:
            progs = build_programs(station)
            PROGRAM_CACHE[key] = progs
        return progs


def dm_payload(cid, seg):
    total = 900
    if seg < 0 or seg > 59:
        return {"cid": cid, "seg": seg, "from": 0, "to": 0,
                "total": total, "items": []}

    start = seg * 360000
    end = start + 360000
    rng = random.Random((zlib.crc32(("%s:%s" % (cid, seg)).encode("utf-8"))
                         ^ 0x5A17) & 0xFFFFFFFF)
    items = []
    for k, progress in enumerate(range(start, end, 1200)):
        roll = rng.random()
        if roll < 0.90:
            mode = 1
        elif roll < 0.97:
            mode = 4
        else:
            mode = 5
        size = 25 if rng.random() < 0.65 else 18
        color = rng.choice(DM_COLORS)
        text = DM_TEXTS[(k + seg * 7) % len(DM_TEXTS)]
        items.append([progress, mode, size, color, text])

    return {"cid": cid, "seg": seg, "from": start, "to": end,
            "total": total, "items": items}


def _pixel_bytes():
    path = os.path.join(ASSET_DIR, "pixel.png")
    try:
        with open(path, "rb") as fh:
            data = fh.read()
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return data
    except OSError:
        pass
    return PIXEL_PNG


def _safe_static_path(url_path):
    """把 URL path 落到 ROOT 内；拒绝 .. / 绝对路径 / NUL。"""
    raw = urllib.parse.unquote(url_path, errors="replace")
    if not raw or "\x00" in raw or "\\" in raw:
        return None
    rel = raw.lstrip("/")
    if not rel:
        rel = "index.html"
    norm = os.path.normpath(rel)
    if norm in (".", ""):
        norm = "index.html"
    if os.path.isabs(norm) or norm == ".." or norm.startswith(".." + os.sep):
        return None

    root_real = os.path.realpath(ROOT)
    full = os.path.realpath(os.path.join(root_real, norm))
    if full != root_real and not full.startswith(root_real + os.sep):
        return None
    return full


def _best_effort_lan_ip():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("223.5.5.5", 53))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


# ---------------------------------------------------------------- HTTP 服务

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ReplayRadioMock/7.0.0"
    sys_version = ""

    # -- 基础响应 --------------------------------------------------------

    def log_message(self, fmt, *args):
        try:
            msg = fmt % args
        except Exception:
            msg = str(fmt)
        print("[%s] [%s] %s %s -> %s" % (
            time.strftime("%H:%M:%S"),
            threading.current_thread().name,
            self.command, self.path, msg,
        ), flush=True)

    def end_headers(self):
        # 所有响应（含 404 / SSE / 静态）都带 CORS，方便 iframe 探针。
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type, Range, If-None-Match")
        self.send_header("Access-Control-Max-Age", "86400")
        super().end_headers()

    def _bump(self):
        with STATE_LOCK:
            REQUEST_COUNT[0] += 1

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            length = 0
        raw = self.rfile.read(length) if length > 0 else b""
        if not raw:
            return {}
        try:
            value = json.loads(raw.decode("utf-8", "replace"))
        except (ValueError, UnicodeError):
            return {}
        return value if isinstance(value, dict) else {}

    def _serve_static(self, path):
        full = _safe_static_path(path)
        if full is None:
            return self._json({"error": "forbidden", "path": path}, 403)
        if not os.path.isfile(full):
            return self._json({"error": "not found", "path": path}, 404)

        try:
            with open(full, "rb") as fh:
                body = fh.read()
        except OSError as exc:
            return self._json({"error": "read failed", "detail": str(exc)}, 500)

        ext = os.path.splitext(full)[1].lower()
        ctype = MIME_TYPES.get(ext)
        if not ctype:
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            if ctype.startswith("text/") and "charset" not in ctype:
                ctype += "; charset=utf-8"

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    # -- 媒体（支持 Range，seek 才正常） ---------------------------------
    def _serve_media(self, rel, ctype):
        full = os.path.join(ROOT, rel)
        if not os.path.isfile(full):
            return self._json({"error": "media missing", "path": rel}, 404)
        size = os.path.getsize(full)
        start, end = 0, size - 1
        code = 200
        rng = self.headers.get("Range") or ""
        if rng.startswith("bytes="):
            part = rng[6:].split(",")[0].strip()
            a, _, b = part.partition("-")
            try:
                if a == "":
                    start = max(0, size - int(b))
                else:
                    start = int(a)
                    if b:
                        end = min(size - 1, int(b))
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", "bytes */%d" % size)
                    self.end_headers()
                    return None
                code = 206
            except ValueError:
                start, end = 0, size - 1
        length = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if code == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.end_headers()
        try:
            with open(full, "rb") as fh:
                fh.seek(start)
                left = length
                while left > 0:
                    chunk = fh.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        return None

    # -- 全天循环（和 Kotlin 端同一套：把 parts 摊平成段） -----------------
    def _cycle_payload(self, station_key=""):
        station = find_station(station_key)
        if station is None:
            return {"total": 0, "position": 0, "count": 0, "segments": []}
        programs = get_programs(station)
        segments = []
        acc = 0.0
        for prog in programs:
            for part in prog["parts"]:
                dur = float(part["duration"])
                if dur <= 0:
                    continue
                segments.append({
                    "bvid": prog["bvid"],
                    "cid": str(part["cid"]),
                    "title": prog["title"],
                    "start": round(acc, 1),
                    "duration": round(dur, 1),
                    "cover": "",
                })
                acc += dur
        total = acc
        pos = (time.time() - 1762000000.0) % total if total else 0
        return {
            "total": round(total, 1),
            "position": round(pos, 1),
            "count": len(segments),
            "epoch": 1762000000,
            "station": str(station.get("id") or ""),
            "segments": segments,
        }

    # -- SSE -------------------------------------------------------------

    def _sse_data(self, obj):
        line = "data: " + json.dumps(obj, ensure_ascii=False,
                                     separators=(",", ":")) + "\n\n"
        self.wfile.write(line.encode("utf-8"))
        self.wfile.flush()

    def _sse_raw(self, text):
        self.wfile.write(text.encode("utf-8"))
        self.wfile.flush()

    def _live_chat_stream(self):
        with SSE_LOCK:
            SSE_STATE["clients"] += 1
            client_no = SSE_STATE["clients"]
            SSE_STATE["seq"] += 1
            seq = SSE_STATE["seq"]

        print("[sse] client #%s connected (clients=%s)" % (
            seq, client_no), flush=True)

        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            self.close_connection = True

            self._sse_data({"type": "state", "text": "已连接 · 实时弹幕中"})

            rng = random.Random(0x5A17 + seq * 104729)
            sent = 0
            last_ping = time.monotonic()

            while True:
                time.sleep(1.5)
                sent += 1
                self._sse_data({
                    "type": "danmaku",
                    "uid": str(rng.randint(100000, 999999999)),
                    "uname": rng.choice(SSE_NAMES),
                    "text": rng.choice(SSE_TEXTS),
                })

                if sent % 20 == 0:
                    self._sse_data({"type": "popularity", "value": 12345})
                if sent % 25 == 0:
                    self._sse_data({
                        "type": "superchat",
                        "uname": rng.choice(SSE_NAMES),
                        "text": rng.choice(SUPERCHAT_TEXTS),
                        "price": 30,
                    })

                now = time.monotonic()
                if now - last_ping >= 15.0:
                    self._sse_raw(": ping\n\n")
                    last_ping = now
        except (BrokenPipeError, ConnectionResetError, OSError):
            # 浏览器 / curl 关掉长连接时安静退出，不打印 traceback。
            pass
        finally:
            with SSE_LOCK:
                SSE_STATE["clients"] -= 1
                left = SSE_STATE["clients"]
            self.close_connection = True
            print("[sse] client #%s gone (clients=%s)" % (seq, left), flush=True)

    # -- 路由 ------------------------------------------------------------

    def do_OPTIONS(self):
        self._bump()
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        self._bump()
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)

        if path == "/api/ping":
            return self._json({
                "app": "replay-radio", "version": VERSION,
                "independent": True, "build": BUILD,
            })

        if path == "/api/status":
            return self._json({
                "logged": True, "jct": True, "uname": "夜航星",
                "mid": 123456, "face": "/api/img?u=x", "vip": True,
                "status": "已登录",
            })

        if path == "/api/stations":
            return self._json(stations_snapshot())

        if path == "/api/stations/probe":
            mid = str((query.get("mid") or [""])[0]).strip() or "1004"
            return self._json(self._probe_payload(mid, {}))

        if path == "/api/programs":
            key = (query.get("station") or [""])[0]
            station = find_station(key)
            if station is None:
                return self._json({"error": "no station"}, 404)
            programs = get_programs(station)
            part_count = sum(len(p["parts"]) for p in programs)
            return self._json({
                "programs": programs,
                "meta": {
                    "mid": station["mid"],
                    "up_name": station["name"],
                    "station": station,
                    "count": len(programs),
                    "part_count": part_count,
                    "generated_at": 0,
                    "live": False,
                    "series": {
                        "series_id": station["series"]["id"],
                        "name": station["series"]["name"],
                    },
                },
            })

        if path == "/api/login/qrcode":
            return self._json({"url": "https://passport.bilibili.com/h5-app/passport/login/scan?mock=1",
                               "key": "mock-key"})

        if path == "/api/login/poll":
            return self._json({"code": 86090, "message": "已扫码，请在手机上确认"})

        if path == "/api/cycle":
            st_key = (query.get("station") or [""])[0]
            return self._json(self._cycle_payload(st_key))

        if path == "/api/now":
            return self._json(self._now_payload())

        if path == "/api/playurl":
            qn = (query.get("qn") or ["64"])[0]
            try:
                wanted = int(qn)
            except (TypeError, ValueError):
                wanted = 64
            accepted = [
                {"qn": 80, "desc": "1080P"},
                {"qn": 64, "desc": "720P"},
                {"qn": 32, "desc": "480P"},
            ]
            valid = {item["qn"] for item in accepted}
            current = wanted if wanted in valid else 64
            desc = {80: "1080P", 64: "720P", 32: "480P"}[current]
            return self._json({
                "media": "/test.mp4",
                "length": 180000,
                "quality": current,
                "qualityDesc": desc,
                "accept": accepted,
                "logged": False,
                # 兼容旧字段
                "url": "/test.mp4",
                "accept_quality": accepted,
                "current_qn": current,
                "format": "mp4",
                "durl": True,
            })

        if path == "/api/stream":
            raw = (query.get("u") or [""])[0]
            target = ""
            if raw:
                pad = "=" * ((4 - len(raw) % 4) % 4)
                try:
                    target = base64.urlsafe_b64decode(raw + pad).decode("utf-8", "replace")
                except Exception:
                    target = ""
            if target.endswith("/test.mp4") or target.endswith("test.mp4"):
                return self._serve_media("mockdata/test.mp4", "video/mp4")
            return self._json({"error": "stream unavailable in mock", "u": target}, 404)

        if path == "/api/img":
            body = _pixel_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return None

        if path == "/api/dm":
            cid = (query.get("cid") or ["111111"])[0]
            try:
                seg = int((query.get("seg") or ["0"])[0])
            except (TypeError, ValueError):
                seg = 0
            return self._json(dm_payload(cid, seg))

        if path == "/api/live/playinfo":
            station = find_station((query.get("station") or [""])[0])
            room = (query.get("room") or [""])[0]
            if not room:
                room = station["room"] if station else "2233"
            uname = station["name"] if station else "夜航星"
            return self._json({
                "room": room,
                "url": "/api/live/stream?qn=250",
                "qn": 250,
                "current_qn": 250,
                "living": True,
                "title": "夜间歌回",
                "uname": uname,
                "online": 12345,
                "qualities": [
                    {"qn": 250, "desc": "原画"},
                    {"qn": 150, "desc": "高清"},
                ],
                "kind": "flv",
                # 8.0.1：直连流地址（真机由后端从 B 站 playUrl 取出；mock 指回本机中转即可）
                "flv": "/api/live/stream?room=%s&qn=250" % room,
                "flv_qn": 250,
            })

        if path == "/api/live/stream":
            return self._serve_media("mockdata/live.flv", "video/x-flv")

        if path == "/api/live/chat/stream":
            return self._live_chat_stream()

        if path == "/api/following/live":
            return self._json({
                "living": [{
                    "mid": "1002", "name": "第二主播", "room": "3344",
                    "title": "在播", "cover": "", "url": "",
                }],
            })

        if path == "/api/status-board":
            return self._json({
                "at": 0, "mid": "1001",
                "live": {"living": True, "title": "夜间歌回",
                         "url": "", "face": ""},
                "source": "mock",
            })

        if path == "/api/logout":
            return self._json({"ok": True})

        if path == "/api/live/brief":
            station = find_station((query.get("station") or [""])[0])
            room = (query.get("room") or [""])[0] or (station["room"] if station else "2233")
            return self._json({"living": True, "title": "夜间歌回", "cover": "",
                               "online": 12345, "room": room})

        if path == "/api/live/emoticons":
            emo = [{"unique": "emo_hh", "name": "哈哈", "url": "/assets/idle.webp", "w": 60, "h": 60, "level": 0},
                   {"unique": "emo_ok", "name": "好耶", "url": "/assets/idle.webp", "w": 60, "h": 60, "level": 0},
                   {"unique": "emo_up1", "name": "上舰啦", "url": "/assets/idle.webp", "w": 60, "h": 60, "level": 0},
                   {"unique": "emo_hl", "name": "好耶", "url": "/assets/idle.webp", "w": 60, "h": 60, "level": 5}]
            return self._json({"packs": [
                {"name": "通用", "items": emo[:2]},
                {"name": "房间", "items": emo[2:]},
            ]})

        if path == "/api/dynamic":
            now = int(time.time())
            items = [
                {"id": "d1", "at": now - 1800, "kind": "video", "text": "新一期回放上传：凌晨三点的钢琴",
                 "cover": "/assets/idle.webp", "url": "https://www.bilibili.com/video/BV1xx411c7mD",
                 "stat": {"like": 1280, "comment": 96}},
                {"id": "d2", "at": now - 7200, "kind": "live", "text": "今晚 21:00 直播，歌回老地方",
                 "cover": "/assets/idle.webp", "url": "https://live.bilibili.com/2233",
                 "stat": {"like": 342, "comment": 18}},
                {"id": "d3", "at": now - 86400, "kind": "dynamic", "text": "谢谢大家上舰，下一期继续",
                 "cover": "", "url": "https://t.bilibili.com/1", "stat": {"like": 88, "comment": 4}},
            ]
            return self._json({"items": items})

        if path == "/api/playlists":
            return self._json({"lists": [
                {"id": "pl1", "name": "深夜歌单", "count": 6, "tags": ["翻唱", "钢琴"], "cover": "/assets/idle.webp", "updated": "2026-11-26"},
                {"id": "pl2", "name": "通宵循环", "count": 4, "tags": ["民谣"], "cover": "/assets/idle.webp", "updated": "2026-11-24"},
            ]})

        if path == "/api/playlist":
            pid = (query.get("id") or ["pl1"])[0]
            names = ["凌晨三点的钢琴", "晚安曲", "雨夜电台", "白噪音", "未寄出的信", "旧磁带"]
            items = []
            for i, n in enumerate(names):
                items.append({"bvid": "BV1xx411c7m%d" % i, "cid": str(100000 + i), "title": n,
                              "author": "夜航星", "cover": "/assets/idle.webp",
                              "dur": 240 + i * 37})
            return self._json({"id": pid, "name": "深夜歌单" if pid == "pl1" else "通宵循环", "items": items})

        if path == "/api/chapters":
            return self._json({"points": [
                {"from": 0, "to": 213, "content": "开场"},
                {"from": 213, "to": 486, "content": "第一首歌"},
                {"from": 486, "to": 780, "content": "和弹幕聊天"},
                {"from": 780, "to": 1120, "content": "深夜钢琴"},
            ]})

        if path.startswith("/api/"):
            return self._json({"error": "unknown endpoint", "path": path}, 404)

        if path == "/test.mp4":
            return self._serve_media("mockdata/test.mp4", "video/mp4")

        return self._serve_static(path)

    def do_POST(self):
        self._bump()
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()

        if path == "/api/dm/send":
            text = str(body.get("text") or "").strip()
            if not text:
                return self._json({"error": "弹幕不能为空"}, 400)
            if len(text) > 100:
                return self._json({"error": "弹幕太长了"}, 400)
            return self._json({"ok": True, "text": text, "progress": body.get("progress", 0)})

        if path == "/api/live/send":
            text = str(body.get("text") or "").strip()
            if not text:
                return self._json({"error": "弹幕不能为空"}, 400)
            if len(text) > 20:
                return self._json({"error": "弹幕太长"}, 400)
            return self._json({"ok": True, "text": text})

        if path == "/api/stations/probe":
            mid = str(body.get("mid") or body.get("id") or "1004").strip()
            return self._json(self._probe_payload(mid, body))

        if path == "/api/stations/save":
            return self._json(self._save_station(body))

        if path == "/api/stations/delete":
            return self._json(self._delete_station(body))

        if path == "/api/playlist/import":
            url = str(body.get("url") or "").strip()
            if not url:
                return self._json({"error": "粘一个 B 站链接"}, 400)
            if "error" in url:
                return self._json({"error": "没认出这个链接"}, 400)
            return self._json({"ok": True, "id": "pl%d" % (int(time.time()) % 1000),
                               "name": "导入的歌单", "count": 6})

        if path == "/api/playlist/delete":
            return self._json({"ok": True, "id": str(body.get("id") or "")})

        return self._json({"error": "unknown endpoint", "path": path}, 404)

    # -- 站管理 ----------------------------------------------------------

    @staticmethod
    def _probe_payload(mid, body):
        mid = str(mid or "1004").strip() or "1004"
        name = str(body.get("name") or "新主播").strip() or "新主播"
        room = body.get("room")
        if not room:
            room = str(int(mid) + 3451) if mid.isdigit() else "4455"
        return {
            "ok": True,
            "probe": {
                "name": name,
                "face": "",
                "room": str(room),
                "suggested": "s9",
                "sources": [
                    {"id": "s9", "name": "直播回放", "kind": "series"},
                ],
            },
        }

    @staticmethod
    def _save_station(body):
        mid = str(body.get("mid") or body.get("id") or "").strip()
        if not mid:
            return stations_snapshot()

        name = str(body.get("name") or body.get("uname") or "").strip()
        with STATE_LOCK:
            existing = None
            for s in STATIONS:
                if s["id"] == mid or s["mid"] == mid:
                    existing = s
                    break
            if existing is not None:
                if name:
                    existing["name"] = name
                    existing["short"] = body.get("short") or name[:2]
                return _stations_locked()

            name = name or "新主播"
            room = body.get("room")
            if not room:
                room = str(int(mid) + 3451) if mid.isdigit() else "9999"
            accent = body.get("accent") or ["#7f5af0", "#2cb67d",
                                             "#ff8906", "#e53170"][len(STATIONS) % 4]
            raw_series = body.get("series") or body.get("suggested") or "s9"
            if isinstance(raw_series, dict):
                series_id = str(raw_series.get("id") or "s9")
            else:
                series_id = str(raw_series)
            STATIONS.append({
                "id": mid,
                "name": name,
                "short": str(body.get("short") or name[:2] or "新主"),
                "mid": mid,
                "room": str(room),
                "face": str(body.get("face") or ""),
                "main": not STATIONS,
                "has_programs": True,
                "tag": "",
                "site": "bilibili",
                "accent": accent,
                "weibo": "",
                "series": {"id": series_id, "source": "series",
                           "name": "直播回放", "total": 0, "error": ""},
            })
            return _stations_locked()

    @staticmethod
    def _delete_station(body):
        mid = str(body.get("mid") or body.get("id") or "").strip()
        if not mid:
            return stations_snapshot()
        with STATE_LOCK:
            removed = [s for s in STATIONS
                       if s["id"] == mid or s["mid"] == mid]
            for station in removed:
                STATIONS.remove(station)
                with PROGRAM_LOCK:
                    PROGRAM_CACHE.pop(station["id"], None)
            # 删掉主站时把第一个剩下的站顶上来，保持 main / stations 自洽。
            if STATIONS and not any(s.get("main") for s in STATIONS):
                STATIONS[0]["main"] = True
            return _stations_locked()

    # -- 播放状态 --------------------------------------------------------

    @staticmethod
    def _now_payload():
        station = find_station("")
        if station is None:
            return {"empty": True, "total": 0, "position": 0, "index": 0,
                    "count": 0, "current": {}, "offset": 0,
                    "remaining": 0, "next": {"title": ""}, "playurl": ""}
        programs = get_programs(station)
        index = min(2, len(programs) - 1)
        program = programs[index]
        part = program["parts"][0]
        offset = 1234.5
        position = sum(p["duration"] for p in programs[:index]) + offset
        total = sum(p["duration"] for p in programs)
        next_title = (programs[index + 1]["title"]
                      if index + 1 < len(programs) else "")
        return {
            "empty": False,
            "total": total,
            "position": round(position, 1),
            "index": index,
            "count": len(programs),
            "current": {
                "bvid": program["bvid"],
                "page": part["page"],
                "cid": part["cid"],
                "duration": part["duration"],
                "start": 0,
                "title": program["title"],
                "cover": "",
            },
            "offset": offset,
            "remaining": round(part["duration"] - offset, 1),
            "next": {"title": next_title},
            "playurl": "/api/playurl?bvid=%s&cid=%s&qn=64" % (
                urllib.parse.quote(program["bvid"]),
                urllib.parse.quote(part["cid"]),
            ),
        }


class MockServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64


def main():
    parser = argparse.ArgumentParser(
        description="回放电台 v5.0 本地 mock 服务（只读假数据）")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help="监听端口，默认 %d" % DEFAULT_PORT)
    args = parser.parse_args()

    mimetypes.init()
    server = MockServer(("0.0.0.0", args.port), Handler)
    lan_ip = _best_effort_lan_ip()
    print("回放电台 mock v%s build=%s" % (VERSION, BUILD), flush=True)
    print("  root   : %s" % ROOT, flush=True)
    print("  listen : 0.0.0.0:%d" % args.port, flush=True)
    print("  local  : http://127.0.0.1:%d/" % args.port, flush=True)
    print("  lan    : http://%s:%d/" % (lan_ip, args.port), flush=True)
    print("  Ctrl-C 停止；日志全部写 stdout", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[mock] keyboard interrupt, shutting down", flush=True)
    finally:
        server.server_close()
        print("[mock] stopped", flush=True)


if __name__ == "__main__":
    main()
