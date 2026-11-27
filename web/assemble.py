#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 rr-v700 的前端装配进 APK 的 assets/web。

- 只拷运行需要的文件（index.html / app.css / app.js / mpegts.js / qrcode.min.js）；
- 清掉旧版遗留（assets 整目录重建）；
- 在 </body> 前注入原生桥接层与 SW 清理块。
"""
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = HERE
# 装配目标：优先 $RR_DEST；未指定时按仓库布局写到 ../android/app/src/main/assets/web
DST = os.environ.get("RR_DEST") or os.path.normpath(
    os.path.join(HERE, "..", "android", "app", "src", "main", "assets", "web")
)
FILES = ["index.html", "app.css", "app.js", "mpegts.js", "qrcode.min.js"]
ASSETS = ["idle.webp"]

BRIDGE = """<script>
/* 哔哩吧啦 Android 桥接层：网页只负责画面，声音交给原生前台服务（锁屏/通知可控）。
   位置一律取 video.currentTime —— 页面在 seek/续播后它就是唯一事实。 */
(function(){
  "use strict";
  var BR = (typeof window.AndroidRadio !== "undefined") ? window.AndroidRadio : null;
  if (!BR) return;
  try { window.__RR_STANDALONE__ = true; } catch(e){}
  var video = document.getElementById("player");
  if (!video) { try { console.warn("bridge: #player missing"); } catch(e){} return; }
  var lastTitle = "哔哩吧啦";
  var origPlay = video.play;
  video.play = function(){
    try {
      var t = document.getElementById("np-title");
      if (t && t.textContent && t.textContent.trim()) lastTitle = t.textContent.trim();
      var src = video.src || "";
      var m = src.match(/[?&]u=([^&]+)/);
      // 页面自己切前后台时会复播画面，那一次不该把原生播放重新拉起来
      if (m && BR.play && !window.__rrKeepNative) {
        var pos = Math.max(0, Math.floor((video.currentTime || 0) * 1000));
        var key = video.dataset.key || "";
        var cover = video.dataset.cover || (location.origin + "/assets/idle.webp");
        BR.play(lastTitle, location.origin + "/api/stream?u=" + m[1], pos, 0, key, cover);
      }
      video.muted = true;
    } catch(e){}
    return origPlay ? origPlay.apply(video, arguments) : Promise.resolve();
  };
  var origPause = video.pause ? video.pause.bind(video) : function(){};
  video.pause = function(){
    // 只有「人按了暂停」才停原生；系统把页面挂起导致的 pause 必须放行
    try { if (BR.stop && !window.__rrKeepNative) BR.stop(); } catch(e){}
    return origPause();
  };
})();
</script>"""

PURGE = """<script>
/* APK 里 assets 本来就在本地，不需要 Service Worker；历史版本的 SW 会把旧
   index.html 缓存住，换 APK 后仍显示老界面。这里清一次注册与缓存，清到过就重载一次。 */
(function () {
  if (!("serviceWorker" in navigator) && !window.caches) return;
  var KEY = "__rr_sw_purged_v9";
  try { if (sessionStorage.getItem(KEY)) return; } catch (e) {}
  var jobs = [];
  if ("serviceWorker" in navigator) {
    jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
      var had = rs && rs.length;
      return Promise.all(rs.map(function (r) { return r.unregister(); }))
        .then(function () { return had; });
    }).catch(function () { return false; }));
  }
  if (window.caches && caches.keys) {
    jobs.push(caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) { return caches.delete(k); }));
    }).catch(function () {}));
  }
  Promise.all(jobs).then(function (r) {
    var had = !!r[0];
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    if (had) location.reload();
  });
})();
</script>"""


def main():
    if not os.path.isdir(os.path.dirname(DST)):
        print("找不到 Android 工程目录：", os.path.dirname(DST))
        print("用 RR_DEST=<…/app/src/main/assets/web> 指定装配目标")
        return 1
    for f in FILES:
        if not os.path.isfile(os.path.join(SRC, f)):
            print("missing source:", f)
            return 1
    for old in ("assets", "data", "sw.js", "manifest.json", "favicon.png", "favicon.ico"):
        p = os.path.join(DST, old)
        if os.path.isdir(p):
            shutil.rmtree(p)
        elif os.path.exists(p):
            os.remove(p)
    os.makedirs(DST, exist_ok=True)
    for f in FILES:
        shutil.copy2(os.path.join(SRC, f), os.path.join(DST, f))
    assets_dst = os.path.join(DST, "assets")
    if os.path.isdir(assets_dst):
        shutil.rmtree(assets_dst)
    os.makedirs(assets_dst, exist_ok=True)
    for f in ASSETS:
        shutil.copy2(os.path.join(SRC, "assets", f), os.path.join(assets_dst, f))

    html_path = os.path.join(DST, "index.html")
    html = open(html_path, encoding="utf-8").read()
    if "AndroidRadio" in html:
        print("bridge already present")
    else:
        assert "</body>" in html
        inject = "<style>/* 独立版没有「停止本机服务」这个语义 */\n#btn-quit{display:none!important}</style>\n" + BRIDGE + "\n" + PURGE + "\n"
        html = html.replace("</body>", inject + "</body>", 1)
        open(html_path, "w", encoding="utf-8").write(html)

    assert "AndroidRadio" in html, "bridge missing"
    assert "__rr_sw_purged_v9" in html, "purge missing"
    assert "serviceWorker.register" not in html, "sw registration left"
    total = sum(os.path.getsize(os.path.join(DST, f)) for f in FILES)
    print("wrote", DST, "files:", ", ".join(FILES))
    print("total bytes:", total, "index:", os.path.getsize(html_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
