#!/bin/bash
# Prints one line per new comment left in dev-mode comment mode (⌘⇧K).
# Comments land in .feedback/<id>.json with <id>.element.png and <id>.full.png beside them.
# Move a handled comment's three files into .feedback/done/ so it is not reported again.
# Pass --all to also report comments already waiting when the watcher starts.
set -u
dir="$(cd "$(dirname "$0")/.." && pwd)/.feedback"
mkdir -p "$dir/done"
seen=$'\n'
for f in "$dir"/*.json; do
  [ -e "$f" ] || continue
  [ "${1:-}" = "--all" ] && echo "PENDING FEEDBACK: $f"
  seen="$seen$f"$'\n'
done
while true; do
  for f in "$dir"/*.json; do
    [ -e "$f" ] || continue
    case "$seen" in *$'\n'"$f"$'\n'*) continue ;; esac
    seen="$seen$f"$'\n'
    echo "NEW FEEDBACK: $f"
  done
  sleep 1
done
