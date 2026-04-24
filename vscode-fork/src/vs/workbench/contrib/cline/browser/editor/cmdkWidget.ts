/*---------------------------------------------------------------------------------------------
 * Cline IDE — Phase 3: Editor Contributions
 * CMD+K inline prompt overlay widget.
 *
 * Renders a floating input bar directly in the editor (à la GitHub Copilot's
 * inline chat) when the user presses Ctrl+K / Cmd+K.  The user types an
 * instruction; on submit the text + surrounding code context is sent to
 * IClineService for AI-powered code generation, which is then shown as an
 * inline diff.
 *
 * Drop this file into the VS Code OSS fork at:
 *   src/vs/workbench/contrib/cline/browser/editor/cmdkWidget.ts
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { $, append, addDisposableListener, EventType, isAncestor } from 'vs/base/browser/dom';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition } from 'vs/editor/browser/editorBrowser';
import { IPosition } from 'vs/editor/common/core/position';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { IClineService } from '../../common/clineService';

// ---------------------------------------------------------------------------
// Event payload sent when the user submits the CMD+K prompt
// ---------------------------------------------------------------------------

export interface ICmdkSubmitEvent {
	/** The instruction text the user typed. */
	readonly instruction: string;
	/** The surrounding code context (N lines above+below the cursor). */
	readonly context: string;
	/** The file URI. */
	readonly fileUri: string;
	/** The cursor position at the time of the submit. */
	readonly position: IPosition;
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

const CONTEXT_LINES_ABOVE = 30;
const CONTEXT_LINES_BELOW = 10;

export class CmdkWidget extends Disposable implements IOverlayWidget {

	static readonly ID = 'cline.cmdkWidget';

	// -------------------------------------------------------------------------
	// Events
	// -------------------------------------------------------------------------

	private readonly _onDidSubmit = this._register(new Emitter<ICmdkSubmitEvent>());
	readonly onDidSubmit: Event<ICmdkSubmitEvent> = this._onDidSubmit.event;

	private readonly _onDidCancel = this._register(new Emitter<void>());
	readonly onDidCancel: Event<void> = this._onDidCancel.event;

	// -------------------------------------------------------------------------
	// DOM
	// -------------------------------------------------------------------------

	private readonly _domNode: HTMLElement;
	private readonly _inputEl: HTMLInputElement;
	private readonly _statusEl: HTMLElement;
	private _isVisible = false;

	/** Position in the editor where the widget is anchored. */
	private _anchorLine = 0;

	constructor(private readonly _editor: ICodeEditor) {
		super();

		// Build DOM
		this._domNode = $('div.cline-cmdk-widget');
		Object.assign(this._domNode.style, {
			display: 'none',
			position: 'absolute',
			zIndex: '1000',
			background: 'var(--vscode-input-background)',
			border: '1px solid var(--vscode-focusBorder)',
			borderRadius: '4px',
			boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
			padding: '8px',
			minWidth: '360px',
			maxWidth: '560px',
		});

		// Header
		const header = append(this._domNode, $('div.cmdk-header'));
		Object.assign(header.style, {
			display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px',
		});
		const icon = append(header, $('span'));
		icon.textContent = '✦';
		icon.style.cssText = 'color:var(--vscode-focusBorder);font-size:14px;';
		const label = append(header, $('span'));
		label.textContent = 'Cline: Edit with AI';
		label.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-foreground);flex:1;';
		const hint = append(header, $('span'));
		hint.textContent = 'Esc to cancel';
		hint.style.cssText = 'font-size:10px;opacity:0.5;color:var(--vscode-foreground);';

		// Input row
		const row = append(this._domNode, $('div.cmdk-row'));
		row.style.cssText = 'display:flex;gap:6px;';

		this._inputEl = append(row, $('input')) as HTMLInputElement;
		Object.assign(this._inputEl, { type: 'text', placeholder: 'Describe the edit you want…' });
		Object.assign(this._inputEl.style, {
			flex: '1',
			background: 'var(--vscode-input-background)',
			color: 'var(--vscode-input-foreground)',
			border: '1px solid var(--vscode-input-border)',
			borderRadius: '2px',
			padding: '4px 8px',
			fontSize: '13px',
			outline: 'none',
		});

		const submitBtn = append(row, $('button.cmdk-submit'));
		submitBtn.textContent = 'Generate';
		Object.assign(submitBtn.style, {
			background: 'var(--vscode-button-background)',
			color: 'var(--vscode-button-foreground)',
			border: 'none',
			borderRadius: '2px',
			padding: '4px 10px',
			fontSize: '12px',
			cursor: 'pointer',
		});

		// Status line
		this._statusEl = append(this._domNode, $('div.cmdk-status'));
		this._statusEl.style.cssText = 'font-size:10px;opacity:0.6;margin-top:4px;min-height:14px;';

		// Events
		this._register(addDisposableListener(this._inputEl, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Escape') { this.hide(); this._onDidCancel.fire(); }
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._submit(); }
		}));
		this._register(addDisposableListener(submitBtn, EventType.CLICK, () => this._submit()));

		// Hide when the editor loses focus and the click isn't inside us
		this._register(addDisposableListener(window, EventType.MOUSE_DOWN, (e: MouseEvent) => {
			if (this._isVisible && !isAncestor(e.target as HTMLElement, this._domNode)) {
				this.hide();
				this._onDidCancel.fire();
			}
		}));

		// Register as overlay widget
		this._editor.addOverlayWidget(this);
	}

	// -------------------------------------------------------------------------
	// IOverlayWidget
	// -------------------------------------------------------------------------

	getId(): string { return CmdkWidget.ID; }

	getDomNode(): HTMLElement { return this._domNode; }

	getPosition(): IOverlayWidgetPosition | null {
		// Position is managed manually below — return null to opt out of automatic placement.
		return null;
	}

	// -------------------------------------------------------------------------
	// Show / hide
	// -------------------------------------------------------------------------

	show(): void {
		const pos = this._editor.getPosition();
		if (!pos) { return; }
		this._anchorLine = pos.lineNumber;

		const lineHeight = this._editor.getOption(EditorOption.lineHeight);
		const top = this._editor.getTopForLineNumber(pos.lineNumber) + lineHeight -
			this._editor.getScrollTop() + 4;
		const left = this._editor.getLayoutInfo().contentLeft + 24;

		Object.assign(this._domNode.style, {
			display: 'block',
			top: `${top}px`,
			left: `${left}px`,
		});

		this._inputEl.value = '';
		this._statusEl.textContent = '';
		this._isVisible = true;
		setTimeout(() => this._inputEl.focus(), 0);
	}

	hide(): void {
		this._domNode.style.display = 'none';
		this._isVisible = false;
	}

	get isVisible(): boolean { return this._isVisible; }

	/** Update the status line shown below the input (e.g. "Generating…"). */
	setStatus(text: string): void {
		this._statusEl.textContent = text;
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	private _submit(): void {
		const instruction = this._inputEl.value.trim();
		if (!instruction) { return; }

		const model = this._editor.getModel();
		const position = this._editor.getPosition();
		if (!model || !position) { return; }

		// Gather surrounding context
		const startLine = Math.max(1, position.lineNumber - CONTEXT_LINES_ABOVE);
		const endLine = Math.min(model.getLineCount(), position.lineNumber + CONTEXT_LINES_BELOW);
		const contextLines: string[] = [];
		for (let l = startLine; l <= endLine; l++) {
			contextLines.push(model.getLineContent(l));
		}
		const context = contextLines.join('\n');

		this._onDidSubmit.fire({
			instruction,
			context,
			fileUri: model.uri.toString(),
			position,
		});

		this.setStatus('Generating…');
		this._inputEl.disabled = true;
	}

	/** Re-enable the input after generation is complete. */
	resetAfterGeneration(error?: string): void {
		this._inputEl.disabled = false;
		if (error) {
			this.setStatus(`Error: ${error}`);
		} else {
			this.hide();
		}
	}

	override dispose(): void {
		this._editor.removeOverlayWidget(this);
		super.dispose();
	}
}
