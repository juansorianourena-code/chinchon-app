#!/bin/sh
# Uso: ./release.sh 1.2.0 "mensaje"
# Pone la versión en todos los ficheros, hace commit y sube a GitHub (Cloudflare despliega solo).
set -e
V="$1"; MSG="${2:-Versión $1}"
[ -z "$V" ] && echo "Falta versión" && exit 1
sed -i '' "s/const APP_VERSION = '[^']*'/const APP_VERSION = '$V'/" app.js
sed -i '' "s/const VERSION = '[^']*'/const VERSION = '$V'/" sw.js
echo "{ \"version\": \"$V\" }" > version.json
sed -i '' -E "s/(app\.js|style\.css)\?v=[0-9.]+/\1?v=$V/g" index.html
git add -A && git commit -qm "v$V: $MSG" && git push -q && echo "Publicada v$V"
