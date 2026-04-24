/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 1 Scaffold
 * Sidebar ViewPane — the "Cline Agent" panel that appears in the activity bar.
 *
 * Drop this file into the VS Code OSS fork at the same relative path:
 *   src/vs/workbench/contrib/cline/browser/clineView.ts
 *
 * Phase 1: renders a simple placeholder DOM node proving registration works.
 * Phase 4: the body of `renderBody()` is replaced with the full React-based
 *           agent workspace UI.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IClineService, AgentState } from '../common/clineService';
import { append, $, addDisposableListener, EventType } from 'vs/base/browser/dom';

export class ClineView extends ViewPane {

	static readonly ID = 'workbench.view.cline.agent';
	static readonly TITLE = 'Cline Agent';

	private _statusEl: HTMLElement | undefined;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IClineService private readonly clineService: IClineService,
	) {
		super(options, keybindingService, contextMenuService, configurationService,
			contextKeyService, viewDescriptorService, instantiationService,
			openerService, themeService, telemetryService);

		this._register(this.clineService.onDidChangeState(e => {
			this._refreshStatus(e.current);
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		// -----------------------------------------------------------------------
		// Phase 1 placeholder UI
		// Phase 4 will replace this entire block with the React agent workspace.
		// -----------------------------------------------------------------------

		const root = append(container, $('div.cline-agent-root'));
		root.style.cssText = 'padding:24px;font-family:var(--vscode-font-family);';

		const header = append(root, $('h2'));
		header.textContent = 'Cline Agent — Phase 1 Scaffold';
		header.style.cssText = 'margin:0 0 8px;font-size:14px;font-weight:600;';

		const desc = append(root, $('p'));
		desc.textContent =
			'The Cline agent service is registered and the DI container is wired up. ' +
			'Phase 4 will replace this placeholder with the full agent workspace UI.';
		desc.style.cssText = 'margin:0 0 16px;font-size:12px;opacity:0.7;';

		this._statusEl = append(root, $('div.cline-agent-status'));
		this._statusEl.style.cssText =
			'padding:8px 12px;border-radius:4px;font-size:12px;' +
			'background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);';
		this._refreshStatus(this.clineService.state);

		// Simple Start / Stop buttons for manual testing during Phase 1.
		const buttonRow = append(root, $('div'));
		buttonRow.style.cssText = 'margin-top:16px;display:flex;gap:8px;';

		const startBtn = append(buttonRow, $('button'));
		startBtn.textContent = 'Start Agent';
		startBtn.style.cssText = this._btnStyle('var(--vscode-button-background)', 'var(--vscode-button-foreground)');
		this._register(addDisposableListener(startBtn, EventType.CLICK, () => this.clineService.startAgent()));

		const stopBtn = append(buttonRow, $('button'));
		stopBtn.textContent = 'Stop Agent';
		stopBtn.style.cssText = this._btnStyle('var(--vscode-button-secondaryBackground)', 'var(--vscode-button-secondaryForeground)');
		this._register(addDisposableListener(stopBtn, EventType.CLICK, () => this.clineService.stopAgent()));
	}

	private _refreshStatus(state: AgentState): void {
		if (!this._statusEl) { return; }
		this._statusEl.textContent = `Agent state: ${state}`;
	}

	private _btnStyle(bg: string, fg: string): string {
		return `padding:4px 12px;border:none;border-radius:2px;cursor:pointer;` +
			`background:${bg};color:${fg};font-size:12px;`;
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
