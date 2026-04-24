/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 2: Codebase Indexer
 * SQLite FTS5-backed search store.
 *
 * Uses VS Code's built-in vscode-sqlite3 module (available in the Electron
 * process) to maintain a full-text-searchable index of code chunks.  FTS5
 * with BM25 ranking gives fast, accurate keyword search with no external
 * dependencies.
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/node/indexer/sqliteFtsStore.ts
 *--------------------------------------------------------------------------------------------*/

import { ICodeChunk, ISearchResult, IFileSymbol, ChunkKind } from '../../common/clineIndexerService';

// We load sqlite3 lazily via require() rather than a static import so that
// the module can be resolved at runtime from the correct Electron native path.
// In the VS Code OSS build the module is provided by `@vscode/sqlite3`.
type Database = import('@vscode/sqlite3').Database;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- Stores metadata about each indexed file
CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uri         TEXT    NOT NULL UNIQUE,
  language    TEXT    NOT NULL,
  indexed_at  INTEGER NOT NULL   -- Unix timestamp ms
);

-- Stores individual code chunks
CREATE TABLE IF NOT EXISTS chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  kind        TEXT    NOT NULL,
  symbol_name TEXT    NOT NULL DEFAULT '',
  text_len    INTEGER NOT NULL
);

-- FTS5 virtual table for full-text search
-- Uses the porter tokeniser for stemming (helps with plurals, verb forms)
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  uri         UNINDEXED,
  language    UNINDEXED,
  start_line  UNINDEXED,
  end_line    UNINDEXED,
  kind        UNINDEXED,
  symbol_name,
  text,
  content     = '',   -- contentless for smaller DB size
  tokenize    = 'porter ascii'
);

-- Trigger to keep FTS in sync when chunks are deleted
CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, uri, language, start_line, end_line, kind, symbol_name, text)
    VALUES ('delete', old.id, '', '', old.start_line, old.end_line, '', '', '');
END;
`;

const SNIPPET_LEN = 200; // characters to return in highlighted snippets

// ---------------------------------------------------------------------------
// SQLiteFtsStore
// ---------------------------------------------------------------------------

export class SQLiteFtsStore {
	private _db: Database | null = null;
	private readonly _dbPath: string;

	constructor(dbPath: string) {
		this._dbPath = dbPath;
	}

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	async open(): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const sqlite3 = require('@vscode/sqlite3') as typeof import('@vscode/sqlite3');
		this._db = await new Promise<Database>((resolve, reject) => {
			const db = new sqlite3.Database(this._dbPath, (err: Error | null) => {
				if (err) { reject(err); } else { resolve(db); }
			});
		});
		try {
			this._run(SCHEMA_SQL);
		} catch (e) {
			this._db.close();
			this._db = null;
			throw e;
		}
	}

	close(): void {
		this._db?.close();
		this._db = null;
	}

	// -------------------------------------------------------------------------
	// Write operations
	// -------------------------------------------------------------------------

	/**
	 * Upsert all chunks for a file.
	 * Replaces any previously indexed chunks for that URI atomically.
	 */
	upsertFile(chunks: ICodeChunk[]): void {
		if (!this._db || chunks.length === 0) { return; }
		const uri = chunks[0].fileUri;
		const language = chunks[0].language;

		this._run('BEGIN');
		try {
			// Remove old data for this file (cascade deletes chunks rows, FTS trigger cleans FTS)
			this._run('DELETE FROM files WHERE uri = ?', [uri]);

			// Insert file record
			const fileId = this._runInsert(
				'INSERT INTO files (uri, language, indexed_at) VALUES (?, ?, ?)',
				[uri, language, Date.now()],
			);

			// Insert chunks and FTS rows in one loop
			const chunkStmt = this._db.prepare(
				'INSERT INTO chunks (file_id, start_line, end_line, kind, symbol_name, text_len) VALUES (?, ?, ?, ?, ?, ?)',
			);
			const ftsStmt = this._db.prepare(
				'INSERT INTO chunks_fts (rowid, uri, language, start_line, end_line, kind, symbol_name, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
			);

			for (const chunk of chunks) {
				const info = chunkStmt.run([fileId, chunk.startLine, chunk.endLine, chunk.kind, chunk.symbolName, chunk.text.length]);
				const chunkId = info.lastID;
				ftsStmt.run([chunkId, uri, language, chunk.startLine, chunk.endLine, chunk.kind, chunk.symbolName, chunk.text]);
			}
			chunkStmt.finalize();
			ftsStmt.finalize();

			this._run('COMMIT');
		} catch (e) {
			this._run('ROLLBACK');
			throw e;
		}
	}

	/** Remove all indexed data for the given URI. */
	removeFile(uri: string): void {
		this._run('DELETE FROM files WHERE uri = ?', [uri]);
	}

	// -------------------------------------------------------------------------
	// Read operations
	// -------------------------------------------------------------------------

	/**
	 * BM25 full-text search.  Returns up to `limit` results ordered by rank.
	 */
	search(query: string, limit: number = 20, fileUriFilter?: string[]): ISearchResult[] {
		if (!this._db) { return []; }

		// Sanitise query: FTS5 match expressions require careful escaping.
		const safeQuery = sanitiseFtsQuery(query);
		if (!safeQuery) { return []; }

		let sql = `
      SELECT
        f.uri         AS fileUri,
        f.language,
        c.start_line  AS startLine,
        c.end_line    AS endLine,
        c.kind,
        c.symbol_name AS symbolName,
        snippet(chunks_fts, 6, '<mark>', '</mark>', '…', 32) AS snippet,
        bm25(chunks_fts)    AS rank
      FROM chunks_fts
      JOIN chunks c ON c.rowid = chunks_fts.rowid
      JOIN files  f ON f.id   = c.file_id
      WHERE chunks_fts MATCH ?
    `;
		const params: unknown[] = [safeQuery];

		if (fileUriFilter && fileUriFilter.length > 0) {
			const placeholders = fileUriFilter.map(() => '?').join(', ');
			sql += ` AND f.uri IN (${placeholders})`;
			params.push(...fileUriFilter);
		}

		sql += ` ORDER BY rank LIMIT ?`;
		params.push(limit);

		const rows = this._all<{
			fileUri: string; language: string; startLine: number; endLine: number;
			kind: ChunkKind; symbolName: string; snippet: string; rank: number;
		}>(sql, params);

		return rows.map(row => ({
			chunk: {
				fileUri: row.fileUri,
				language: row.language,
				startLine: row.startLine,
				endLine: row.endLine,
				kind: row.kind,
				symbolName: row.symbolName,
				text: '', // raw text not returned from search for performance
			},
			score: -row.rank, // BM25 returns negative values; negate for intuitive ordering
			snippet: truncate(row.snippet, SNIPPET_LEN),
		}));
	}

	/** Return all symbols for a given file URI. */
	getSymbols(uri: string): IFileSymbol[] {
		const rows = this._all<{
			kind: ChunkKind; symbol_name: string; start_line: number; end_line: number;
		}>(
			`SELECT c.kind, c.symbol_name, c.start_line, c.end_line
       FROM chunks c
       JOIN files f ON f.id = c.file_id
       WHERE f.uri = ?
         AND c.symbol_name != ''
       ORDER BY c.start_line`,
			[uri],
		);
		return rows.map(r => ({
			name: r.symbol_name,
			kind: r.kind,
			startLine: r.start_line,
			endLine: r.end_line,
		}));
	}

	/** Return all indexed chunks for a file, in source order. */
	getChunks(uri: string): ICodeChunk[] {
		// We store metadata only in the chunks table; the text lives in FTS.
		// For content retrieval we join through the FTS shadow table.
		const rows = this._all<{
			kind: ChunkKind; symbol_name: string; start_line: number; end_line: number; language: string;
		}>(
			`SELECT c.kind, c.symbol_name, c.start_line, c.end_line, f.language
       FROM chunks c
       JOIN files f ON f.id = c.file_id
       WHERE f.uri = ?
       ORDER BY c.start_line`,
			[uri],
		);
		return rows.map(r => ({
			fileUri: uri,
			language: r.language,
			startLine: r.start_line,
			endLine: r.end_line,
			kind: r.kind,
			symbolName: r.symbol_name,
			text: '', // caller should read the file for the actual text
		}));
	}

	/** Return the total number of indexed files. */
	getFileCount(): number {
		const row = this._get<{ n: number }>('SELECT COUNT(*) AS n FROM files');
		return row?.n ?? 0;
	}

	/** Return the total number of indexed chunks. */
	getChunkCount(): number {
		const row = this._get<{ n: number }>('SELECT COUNT(*) AS n FROM chunks');
		return row?.n ?? 0;
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	private _run(sql: string, params?: unknown[]): void {
		if (!this._db) { throw new Error('SQLiteFtsStore: database is not open'); }
		this._db.prepare(sql).run(params ?? []);
	}

	private _runInsert(sql: string, params: unknown[]): number {
		if (!this._db) { throw new Error('SQLiteFtsStore: database is not open'); }
		const stmt = this._db.prepare(sql);
		const info = stmt.run(params);
		stmt.finalize();
		return info.lastID;
	}

	private _all<T>(sql: string, params: unknown[] = []): T[] {
		if (!this._db) { return []; }
		const stmt = this._db.prepare(sql);
		const rows = stmt.all(params) as T[];
		stmt.finalize();
		return rows;
	}

	private _get<T>(sql: string, params: unknown[] = []): T | undefined {
		if (!this._db) { return undefined; }
		const stmt = this._db.prepare(sql);
		const row = stmt.get(params) as T | undefined;
		stmt.finalize();
		return row;
	}
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Basic sanitisation for FTS5 MATCH expressions.
 * - Removes characters that FTS5 interprets as operators when they appear
 *   unbalanced (quotes, parentheses).
 * - Wraps multi-word queries so each word is independently matched.
 */
function sanitiseFtsQuery(raw: string): string {
	// Remove characters that break FTS5 query syntax
	let q = raw.replace(/["\(\)\*\^]/g, ' ').trim();
	if (!q) { return ''; }
	// Split into words and append wildcard to support prefix matching
	const words = q.split(/\s+/).filter(Boolean);
	return words.map(w => `"${w}"*`).join(' ');
}

function truncate(s: string, maxLen: number): string {
	return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}
