/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 2: Codebase Indexer
 * Main indexing orchestrator.
 *
 * Wires together:
 *   - IFileService  →  discover workspace files + watch for changes
 *   - fileChunker   →  split each file into searchable chunks
 *   - SQLiteFtsStore→  persist and query chunks
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/node/indexer/codebaseIndexer.ts
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { ILogService } from 'vs/platform/log/common/log';
import { IFileService, FileChangeType } from 'vs/platform/files/common/files';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import * as path from 'vs/base/common/path';
import {
	IIndexUpdateEvent, IIndexingProgress, IndexingStatus,
	ISearchResult, IFileSymbol, ICodeChunk,
} from '../../common/clineIndexerService';
import { chunkFile, detectLanguage, shouldIndexFile } from './fileChunker';
import { SQLiteFtsStore } from './sqliteFtsStore';

// Maximum number of files to index concurrently.
const INDEX_CONCURRENCY = 4;

// Debounce delay for file change events (ms).
const CHANGE_DEBOUNCE_MS = 1500;

// Key used to persist the database path across sessions.
const STORAGE_KEY_DB_PATH = 'cline.indexer.dbPath';

export class CodebaseIndexer extends Disposable {

	// -------------------------------------------------------------------------
	// Events
	// -------------------------------------------------------------------------

	private readonly _onDidIndexUpdate = this._register(new Emitter<IIndexUpdateEvent>());
	readonly onDidIndexUpdate: Event<IIndexUpdateEvent> = this._onDidIndexUpdate.event;

	private readonly _onDidChangeStatus = this._register(new Emitter<IndexingStatus>());
	readonly onDidChangeStatus: Event<IndexingStatus> = this._onDidChangeStatus.event;

	// -------------------------------------------------------------------------
	// State
	// -------------------------------------------------------------------------

	private _status: IndexingStatus = IndexingStatus.NotStarted;
	private _total: number | undefined = undefined;
	private _indexed = 0;
	private _lastError: string | undefined = undefined;

	/** Pending file change events waiting to be processed. */
	private _pendingChanges = new Map<string, FileChangeType>();
	private _changeTimer: ReturnType<typeof setTimeout> | undefined = undefined;

	/** Whether a full workspace index is currently running. */
	private _indexingInProgress = false;

	get progress(): IIndexingProgress {
		return {
			status: this._status,
			total: this._total,
			indexed: this._indexed,
			error: this._lastError,
		};
	}

	// -------------------------------------------------------------------------
	// Constructor
	// -------------------------------------------------------------------------

	constructor(
		private readonly store: SQLiteFtsStore,
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		// Watch for file system changes
		this._register(fileService.onDidFilesChange(e => {
			for (const change of e.changes) {
				if (shouldIndexFile(change.resource.fsPath)) {
					this._pendingChanges.set(change.resource.toString(), change.type);
				}
			}
			this._schedulePendingChanges();
		}));
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	async indexWorkspace(rootUri: URI): Promise<void> {
		if (this._indexingInProgress) {
			this.logService.info('[ClineIndexer] indexWorkspace() called while already indexing — skipping.');
			return;
		}

		this._indexingInProgress = true;
		this._setStatus(IndexingStatus.Indexing);
		this._indexed = 0;
		this._total = undefined;

		try {
			this.logService.info(`[ClineIndexer] Starting workspace index: ${rootUri.toString()}`);

			// Discover all files recursively
			const files = await this._discoverFiles(rootUri);
			this._total = files.length;
			this.logService.info(`[ClineIndexer] Found ${files.length} files to index.`);

			// Index in parallel batches
			await this._processInBatches(files, async (fileUri) => {
				try {
					await this._indexOneFile(fileUri);
				} catch (e) {
					this.logService.warn(`[ClineIndexer] Failed to index ${fileUri.toString()}: ${e}`);
				}
			});

			this._setStatus(IndexingStatus.Ready);
			this.logService.info(`[ClineIndexer] Workspace index complete. ${this._indexed}/${this._total} files.`);
		} catch (e) {
			this._lastError = String(e);
			this._setStatus(IndexingStatus.Error);
			this.logService.error(`[ClineIndexer] Workspace index failed: ${e}`);
		} finally {
			this._indexingInProgress = false;
		}
	}

	async indexFile(fileUri: URI): Promise<void> {
		try {
			await this._indexOneFile(fileUri);
		} catch (e) {
			this.logService.warn(`[ClineIndexer] Failed to index ${fileUri.toString()}: ${e}`);
		}
	}

	async removeFile(fileUri: URI): Promise<void> {
		this.store.removeFile(fileUri.toString());
		this.logService.trace(`[ClineIndexer] Removed ${fileUri.toString()} from index.`);
	}

	search(query: string, limit: number = 20, fileUriFilter?: string[]): ISearchResult[] {
		return this.store.search(query, limit, fileUriFilter);
	}

	getSymbols(fileUri: URI): IFileSymbol[] {
		return this.store.getSymbols(fileUri.toString());
	}

	getChunks(fileUri: URI): ICodeChunk[] {
		return this.store.getChunks(fileUri.toString());
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private async _indexOneFile(fileUri: URI): Promise<void> {
		const fsPath = fileUri.fsPath;
		if (!shouldIndexFile(fsPath)) { return; }

		const language = detectLanguage(fsPath);
		let text: string;

		try {
			const content = await this.fileService.readFile(fileUri);
			text = content.value.toString();
		} catch {
			// File may have been deleted between discovery and indexing
			return;
		}

		const chunks = chunkFile(fileUri.toString(), text, language);
		if (chunks.length > 0) {
			this.store.upsertFile(chunks);
		}

		this._indexed++;
		this._onDidIndexUpdate.fire({
			fileUri: fileUri.toString(),
			chunkCount: chunks.length,
			status: this._status,
		});
	}

	private async _discoverFiles(rootUri: URI): Promise<URI[]> {
		const results: URI[] = [];
		await this._walkDirectory(rootUri, results);
		return results;
	}

	private async _walkDirectory(dirUri: URI, results: URI[]): Promise<void> {
		let stat;
		try {
			stat = await this.fileService.resolve(dirUri, { resolveMetadata: false });
		} catch {
			return; // Directory may not exist or be accessible
		}

		if (!stat.isDirectory) {
			if (shouldIndexFile(dirUri.fsPath)) {
				results.push(dirUri);
			}
			return;
		}

		for (const child of stat.children ?? []) {
			if (child.isDirectory) {
				if (!this._isIgnoredDir(child.resource.fsPath)) {
					await this._walkDirectory(child.resource, results);
				}
			} else if (shouldIndexFile(child.resource.fsPath)) {
				results.push(child.resource);
			}
		}
	}

	private _isIgnoredDir(fsPath: string): boolean {
		const name = path.basename(fsPath);
		const ignored = new Set([
			'node_modules', '.git', 'dist', 'build', 'out', '.next',
			'coverage', '__pycache__', '.venv', 'vendor', 'target',
			'.build', 'obj', 'bin', 'pkg', '.yarn',
		]);
		return ignored.has(name);
	}

	private async _processInBatches<T>(
		items: T[],
		fn: (item: T) => Promise<void>,
	): Promise<void> {
		for (let i = 0; i < items.length; i += INDEX_CONCURRENCY) {
			const batch = items.slice(i, i + INDEX_CONCURRENCY);
			await Promise.all(batch.map(fn));
		}
	}

	private _schedulePendingChanges(): void {
		if (this._changeTimer !== undefined) {
			clearTimeout(this._changeTimer);
		}
		this._changeTimer = setTimeout(() => {
			this._changeTimer = undefined;
			this._flushPendingChanges();
		}, CHANGE_DEBOUNCE_MS);
	}

	private _flushPendingChanges(): void {
		const changes = new Map(this._pendingChanges);
		this._pendingChanges.clear();

		for (const [uriStr, type] of changes) {
			const uri = URI.parse(uriStr);
			if (type === FileChangeType.DELETED) {
				this.removeFile(uri).catch(() => undefined);
			} else {
				this.indexFile(uri).catch(() => undefined);
			}
		}
	}

	private _setStatus(status: IndexingStatus): void {
		if (this._status !== status) {
			this._status = status;
			this._onDidChangeStatus.fire(status);
		}
	}
}
