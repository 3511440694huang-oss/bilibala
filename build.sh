#!/usr/bin/env bash
# 哔哩吧啦 · 一键构建：前端 → 装配进 assets → Gradle release
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== 1/3 前端构建"
cd "$ROOT/web"
bash mk.sh

echo "== 2/3 装配进 Android assets"
RR_DEST="$ROOT/android/app/src/main/assets/web" python3 "$ROOT/web/assemble.py"

echo "== 3/3 Gradle release"
bash "$ROOT/android/build.sh" :app:assembleRelease

OUT="$ROOT/android/app/build/outputs/apk/release"
echo "== 产物"
ls -l "$OUT"/*.apk 2>/dev/null || echo "（没有 .apk：检查 android/keystore/ 是否放了签名文件）"
