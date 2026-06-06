#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
BOOTSTRAP_PYTHON=${NEWS_TRANSLATION_BOOTSTRAP_PYTHON:-python3}
VENV=${NEWS_TRANSLATION_VENV:-"$HOME/.local/share/krw-ontology/news-translation-venv"}
PYTHON="$VENV/bin/python"

if [ ! -x "$PYTHON" ]; then
  "$BOOTSTRAP_PYTHON" -m venv "$VENV"
fi

"$PYTHON" -m pip install --upgrade pip >/dev/null
"$PYTHON" -m pip install -r "$FRONT_DIR/requirements-news-translation.txt"
"$PYTHON" - <<'PY'
import googletrans
print("OK googletrans", getattr(googletrans, "__version__", "unknown"))
PY

echo "Set NEWS_TRANSLATION_PYTHON=$PYTHON in the worker env."
