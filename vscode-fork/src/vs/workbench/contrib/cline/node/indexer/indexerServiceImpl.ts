/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 2: Codebase Indexer
 * IClineIndexerService implementation.
 *
 * Manages the SQLite store lifecycle (open/close), wires the CodebaseIndexer
 * to VS Code platform services, and exposes the async search/symbols APIs.
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/node/indexer/indexerServiceImpl.ts
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { ILogService } from 'vs/platform/log/common/log';
import { IFileService } from 'vs/platform/files/common/files';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ILifecycleService, LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import * as path from 'vs/base/common/path';
import {
	IClineIndexerService,
	IIndexUpdateEvent,
	IIndexingProgress,
	IndexingStatus,
	ISearchResult,
	IFileSymbol,
	ICodeChunk,
} from '../../common/clineIndexerService';
import { CodebaseIndexer } from './codebaseIndexer';
import { SQLiteFtsStore } from './sqliteFtsStore';

export class ClineIndexerServiceImpl extends Disposable implements IClineIndexerService {
	declare readonly _serviceBrand: undefined;

	// -------------------------------------------------------------------------
	// Events (delegated to CodebaseIndexer)
	// -------------------------------------------------------------------------

	get onDidIndexUpdate(): Event<IIndexUpdateEvent> { return this._indexer.onDidIndexUpdate; }
	get onDidChangeStatus(): Event<IndexingStatus> { return this._indexer.onDidChangeStatus; }
	get progress(): IIndexingProgress { return this._indexer.progress; }

	// -------------------------------------------------------------------------
	// Internal
	// -------------------------------------------------------------------------

	private readonly _store: SQLiteFtsStore;
	private readonly _indexer: CodebaseIndexer;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService fileService: IFileService,
		@IStorageService storageService: IStorageService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
	) {
		super();

		// Determine the path for the SQLite DB file.
		// Store it under the user's appRoot data directory so it persists across sessions
		// but is separate per workspace (we append a hash of the workspace path).
		const workspaceId = this._workspaceId();
		const dbPath = path.join(environmentService.globalStorageHome.fsPath, `cline-index-${workspaceId}.db`);
		this.logService.info(`[ClineIndexer] Database path: ${dbPath}`);

		this._store = new SQLiteFtsStore(dbPath);
		this._indexer = this._register(new CodebaseIndexer(this._store, logService, fileService, storageService));

		// Open DB and start indexing once the workbench is fully restored.
		lifecycleService.when(LifecyclePhase.Restored).then(async () => {
			try {
				await this._store.open();
				this.logService.info('[ClineIndexer] Database opened.');

				// Kick off initial workspace index.
				const roots = workspaceService.getWorkspace().folders;
				for (const folder of roots) {
					await this._indexer.indexWorkspace(folder.uri);
				}
			} catch (e) {
				this.logService.error(`[ClineIndexer] Failed to initialise: ${e}`);
			}
		});

		// Close DB cleanly on shutdown.
		lifecycleService.onWillShutdown(() => {
			this._store.close();
		});
	}

	// -------------------------------------------------------------------------
	// IClineIndexerService
	// -------------------------------------------------------------------------

	async indexWorkspace(rootUri: URI): Promise<void> {
		return this._indexer.indexWorkspace(rootUri);
	}

	async indexFile(fileUri: URI): Promise<void> {
		return this._indexer.indexFile(fileUri);
	}

	async removeFile(fileUri: URI): Promise<void> {
		return this._indexer.removeFile(fileUri);
	}

	async search(query: string, limit?: number, fileUriFilter?: string[]): Promise<ISearchResult[]> {
		return this._indexer.search(query, limit, fileUriFilter);
	}

	async getSymbols(fileUri: URI): Promise<IFileSymbol[]> {
		return this._indexer.getSymbols(fileUri);
	}

	async getChunks(fileUri: URI): Promise<ICodeChunk[]> {
		return this._indexer.getChunks(fileUri);
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	private _workspaceId(): string {
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length === 0) { return 'empty'; }
		const root = folders[0].uri.toString();
		// Simple djb2 hash for a short, filesystem-safe identifier
		let hash = 5381;
		for (let i = 0; i < root.length; i++) {
			hash = ((hash << 5) + hash) + root.charCodeAt(i);
			hash |= 0; // Convert to 32-bit integer
		}
		return Math.abs(hash).toString(16);
	}
}
