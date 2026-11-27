#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""shell.html + views/*.html → index.html（视图内联，顺序固定）。"""
import os, re, sys

SRC = os.path.dirname(os.path.abspath(__file__))
ORDER = ["channel", "live", "day", "playlist", "monitor", "me"]


def main():
    shell = open(os.path.join(SRC, "shell.html"), encoding="utf-8").read()
    missing = []
    for name in ORDER:
        p = os.path.join(SRC, "views", name + ".html")
        if not os.path.isfile(p):
            missing.append(name)
            frag = '<!-- %s 视图待实现 -->\n' % name
        else:
            frag = open(p, encoding="utf-8").read()
        shell = shell.replace("<!--VIEW:%s-->" % name, frag)
    if "<!--VIEW:" in shell:
        print("unresolved view placeholder", file=sys.stderr)
        return 1
    out = os.path.join(SRC, "index.html")
    open(out, "w", encoding="utf-8").write(shell)
    print("index.html", os.path.getsize(out), "bytes", ("missing: " + ",".join(missing)) if missing else "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
