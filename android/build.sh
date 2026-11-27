#!/usr/bin/env bash
# Android 端构建。
# 在 Android / Termux 上跑时复用本机固定工具链（JDK / SDK / Gradle 都在里面）；
# 其它环境直接用 PATH 上的 gradle（或 $GRADLE_BIN），需要 JDK 17 与 compileSdk 35。
set -e
PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TOOLCHAIN="${RR_TOOLCHAIN:-/storage/emulated/0/WORK/02-工具链/dsh-build-env.sh}"
if [ -f "$TOOLCHAIN" ]; then
  # shellcheck disable=SC1090
  source "$TOOLCHAIN"
  export JAVA_HOME="$S/lib/jvm/java-17-openjdk"
  export PATH="$JAVA_HOME/bin:$S/bin:$B/bin:/system/bin"
  export TMPDIR="$H/tmp"
  mkdir -p "$TMPDIR"
fi

export TMPDIR="${TMPDIR:-/tmp}"
export GRADLE_OPTS="-Djava.io.tmpdir=$TMPDIR -Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8"
export JAVA_OPTS="$GRADLE_OPTS"

cd "$PROJ"
"${GRADLE_BIN:-gradle}" "${1:-:app:assembleRelease}" --no-daemon
