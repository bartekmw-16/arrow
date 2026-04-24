/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 3: Editor Contributions
 * Inline diff decorator.
 *
 * Given a proposed replacement for a range of lines, renders:
 *   - Deleted lines in red with a "−" margin glyph
 *   - Added lines in green with a "+" margin glyph
 *   - Accept / Reject buttons in the margin of the first changed line
 *
 * Uses standard VS Code editor decoration and zone APIs only — no private
 * internals — so it compiles cleanly against the public editor surface.
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/browser/editor/inlineDiffDecorator.ts
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ICodeEditor, IViewZone } from 'vs/editor/browser/editorBrowser';
import { Range } from 'vs/editor/common/core/range';
import {
	IModelDeltaDecoration,
	IModelDecorationOptions,
	TrackedRangeStickiness,
	OverviewRulerLane,
} from 'vs/editor/common/model';
import { $, append, addDisposableListener, EventType } from 'vs/base/browser/dom';
import { themeColorFromId } from 'vs/platform/theme/common/themeService';
import {
	editorErrorBackground,
	editorLineHighlightBorder,
} from 'vs/platform/theme/common/colorRegistry';

// ---------------------------------------------------------------------------
// Diff proposal
// ---------------------------------------------------------------------------

export interface IDiffProposal {
	/** 1-based start line of the region being replaced. */
	readonly startLine: number;
	/** 1-based end line of the region being replaced. */
	readonly endLine: number;
	/** The proposed replacement text (may have different line count). */
	readonly newText: string;
}

// ---------------------------------------------------------------------------
// Decoration key constants
// ---------------------------------------------------------------------------

const DELETED_LINE_DECORATION: IModelDecorationOptions = {
	isWholeLine: true,
	className: 'cline-diff-deleted-line',
	glyphMarginClassName: 'cline-diff-glyph-deleted',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	overviewRuler: {
		color: { id: 'diffEditor.removedLineBackground' },
		position: OverviewRulerLane.Left,
	},
};

const ADDED_LINE_DECORATION: IModelDecorationOptions = {
	isWholeLine: true,
	className: 'cline-diff-added-line',
	glyphMarginClassName: 'cline-diff-glyph-added',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	overviewRuler: {
		color: { id: 'diffEditor.insertedLineBackground' },
		position: OverviewRulerLane.Left,
	},
};

// ---------------------------------------------------------------------------
// InlineDiffDecorator
// ---------------------------------------------------------------------------

export class InlineDiffDecorator extends Disposable {

	private readonly _onDidAccept = this._register(new Emitter<void>());
	readonly onDidAccept: Event<void> = this._onDidAccept.event;

	private readonly _onDidReject = this._register(new Emitter<void>());
	readonly onDidReject: Event<void> = this._onDidReject.event;

	private _decorationIds: string[] = [];
	private _zoneIds: string[] = [];
	private _proposal: IDiffProposal | null = null;
	private _isActive = false;

	constructor(private readonly _editor: ICodeEditor) {
		super();
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	/**
	 * Show a proposed diff in the editor.
	 * The original lines are highlighted red; the new lines appear below in a
	 * view zone highlighted green.
	 */
	showProposal(proposal: IDiffProposal): void {
		this.clear();
		this._proposal = proposal;
		this._isActive = true;

		const model = this._editor.getModel();
		if (!model) { return; }

		const newLines = proposal.newText.split('\n');
		const deltaDecorations: IModelDeltaDecoration[] = [];

		// Mark deleted lines (original region) in red
		for (let l = proposal.startLine; l <= proposal.endLine; l++) {
			deltaDecorations.push({
				range: new Range(l, 1, l, model.getLineMaxColumn(l)),
				options: DELETED_LINE_DECORATION,
			});
		}

		this._decorationIds = model.deltaDecorations([], deltaDecorations);

		// Add a view zone below the last deleted line showing the new content.
		// Height: new lines + 1 for the button row header.
		const BUTTON_ROW_HEIGHT_LINES = 1;
		this._editor.changeViewZones(accessor => {
			const domNode = this._buildZoneDom(newLines, proposal);
			const zone: IViewZone = {
				afterLineNumber: proposal.endLine,
				heightInLines: newLines.length + BUTTON_ROW_HEIGHT_LINES,
				domNode,
			};
			this._zoneIds = [accessor.addZone(zone)];
		});
	}

	/** Remove all decorations and view zones. */
	clear(): void {
		const model = this._editor.getModel();
		if (model && this._decorationIds.length > 0) {
			model.deltaDecorations(this._decorationIds, []);
			this._decorationIds = [];
		}
		if (this._zoneIds.length > 0) {
			this._editor.changeViewZones(accessor => {
				for (const id of this._zoneIds) {
					accessor.removeZone(id);
				}
			});
			this._zoneIds = [];
		}
		this._proposal = null;
		this._isActive = false;
	}

	get isActive(): boolean { return this._isActive; }
	get proposal(): IDiffProposal | null { return this._proposal; }

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	private _buildZoneDom(newLines: string[], proposal: IDiffProposal): HTMLElement {
		const root = $('div.cline-diff-zone');
		Object.assign(root.style, {
			fontFamily: 'var(--vscode-editor-font-family)',
			fontSize: 'var(--vscode-editor-font-size)',
			lineHeight: 'var(--vscode-editor-line-height)',
			background: 'var(--vscode-diffEditor-insertedLineBackground, rgba(0,255,0,0.08))',
			borderTop: '1px solid var(--vscode-diffEditor-insertedTextBorder, rgba(0,255,0,0.4))',
			borderBottom: '1px solid var(--vscode-diffEditor-insertedTextBorder, rgba(0,255,0,0.4))',
		});

		// Button row (Accept / Reject)
		const btnRow = append(root, $('div.cline-diff-buttons'));
		Object.assign(btnRow.style, {
			display: 'flex', gap: '8px', padding: '4px 8px',
			borderBottom: '1px solid rgba(0,0,0,0.1)',
		});

		const acceptBtn = append(btnRow, $('button'));
		acceptBtn.textContent = '✓ Accept';
		this._styleBtn(acceptBtn, 'var(--vscode-testing-iconPassed, #73c991)', '#fff');
		this._register(addDisposableListener(acceptBtn, EventType.CLICK, () => {
			this._applyAccept();
			this._onDidAccept.fire();
		}));

		const rejectBtn = append(btnRow, $('button'));
		rejectBtn.textContent = '✕ Reject';
		this._styleBtn(rejectBtn, 'var(--vscode-testing-iconFailed, #f48771)', '#fff');
		this._register(addDisposableListener(rejectBtn, EventType.CLICK, () => {
			this.clear();
			this._onDidReject.fire();
		}));

		// New lines preview
		const pre = append(root, $('div.cline-diff-added-lines'));
		pre.style.cssText = 'padding:2px 8px;white-space:pre;overflow:hidden;';
		for (const line of newLines) {
			const span = append(pre, $('span.cline-diff-added-line'));
			span.style.cssText = 'display:block;';
			// Prefix with "+" and HTML-escape content
			span.textContent = '+ ' + line;
		}

		return root;
	}

	private _styleBtn(btn: HTMLElement, bg: string, fg: string): void {
		Object.assign(btn.style, {
			background: bg, color: fg, border: 'none',
			borderRadius: '2px', padding: '2px 10px',
			fontSize: '11px', cursor: 'pointer', fontWeight: '600',
		});
	}

	private _applyAccept(): void {
		const model = this._editor.getModel();
		if (!model || !this._proposal) { return; }

		const { startLine, endLine, newText } = this._proposal;
		const startCol = 1;
		const endCol = model.getLineMaxColumn(endLine);

		// Apply the replacement via an edit operation so it participates in undo
		model.pushEditOperations([], [{
			range: new Range(startLine, startCol, endLine, endCol),
			text: newText,
		}], () => null);

		this.clear();
	}
}

// ---------------------------------------------------------------------------
// Inject global CSS for decorations
// (In a real build this would live in a .css file; inlined here for portability)
// ---------------------------------------------------------------------------

const STYLE_ID = 'cline-diff-styles';
if (!document.getElementById(STYLE_ID)) {
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
    .cline-diff-deleted-line { background: var(--vscode-diffEditor-removedLineBackground, rgba(255,0,0,0.1)) !important; }
    .cline-diff-glyph-deleted::before { content: '−'; color: var(--vscode-errorForeground, #f48771); font-weight: bold; }
    .cline-diff-added-line   { background: var(--vscode-diffEditor-insertedLineBackground, rgba(0,255,0,0.1)) !important; }
    .cline-diff-glyph-added::before  { content: '+'; color: var(--vscode-testing-iconPassed, #73c991); font-weight: bold; }
  `;
	document.head.appendChild(style);
}
