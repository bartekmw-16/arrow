/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 1 Scaffold
 * Build integration — Gulp tasks for branding and asset pipeline.
 *
 * Usage from the VS Code OSS repo root:
 *
 *   node_modules/.bin/gulp cline-assets   # copy/patch assets only
 *   node_modules/.bin/gulp cline-dev      # watch + launch dev instance
 *
 * This file must be imported by the main build/gulpfile.js:
 *   require('./gulpfile.cline');
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');          // vscode OSS repo root
const BUILD_DIR = path.join(ROOT, '.build');
const PRODUCT_JSON = path.join(ROOT, 'product.json');

// ---------------------------------------------------------------------------
// Branding overrides applied on top of the upstream product.json at build time.
// Modify these values to customise the Cline IDE identity.
// ---------------------------------------------------------------------------

const CLINE_PRODUCT_OVERRIDES = {
	nameShort: 'Cline IDE',
	nameLong: 'Cline IDE - AI Native',
	applicationName: 'cline-ide',
	dataFolderName: '.cline-ide',
	win32MutexName: 'clineide',
	win32AppUserModelId: 'ClineIDE.ClineIDE',
	// Allow our internal extension ID to use proposed APIs.
	extensionAllowedProposedApi: [
		'cline.cline-ai',
	],
	// Keep all upstream licence/update settings; only override identity fields.
};

// ---------------------------------------------------------------------------
// Task: patch-product-json
// Reads the upstream product.json, merges our overrides, writes it back.
// Run this BEFORE the upstream build pipeline to ensure the binary is branded.
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
// Task: cline-assets
// Copies Cline-specific static assets (icons, splash screens) into resources/.
// In Phase 1 this is a no-op stub — add real asset copy steps in later phases
// once the branding assets exist.
// ---------------------------------------------------------------------------

gulp.task('cline-assets', gulp.series('cline-patch-product', function clineAssets(cb) {
	// TODO (Phase 2+): uncomment and point at real asset files.
	// gulp.src('resources/cline/**/*')
	//     .pipe(gulp.dest(path.join(ROOT, 'resources')));
	console.log('[cline-build] cline-assets: no custom assets in Phase 1 (stub).');
	cb();
}));

// ---------------------------------------------------------------------------
// Task: cline-dev
// Launches the VS Code dev instance with our contribution loaded.
// Equivalent to running `./scripts/code.sh` from the repo root.
// ---------------------------------------------------------------------------

gulp.task('cline-dev', gulp.series('cline-assets', function launchDev(cb) {
	const { spawn } = require('child_process');
	const scriptExt = process.platform === 'win32' ? '.bat' : '.sh';
	const scriptPath = path.join(ROOT, 'scripts', `code${scriptExt}`);

	console.log(`[cline-build] Launching dev instance via ${scriptPath}…`);

	const proc = spawn(scriptPath, [], {
		stdio: 'inherit',
		shell: true,
		cwd: ROOT,
		env: {
			...process.env,
			// Disable GPU sandbox for easier debugging in CI environments.
			ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
		},
	});

	proc.on('close', (code) => {
		if (code !== 0) {
			cb(new Error(`Dev instance exited with code ${code}`));
		} else {
			cb();
		}
	});
}));

// ---------------------------------------------------------------------------
// Default Cline build target
// Runs all Cline tasks in sequence.
// ---------------------------------------------------------------------------

gulp.task('cline', gulp.series('cline-assets'));
