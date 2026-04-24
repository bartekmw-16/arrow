/*---------------------------------------------------------------------------------------------
 * Cline IDE — Full Service Interface
 * Service interface & DI decorator for the Cline agent service.
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/common/clineService.ts
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IDiffProposal } from '../browser/editor/inlineDiffDecorator';

// ---------------------------------------------------------------------------
// Agent state
// ---------------------------------------------------------------------------

export const enum AgentState {
	Idle = 'idle',
	Running = 'running',
	Done = 'done',
	Error = 'error',
}

export interface IAgentStateChangeEvent {
	readonly previous: AgentState;
	readonly current: AgentState;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface IClineService {
	readonly _serviceBrand: undefined;

	/** Fires whenever the agent state changes. */
	readonly onDidChangeState: Event<IAgentStateChangeEvent>;

	/** The current agent state. */
	readonly state: AgentState;

	/** Start an agent session. */
	startAgent(): Promise<void>;

	/** Stop the currently running agent session. */
	stopAgent(): Promise<void>;

	/** Return a snapshot of the current agent state. */
	getAgentState(): AgentState;

	/**
	 * Send a user message to the agent.
	 * Starts the agent if not already running.
	 */
	sendMessage(text: string, images?: string[]): Promise<void>;

	/** Cancel the currently running task. */
	cancelCurrentTask(): Promise<void>;

	/**
	 * Ask the agent to generate an edit for the given instruction + context.
	 * Returns a diff proposal that the editor contribution will show inline,
	 * or null if the model produced no change.
	 */
	generateEdit(params: {
		instruction: string;
		context: string;
		fileUri: string;
		cursorLine: number;
	}): Promise<IDiffProposal | null>;

	/** Open a file in the editor, optionally scrolling to a line. */
	openFile(fileUri: string, line?: number): Promise<void>;

	/** Open the Cline settings page. */
	openSettings(): Promise<void>;
}

// ---------------------------------------------------------------------------
// DI service identifier
// ---------------------------------------------------------------------------

export const IClineService = createDecorator<IClineService>('clineService');
