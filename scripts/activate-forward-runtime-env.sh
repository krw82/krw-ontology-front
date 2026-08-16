#!/bin/sh
set -eu

candidate=
destination=

usage() {
  echo "Usage: activate-forward-runtime-env.sh --candidate FILE --destination FILE" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --candidate)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      candidate=$1
      ;;
    --destination)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      destination=$1
      ;;
    *)
      usage
      exit 2
      ;;
  esac
  shift
done

case "$candidate" in /*) ;; *) usage; exit 2 ;; esac
case "$destination" in /*) ;; *) usage; exit 2 ;; esac
[ -f "$candidate" ] && [ ! -L "$candidate" ] \
  || { echo "Forward runtime env candidate is missing or unsafe." >&2; exit 1; }
[ -f "$destination" ] && [ ! -L "$destination" ] \
  || { echo "Forward runtime env destination is missing or unsafe." >&2; exit 1; }

staged=$(mktemp "${destination}.forward.XXXXXX")
cleanup() {
  status=$?
  rm -f -- "$staged"
  exit "$status"
}
trap cleanup EXIT INT TERM
cp "$candidate" "$staged"
chmod 600 "$staged"
mv -f "$staged" "$destination"
trap - EXIT INT TERM

