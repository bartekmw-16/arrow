/*---------------------------------------------------------------------------------------------
 * Cline IDE — Barrel export
 * Re-exports all public types from the cline workbench contribution.
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/index.ts
 *--------------------------------------------------------------------------------------------*/

// Common (platform-agnostic)
export { IClineService, AgentState } from './common/clineService';
export type { IAgentStateChangeEvent } from './common/clineService';

export { IClineIndexerService, IndexingStatus } from './common/clineIndexerService';
export type {
	ICodeChunk, ChunkKind, ISearchResult, IFileSymbol,
	IIndexUpdateEvent, IIndexingProgress,
} from './common/clineIndexerService';

// Browser-layer identifiers
export { CLINE_VIEW_CONTAINER_ID, CLINE_VIEW_CONTAINER, CLINE_VIEW_ICON } from './browser/clineViewContainer';
export { ClineView } from './browser/clineView';

// Webview message protocol
export type { HostToWebviewMessage, WebviewToHostMessage } from './browser/panel/webviewMessages';

// Editor contribution
export { ClineEditorContribution, CLINE_EDITOR_CONTRIB_ID } from './browser/editor/clineEditorContribution';
export type { IDiffProposal } from './browser/editor/inlineDiffDecorator';

// Action IDs
export const ClineActionIds = {
	OpenAgent: 'cline.openAgent',
	StartSession: 'cline.startSession',
	StopSession: 'cline.stopSession',
	ToggleCmdk: 'cline.editor.toggleCmdk',
} as const;
