#!/usr/bin/env bash
set -uo pipefail

# Usage: ./scripts/debug-test.sh [test-filter]
# Example: ./scripts/debug-test.sh commands/init
FILTER="${1:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LAUNCH_JSON="$PROJECT_ROOT/.vscode/launch.json"

CMD=(bun test --env-file .env.test)
[[ -n "$FILTER" ]] && CMD+=("$FILTER")
CMD+=(--inspect-wait)

echo "Running: ${CMD[*]}"
echo ""

"${CMD[@]}" 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ "$line" =~ (ws://[^[:space:]]+) ]]; then
    WS_URL="${BASH_REMATCH[1]}"
    sed -i "s|\"url\": \"ws://[^\"]*\"|\"url\": \"$WS_URL\"|" "$LAUNCH_JSON"
    echo ""
    echo ">>> Updated launch.json → $WS_URL"
    echo ">>> Now run 'Attach Bun' in VS Code"
  fi
done
