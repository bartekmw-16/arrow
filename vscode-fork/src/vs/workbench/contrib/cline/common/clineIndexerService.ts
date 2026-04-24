/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 2: Codebase Indexer
 * Service interface for the local codebase index.
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/common/clineIndexerService.ts
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

/** A single searchable unit extracted from a source file. */
export interface ICodeChunk {
	/** Absolute file URI. */
	readonly fileUri: string;
	/** Programming language identifier (e.g. 'typescript', 'python'). */
	readonly language: string;
	/** 0-based start line of this chunk in the file. */
	readonly startLine: number;
	/** 0-based end line (inclusive). */
	readonly endLine: number;
	/** Symbol kind: 'function' | 'class' | 'method' | 'variable' | 'block'. */
	readonly kind: ChunkKind;
	/** Symbol name, if extractable (empty for anonymous blocks). */
	readonly symbolName: string;
	/** Raw source text of the chunk. */
	readonly text: string;
}

export type ChunkKind = 'function' | 'class' | 'method' | 'variable' | 'block' | 'file';

/** A search result referencing a code chunk with a relevance score. */
export interface ISearchResult {
	readonly chunk: ICodeChunk;
	/** BM25 / FTS5 relevance score (higher = more relevant). */
	readonly score: number;
	/** Highlighted snippet for display (HTML-escaped, `<mark>` tags for matches). */
	readonly snippet: string;
}

/** Per-file symbol information, similar to DocumentSymbol in LSP. */
export interface IFileSymbol {
	readonly name: string;
	readonly kind: ChunkKind;
	readonly startLine: number;
	readonly endLine: number;
}

export const enum IndexingStatus {
	/** Nothing has been indexed yet. */
	NotStarted = 'not_started',
	/** An indexing pass is in progress. */
	Indexing = 'indexing',
	/** All files have been indexed and the index is up-to-date. */
	Ready = 'ready',
	/** The last indexing pass encountered an error. */
	Error = 'error',
}

export interface IIndexUpdateEvent {
	/** URI of the file that was just indexed. */
	readonly fileUri: string;
	/** How many chunks were stored for this file. */
	readonly chunkCount: number;
	/** Current overall status. */
	readonly status: IndexingStatus;
}

export interface IIndexingProgress {
	readonly status: IndexingStatus;
	/** Total files to index (undefined until discovery is complete). */
	readonly total: number | undefined;
	/** Files indexed so far. */
	readonly indexed: number;
	/** Last error message, if status === Error. */
	readonly error?: string;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface IClineIndexerService {
	readonly _serviceBrand: undefined;

	/** Fires after each file has been indexed. */
	readonly onDidIndexUpdate: Event<IIndexUpdateEvent>;

	/** Fires when the overall indexing status changes. */
	readonly onDidChangeStatus: Event<IndexingStatus>;

	/** Current indexing progress snapshot. */
	readonly progress: IIndexingProgress;

	/**
	 * Kick off a full workspace index.  Safe to call while indexing is already
	 * in progress — subsequent calls are debounced.
	 */
	indexWorkspace(rootUri: URI): Promise<void>;

	/**
	 * Re-index a single file (called on file save / change events).
	 * Resolves when the file has been processed.
	 */
	indexFile(fileUri: URI): Promise<void>;

	/**
	 * Remove a file from the index (called on file delete events).
	 */
	removeFile(fileUri: URI): Promise<void>;

	/**
	 * Full-text search over the indexed codebase.
	 *
	 * @param query Natural-language or keyword query.
	 * @param limit Maximum number of results to return (default 20).
	 * @param fileUriFilter Optional list of file URIs to restrict the search.
	 */
	search(query: string, limit?: number, fileUriFilter?: string[]): Promise<ISearchResult[]>;

	/**
	 * Return all symbols for a given file URI.
	 * Returns an empty array if the file has not been indexed.
	 */
	getSymbols(fileUri: URI): Promise<IFileSymbol[]>;

	/**
	 * Return the raw indexed chunks for a file, in source order.
	 */
	getChunks(fileUri: URI): Promise<ICodeChunk[]>;
}

export const IClineIndexerService = createDecorator<IClineIndexerService>('clineIndexerService');
