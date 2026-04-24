#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 5: Full Agent Backend
 * Agent subprocess entry-point.
 *
 * This script is spawned by AgentBridge as a child process.  It:
 *   1. Imports the Cline core task/controller logic (reusing the extension's
 *      TypeScript source compiled to CommonJS by `gulp cline-agent-bundle`).
 *   2. Reads JSON-RPC requests from stdin (newline-delimited).
 *   3. Writes JSON-RPC responses and notifications to stdout.
 *   4. Writes debug/error logs to stderr (picked up by AgentBridge and forwarded
 *      to VS Code's ILogService).
 *
 * IMPORTANT: This file is compiled and bundled separately from the main VS Code
 * source tree.  It must not import any VS Code platform modules (`vs/...`) directly,
 * because it runs in a plain Node.js context, not the Electron renderer.
 *
 * Instead it uses the Cline core library re-exported from:
 *   out/cline-agent/clineCore.js   (built by `gulp cline-agent-bundle`)
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/node/agentProcess/agentRunner.ts
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Stdin / stdout message framing
// ---------------------------------------------------------------------------

import * as readline from 'readline';
import * as path from 'path';

type RpcRequest = { id: string; method: string; params: unknown };
type RpcResponse = { id: string; result?: unknown; error?: string };
type Notification = { event: string; data: unknown };

function send(msg: RpcResponse | Notification): void {
	process.stdout.write(JSON.stringify(msg) + '\n');
}

function notify(event: string, data: unknown): void {
	send({ event, data });
}

function respond(id: string, result: unknown): void {
	send({ id, result });
}

function respondError(id: string, error: unknown): void {
	const msg = error instanceof Error ? error.message : String(error);
	send({ id, error: msg });
}

// ---------------------------------------------------------------------------
// Load Cline core
// ---------------------------------------------------------------------------

/**
 * Path to the bundled Cline core module.
 * Resolved relative to this file's compiled output location.
 *
 * Build: `gulp cline-agent-bundle` produces:
 *   out/cline-agent/clineCore.js
 */
const CLINE_CORE_PATH = process.env['CLINE_CORE_PATH'] ||
	require('path').resolve(__dirname, 'clineCore.js');

let clineCore: {
	createAgent: (config: {
		apiProvider: string;
		apiKey: string;
		model: string;
		onChatMessage: (msg: unknown) => void;
		onToolCallStarted: (tc: unknown) => void;
		onToolCallCompleted: (tc: unknown) => void;
		onEditProposal: (ep: unknown) => void;
		onStateChange: (s: unknown) => void;
	}) => {
		sendUserMessage: (text: string, images?: string[]) => Promise<void>;
		cancelTask: () => Promise<void>;
		generateEdit: (params: unknown) => Promise<unknown>;
		getSettings: () => Promise<unknown>;
		updateSettings: (s: unknown) => Promise<void>;
		dispose: () => void;
	};
} | null = null;

try {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	clineCore = require(CLINE_CORE_PATH);
} catch (e) {
	process.stderr.write(`[AgentRunner] WARNING: Could not load clineCore at ${CLINE_CORE_PATH}: ${e}\n`);
	process.stderr.write('[AgentRunner] Running in stub mode — AI calls will be no-ops.\n');
}

// ---------------------------------------------------------------------------
// Agent instance
// ---------------------------------------------------------------------------

type Agent = ReturnType<NonNullable<typeof clineCore>['createAgent']>;
let _agent: Agent | null = null;

function getOrCreateAgent(): Agent {
	if (_agent) { return _agent; }

	const settings = _settings;

	if (!clineCore) {
		// Stub agent for environments where clineCore is not available
		return _stubAgent();
	}

	_agent = clineCore.createAgent({
		apiProvider: settings.apiProvider ?? 'anthropic',
		apiKey: settings.apiKey ?? '',
		model: settings.model ?? 'claude-opus-4-5',
		onChatMessage: (msg) => notify('chatMessage', msg),
		onToolCallStarted: (tc) => notify('toolCallStarted', tc),
		onToolCallCompleted: (tc) => notify('toolCallCompleted', tc),
		onEditProposal: (ep) => notify('editProposal', ep),
		onStateChange: (s) => notify('agentState', s),
	});

	return _agent;
}

function _stubAgent(): Agent {
	return {
		async sendUserMessage(text: string) {
			notify('chatMessage', {
				role: 'assistant',
				content: `[Stub mode] Received: "${text}". Load clineCore.js to enable real AI responses.`,
				ts: Date.now(),
			});
			notify('agentState', { state: 'done' });
		},
		async cancelTask() { notify('agentState', { state: 'idle' }); },
		async generateEdit() { return null; },
		async getSettings() { return _settings; },
		async updateSettings(s: unknown) { Object.assign(_settings, s as object); },
		dispose() {},
	} as unknown as Agent;
}

// ---------------------------------------------------------------------------
// Persisted settings (in-memory for now; Phase 6+ persists to disk)
// ---------------------------------------------------------------------------

let _settings: Record<string, unknown> = {
	apiProvider: process.env['CLINE_API_PROVIDER'] ?? 'anthropic',
	apiKey: process.env['CLINE_API_KEY'] ?? '',
	model: process.env['CLINE_MODEL'] ?? 'claude-opus-4-5',
	maxTokens: 8192,
	temperature: 0,
	enableIndexing: true,
	indexIgnorePatterns: [],
};

// ---------------------------------------------------------------------------
// Request dispatcher
// ---------------------------------------------------------------------------

const HANDLERS: Record<string, (id: string, params: unknown) => Promise<void>> = {

	async sendUserMessage(id, params: any) {
		const agent = getOrCreateAgent();
		notify('agentState', { state: 'running' });
		await agent.sendUserMessage(params.text, params.images);
		respond(id, null);
	},

	async cancelTask(id) {
		_agent?.cancelTask().catch(() => undefined);
		respond(id, null);
	},

	async generateEdit(id, params) {
		const agent = getOrCreateAgent();
		const result = await agent.generateEdit(params);
		respond(id, result);
	},

	async getSettings(id) {
		const agent = getOrCreateAgent();
		const s = await agent.getSettings();
		respond(id, s ?? _settings);
	},

	async updateSettings(id, params) {
		Object.assign(_settings, params as object);
		if (_agent) { await _agent.updateSettings(_settings); }
		respond(id, null);
	},
};

// ---------------------------------------------------------------------------
// Stdin reader
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', async (line: string) => {
	let req: RpcRequest;
	try {
		req = JSON.parse(line.trim());
	} catch {
		process.stderr.write(`[AgentRunner] Unparseable request: ${line}\n`);
		return;
	}

	const handler = HANDLERS[req.method];
	if (!handler) {
		respondError(req.id, `Unknown method: ${req.method}`);
		return;
	}

	try {
		await handler(req.id, req.params);
	} catch (e) {
		process.stderr.write(`[AgentRunner] Error in ${req.method}: ${e}\n`);
		respondError(req.id, e);
	}
});

rl.on('close', () => {
	_agent?.dispose();
	process.exit(0);
});

// Signal readiness
process.stderr.write('[AgentRunner] Ready.\n');
