/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 3: Editor Contributions
 * IEditorContribution that wires CMD+K prompt + inline diff into every editor.
 *
 * Registered via `EditorExtensionsRegistry.registerEditorContribution()` in
 * cline.contribution.ts.  One instance is created per editor widget.
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/browser/editor/clineEditorContribution.ts
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction2, EditorContributionInstantiation, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { registerAction2, Action2, MenuId } from 'vs/platform/actions/common/actions';
import { localize2 } from 'vs/nls';
import { IClineService } from '../../common/clineService';
import { CmdkWidget, ICmdkSubmitEvent } from './cmdkWidget';
import { InlineDiffDecorator } from './inlineDiffDecorator';

export const CLINE_EDITOR_CONTRIB_ID = 'editor.contrib.cline';

export class ClineEditorContribution extends Disposable implements IEditorContribution {

	static readonly ID = CLINE_EDITOR_CONTRIB_ID;

	private readonly _cmdkWidget: CmdkWidget;
	private readonly _diffDecorator: InlineDiffDecorator;

	constructor(
		private readonly _editor: ICodeEditor,
		@IClineService private readonly _clineService: IClineService,
	) {
		super();

		this._cmdkWidget = this._register(new CmdkWidget(_editor));
		this._diffDecorator = this._register(new InlineDiffDecorator(_editor));

		// Handle prompt submission
		this._register(this._cmdkWidget.onDidSubmit(async (event: ICmdkSubmitEvent) => {
			await this._handleSubmit(event);
		}));

		// Handle user cancelling the CMD+K prompt
		this._register(this._cmdkWidget.onDidCancel(() => {
			this._diffDecorator.clear();
		}));

		// Reject clears the diff
		this._register(this._diffDecorator.onDidReject(() => {
			// Diff was already cleared inside InlineDiffDecorator; nothing extra needed.
		}));
	}

	// -------------------------------------------------------------------------
	// Public (called from keybinding action)
	// -------------------------------------------------------------------------

	toggleCmdk(): void {
		if (this._cmdkWidget.isVisible) {
			this._cmdkWidget.hide();
		} else {
			this._diffDecorator.clear();
			this._cmdkWidget.show();
		}
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	private async _handleSubmit(event: ICmdkSubmitEvent): Promise<void> {
		try {
			// Delegate to IClineService — it will call the AI backend.
			// The service returns the proposed replacement text and the affected line range.
			const proposal = await this._clineService.generateEdit({
				instruction: event.instruction,
				context: event.context,
				fileUri: event.fileUri,
				cursorLine: event.position.lineNumber,
			});

			this._cmdkWidget.resetAfterGeneration();

			if (proposal) {
				this._diffDecorator.showProposal(proposal);
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			this._cmdkWidget.resetAfterGeneration(msg);
		}
	}
}

// ---------------------------------------------------------------------------
// Register the contribution
// ---------------------------------------------------------------------------

registerEditorContribution(
	ClineEditorContribution.ID,
	ClineEditorContribution,
	EditorContributionInstantiation.Lazy,
);

// ---------------------------------------------------------------------------
// CMD+K action
// ---------------------------------------------------------------------------

registerAction2(class ClineToggleCmdkAction extends Action2 {
	constructor() {
		super({
			id: 'cline.editor.toggleCmdk',
			title: localize2('toggleCmdk', 'Edit with AI (CMD+K)'),
			category: { value: 'Cline', original: 'Cline' },
			f1: true,
			keybinding: {
				// Ctrl+K / Cmd+K  — the standard inline-AI keybinding
				primary: KeyMod.CtrlCmd | KeyCode.KeyK,
				// Only fire when the editor has focus AND the CMD+K widget is not already open,
				// to avoid stealing Ctrl+K from other editor keybindings
				when: ContextKeyExpr.and(
					ContextKeyExpr.has('editorFocus'),
					ContextKeyExpr.not('cline.cmdkOpen'),
				),
				weight: KeybindingWeight.EditorContrib,
			},
		});
	}

	override run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const contribution = editor.getContribution<ClineEditorContribution>(ClineEditorContribution.ID);
		contribution?.toggleCmdk();
	}
});
