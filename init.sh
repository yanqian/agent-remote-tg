#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "== Required files =="
required_files=(
  "AGENTS.md"
  "SPEC.md"
  "feature_list.json"
  "progress.md"
  "test_plan.md"
  "init.sh"
  "orchestrator.py"
)

for path in "${required_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $path" >&2
    exit 1
  fi
done

echo "== Build check =="
python3 -m py_compile orchestrator.py

echo "== State validation =="
python3 scripts/verify-state.py

run_npm_script_if_present() {
  local script_name="$1"
  if [[ ! -f package.json ]]; then
    echo "skip npm run ${script_name}: package.json not present"
    return 0
  fi

  if node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['${script_name}'] ? 0 : 1)"; then
    echo "== npm run ${script_name} =="
    npm run "${script_name}"
  else
    echo "skip npm run ${script_name}: script not present"
  fi
}

run_npm_script_if_present "build"
run_npm_script_if_present "test:unit"
run_npm_script_if_present "test:harness"
run_npm_script_if_present "test:contract"
run_npm_script_if_present "smoke"

echo "init verification passed"
