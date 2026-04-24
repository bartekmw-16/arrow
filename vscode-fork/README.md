# Cline IDE — VS Code OSS Fork Scaffold (Phase 1)

This directory contains the Phase 1 scaffold for embedding the Cline agent natively into a VS Code OSS fork. Unlike a standard `.vsix` extension, these files live inside the VS Code OSS source tree and ship as part of the compiled Electron binary.

---

## Directory Layout

```
vscode-fork/
├── .github/
│   └── workflows/
│       └── vscode-fork-build.yml   ← CI/CD for the fork binary
├── build/
│   └── gulpfile.cline.js           ← Branding patches + Gulp tasks
├── patches/
│   ├── workbench.common.main.patch ← One-line import to add to VS Code core
│   └── workbench.desktop.main.patch
└── src/vs/workbench/contrib/cline/
    ├── index.ts                    ← Barrel export
    ├── common/
    │   └── clineService.ts         ← IClineService interface & DI token
    ├── node/
    │   └── clineServiceImpl.ts     ← Phase 1 stub implementation
    └── browser/
        ├── cline.contribution.ts   ← Contribution entry point (registerSingleton + Registry)
        ├── clineViewContainer.ts   ← Activity bar entry + ViewContainer
        ├── clineView.ts            ← Sidebar ViewPane (placeholder UI)
        └── clineActions.ts         ← Commands & keybindings
```

---

## Setting Up the Fork

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | As specified in `.nvmrc` in the VS Code repo (currently 20.x) |
| yarn | `npm install -g yarn` |
| Python | 3.x (for native module compilation) |
| Git | Any recent version |

**Linux only:** install native headers:
```bash
sudo apt-get install -y libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev
```

---

### Step 1 — Clone & Branch

```bash
git clone https://github.com/microsoft/vscode.git cline-ide
cd cline-ide

# Pin to a stable release tag for a reproducible base
git checkout 1.90.0
git checkout -b cline-ide/main

# Add the Cline repo as a remote for reference
git remote add cline https://github.com/cline/cline.git
```

### Step 2 — Copy Scaffold Files

```bash
# From the root of the cline extension repo:
cp -r vscode-fork/src/ <path-to-cline-ide>/src/
cp vscode-fork/build/gulpfile.cline.js <path-to-cline-ide>/build/
cp -r vscode-fork/.github/ <path-to-cline-ide>/.github/
```

### Step 3 — Wire Into VS Code Core

Apply the two patches manually (the patch files in `patches/` show exactly what to add):

**`src/vs/workbench/workbench.common.main.ts`** — add at the end of the contrib import block:
```typescript
import 'vs/workbench/contrib/cline/browser/cline.contribution';
```

**`src/vs/workbench/workbench.desktop.main.ts`** — add after the common imports:
```typescript
import 'vs/workbench/contrib/cline/node/clineServiceImpl';
```

**`build/gulpfile.js`** — add at the bottom:
```javascript
require('./gulpfile.cline');
```

### Step 4 — Install & Build

```bash
yarn install
yarn gulp cline-patch-product   # apply Cline IDE branding to product.json
yarn watch                       # incremental TypeScript compilation
```

### Step 5 — Launch Dev Instance

```bash
# In a second terminal, after `yarn watch` has completed its first pass:
./scripts/code.sh
```

---

## Verifying Phase 1

Once the dev instance is running, confirm:

- [ ] Window title reads "Cline IDE"
- [ ] Activity bar shows the Cline icon (circular "C" logo)
- [ ] Clicking the icon opens the **Cline Agent** sidebar panel
- [ ] Panel displays "Cline Agent — Phase 1 Scaffold" placeholder text
- [ ] **Start Agent** button transitions state label from `idle` → `running`
- [ ] **Stop Agent** button transitions state label back to `idle`
- [ ] `Ctrl+Shift+C` (`Cmd+Shift+C` on macOS) opens the panel
- [ ] Command Palette shows:
  - `Cline: Open Agent`
  - `Cline: Start Session`
  - `Cline: Stop Session`
- [ ] Developer Console (Help → Toggle Developer Tools) shows:
  - `[ClineContrib] Phase 1 scaffold registered successfully.`
  - `[ClineService] Workbench restored — service ready.`

---

## Upstream Merge Strategy

Our additions are confined to:
1. `src/vs/workbench/contrib/cline/` — entirely new directory, zero conflicts possible
2. Two lines in `workbench.common.main.ts` and `workbench.desktop.main.ts`

To sync a new upstream release:
```bash
git fetch origin
git fetch upstream
git tag upstream/1.91.0 upstream/1.91.0
git merge upstream/1.91.0 --no-ff -m "chore: merge upstream vscode 1.91.0"
# Resolve any conflicts in the two patched lines (highly unlikely)
```

---

## Next Steps — Phase 2 (Codebase Indexer)

Phase 2 will add:
- Tree-sitter AST parsing wired into `IFileService` change events
- Local vector DB integration (SQLite + sqlite-vec or ChromaDB via IPC)
- Background indexing worker spawned by `ClineServiceImpl`
