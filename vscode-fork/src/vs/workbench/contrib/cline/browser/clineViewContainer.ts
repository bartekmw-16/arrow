/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 1 Scaffold
 * View Container — registers the "Cline" entry in the activity bar.
 *
 * Drop this file into the VS Code OSS fork at the same relative path:
 *   src/vs/workbench/contrib/cline/browser/clineViewContainer.ts
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import {
	IViewContainersRegistry,
	Extensions as ViewContainerExtensions,
	ViewContainerLocation,
	IViewsRegistry,
	Extensions as ViewExtensions,
} from 'vs/workbench/common/views';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { Codicon } from 'vs/base/common/codicons';
import { ClineView } from './clineView';

// ---------------------------------------------------------------------------
// Activity bar icon for the Cline view container.
//
// We register a named theme icon so VS Code's theming system can apply
// colour/masking automatically.  In Phase 1 we reuse the built-in
// `Codicon.hubot` glyph as a stand-in; in a later phase replace `definition`
// with a URI pointing to the real Cline SVG asset in resources/.
// ---------------------------------------------------------------------------

export const CLINE_VIEW_ICON = registerIcon(
	'cline-view-icon',
	Codicon.hubot,   // stand-in icon — swap for a custom SVG URI in Phase 2+
	localize('clineViewIcon', 'Icon for the Cline agent view.'),
);

// ---------------------------------------------------------------------------
// Register the ViewContainer (activity bar entry)
// ---------------------------------------------------------------------------

export const CLINE_VIEW_CONTAINER_ID = 'workbench.view.cline';

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);

export const CLINE_VIEW_CONTAINER = viewContainerRegistry.registerViewContainer(
	{
		id: CLINE_VIEW_CONTAINER_ID,
		title: localize('cline', 'Cline'),
		icon: CLINE_VIEW_ICON,
		ctorDescriptor: new SyncDescriptor(
			// ViewPaneContainer is the default host for multiple ViewPanes.
			// We import lazily to avoid circular deps.
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			require('vs/workbench/browser/parts/views/viewPaneContainer').ViewPaneContainer,
			[CLINE_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }],
		),
		order: 5, // position in the activity bar (after Explorer=1, Search=2, SCM=3, Debug=4)
		hideIfEmpty: false,
	},
	ViewContainerLocation.Sidebar,
	{ isDefault: false },
);

// ---------------------------------------------------------------------------
// Register the individual ViewPane inside the container
// ---------------------------------------------------------------------------

const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

viewsRegistry.registerViews(
	[
		{
			id: ClineView.ID,
			name: localize('clineAgent', 'Cline Agent'),
			containerIcon: CLINE_VIEW_ICON,
			ctorDescriptor: new SyncDescriptor(ClineView),
			canToggleVisibility: false,
			canMoveView: false,
			// Show this view immediately when the container opens.
			order: 0,
		},
	],
	CLINE_VIEW_CONTAINER,
);
