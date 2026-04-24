/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 4: React UI Integration
 * Sidebar ViewPane — the "Cline Agent" panel that appears in the activity bar.
 *
 * Phase 4: delegates all rendering to ClineWebviewHost, which embeds the
 * compiled Cline React UI bundle inside a VS Code webview.
 *
 * Drop this file into the VS Code OSS fork at the same relative path:
 *   src/vs/workbench/contrib/cline/browser/clineView.ts
 *--------------------------------------------------------------------------------------------*/

import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ClineWebviewHost } from './panel/clineWebviewHost';

export class ClineView extends ViewPane {

	static readonly ID = 'workbench.view.cline.agent';
	static readonly TITLE = 'Cline Agent';

	private _webviewHost: ClineWebviewHost | undefined;

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
	) {
		super(options, keybindingService, contextMenuService, configurationService,
			contextKeyService, viewDescriptorService, instantiationService,
			openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		// Create the webview host via instantiationService so all @-injected
		// dependencies (IClineService, IClineIndexerService, etc.) are resolved.
		this._webviewHost = this._register(
			this.instantiationService.createInstance(ClineWebviewHost),
		);
		this._webviewHost.mountIn(container);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._webviewHost?.layout(width, height);
	}
}
