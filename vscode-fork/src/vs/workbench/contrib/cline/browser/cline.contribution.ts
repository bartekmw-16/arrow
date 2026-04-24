/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 1 Scaffold
 * Workbench contribution entry point.
 *
 * Drop this file into the VS Code OSS fork at the same relative path:
 *   src/vs/workbench/contrib/cline/browser/cline.contribution.ts
 *
 * This file is the single import that VS Code's module bundler resolves to
 * self-register the entire Cline workbench contribution.  It is referenced
 * from `src/vs/workbench/workbench.common.main.ts` as:
 *
 *   import 'vs/workbench/contrib/cline/browser/cline.contribution';
 *
 * Import order matters — the service interface must be registered before the
 * view container (which injects it), and actions/views must come after.
 *--------------------------------------------------------------------------------------------*/

// 1. Register the DI service identifier and the browser-compatible singleton.
//    The Node-layer implementation (clineServiceImpl.ts) is registered in
//    workbench.desktop.main.ts so that web/remote builds can provide an
//    alternative stub.
import { registerSingleton, InstantiationType } from 'vs/platform/instantiation/common/extensions';
import { IClineService } from '../common/clineService';
import { ClineServiceImpl } from '../node/clineServiceImpl';

// Register the Phase 1 stub as the singleton for IClineService.
// InstantiationType.Delayed means the service is only instantiated when first
// requested, keeping startup time minimal.
registerSingleton(IClineService, ClineServiceImpl, InstantiationType.Delayed);

// 2. Register the activity bar view container and the agent ViewPane.
import './clineViewContainer';

// 3. Register commands and keybindings.
import './clineActions';

// 4. Register the workbench contribution class so VS Code calls our
//    IWorkbenchContribution.dispose() on shutdown and can include us in
//    startup timing measurements.
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
		logService.info('[ClineContrib] Phase 1 scaffold registered successfully.');
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(ClineWorkbenchContribution, LifecyclePhase.Starting);
