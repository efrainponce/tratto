#!/bin/sh
# Regenera los PNG del anuncio con Chrome headless: 4:5, vertical (9:16) y horizontal (1.91:1) para A y B.
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
shot() { "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --virtual-time-budget=2000 --window-size="$2" --screenshot="$PWD/$1" "file://$PWD/anuncio.html$3" 2>/dev/null; }
for v in a b; do
  shot "anuncio-$v.png" 1080,1350 "?v=$v"
  shot "anuncio-$v-vertical.png" 1080,1920 "?v=$v&f=vertical"
  shot "anuncio-$v-horizontal.png" 1200,628 "?v=$v&f=horizontal"
done
