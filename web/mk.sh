#!/bin/bash
# 前端构建：校验 JS → 合并 CSS → 合并 JS → 内联视图
set -e
cd "$(dirname "$0")"
for f in js/*.js; do
  node --check "$f" || { echo "syntax: $f"; exit 1; }
done
cat css/*.css > app.css
cat js/*.js > app.js
python3 md.py
printf 'app.css %s B  app.js %s B\n' "$(wc -c < app.css)" "$(wc -c < app.js)"
