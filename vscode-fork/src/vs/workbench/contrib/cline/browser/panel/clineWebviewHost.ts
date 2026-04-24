/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 4: React UI Integration
 * WebviewView host — embeds the Cline React UI inside the native ViewPane.
 *
 * Architecture:
 *   ClineView (ViewPane) → ClineWebviewHost (this file) → [webview iframe]
 *                                                              ↕  postMessage
 *                                                         Cline React app
 *
 * The React app is the compiled webview-ui/ bundle from the Cline extension.
 * At build time, `gulp cline-assets` copies it into
 * `out/vs/workbench/contrib/cline/browser/panel/dist/`.
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/browser/panel/clineWebviewHost.ts
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { IWebviewService, WebviewInitInfo, IWebview } from 'vs/workbench/contrib/webview/browser/webview';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IThemeService, IColorTheme } from 'vs/platform/theme/common/themeService';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { ILogService } from 'vs/platform/log/common/log';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IClineService, AgentState } from '../../common/clineService';
import { IClineIndexerService, IndexingStatus } from '../../common/clineIndexerService';
import {
	HostToWebviewMessage,
	WebviewToHostMessage,
	ThemeData,
	ISettingsData,
} from './webviewMessages';
import * as nls from 'vs/nls';

/** Cryptographically random nonce for the Content-Security-Policy. */
function generateNonce(): string {
	const buf = new Uint8Array(16);
	crypto.getRandomValues(buf);
	return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

export class ClineWebviewHost extends Disposable {

	// -------------------------------------------------------------------------
	// Events
	// -------------------------------------------------------------------------

	private readonly _onDidChangeWebview = this._register(new Emitter<IWebview | undefined>());
	readonly onDidChangeWebview: Event<IWebview | undefined> = this._onDidChangeWebview.event;

	// -------------------------------------------------------------------------
	// Internal
	// -------------------------------------------------------------------------

	private _webview: IWebview | undefined;
	private _container: HTMLElement | undefined;

	constructor(
		@IClineService private readonly clineService: IClineService,
		@IClineIndexerService private readonly indexerService: IClineIndexerService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IThemeService private readonly themeService: IThemeService,
		@ILogService private readonly logService: ILogService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
	) {
		super();

		// Bridge native service events → webview messages
		this._register(clineService.onDidChangeState(e => {
			this._postMessage({ type: 'agentStateChanged', state: e.current });
		}));

		this._register(indexerService.onDidChangeStatus(status => {
			const p = indexerService.progress;
			this._postMessage({
				type: 'indexingProgress',
				indexed: p.indexed,
				total: p.total,
				status,
			});
		}));

		this._register(themeService.onDidColorThemeChange(theme => {
			this._postMessage({ type: 'themeChanged', theme: this._buildThemeData(theme) });
		}));
	}

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	/**
	 * Create and mount the webview into `container`.
	 * Called by ClineView.renderBody().
	 */
	mountIn(container: HTMLElement): void {
		this._container = container;
		this._createWebview(container);
	}

	layout(width: number, height: number): void {
		if (this._webview) {
			this._webview.layoutWebviewOverElement(this._container!, { width, height });
		}
	}

	// -------------------------------------------------------------------------
	// Private — webview creation
	// -------------------------------------------------------------------------

	private _createWebview(container: HTMLElement): void {
		if (this._webview) {
			this._webview.dispose();
		}

		const nonce = generateNonce();
		const distUri = this._distUri();

		const initInfo: WebviewInitInfo = {
			title: nls.localize('clinePanel', 'Cline Agent'),
			options: {
				enableScripts: true,
				localResourceRoots: [distUri],
				retainContextWhenHidden: true,
			},
			contentOptions: {
				allowScripts: true,
			},
			extension: undefined,
		};

		const webview = this._webview = this._register(
			this.webviewService.createWebviewElement(initInfo),
		);

		webview.mountTo(container);

		// Set HTML content
		webview.html = this._buildHtml(nonce, distUri);

		// Receive messages from React
		this._register(webview.onMessage(e => this._handleWebviewMessage(e.message)));

		this._onDidChangeWebview.fire(webview);
	}

	private _buildHtml(nonce: string, distUri: URI): string {
		// Read the template from the bundled panel directory at runtime.
		// During development the file is available at the compiled output path.
		const scriptUri = distUri.with({ path: distUri.path + '/main.js' });
		const stylesUri = distUri.with({ path: distUri.path + '/main.css' });

		// We inline the template directly here for portability.
		// Use the distUri as the only allowed resource origin.
		const resourceOrigin = distUri.toString(true);
		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}';
             style-src 'unsafe-inline' ${resourceOrigin};
             img-src data: https:;
             font-src ${resourceOrigin} data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cline Agent</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body, #root { margin:0; padding:0; height:100%; overflow:hidden;
      background:var(--vscode-panel-background,#1e1e1e);
      color:var(--vscode-foreground,#d4d4d4);
      font-family:var(--vscode-font-family,sans-serif);
      font-size:var(--vscode-font-size,13px); }
  </style>
  <link rel="stylesheet" href="${stylesUri.toString(true)}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri.toString(true)}"></script>
</body>
</html>`;
	}

	private _distUri(): URI {
		// The compiled React bundle lives next to this file in the built output.
		return this.environmentService.appRoot
			? URI.file(this.environmentService.appRoot).with({
				path: this.environmentService.appRoot + '/out/vs/workbench/contrib/cline/browser/panel/dist',
			})
			: URI.file('/tmp/cline-dist');
	}

	// -------------------------------------------------------------------------
	// Private — message handling
	// -------------------------------------------------------------------------

	private async _handleWebviewMessage(raw: unknown): Promise<void> {
		const msg = raw as WebviewToHostMessage;

		switch (msg.type) {
			case 'ready':
				// Send initial state on first load
				this._postMessage({
					type: 'init',
					agentState: this.clineService.state,
					indexingStatus: this.indexerService.progress.status,
					theme: this._buildThemeData(this.themeService.getColorTheme()),
				});
				break;

			case 'startAgent':
				await this.clineService.startAgent();
				break;

			case 'stopAgent':
				await this.clineService.stopAgent();
				break;

			case 'sendUserMessage':
				await this.clineService.sendMessage(msg.text, msg.images);
				break;

			case 'cancelTask':
				await this.clineService.cancelCurrentTask();
				break;

			case 'searchCode': {
				try {
					const results = await this.indexerService.search(msg.query, msg.limit ?? 10);
					this._postMessage({
						type: 'searchResults',
						requestId: msg.requestId,
						results: results.map(r => ({
							fileUri: r.chunk.fileUri,
							startLine: r.chunk.startLine,
							endLine: r.chunk.endLine,
							symbolName: r.chunk.symbolName,
							kind: r.chunk.kind,
							snippet: r.snippet,
							score: r.score,
						})),
					});
				} catch (e) {
					this.logService.error(`[ClineWebview] searchCode failed: ${e}`);
				}
				break;
			}

			case 'openFile':
				await this.clineService.openFile(msg.fileUri, msg.line);
				break;

			case 'openSettings':
				// Trigger the Cline settings view
				await this.clineService.openSettings();
				break;

			default:
				this.logService.warn(`[ClineWebview] Unhandled webview message type: ${(msg as any).type}`);
		}
	}

	private _postMessage(msg: HostToWebviewMessage): void {
		this._webview?.postMessage(msg);
	}

	// -------------------------------------------------------------------------
	// Private — theme
	// -------------------------------------------------------------------------

	private _buildThemeData(theme: IColorTheme): ThemeData {
		let kind: ThemeData['kind'] = 'dark';
		if (theme.type === ColorScheme.LIGHT) { kind = 'light'; }
		else if (theme.type === ColorScheme.HIGH_CONTRAST_DARK || theme.type === ColorScheme.HIGH_CONTRAST_LIGHT) {
			kind = 'highContrast';
		}

		// Collect the CSS custom properties that the React app needs
		const cssVars: Record<string, string> = {};
		const propsToExport = [
			'--vscode-foreground', '--vscode-background',
			'--vscode-panel-background', '--vscode-panel-border',
			'--vscode-input-background', '--vscode-input-foreground', '--vscode-input-border',
			'--vscode-button-background', '--vscode-button-foreground',
			'--vscode-button-secondaryBackground', '--vscode-button-secondaryForeground',
			'--vscode-focusBorder', '--vscode-font-family', '--vscode-font-size',
			'--vscode-badge-background', '--vscode-badge-foreground',
			'--vscode-list-activeSelectionBackground', '--vscode-list-activeSelectionForeground',
			'--vscode-editor-background', '--vscode-editor-foreground',
		];
		const computedStyle = getComputedStyle(document.documentElement);
		for (const prop of propsToExport) {
			const val = computedStyle.getPropertyValue(prop).trim();
			if (val) { cssVars[prop] = val; }
		}

		return { kind, cssVars };
	}
}
