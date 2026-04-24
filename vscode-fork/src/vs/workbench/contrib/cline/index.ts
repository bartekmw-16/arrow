/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 1 Scaffold
 * Barrel export — re-exports all public types from the cline contribution.
 *
 * Drop this file into the VS Code OSS fork at the same relative path:
 *   src/vs/workbench/contrib/cline/index.ts
 *--------------------------------------------------------------------------------------------*/

// Common (platform-agnostic) surface area
export { IClineService, AgentState } from './common/clineService';
export type { IAgentStateChangeEvent } from './common/clineService';

// Browser-layer identifiers useful to other contributions
export { CLINE_VIEW_CONTAINER_ID, CLINE_VIEW_CONTAINER } from './browser/clineViewContainer';
export { ClineView } from './browser/clineView';

// Action IDs (useful for tests and other contributions that want to trigger actions)
// Action classes themselves are not exported; use their static ID strings.
export const ClineActionIds = {
	OpenAgent: 'cline.openAgent',
	StartSession: 'cline.startSession',
	StopSession: 'cline.stopSession',
} as const;
