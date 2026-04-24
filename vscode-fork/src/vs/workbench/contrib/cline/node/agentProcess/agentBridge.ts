/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 5: Full Agent Backend
 * IPC bridge between the VS Code native layer and the Cline agent process.
 *
 * The Cline agent runs in a child process (`agentRunner.ts`) to keep heavy AI
 * inference off the main Electron thread.  This module manages the child
 * process lifecycle and exposes a typed Promise-based RPC interface to the
 * rest of the native code.
 *
 * Communication protocol:
 *   - Each request is a JSON line:  { id, method, params }
 *   - Each response is a JSON line: { id, result } or { id, error }
 *   - Notifications have no id:     { event, data }
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/node/agentProcess/agentBridge.ts
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import * as cp from 'child_process';
import * as readline from 'readline';

// ---------------------------------------------------------------------------
// Protocol types
// ---------------------------------------------------------------------------

export interface AgentRequest {
	id: string;
	method: string;
	params: unknown;
}

export interface AgentResponse {
	id: string;
	result?: unknown;
	error?: string;
}

export interface AgentNotification {
	event: string;
	data: unknown;
}

export type AgentMessage = AgentResponse | AgentNotification;

// ---------------------------------------------------------------------------
// Notification event data shapes
// ---------------------------------------------------------------------------

export interface IChatMessageEvent {
	role: 'assistant' | 'tool' | 'system';
	content: string;
	images?: string[];
}

export interface IToolCallStartedEvent {
	id: string;
	name: string;
	input: string;
}

export interface IToolCallCompletedEvent {
	id: string;
	result: string;
	error?: string;
}

export interface IEditProposalEvent {
	id: string;
	fileUri: string;
	startLine: number;
	endLine: number;
	originalText: string;
	newText: string;
}

export interface IAgentStateEvent {
	state: 'idle' | 'running' | 'done' | 'error';
	error?: string;
}

// ---------------------------------------------------------------------------
// AgentBridge
// ---------------------------------------------------------------------------

let _idCounter = 0;
function nextId(): string { return `req_${++_idCounter}`; }

const REQUEST_TIMEOUT_MS = 60_000;

export class AgentBridge extends Disposable {

	// -------------------------------------------------------------------------
	// Notifications from the child process
	// -------------------------------------------------------------------------

	private readonly _onChatMessage = this._register(new Emitter<IChatMessageEvent>());
	readonly onChatMessage: Event<IChatMessageEvent> = this._onChatMessage.event;

	private readonly _onToolCallStarted = this._register(new Emitter<IToolCallStartedEvent>());
	readonly onToolCallStarted: Event<IToolCallStartedEvent> = this._onToolCallStarted.event;

	private readonly _onToolCallCompleted = this._register(new Emitter<IToolCallCompletedEvent>());
	readonly onToolCallCompleted: Event<IToolCallCompletedEvent> = this._onToolCallCompleted.event;

	private readonly _onEditProposal = this._register(new Emitter<IEditProposalEvent>());
	readonly onEditProposal: Event<IEditProposalEvent> = this._onEditProposal.event;

	private readonly _onAgentState = this._register(new Emitter<IAgentStateEvent>());
	readonly onAgentState: Event<IAgentStateEvent> = this._onAgentState.event;

	// -------------------------------------------------------------------------
	// Internal
	// -------------------------------------------------------------------------

	private _proc: cp.ChildProcess | null = null;
	private readonly _pendingRequests = new Map<string, {
		resolve: (r: unknown) => void;
		reject: (e: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}>();

	constructor(
		private readonly _agentScriptPath: string,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	// -------------------------------------------------------------------------
	// Process lifecycle
	// -------------------------------------------------------------------------

	start(): void {
		if (this._proc) { return; }

		this.logService.info(`[AgentBridge] Starting agent process: ${this._agentScriptPath}`);

		this._proc = cp.fork(this._agentScriptPath, [], {
			stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
			env: { ...process.env, CLINE_AGENT_MODE: 'native' },
		});

		// Parse newline-delimited JSON from stdout
		const rl = readline.createInterface({ input: this._proc.stdout! });
		rl.on('line', line => this._handleLine(line));

		this._proc.stderr!.on('data', chunk => {
			this.logService.warn(`[AgentProcess] ${chunk.toString().trim()}`);
		});

		this._proc.on('exit', (code, signal) => {
			this.logService.info(`[AgentBridge] Agent process exited (code=${code}, signal=${signal}).`);
			this._proc = null;
			this._rejectAllPending(new Error(`Agent process exited (code=${code})`));
		});

		this._proc.on('error', err => {
			this.logService.error(`[AgentBridge] Process error: ${err.message}`);
			this._rejectAllPending(err);
		});
	}

	stop(): void {
		if (!this._proc) { return; }
		this.logService.info('[AgentBridge] Stopping agent process.');
		const procToKill = this._proc;
		this._proc = null;
		procToKill.kill('SIGTERM');
		// Force-kill after 5 s if still running. Store the handle so it can be
		// cleared if the process exits cleanly before the timeout fires.
		const killTimer = setTimeout(() => {
			if (!procToKill.killed) {
				procToKill.kill('SIGKILL');
			}
		}, 5_000);
		procToKill.once('exit', () => clearTimeout(killTimer));
	}

	get isRunning(): boolean { return this._proc !== null; }

	// -------------------------------------------------------------------------
	// RPC methods
	// -------------------------------------------------------------------------

	async sendUserMessage(text: string, images?: string[]): Promise<void> {
		await this._request('sendUserMessage', { text, images });
	}

	async cancelTask(): Promise<void> {
		await this._request('cancelTask', {});
	}

	async generateEdit(params: {
		instruction: string;
		context: string;
		fileUri: string;
		cursorLine: number;
	}): Promise<{ startLine: number; endLine: number; newText: string; originalText: string } | null> {
		return this._request('generateEdit', params) as any;
	}

	async getSettings(): Promise<unknown> {
		return this._request('getSettings', {});
	}

	async updateSettings(settings: unknown): Promise<void> {
		await this._request('updateSettings', settings);
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	private _request<T = unknown>(method: string, params: unknown): Promise<T> {
		if (!this._proc) {
			return Promise.reject(new Error('Agent process is not running.'));
		}

		return new Promise<T>((resolve, reject) => {
			const id = nextId();
			const timer = setTimeout(() => {
				this._pendingRequests.delete(id);
				reject(new Error(`Agent RPC timeout: ${method} (${REQUEST_TIMEOUT_MS}ms)`));
			}, REQUEST_TIMEOUT_MS);

			this._pendingRequests.set(id, {
				resolve: resolve as (r: unknown) => void,
				reject,
				timer,
			});

			const msg: AgentRequest = { id, method, params };
			this._proc!.stdin!.write(JSON.stringify(msg) + '\n');
		});
	}

	private _handleLine(line: string): void {
		let msg: AgentMessage;
		try {
			msg = JSON.parse(line.trim());
		} catch {
			this.logService.warn(`[AgentBridge] Unparseable line: ${line}`);
			return;
		}

		// Response to a pending request
		if ('id' in msg && msg.id) {
			const pending = this._pendingRequests.get(msg.id);
			if (pending) {
				clearTimeout(pending.timer);
				this._pendingRequests.delete(msg.id);
				if ('error' in msg && msg.error) {
					pending.reject(new Error(msg.error));
				} else {
					pending.resolve(msg.result);
				}
			}
			return;
		}

		// Notification (no id)
		if ('event' in msg) {
			this._handleNotification(msg);
		}
	}

	private _handleNotification(msg: AgentNotification): void {
		switch (msg.event) {
			case 'chatMessage':
				this._onChatMessage.fire(msg.data as IChatMessageEvent);
				break;
			case 'toolCallStarted':
				this._onToolCallStarted.fire(msg.data as IToolCallStartedEvent);
				break;
			case 'toolCallCompleted':
				this._onToolCallCompleted.fire(msg.data as IToolCallCompletedEvent);
				break;
			case 'editProposal':
				this._onEditProposal.fire(msg.data as IEditProposalEvent);
				break;
			case 'agentState':
				this._onAgentState.fire(msg.data as IAgentStateEvent);
				break;
			default:
				this.logService.trace(`[AgentBridge] Unknown notification: ${msg.event}`);
		}
	}

	private _rejectAllPending(err: Error): void {
		for (const [id, pending] of this._pendingRequests) {
			clearTimeout(pending.timer);
			pending.reject(err);
		}
		this._pendingRequests.clear();
	}

	override dispose(): void {
		this.stop();
		super.dispose();
	}
}
