/*---------------------------------------------------------------------------------------------
 * Cline IDE — Build Integration
 * Gulp tasks for branding, asset pipeline, agent bundling, and dev workflow.
 *
 * Usage from the VS Code OSS repo root:
 *
 *   node_modules/.bin/gulp cline-patch-product   # apply branding to product.json
 *   node_modules/.bin/gulp cline-assets          # copy/build all assets
 *   node_modules/.bin/gulp cline-agent-bundle    # bundle agentRunner.js (esbuild)
 *   node_modules/.bin/gulp cline-webview-bundle  # build React webview-ui bundle
 *   node_modules/.bin/gulp cline                 # run all of the above
 *   node_modules/.bin/gulp cline-dev             # watch + launch dev instance
 *
 * This file must be required by the main build/gulpfile.js:
 *   require('./gulpfile.cline');
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');              // vscode OSS repo root
const PRODUCT_JSON = path.join(ROOT, 'product.json');
const OUT_DIR = path.join(ROOT, 'out');

// Path to the Cline extension repo (sibling directory, or override via env)
const CLINE_REPO = process.env['CLINE_REPO_PATH'] ||
	path.join(ROOT, '..', 'cline');

// Where the compiled agent runner script lands
const AGENT_OUT = path.join(OUT_DIR, 'cline-agent');

// Where the compiled webview bundle lands (loaded by ClineWebviewHost)
const WEBVIEW_OUT = path.join(
	OUT_DIR, 'vs', 'workbench', 'contrib', 'cline', 'browser', 'panel', 'dist',
);

// ---------------------------------------------------------------------------
// Branding overrides
// ---------------------------------------------------------------------------

const CLINE_PRODUCT_OVERRIDES = {
	nameShort: 'Cline IDE',
	nameLong: 'Cline IDE - AI Native',
	applicationName: 'cline-ide',
	dataFolderName: '.cline-ide',
	win32MutexName: 'clineide',
	win32AppUserModelId: 'ClineIDE.ClineIDE',
	extensionAllowedProposedApi: ['cline.cline-ai'],
};

// ---------------------------------------------------------------------------
// Task: cline-patch-product
// ---------------------------------------------------------------------------

gulp.task('cline-patch-product', function (cb) {
	const raw = fs.readFileSync(PRODUCT_JSON, 'utf8');
	const product = JSON.parse(raw);
	Object.assign(product, CLINE_PRODUCT_OVERRIDES);
	fs.writeFileSync(PRODUCT_JSON, JSON.stringify(product, null, '\t'), 'utf8');
	console.log('[cline-build] product.json patched with Cline IDE branding.');
	cb();
});

// ---------------------------------------------------------------------------
// Task: cline-agent-bundle
// Bundles agentRunner.ts into a single self-contained Node.js CJS module.
// Uses esbuild (already a dev dependency in the VS Code OSS repo via
// @vscode/build-utils, or installable separately).
// ---------------------------------------------------------------------------

gulp.task('cline-agent-bundle', function (cb) {
	fs.mkdirSync(AGENT_OUT, { recursive: true });

	const entryPoint = path.join(
		ROOT, 'src', 'vs', 'workbench', 'contrib', 'cline',
		'node', 'agentProcess', 'agentRunner.ts',
	);

	// esbuild command — uses the version bundled with VS Code's own build tooling
	const esbuildBin = path.join(ROOT, 'node_modules', '.bin', 'esbuild');
	const args = [
		entryPoint,
		'--bundle',
		'--platform=node',
		'--target=node20',
		'--format=cjs',
		`--outfile=${path.join(AGENT_OUT, 'agentRunner.js')}`,
		// Mark native addons as external so esbuild doesn't try to bundle them
		'--external:@vscode/sqlite3',
		'--external:better-sqlite3',
		'--external:*.node',
		// Mark the clineCore module as external — it's bundled separately
		'--external:*/clineCore',
	];

	console.log('[cline-build] Bundling agentRunner…');
	const proc = cp.spawn(esbuildBin, args, { stdio: 'inherit', cwd: ROOT });
	proc.on('close', code => {
		if (code !== 0) { cb(new Error(`esbuild exited with code ${code}`)); return; }
		console.log(`[cline-build] agentRunner.js → ${AGENT_OUT}`);
		cb();
	});
});

// ---------------------------------------------------------------------------
// Task: cline-core-bundle
// Bundles the Cline core library (src/ of the extension) into clineCore.js
// so that agentRunner.js can require() it.
// ---------------------------------------------------------------------------

gulp.task('cline-core-bundle', function (cb) {
	fs.mkdirSync(AGENT_OUT, { recursive: true });

	const clineExtSrc = path.join(CLINE_REPO, 'src', 'extension.ts');
	if (!fs.existsSync(clineExtSrc)) {
		console.warn(`[cline-build] Cline repo not found at ${CLINE_REPO} — skipping core bundle.`);
		console.warn('[cline-build] Set CLINE_REPO_PATH env var to point to the Cline extension repo.');
		return cb();
	}

	const esbuildBin = path.join(ROOT, 'node_modules', '.bin', 'esbuild');

	// We bundle the Cline extension's core export specifically crafted for
	// the native bridge (a separate entry in the cline repo's package.json).
	const clineCoreSrc = path.join(CLINE_REPO, 'src', 'standalone', 'index.ts');
	const entryPoint = fs.existsSync(clineCoreSrc)
		? clineCoreSrc
		: clineExtSrc;

	const args = [
		entryPoint,
		'--bundle',
		'--platform=node',
		'--target=node20',
		'--format=cjs',
		`--outfile=${path.join(AGENT_OUT, 'clineCore.js')}`,
		`--tsconfig=${path.join(CLINE_REPO, 'tsconfig.json')}`,
		'--external:vscode',
		'--external:*.node',
	];

	console.log('[cline-build] Bundling Cline core…');
	const proc = cp.spawn(esbuildBin, args, { stdio: 'inherit', cwd: CLINE_REPO });
	proc.on('close', code => {
		if (code !== 0) { cb(new Error(`esbuild (clineCore) exited with code ${code}`)); return; }
		console.log(`[cline-build] clineCore.js → ${AGENT_OUT}`);
		cb();
	});
});

// ---------------------------------------------------------------------------
// Task: cline-webview-bundle
// Builds the React webview-ui application and copies the output to the
// VS Code out/ directory where ClineWebviewHost can serve it.
// ---------------------------------------------------------------------------

gulp.task('cline-webview-bundle', function (cb) {
	const webviewUiDir = path.join(CLINE_REPO, 'webview-ui');
	if (!fs.existsSync(webviewUiDir)) {
		console.warn(`[cline-build] webview-ui not found at ${webviewUiDir} — skipping.`);
		return cb();
	}

	console.log('[cline-build] Building Cline React webview-ui…');

	// Run the webview build (Vite)
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const buildProc = cp.spawn(npm, ['run', 'build'], {
		stdio: 'inherit',
		cwd: webviewUiDir,
		env: {
			...process.env,
			// Vite's base URL must be empty so resource URIs work in webviews
			VITE_BASE_URL: '',
			NODE_ENV: 'production',
		},
	});

	buildProc.on('close', code => {
		if (code !== 0) { cb(new Error(`webview-ui build exited with code ${code}`)); return; }

		// Copy the Vite output (dist/) to the VS Code out/ tree
		const distSrc = path.join(webviewUiDir, 'dist');
		fs.mkdirSync(WEBVIEW_OUT, { recursive: true });
		copyDirSync(distSrc, WEBVIEW_OUT);
		console.log(`[cline-build] webview-ui dist → ${WEBVIEW_OUT}`);
		cb();
	});
});

// ---------------------------------------------------------------------------
// Task: cline-assets
// ---------------------------------------------------------------------------

gulp.task('cline-assets', gulp.series(
	'cline-patch-product',
	'cline-core-bundle',
	'cline-agent-bundle',
	'cline-webview-bundle',
	function clineAssetsFinish(cb) {
		console.log('[cline-build] All Cline assets built successfully.');
		cb();
	},
));

// ---------------------------------------------------------------------------
// Task: cline
// Master task — everything needed for a production build.
// ---------------------------------------------------------------------------

gulp.task('cline', gulp.series('cline-assets'));

// ---------------------------------------------------------------------------
// Task: cline-dev
// Launches a VS Code dev instance with Cline active.
// ---------------------------------------------------------------------------

gulp.task('cline-dev', gulp.series('cline-assets', function launchDev(cb) {
	const scriptExt = process.platform === 'win32' ? '.bat' : '.sh';
	const scriptPath = path.join(ROOT, 'scripts', `code${scriptExt}`);

	console.log(`[cline-build] Launching dev instance…`);
	const proc = cp.spawn(scriptPath, [], {
		stdio: 'inherit',
		shell: true,
		cwd: ROOT,
		env: {
			...process.env,
			ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
		},
	});

	proc.on('close', code => {
		if (code && code !== 0) { cb(new Error(`Dev instance exited with code ${code}`)); }
		else { cb(); }
	});
}));

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function copyDirSync(src, dest) {
	if (!fs.existsSync(src)) { return; }
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDirSync(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}
