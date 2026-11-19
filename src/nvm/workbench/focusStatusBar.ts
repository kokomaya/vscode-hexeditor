// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Status bar entry showing the NVM block / field under the user's focus in the
 * active dump. Clicking it pre-fills an "@nvm what is this?" question.
 */

import * as vscode from "vscode";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { Disposable } from "../../dispose";

export class NvmFocusStatusBar extends Disposable {
	private readonly item = this._register(vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95));

	constructor(private readonly registry: HexEditorRegistry) {
		super();
		this.item.command = "nvmStudio.nvm.askAboutSelection";
		this._register(registry.onDidChangeNvmFocus(doc => doc === registry.activeDocument && this.update()));
		this._register(registry.onDidChangeActiveDocument(() => this.update()));
		this.update();
	}

	private update(): void {
		const doc = this.registry.activeDocument;
		const focus = doc && this.registry.getNvmFocus(doc);
		if (!focus?.blockName) {
			this.item.hide();
			return;
		}
		const field = focus.fieldName ? ` › ${focus.fieldName}` : "";
		this.item.text = `$(symbol-field) ${focus.blockName}${field}`;
		this.item.tooltip = vscode.l10n.t("NVM focus at 0x{0} — click to ask @nvm about it", focus.offset.toString(16).toUpperCase());
		this.item.show();
	}
}
