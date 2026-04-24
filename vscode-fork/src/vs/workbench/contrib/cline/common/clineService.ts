/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 1 Scaffold
 * Service interface & DI decorator for the Cline agent service.
 *
 * Drop this file into the VS Code OSS fork at the same relative path:
 *   src/vs/workbench/contrib/cline/common/clineService.ts
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

// ---------------------------------------------------------------------------
// Agent state
// ---------------------------------------------------------------------------

export const enum AgentState {
	/** The service has been created but no session has started yet. */
	Idle = 'idle',
	/** The agent is actively processing a task. */
	Running = 'running',
	/** The agent completed its last task successfully. */
	Done = 'done',
	/** The agent encountered an unrecoverable error. */
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
	/**
	 * Service brand — required by VS Code's DI system.
	 * @internal
	 */
	readonly _serviceBrand: undefined;

	/** Fires whenever the agent state changes. */
	readonly onDidChangeState: Event<IAgentStateChangeEvent>;

	/** The current agent state. */
	readonly state: AgentState;

	/**
	 * Start an agent session.
	 * Resolves when the agent is ready to accept tasks.
	 */
	startAgent(): Promise<void>;

	/**
	 * Stop the currently running agent session.
	 * Resolves when the agent process has fully exited.
	 */
	stopAgent(): Promise<void>;

	/**
	 * Return a snapshot of the current agent state.
	 * Equivalent to reading `state` but provided as a method for callers
	 * that prefer an async-compatible signature.
	 */
	getAgentState(): AgentState;
}

// ---------------------------------------------------------------------------
// DI service identifier
// ---------------------------------------------------------------------------

/** Unique DI token used across the workbench to resolve `IClineService`. */
export const IClineService = createDecorator<IClineService>('clineService');
