/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 1 Scaffold
 * Node-layer stub implementation of IClineService.
 *
 * Drop this file into the VS Code OSS fork at the same relative path:
 *   src/vs/workbench/contrib/cline/node/clineServiceImpl.ts
 *
 * In Phase 4 this class will spawn the real Cline agent subprocess and wire
 * up full IPC.  For Phase 1 it is a fully-functional lifecycle stub that:
 *   - Logs state transitions to the VS Code output channel
 *   - Starts/stops cleanly with the workbench lifecycle
 *   - Proves the DI wiring compiles and registers correctly
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { ILifecycleService, LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { AgentState, IAgentStateChangeEvent, IClineService } from '../common/clineService';

export class ClineServiceImpl extends Disposable implements IClineService {
	declare readonly _serviceBrand: undefined;

	// -------------------------------------------------------------------------
	// State
	// -------------------------------------------------------------------------

	private _state: AgentState = AgentState.Idle;

	get state(): AgentState {
		return this._state;
	}

	private readonly _onDidChangeState = this._register(new Emitter<IAgentStateChangeEvent>());
	readonly onDidChangeState: Event<IAgentStateChangeEvent> = this._onDidChangeState.event;

	// -------------------------------------------------------------------------
	// Constructor
	// -------------------------------------------------------------------------

	constructor(
		@ILogService private readonly logService: ILogService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		super();

		// Wait until the workbench is fully restored before doing anything heavy.
		lifecycleService.when(LifecyclePhase.Restored).then(() => {
			this.logService.info('[ClineService] Workbench restored — service ready.');
		});

		// Tear down cleanly when the window is about to close.
		this._register(lifecycleService.onWillShutdown(() => {
			this.logService.info('[ClineService] Shutdown requested — stopping agent if running.');
			this.stopAgent();
		}));
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	async startAgent(): Promise<void> {
		if (this._state === AgentState.Running) {
			this.logService.warn('[ClineService] startAgent() called while agent is already running — ignoring.');
			return;
		}

		this.logService.info('[ClineService] Starting agent…');
		this._setState(AgentState.Running);

		// Phase 1 stub: nothing actually runs yet.
		// Phase 4 will replace this with real subprocess spawning via IPC.
		this.logService.info('[ClineService] Agent started (stub — Phase 4 will wire the real process).');
	}

	async stopAgent(): Promise<void> {
		if (this._state === AgentState.Idle) {
			return;
		}

		this.logService.info('[ClineService] Stopping agent…');

		// Phase 1 stub: immediate transition to Idle.
		this._setState(AgentState.Idle);
		this.logService.info('[ClineService] Agent stopped.');
	}

	getAgentState(): AgentState {
		return this._state;
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	private _setState(next: AgentState): void {
		const previous = this._state;
		this._state = next;
		this._onDidChangeState.fire({ previous, current: next });
	}
}
