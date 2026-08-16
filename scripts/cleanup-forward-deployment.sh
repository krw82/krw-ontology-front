#!/bin/sh
set -eu

temporary_dir=
data_lock_dir=
forward_cutover_started=0

usage() {
  echo "Usage: cleanup-forward-deployment.sh [--temporary-dir DIR] [--data-lock-dir DIR] [--forward-cutover-started]" >&2
}

safe_absolute_path() {
  candidate=$1
  case "$candidate" in
    /*) ;;
    *) return 1 ;;
  esac
  [ "$candidate" != "/" ] \
    && { [ -z "${HOME:-}" ] || [ "$candidate" != "$HOME" ]; }
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --temporary-dir)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      temporary_dir=$1
      ;;
    --data-lock-dir)
      shift
      [ "$#" -gt 0 ] || { usage; exit 2; }
      data_lock_dir=$1
      ;;
    --forward-cutover-started)
      forward_cutover_started=1
      ;;
    *)
      usage
      exit 2
      ;;
  esac
  shift
done

if [ -n "$temporary_dir" ]; then
  safe_absolute_path "$temporary_dir" \
    || { echo "Refusing unsafe deployment temporary path: $temporary_dir" >&2; exit 1; }
  case "${temporary_dir##*/}" in
    krw-*) ;;
    *) echo "Refusing non-deployment temporary directory: $temporary_dir" >&2; exit 1 ;;
  esac
  if [ -e "$temporary_dir" ]; then
    [ -d "$temporary_dir" ] && [ ! -L "$temporary_dir" ] \
      || { echo "Refusing unsafe deployment temporary directory: $temporary_dir" >&2; exit 1; }
    rm -rf -- "$temporary_dir"
  fi
fi

if [ -n "$data_lock_dir" ]; then
  safe_absolute_path "$data_lock_dir" \
    || { echo "Refusing unsafe deployment lock path: $data_lock_dir" >&2; exit 1; }
  [ "${data_lock_dir##*/}" = "production-deploy.lock" ] \
    || { echo "Refusing non-deployment lock directory: $data_lock_dir" >&2; exit 1; }
  if [ -e "$data_lock_dir" ]; then
    [ -d "$data_lock_dir" ] && [ ! -L "$data_lock_dir" ] \
      || { echo "Refusing unsafe deployment lock directory: $data_lock_dir" >&2; exit 1; }
    rm -f -- "$data_lock_dir/owner"
    rmdir -- "$data_lock_dir" 2>/dev/null || true
  fi
fi

if [ "$forward_cutover_started" = "1" ]; then
  echo "Forward cutover stopped before completion; active runtime was kept and research admission remains closed." >&2
fi
