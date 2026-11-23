// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The interactive half of annotating: resolves the "ask the user" sentinels a
 * webview or command sends (tag picker, bookmark label, note title), applies
 * the mutation, and — for a new note — opens it straight away so the user can
 * write it. Shared by the hex/table/tree webview messages and the
 * command-palette / context-menu commands, so all entry points behave alike.
 */

import * as vscode from "vscode";
import { NvmAnnotationCommand } from "../../../shared/protocol";
import { AnnotationService } from "./annotationService";

/** Sentinel tag id / bookmark label meaning "prompt the user". */
export const PROMPT = "__prompt__";

const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
const NOTE_PLACEHOLDER = /^_Write your notes here.*_$/m;

export class AnnotationInteractions {
	constructor(private readonly annotations: AnnotationService) {}

	/**
	 * Resolve prompts, apply, and open a newly created note. Returns false when
	 * the user cancelled a prompt (nothing was changed).
	 */
	public async run(docUri: vscode.Uri, command: NvmAnnotationCommand): Promise<boolean> {
		if (command.kind === "openNote") {
			await this.openNote(docUri, command.id);
			return true;
		}
		const resolved = await this.resolve(docUri, command);
		if (!resolved) {
			return false;
		}
		const before = new Set((await this.annotations.get(docUri)).notes.map(n => n.id));
		const set = await this.annotations.apply(docUri, resolved);
		if (resolved.kind === "addNote") {
			const created = set.notes.find(n => !before.has(n.id));
			if (created) {
				await this.openNote(docUri, created.id);
			}
		}
		return true;
	}

	/** Open a note for editing, with the template's placeholder line selected. */
	public async openNote(docUri: vscode.Uri, noteId: string): Promise<void> {
		const uri = this.annotations.noteUri(docUri, noteId);
		if (!uri) {
			void vscode.window.showInformationMessage(
				vscode.l10n.t(
					"Notes are stored in workspace state and cannot be opened as files. Set nvmstudio.nvm.annotationStorage to \"sidecar\" to edit notes as Markdown.",
				),
			);
			return;
		}
		const editor = await vscode.window.showTextDocument(uri, { preview: false });
		const text = editor.document.getText();
		const match = NOTE_PLACEHOLDER.exec(text);
		if (match) {
			const start = editor.document.positionAt(match.index);
			const end = editor.document.positionAt(match.index + match[0].length);
			editor.selection = new vscode.Selection(start, end);
			editor.revealRange(new vscode.Range(start, end));
		}
	}

	/** Pick an existing tag or create a new one; returns its id. */
	public async pickTag(docUri: vscode.Uri): Promise<string | undefined> {
		const set = await this.annotations.get(docUri);
		const CREATE = vscode.l10n.t("$(add) Create new tag…");
		const pick = await vscode.window.showQuickPick([CREATE, ...set.tags.map(t => t.label)], {
			title: vscode.l10n.t("Assign NVM tag"),
			placeHolder: vscode.l10n.t("Pick a tag or create one"),
		});
		if (!pick) {
			return undefined;
		}
		if (pick !== CREATE) {
			return set.tags.find(t => t.label === pick)?.id;
		}
		const label = await vscode.window.showInputBox({
			title: vscode.l10n.t("New tag"),
			prompt: vscode.l10n.t("Tag name"),
			validateInput: v => (v.trim() ? undefined : vscode.l10n.t("Enter a name")),
		});
		if (!label) {
			return undefined;
		}
		const updated = await this.annotations.apply(docUri, { kind: "createTag", label });
		return updated.tags.find(t => t.label === label)?.id;
	}

	private async resolve(
		docUri: vscode.Uri,
		command: NvmAnnotationCommand,
	): Promise<NvmAnnotationCommand | undefined> {
		switch (command.kind) {
			case "assignTag": {
				if (command.tagId !== PROMPT) {
					return command;
				}
				const tagId = await this.pickTag(docUri);
				return tagId ? { ...command, tagId } : undefined;
			}
			case "addBookmark": {
				if (!command.prompt) {
					return command;
				}
				const label = await vscode.window.showInputBox({
					title: vscode.l10n.t("New bookmark"),
					prompt: vscode.l10n.t("Bookmark label (optional)"),
					value: command.label ?? hex(command.offset),
				});
				return label === undefined ? undefined : { kind: "addBookmark", offset: command.offset, label: label || undefined };
			}
			case "renameBookmark": {
				if (command.label !== PROMPT) {
					return command;
				}
				const current = (await this.annotations.get(docUri)).bookmarks.find(b => b.id === command.id)?.label ?? "";
				const label = await vscode.window.showInputBox({
					title: vscode.l10n.t("Rename bookmark"),
					prompt: vscode.l10n.t("Bookmark label (leave empty to clear)"),
					value: current,
				});
				return label === undefined ? undefined : { kind: "renameBookmark", id: command.id, label: label || undefined };
			}
			case "addNote": {
				if (!command.prompt) {
					return command;
				}
				const title = await vscode.window.showInputBox({
					title: vscode.l10n.t("New note"),
					prompt: vscode.l10n.t("Note title — press Enter to create the note and start writing"),
					value: command.title ?? `Note @ ${hex(command.start)}`,
				});
				return title === undefined
					? undefined
					: { kind: "addNote", start: command.start, end: command.end, title: title || undefined, body: command.body };
			}
			default:
				return command;
		}
	}
}
