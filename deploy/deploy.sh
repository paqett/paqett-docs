#!/usr/bin/env bash
# Build the site and put it live on the Paqett box.
#
#   deploy/deploy.sh                 # build, sync, (re)start the container, install the Caddy site
#   DEPLOY_HOST=other deploy/deploy.sh
#   INSTALL_SITE=0 deploy/deploy.sh  # files + container only, main Caddy untouched (first install:
#                                    # point DNS at the box before Caddy asks Let's Encrypt for a cert)
#
# Files only: a content change is a new set of HTML files under /opt/paqett-docs/site, which the
# docs container serves as soon as they land. The main Caddy is reloaded only when its site block
# changes, and only after `caddy validate` passes with the new block in place.
set -euo pipefail

HOST="${DEPLOY_HOST:-udb-hetzner}"
DIR=/opt/paqett-docs
SITES=/opt/universitydb/caddy/sites
SITE_FILE=docs-paqett.caddyfile

cd "$(dirname "$0")/.."

pnpm build

ssh "$HOST" "install -d -m 755 $DIR $DIR/site $DIR/deploy"

# --no-owner/--no-group: files land as root, not as the laptop's uid. a+r so the container's
# nobody user can read them.
rsync -rlt --delete --no-owner --no-group --chmod=Da+rx,Fa+r build/ "$HOST:$DIR/site/"
rsync -rlt --no-owner --no-group --chmod=Fa+r deploy/compose.yaml deploy/Caddyfile "$HOST:$DIR/deploy/"
rsync -rlt --no-owner --no-group --chmod=Fa+r deploy/docs.paqett.com.caddyfile "$HOST:$DIR/deploy/$SITE_FILE.new"

ssh "$HOST" bash -s <<EOF
set -euo pipefail
cd $DIR/deploy
docker compose up -d --remove-orphans

if [ "${INSTALL_SITE:-1}" = "0" ]; then
  echo "caddy: site block not installed (INSTALL_SITE=0)"
elif ! cmp -s $SITE_FILE.new $SITES/$SITE_FILE 2>/dev/null; then
  [ -f $SITES/$SITE_FILE ] && cp $SITES/$SITE_FILE $SITE_FILE.prev
  cp $SITE_FILE.new $SITES/$SITE_FILE
  if docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>validate.log; then
    docker kill -s SIGUSR1 caddy >/dev/null
    echo "caddy: docs site installed and reloaded"
  else
    if [ -f $SITE_FILE.prev ]; then cp $SITE_FILE.prev $SITES/$SITE_FILE; else rm -f $SITES/$SITE_FILE; fi
    cat validate.log >&2
    echo "caddy: validate failed, previous site block restored, nothing reloaded" >&2
    exit 1
  fi
fi
rm -f $SITE_FILE.new
EOF

echo "deployed: https://docs.paqett.com"

# IndexNow: tell Bing (and through it ChatGPT search and Copilot), Yandex, Seznam and Naver
# which URLs changed. The key file is static/<key>.txt. Only pages whose built HTML differs
# from the last deploy are sent; INDEXNOW=all sends every URL in the sitemap, INDEXNOW=0 none.
INDEXNOW_KEY=7fb74c3a440d90bc91f5fac1b5bb3fc0
if [ "${INDEXNOW:-changed}" != "0" ]; then
  STATE=.indexnow-hashes
  touch "$STATE"
  urls=()
  while read -r loc; do
    path=${loc#https://docs.paqett.com}
    file="build${path%/}.html"; [ "$path" = "/" ] && file=build/index.html
    [ -f "$file" ] || file="build${path%/}/index.html"
    hash=$(shasum -a 256 "$file" 2>/dev/null | cut -d' ' -f1)
    if [ "${INDEXNOW:-changed}" = "all" ] || ! grep -q "^$path $hash\$" "$STATE"; then urls+=("$loc"); fi
    echo "$path $hash"
  done < <(grep -o '<loc>[^<]*' build/sitemap.xml | sed 's/<loc>//') > "$STATE.new"
  mv "$STATE.new" "$STATE"
  if [ ${#urls[@]} -gt 0 ]; then
    list=$(printf '"%s",' "${urls[@]}"); list="[${list%,}]"
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST https://api.indexnow.org/indexnow \
      -H 'content-type: application/json; charset=utf-8' \
      -d "{\"host\":\"docs.paqett.com\",\"key\":\"$INDEXNOW_KEY\",\"keyLocation\":\"https://docs.paqett.com/$INDEXNOW_KEY.txt\",\"urlList\":$list}")
    echo "indexnow: ${#urls[@]} url(s) submitted, HTTP $code"
  else
    echo "indexnow: nothing changed"
  fi
fi
