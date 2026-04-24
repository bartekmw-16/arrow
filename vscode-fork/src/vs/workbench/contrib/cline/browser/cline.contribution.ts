/*---------------------------------------------------------------------------------------------
 * Cline IDE — Full Workbench Contribution Entry Point.
 *
 * This file is the single import that VS Code's module bundler resolves to
 * self-register the entire Cline workbench contribution.  It is referenced
 * from `src/vs/workbench/workbench.common.main.ts` as:
 *
 *   import 'vs/workbench/contrib/cline/browser/cline.contribution';
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/browser/cline.contribution.ts
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from 'vs/platform/instantiation/common/extensions';

// ---------------------------------------------------------------------------
// 1. Service registrations
// ---------------------------------------------------------------------------

// Agent service
import { IClineService } from '../common/clineService';
import { ClineServiceImpl } from '../node/clineServiceImpl';
registerSingleton(IClineService, ClineServiceImpl, InstantiationType.Delayed);

// Indexer service
import { IClineIndexerService } from '../common/clineIndexerService';
import { ClineIndexerServiceImpl } from '../node/indexer/indexerServiceImpl';
registerSingleton(IClineIndexerService, ClineIndexerServiceImpl, InstantiationType.Delayed);

// ---------------------------------------------------------------------------
// 2. View container + ViewPane
// ---------------------------------------------------------------------------

import './clineViewContainer';

// ---------------------------------------------------------------------------
// 3. Commands, keybindings, actions
// ---------------------------------------------------------------------------

import './clineActions';

// ---------------------------------------------------------------------------
// 4. Editor contributions (CMD+K, inline diff)
// ---------------------------------------------------------------------------

import './editor/clineEditorContribution';

// ---------------------------------------------------------------------------
// 5. Workbench contribution lifecycle class
// ---------------------------------------------------------------------------

import { Registry } from 'vs/platform/registry/common/platform';
import {
	IWorkbenchContributionsRegistry,
	Extensions as WorkbenchExtensions,
	IWorkbenchContribution,
} from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';

class ClineWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.cline';

	constructor(
		@ILogService logService: ILogService,
	) {
		super();
		logService.info('[ClineContrib] Cline IDE contribution registered successfully.');
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(ClineWorkbenchContribution, LifecyclePhase.Starting);
