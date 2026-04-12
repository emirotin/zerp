#!/usr/bin/env bash
# Zed external formatter wrapper: runs oxfmt from the nearest package directory
# so that pnpm can find the binary in the local node_modules.

FILE_PATH="$1"
DIR="$(dirname "$FILE_PATH")"

while [ "$DIR" != "/" ]; do
  if [ -f "$DIR/package.json" ]; then
    break
  fi
  DIR="$(dirname "$DIR")"
done

exec pnpm --dir "$DIR" exec oxfmt --stdin-filepath "$FILE_PATH"
