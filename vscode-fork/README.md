# Cline IDE — VS Code OSS Fork

An AI-native development environment built as a native fork of [VS Code OSS](https://github.com/microsoft/vscode). Unlike the Cline VS Code extension (which runs in the extension host sandbox), Cline IDE embeds the agent directly into the workbench process — enabling richer editor integration, faster IPC, and deeper access to VS Code platform APIs.

---

## Architecture Overview

```
cline-ide/                          ← VS Code OSS fork repo
├── src/vs/workbench/contrib/cline/ ← All Cline-specific source (this scaffold)
│   ├── common/                     ← Platform-agnostic interfaces (DI tokens)
│   │   ├── clineService.ts         ← IClineService
│   │   └── clineIndexerService.ts  ← IClineIndexerService
│   ├── browser/                    ← Workbench UI layer
│   │   ├── cline.contribution.ts   ← Entry point (self-registers via Registry)
│   │   ├── clineViewContainer.ts   ← Activity bar icon + ViewContainer
│   │   ├── clineView.ts            ← Sidebar ViewPane (hosts React webview)
│   │   ├── clineActions.ts         ← Commands + keybindings
│   │   ├── editor/                 ← Editor contributions
│   │   │   ├── cmdkWidget.ts       ← CMD+K inline prompt overlay
│   │   │   ├── inlineDiffDecorator.ts ← Inline diff renderer
│   │   │   └── clineEditorContribution.ts ← IEditorContribution registration
│   │   └── panel/                  ← React webview host
│   │       ├── webviewMessages.ts  ← Typed message protocol
│   │       ├── clineWebviewHost.ts ← WebviewView host in ViewPane
│   │       └── clinePanel.html     ← HTML bootstrap template
│   └── node/                       ← Node.js / Electron layer
│       ├── clineServiceImpl.ts     ← IClineService implementation
│       ├── indexer/                ← Codebase indexer
│       │   ├── fileChunker.ts      ← Language-aware code chunking
│       │   ├── sqliteFtsStore.ts   ← SQLite FTS5 search store
│       │   ├── codebaseIndexer.ts  ← File-watcher + indexing orchestrator
│       │   └── indexerServiceImpl.ts ← IClineIndexerService implementation
│       └── agentProcess/           ← AI agent subprocess
│           ├── agentBridge.ts      ← IPC bridge (JSON-RPC over stdio)
│           └── agentRunner.ts      ← Child process entry-point
├── build/
│   └── gulpfile.cline.js           ← Branding, bundling, dev workflow
├── scripts/
│   └── apply-patches.sh            ← One-command fork setup
├── patches/                        ← What to add to VS Code core files
│   ├── workbench.common.main.patch
│   └── workbench.desktop.main.patch
└── product.json                    ← Cline IDE branding
```

---

## Feature Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ Complete | VS Code fork scaffold — sidebar, DI wiring, commands, CI |
| 2 | ✅ Complete | Codebase indexer — SQLite FTS5, language-aware chunking, file watcher |
| 3 | ✅ Complete | Editor contributions — CMD+K overlay, inline diff (Accept/Reject) |
| 4 | ✅ Complete | React UI integration — Cline webview-ui embedded in native ViewPane |
| 5 | ✅ Complete | Full agent backend — AgentBridge IPC, agentRunner subprocess |
| 6 | ✅ Complete | Packaging & release — product.json, release.yml, apply-patches.sh |

---

## One-Command Setup

```bash
# From the root of the Cline extension repository:
chmod +x vscode-fork/scripts/apply-patches.sh
./vscode-fork/scripts/apply-patches.sh --tag 1.90.0 --target-dir ../cline-ide
```

This script:
1. Clones `microsoft/vscode` at the pinned tag
2. Creates the `cline-ide/main` branch
3. Copies all scaffold source files
4. Patches `workbench.common.main.ts` and `workbench.desktop.main.ts`
5. Runs `yarn install` and `gulp cline-patch-product`
6. Compiles TypeScript

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20.x (see `.nvmrc`) | [nvm](https://github.com/nvm-sh/nvm) |
| yarn | latest 1.x | `npm install -g yarn` |
| Python | 3.x | system package manager |

**Linux only:**
```bash
sudo apt-get install -y libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev
```

---

## Manual Setup

### Step 1 — Clone & branch

```bash
git clone --depth 1 --branch 1.90.0 https://github.com/microsoft/vscode.git cline-ide
cd cline-ide
git checkout -b cline-ide/main
```

### Step 2 — Copy scaffold files

```bash
# From the Cline extension repo root:
cp -r vscode-fork/src/ <cline-ide>/
cp vscode-fork/build/gulpfile.cline.js <cline-ide>/build/
cp -r vscode-fork/.github/ <cline-ide>/
cp vscode-fork/product.json <cline-ide>/product.json
```

### Step 3 — Patch VS Code core (2 files, 1 line each)

**`src/vs/workbench/workbench.common.main.ts`** — add at end of contrib import block:
```typescript
import 'vs/workbench/contrib/cline/browser/cline.contribution';
```

**`src/vs/workbench/workbench.desktop.main.ts`** — add after common imports:
```typescript
import 'vs/workbench/contrib/cline/node/clineServiceImpl';
```

**`build/gulpfile.js`** — add at the bottom:
```js
require('./gulpfile.cline');
```

### Step 4 — Build

```bash
cd cline-ide
yarn install
yarn gulp cline           # build all Cline artefacts
yarn gulp compile-build   # compile all VS Code TypeScript
```

To also build the Cline React UI, point to the Cline extension repo:
```bash
CLINE_REPO_PATH=../cline yarn gulp cline-webview-bundle
```

### Step 5 — Launch dev instance

```bash
yarn watch              # terminal 1: incremental TypeScript compilation
./scripts/code.sh       # terminal 2: launch Electron
```

---

## Development Workflow

### Rebuilding after source changes

```bash
# Recompile TypeScript (incremental)
yarn watch

# Rebuild Cline-specific artefacts only
yarn gulp cline-assets

# Rebuild agent subprocess bundle
yarn gulp cline-agent-bundle

# Rebuild React webview UI
CLINE_REPO_PATH=../cline yarn gulp cline-webview-bundle
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLINE_REPO_PATH` | `../cline` | Path to the Cline extension repo (for webview-ui build) |
| `CLINE_API_PROVIDER` | `anthropic` | Default API provider for the agent |
| `CLINE_API_KEY` | — | API key (also configurable in settings UI) |
| `CLINE_MODEL` | `claude-opus-4-5` | Default model |
| `CLINE_AGENT_MODE` | `native` | Set by AgentBridge; controls agent behaviour |

---

## Verification Checklist

After launching the dev instance:

- [ ] Window title reads **"Cline IDE"**
- [ ] Activity bar shows the Cline icon
- [ ] Clicking it opens the **Cline Agent** panel with the React UI
- [ ] `Ctrl+Shift+C` / `Cmd+Shift+C` opens the panel from anywhere
- [ ] Command Palette shows: `Cline: Open Agent`, `Cline: Start Session`, `Cline: Stop Session`, `Cline: Edit with AI (CMD+K)`
- [ ] `Ctrl+K` / `Cmd+K` in any editor opens the CMD+K inline prompt
- [ ] Typing in the CMD+K box and submitting shows an inline diff proposal
- [ ] Accept / Reject buttons apply or discard the proposed edit
- [ ] The React chat UI renders correctly with VS Code theme colours
- [ ] Codebase indexing starts automatically and the status is reflected in the UI
- [ ] Developer Console shows: `[ClineContrib] Cline IDE contribution registered successfully.`

---

## Building a Distributable

```bash
# Linux x64
yarn gulp vscode-linux-x64
ls -la ../VSCode-linux-x64/

# macOS Apple Silicon
yarn gulp vscode-darwin-arm64
ls -la ../VSCode-darwin-arm64/

# Windows x64 (run on Windows)
yarn gulp vscode-win32-x64
```

---

## Releasing

Push a `v*.*.*` tag to the fork repository to trigger the release workflow:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The release workflow (`.github/workflows/release.yml`) will:
1. Build binaries for Linux x64, macOS arm64, and Windows x64
2. Create a GitHub Release with all artefacts attached

---

## Upstream Merge Strategy

Our changes are confined to:
1. `src/vs/workbench/contrib/cline/` — entirely new directory (zero conflicts)
2. One import line each in `workbench.common.main.ts` and `workbench.desktop.main.ts`
3. One `require()` line in `build/gulpfile.js`

Merging a new VS Code upstream release:

```bash
# In the cline-ide fork repo
git fetch origin
git remote add upstream https://github.com/microsoft/vscode.git
git fetch upstream tag 1.91.0
git merge 1.91.0 --no-ff -m "chore: merge upstream vscode 1.91.0"
# Resolve any conflicts (structurally impossible in our new dir;
# very unlikely in the three patched lines)
git push origin cline-ide/main
```

---

## Contributing

See the [Cline contributing guide](https://github.com/cline/cline/blob/main/CONTRIBUTING.md).
All Cline IDE–specific issues should be filed in the Cline repo with the `cline-ide` label.

