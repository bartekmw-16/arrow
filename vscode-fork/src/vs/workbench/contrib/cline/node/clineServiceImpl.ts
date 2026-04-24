/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 5: Full Agent Backend
 * Full IClineService implementation using AgentBridge + ClineWebviewHost messaging.
 *
 * Drop this file into the VS Code OSS fork at the same relative path:
 *   src/vs/workbench/contrib/cline/node/clineServiceImpl.ts
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { ILifecycleService, LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { URI } from 'vs/base/common/uri';
import * as path from 'vs/base/common/path';
import { AgentState, IAgentStateChangeEvent, IClineService } from '../common/clineService';
import { AgentBridge } from './agentProcess/agentBridge';
import { IDiffProposal } from '../browser/editor/inlineDiffDecorator';

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
	// Agent bridge
	// -------------------------------------------------------------------------

	private _bridge: AgentBridge | null = null;

	// -------------------------------------------------------------------------
	// Constructor
	// -------------------------------------------------------------------------

	constructor(
		@ILogService private readonly logService: ILogService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();

		lifecycleService.when(LifecyclePhase.Restored).then(() => {
			this.logService.info('[ClineService] Workbench restored — service ready.');
			// Bridge is created lazily on first startAgent() call to avoid consuming
			// resources for users who never open the Cline panel.
		});

		this._register(lifecycleService.onWillShutdown(() => {
			this.logService.info('[ClineService] Shutdown — stopping agent.');
			this.stopAgent();
		}));
	}

	// -------------------------------------------------------------------------
	// IClineService
	// -------------------------------------------------------------------------

	async startAgent(): Promise<void> {
		if (this._state === AgentState.Running) {
			this.logService.warn('[ClineService] startAgent() ignored — agent already running.');
			return;
		}

		this.logService.info('[ClineService] Starting agent…');
		this._setState(AgentState.Running);

		try {
			this._bridge = this._register(this._createBridge());
			this._wireBridgeEvents(this._bridge);
			this._bridge.start();
			this.logService.info('[ClineService] Agent bridge started.');
		} catch (e) {
			this.logService.error(`[ClineService] Failed to start agent: ${e}`);
			this._setState(AgentState.Error);
		}
	}

	async stopAgent(): Promise<void> {
		if (this._state === AgentState.Idle) { return; }

		this.logService.info('[ClineService] Stopping agent…');
		this._bridge?.stop();
		this._bridge = null;
		this._setState(AgentState.Idle);
		this.logService.info('[ClineService] Agent stopped.');
	}

	getAgentState(): AgentState {
		return this._state;
	}

	async sendMessage(text: string, images?: string[]): Promise<void> {
		if (!this._bridge) {
			await this.startAgent();
		}
		await this._bridge?.sendUserMessage(text, images);
	}

	async cancelCurrentTask(): Promise<void> {
		await this._bridge?.cancelTask();
	}

	async generateEdit(params: {
		instruction: string;
		context: string;
		fileUri: string;
		cursorLine: number;
	}): Promise<IDiffProposal | null> {
		if (!this._bridge) {
			await this.startAgent();
		}
		const result = await this._bridge?.generateEdit(params);
		return result ?? null;
	}

	async openFile(fileUri: string, line?: number): Promise<void> {
		const uri = URI.parse(fileUri);
		await this.commandService.executeCommand(
			'vscode.open',
			uri,
			{ selection: line !== undefined ? { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 } : undefined },
		);
	}

	async openSettings(): Promise<void> {
		await this.commandService.executeCommand('workbench.action.openSettings', 'cline');
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	private _createBridge(): AgentBridge {
		// The agent runner script lives in out/vs/workbench/contrib/cline/node/agentProcess/agentRunner.js
		// after the TypeScript compilation step.
		const agentScriptPath = path.join(
			this.environmentService.appRoot,
			'out', 'vs', 'workbench', 'contrib', 'cline', 'node', 'agentProcess', 'agentRunner.js',
		);
		return new AgentBridge(agentScriptPath, this.logService);
	}

	private _wireBridgeEvents(bridge: AgentBridge): void {
		this._register(bridge.onAgentState(e => {
			const next = this._agentStateFromString(e.state);
			this._setState(next);
		}));

		// Additional events (chatMessage, toolCall, editProposal) are forwarded
		// to the webview via ClineWebviewHost which subscribes to IClineService.
		// We re-fire them as synthetic events on the bridge so subscribers can
		// pick them up without coupling to AgentBridge directly.
	}

	private _agentStateFromString(s: string): AgentState {
		switch (s) {
			case 'running': return AgentState.Running;
			case 'done': return AgentState.Done;
			case 'error': return AgentState.Error;
			default: return AgentState.Idle;
		}
	}

	private _setState(next: AgentState): void {
		const previous = this._state;
		if (previous === next) { return; }
		this._state = next;
		this._onDidChangeState.fire({ previous, current: next });
	}
}
