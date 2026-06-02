#!/bin/sh
set -eu

if [ -n "${SUPABASE_CLI:-}" ]; then
  exec "$SUPABASE_CLI" "$@"
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

if [ -x "$FRONT_DIR/node_modules/.bin/supabase" ]; then
  exec "$FRONT_DIR/node_modules/.bin/supabase" "$@"
fi

if command -v supabase >/dev/null 2>&1; then
  exec supabase "$@"
fi

for candidate in \
  "$HOME/.local/bin/supabase" \
  /opt/homebrew/bin/supabase \
  /usr/local/bin/supabase
do
  if [ -x "$candidate" ]; then
    exec "$candidate" "$@"
  fi
done

cat >&2 <<'EOF'
Missing Supabase CLI.

Install it with Homebrew, or set SUPABASE_CLI to an executable path:
  brew install supabase/tap/supabase
  SUPABASE_CLI=/absolute/path/to/supabase npm run supabase:db:push:dry

This project intentionally avoids relying on `npx supabase` because the npm
shim can fail to resolve a native CLI package on darwin-arm64.
EOF
exit 127
