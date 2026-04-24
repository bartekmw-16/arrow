/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 1 Scaffold
 * Commands & Keybindings for the Cline agent.
 *
 * Drop this file into the VS Code OSS fork at the same relative path:
 *   src/vs/workbench/contrib/cline/browser/clineActions.ts
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IViewsService } from 'vs/workbench/services/views/common/viewsService';
import { IClineService } from '../common/clineService';
import { CLINE_VIEW_CONTAINER_ID } from './clineViewContainer';

// ---------------------------------------------------------------------------
// Category shared by all Cline commands (shown in the Command Palette).
// ---------------------------------------------------------------------------

const CLINE_CATEGORY = localize2('clineCategory', 'Cline');

// ---------------------------------------------------------------------------
// 1. Open Agent panel
// ---------------------------------------------------------------------------

class ClineOpenAgentAction extends Action2 {
	static readonly ID = 'cline.openAgent';

	constructor() {
		super({
			id: ClineOpenAgentAction.ID,
			title: localize2('openAgent', 'Open Agent'),
			category: CLINE_CATEGORY,
			f1: true, // show in Command Palette
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
				weight: KeybindingWeight.WorkbenchContrib,
			},
			menu: [
				{
					// Also available from the top-level "Cline" menu (if we add one later).
					id: MenuId.CommandPalette,
				},
			],
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		await viewsService.openViewContainer(CLINE_VIEW_CONTAINER_ID, true);
	}
}

// ---------------------------------------------------------------------------
// 2. Start Session
// ---------------------------------------------------------------------------

class ClineStartSessionAction extends Action2 {
	static readonly ID = 'cline.startSession';

	constructor() {
		super({
			id: ClineStartSessionAction.ID,
			title: localize2('startSession', 'Start Session'),
			category: CLINE_CATEGORY,
			f1: true,
			// No default keybinding for the start action; users can assign one.
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const clineService = accessor.get(IClineService);
		// Also open the panel so the user can see feedback.
		const viewsService = accessor.get(IViewsService);
		await viewsService.openViewContainer(CLINE_VIEW_CONTAINER_ID, true);
		await clineService.startAgent();
	}
}

// ---------------------------------------------------------------------------
// 3. Stop Session
// ---------------------------------------------------------------------------

class ClineStopSessionAction extends Action2 {
	static readonly ID = 'cline.stopSession';

	constructor() {
		super({
			id: ClineStopSessionAction.ID,
			title: localize2('stopSession', 'Stop Session'),
			category: CLINE_CATEGORY,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const clineService = accessor.get(IClineService);
		await clineService.stopAgent();
	}
}

// ---------------------------------------------------------------------------
// Register all actions
// ---------------------------------------------------------------------------

registerAction2(ClineOpenAgentAction);
registerAction2(ClineStartSessionAction);
registerAction2(ClineStopSessionAction);
