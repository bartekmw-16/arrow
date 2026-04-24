/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 4: React UI Integration
 * Typed message protocol between the native service layer and the React webview.
 *
 * Both sides import this module (the native side imports it directly; the
 * webview side is bundled separately but must mirror these type definitions).
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/browser/panel/webviewMessages.ts
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Messages sent FROM the native host TO the webview
// ---------------------------------------------------------------------------

export type HostToWebviewMessage =
	| { type: 'init'; agentState: string; indexingStatus: string; theme: ThemeData }
	| { type: 'agentStateChanged'; state: string }
	| { type: 'indexingProgress'; indexed: number; total: number | undefined; status: string }
	| { type: 'chatMessage'; message: IChatMessage }
	| { type: 'toolCallStarted'; toolCall: IToolCallEvent }
	| { type: 'toolCallCompleted'; toolCallId: string; result: string; error?: string }
	| { type: 'editProposal'; proposal: IEditProposalMessage }
	| { type: 'searchResults'; requestId: string; results: ISearchResultMessage[] }
	| { type: 'themeChanged'; theme: ThemeData }
	| { type: 'settingsData'; settings: ISettingsData };

// ---------------------------------------------------------------------------
// Messages sent FROM the webview TO the native host
// ---------------------------------------------------------------------------

export type WebviewToHostMessage =
	| { type: 'ready' }
	| { type: 'startAgent' }
	| { type: 'stopAgent' }
	| { type: 'sendUserMessage'; text: string; images?: string[] }
	| { type: 'cancelTask' }
	| { type: 'searchCode'; requestId: string; query: string; limit?: number }
	| { type: 'acceptEdit'; proposalId: string }
	| { type: 'rejectEdit'; proposalId: string }
	| { type: 'openFile'; fileUri: string; line?: number }
	| { type: 'openSettings' }
	| { type: 'updateSettings'; settings: Partial<ISettingsData> }
	| { type: 'clearHistory' }
	| { type: 'exportHistory' };

// ---------------------------------------------------------------------------
// Shared data types
// ---------------------------------------------------------------------------

export interface IChatMessage {
	readonly id: string;
	/** 'user' | 'assistant' | 'tool' | 'system' */
	readonly role: 'user' | 'assistant' | 'tool' | 'system';
	readonly content: string;
	/** Optional image data URIs (for multimodal user messages). */
	readonly images?: string[];
	/** Unix timestamp ms. */
	readonly ts: number;
}

export interface IToolCallEvent {
	readonly id: string;
	/** The tool name (e.g. 'read_file', 'write_file', 'execute_command'). */
	readonly name: string;
	/** JSON-encoded input parameters. */
	readonly input: string;
	/** Status while the tool is running. */
	status: 'pending' | 'running' | 'done' | 'error';
}

export interface IEditProposalMessage {
	readonly id: string;
	/** Absolute file URI. */
	readonly fileUri: string;
	/** 1-based start line. */
	readonly startLine: number;
	/** 1-based end line. */
	readonly endLine: number;
	/** Proposed replacement text. */
	readonly newText: string;
	/** Original text (for display in diff). */
	readonly originalText: string;
}

export interface ISearchResultMessage {
	readonly fileUri: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly symbolName: string;
	readonly kind: string;
	readonly snippet: string;
	readonly score: number;
}

export interface ThemeData {
	readonly kind: 'light' | 'dark' | 'highContrast';
	/** CSS custom property overrides, e.g. { '--vscode-foreground': '#ccc' } */
	readonly cssVars: Record<string, string>;
}

export interface ISettingsData {
	readonly apiProvider: string;
	readonly apiKey: string;
	readonly model: string;
	readonly maxTokens: number;
	readonly temperature: number;
	readonly enableIndexing: boolean;
	readonly indexIgnorePatterns: string[];
}
