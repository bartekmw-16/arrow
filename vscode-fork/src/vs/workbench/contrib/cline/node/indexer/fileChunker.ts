/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 2: Codebase Indexer
 * Language-aware file chunker.
 *
 * Splits source files into searchable chunks using regex-based heuristics that
 * approximate tree-sitter output without requiring a native binary.  In a
 * future phase this can be upgraded to use web-tree-sitter for more accurate
 * AST-level splitting.
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/node/indexer/fileChunker.ts
 *--------------------------------------------------------------------------------------------*/

import { ICodeChunk, ChunkKind } from '../../common/clineIndexerService';

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
	ts: 'typescript', tsx: 'typescriptreact',
	js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript',
	py: 'python',
	go: 'go',
	rs: 'rust',
	java: 'java',
	cs: 'csharp',
	cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
	rb: 'ruby',
	php: 'php',
	swift: 'swift',
	kt: 'kotlin', kts: 'kotlin',
	scala: 'scala',
	sh: 'shellscript', bash: 'shellscript',
	md: 'markdown',
	json: 'json', jsonc: 'jsonc',
	yaml: 'yaml', yml: 'yaml',
	toml: 'toml',
	sql: 'sql',
};

/** Returns the VS Code language ID for a file path, or 'plaintext'. */
export function detectLanguage(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
	return EXTENSION_LANGUAGE_MAP[ext] ?? 'plaintext';
}

/** Returns true if this file should be indexed (excludes binaries, build artefacts, etc.). */
export function shouldIndexFile(filePath: string): boolean {
	const lower = filePath.toLowerCase();

	// Skip binary / generated files
	const binaryExts = [
		'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot',
		'pdf', 'zip', 'tar', 'gz', 'bz2', 'exe', 'dll', 'so', 'dylib', 'class',
		'pyc', 'pyo', 'map', 'min.js', 'min.css',
	];
	if (binaryExts.some(e => lower.endsWith('.' + e))) { return false; }

	// Skip well-known directories that should not be indexed
	const ignoredDirs = [
		'/node_modules/', '/.git/', '/dist/', '/build/', '/out/', '/.next/',
		'/coverage/', '/__pycache__/', '/.venv/', '/vendor/', '/target/',
		'/.build/', '/obj/', '/bin/', '/pkg/',
	];
	if (ignoredDirs.some(d => lower.includes(d))) { return false; }

	// Skip lock files and very large generated files
	const ignoredNames = [
		'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
		'cargo.lock', 'gemfile.lock', 'podfile.lock',
	];
	const basename = filePath.split('/').pop() ?? '';
	if (ignoredNames.includes(basename.toLowerCase())) { return false; }

	return true;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

const MAX_CHUNK_LINES = 80;
const MIN_CHUNK_LINES = 3;

interface RawChunk {
	startLine: number;
	endLine: number;
	kind: ChunkKind;
	symbolName: string;
}

/** Language-specific regex patterns for recognising top-level symbols. */
const SYMBOL_PATTERNS: Array<{ languages: string[]; pattern: RegExp; kind: ChunkKind; nameGroup: number }> = [
	// TypeScript / JavaScript — function declarations
	{
		languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
		pattern: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/,
		kind: 'function',
		nameGroup: 1,
	},
	// TS/JS — class declarations
	{
		languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
		pattern: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
		kind: 'class',
		nameGroup: 1,
	},
	// TS/JS — arrow functions assigned to const/let
	{
		languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
		pattern: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*(?::\s*\S+\s*)?=\s*(?:async\s+)?\(/,
		kind: 'function',
		nameGroup: 1,
	},
	// Python — function definitions
	{
		languages: ['python'],
		pattern: /^(?:async\s+)?def\s+(\w+)\s*\(/,
		kind: 'function',
		nameGroup: 1,
	},
	// Python — class definitions
	{
		languages: ['python'],
		pattern: /^class\s+(\w+)/,
		kind: 'class',
		nameGroup: 1,
	},
	// Go — function/method definitions
	{
		languages: ['go'],
		pattern: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/,
		kind: 'function',
		nameGroup: 1,
	},
	// Rust — function definitions
	{
		languages: ['rust'],
		pattern: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*[(<]/,
		kind: 'function',
		nameGroup: 1,
	},
	// Rust — impl/struct/enum
	{
		languages: ['rust'],
		pattern: /^(?:pub\s+)?(?:struct|enum|impl(?:\s+\w+\s+for)?)\s+(\w+)/,
		kind: 'class',
		nameGroup: 1,
	},
	// Java / C# — method/class
	{
		languages: ['java', 'csharp'],
		pattern: /^(?:public|private|protected|internal|static|abstract|override|async|\s)+(?:class|interface|enum)\s+(\w+)/,
		kind: 'class',
		nameGroup: 1,
	},
];

/**
 * Split a file's text into indexable chunks.
 *
 * Strategy:
 * 1. Run language-specific regexes to find symbol boundaries.
 * 2. Merge adjacent lines into blocks where symbols aren't detected.
 * 3. Enforce MAX_CHUNK_LINES to keep chunks manageable.
 */
export function chunkFile(fileUri: string, text: string, language: string): ICodeChunk[] {
	const lines = text.split('\n');
	if (lines.length === 0) { return []; }

	// For very small files, return as a single chunk.
	if (lines.length <= MIN_CHUNK_LINES) {
		return [{
			fileUri,
			language,
			startLine: 0,
			endLine: lines.length - 1,
			kind: 'file',
			symbolName: '',
			text: text.trim(),
		}];
	}

	const patterns = SYMBOL_PATTERNS.filter(p => p.languages.includes(language));
	const rawChunks: RawChunk[] = [];

	// Find symbol start lines
	const symbolStarts: Array<{ line: number; kind: ChunkKind; name: string }> = [];
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trimStart();
		for (const { pattern, kind, nameGroup } of patterns) {
			const m = trimmed.match(pattern);
			if (m) {
				symbolStarts.push({ line: i, kind, name: m[nameGroup] ?? '' });
				break;
			}
		}
	}

	if (symbolStarts.length === 0) {
		// No symbols found — split by fixed window
		return splitByWindow(fileUri, language, lines);
	}

	// Build chunks: each symbol from its start line to just before the next symbol
	for (let i = 0; i < symbolStarts.length; i++) {
		const start = symbolStarts[i].line;
		const end = i + 1 < symbolStarts.length
			? symbolStarts[i + 1].line - 1
			: lines.length - 1;
		rawChunks.push({ startLine: start, endLine: end, kind: symbolStarts[i].kind, symbolName: symbolStarts[i].name });
	}

	// If there are lines before the first symbol, add a preamble chunk
	if (symbolStarts[0].line > 0) {
		rawChunks.unshift({ startLine: 0, endLine: symbolStarts[0].line - 1, kind: 'block', symbolName: '' });
	}

	// Convert to ICodeChunk, splitting oversized chunks
	const result: ICodeChunk[] = [];
	for (const raw of rawChunks) {
		const chunkLines = raw.endLine - raw.startLine + 1;
		if (chunkLines <= MAX_CHUNK_LINES) {
			result.push(makeChunk(fileUri, language, lines, raw.startLine, raw.endLine, raw.kind, raw.symbolName));
		} else {
			// Split oversized chunks by window
			for (let s = raw.startLine; s <= raw.endLine; s += MAX_CHUNK_LINES) {
				const e = Math.min(s + MAX_CHUNK_LINES - 1, raw.endLine);
				result.push(makeChunk(fileUri, language, lines, s, e,
					s === raw.startLine ? raw.kind : 'block',
					s === raw.startLine ? raw.symbolName : ''));
			}
		}
	}

	return result.filter(c => c.text.trim().length > 0);
}

function splitByWindow(fileUri: string, language: string, lines: string[]): ICodeChunk[] {
	const result: ICodeChunk[] = [];
	for (let s = 0; s < lines.length; s += MAX_CHUNK_LINES) {
		const e = Math.min(s + MAX_CHUNK_LINES - 1, lines.length - 1);
		result.push(makeChunk(fileUri, language, lines, s, e, 'block', ''));
	}
	return result.filter(c => c.text.trim().length > 0);
}

function makeChunk(
	fileUri: string,
	language: string,
	lines: string[],
	startLine: number,
	endLine: number,
	kind: ChunkKind,
	symbolName: string,
): ICodeChunk {
	return {
		fileUri,
		language,
		startLine,
		endLine,
		kind,
		symbolName,
		text: lines.slice(startLine, endLine + 1).join('\n'),
	};
}
