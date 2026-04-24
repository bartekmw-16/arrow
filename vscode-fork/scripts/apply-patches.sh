#!/usr/bin/env bash
# =============================================================================
# Cline IDE — Fork Setup Script
#
# One-command setup: clones VS Code OSS, checks out the pinned tag, copies all
# Cline scaffold files, applies the two core patches, and runs the first build.
#
# Usage:
#   chmod +x scripts/apply-patches.sh
#   ./scripts/apply-patches.sh [--tag 1.90.0] [--target-dir ../cline-ide]
#
# Requirements:
#   - git, node (20.x), yarn, python3
#   - On Linux: libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults (override with CLI flags)
# ---------------------------------------------------------------------------
VSCODE_TAG="${VSCODE_TAG:-1.90.0}"
TARGET_DIR="${TARGET_DIR:-$(pwd)/../cline-ide}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORK_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) VSCODE_TAG="$2"; shift 2 ;;
    --target-dir) TARGET_DIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "================================================================="
echo " Cline IDE Fork Setup"
echo " VS Code tag   : ${VSCODE_TAG}"
echo " Target dir    : ${TARGET_DIR}"
echo "================================================================="

# ---------------------------------------------------------------------------
# Step 1: Clone VS Code OSS (if not already cloned)
# ---------------------------------------------------------------------------
if [[ ! -d "${TARGET_DIR}/.git" ]]; then
  echo ""
  echo ">>> Cloning microsoft/vscode @ ${VSCODE_TAG}…"
  git clone --depth 1 --branch "${VSCODE_TAG}" \
    https://github.com/microsoft/vscode.git "${TARGET_DIR}"
else
  echo ">>> Target directory already exists — skipping clone."
fi

cd "${TARGET_DIR}"

# ---------------------------------------------------------------------------
# Step 2: Create (or reset) the fork branch
# ---------------------------------------------------------------------------
echo ""
echo ">>> Setting up cline-ide/main branch…"
git fetch --tags origin 2>/dev/null || true
if git show-ref --verify --quiet refs/heads/cline-ide/main; then
  git checkout cline-ide/main
else
  git checkout -b cline-ide/main
fi

# ---------------------------------------------------------------------------
# Step 3: Copy Cline scaffold source files
# ---------------------------------------------------------------------------
echo ""
echo ">>> Copying Cline source files…"

# Ensure target directories exist
mkdir -p \
  src/vs/workbench/contrib/cline \
  build \
  .github/workflows

cp -r "${FORK_ROOT}/src/" .
cp "${FORK_ROOT}/build/gulpfile.cline.js" build/
cp -r "${FORK_ROOT}/.github/" .
cp "${FORK_ROOT}/product.json" product.json

echo "    Source files copied."

# ---------------------------------------------------------------------------
# Step 4: Patch workbench.common.main.ts
# ---------------------------------------------------------------------------
echo ""
echo ">>> Patching workbench.common.main.ts…"
COMMON_MAIN="src/vs/workbench/workbench.common.main.ts"
CLINE_IMPORT="import 'vs/workbench/contrib/cline/browser/cline.contribution';"

if grep -qF "${CLINE_IMPORT}" "${COMMON_MAIN}"; then
  echo "    Already patched — skipping."
else
  # Find the last existing contrib import line and append after it.
  # Use a Python one-liner for cross-platform (Linux/macOS) reliability
  # instead of `sed -i` which requires different syntax on each OS.
  LAST_CONTRIB_LINE=$(grep -n "^import 'vs/workbench/contrib/" "${COMMON_MAIN}" | tail -1 | cut -d: -f1)
  if [[ -n "${LAST_CONTRIB_LINE}" ]]; then
    python3 - "${COMMON_MAIN}" "${LAST_CONTRIB_LINE}" "${CLINE_IMPORT}" <<'EOF'
import sys
path, after_line, new_line = sys.argv[1], int(sys.argv[2]), sys.argv[3]
lines = open(path).readlines()
lines.insert(after_line, new_line + '\n')
open(path, 'w').writelines(lines)
EOF
    echo "    Inserted import after line ${LAST_CONTRIB_LINE}."
  else
    echo "${CLINE_IMPORT}" >> "${COMMON_MAIN}"
    echo "    Appended import at end of file."
  fi
fi

# ---------------------------------------------------------------------------
# Step 5: Patch workbench.desktop.main.ts
# ---------------------------------------------------------------------------
echo ""
echo ">>> Patching workbench.desktop.main.ts…"
DESKTOP_MAIN="src/vs/workbench/workbench.desktop.main.ts"
NODE_IMPORT="import 'vs/workbench/contrib/cline/node/clineServiceImpl';"

if grep -qF "${NODE_IMPORT}" "${DESKTOP_MAIN}"; then
  echo "    Already patched — skipping."
else
  LAST_DESKTOP_IMPORT=$(grep -n "^import 'vs/workbench/contrib/" "${DESKTOP_MAIN}" | tail -1 | cut -d: -f1)
  if [[ -n "${LAST_DESKTOP_IMPORT}" ]]; then
    python3 - "${DESKTOP_MAIN}" "${LAST_DESKTOP_IMPORT}" "${NODE_IMPORT}" <<'EOF'
import sys
path, after_line, new_line = sys.argv[1], int(sys.argv[2]), sys.argv[3]
lines = open(path).readlines()
lines.insert(after_line, new_line + '\n')
open(path, 'w').writelines(lines)
EOF
    echo "    Inserted import after line ${LAST_DESKTOP_IMPORT}."
  else
    echo "${NODE_IMPORT}" >> "${DESKTOP_MAIN}"
    echo "    Appended import at end of file."
  fi
fi

# ---------------------------------------------------------------------------
# Step 6: Patch build/gulpfile.js to load our Gulp tasks
# ---------------------------------------------------------------------------
echo ""
echo ">>> Patching build/gulpfile.js…"
GULP_REQUIRE="require('./gulpfile.cline');"
if grep -qF "${GULP_REQUIRE}" build/gulpfile.js; then
  echo "    Already patched — skipping."
else
  echo "" >> build/gulpfile.js
  echo "${GULP_REQUIRE}" >> build/gulpfile.js
  echo "    Appended require() to build/gulpfile.js."
fi

# ---------------------------------------------------------------------------
# Step 7: Install dependencies
# ---------------------------------------------------------------------------
echo ""
echo ">>> Installing dependencies (yarn install)…"
echo "    This will download Electron and compile native modules."
echo "    Expected duration: 5-15 minutes on a fresh machine."
yarn install

# ---------------------------------------------------------------------------
# Step 8: Apply Cline branding to product.json
# ---------------------------------------------------------------------------
echo ""
echo ">>> Applying Cline IDE branding…"
node_modules/.bin/gulp cline-patch-product

# ---------------------------------------------------------------------------
# Step 9: First TypeScript compile
# ---------------------------------------------------------------------------
echo ""
echo ">>> Running first TypeScript compilation…"
yarn gulp compile

echo ""
echo "================================================================="
echo " Setup complete!"
echo ""
echo " To start the dev instance:"
echo "   cd ${TARGET_DIR}"
echo "   yarn watch        # in one terminal"
echo "   ./scripts/code.sh # in another terminal"
echo ""
echo " To build a distributable binary:"
echo "   yarn gulp vscode-linux-x64    (Linux)"
echo "   yarn gulp vscode-darwin-arm64 (macOS ARM)"
echo "================================================================="
