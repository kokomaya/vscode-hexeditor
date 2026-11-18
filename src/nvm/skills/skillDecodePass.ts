// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Host glue between layout resolution and block skills (skills.md §7):
 * {@link applySkillsToBlocks} runs AFTER the layout resolved — fallback decode
 * of blocks the config left undecoded, plus field docs — so every consumer sees
 * the same enriched blocks. Skills never feed the engine: the layout config is
 * the single authority on struct layout.
 *
 * Both are total: any failure is logged and the blocks stay as resolved.
 */

import * as vscode from "vscode";
import { NvmBlockInfo } from "../../../shared/protocol";
import { applyBlockSkills } from "../../../shared/nvm/skills/apply";
import { SkillDiagnostic } from "../../../shared/nvm/skills/types";
import { HexDocument } from "../../hexDocument";
import { getNvmLog } from "../nvmLog";
import { SkillRegistry } from "./skillRegistry";

/** Above this size the decode pass reads per block instead of the whole image. */
const WHOLE_READ_LIMIT = 64 * 1024 * 1024;

function skillsMode(): "auto" | "manual" | "off" {
	const m = vscode.workspace.getConfiguration("nvmstudio").get<string>("nvm.skills.mode", "auto");
	return m === "manual" || m === "off" ? m : "auto";
}

function applyStructsEnabled(): boolean {
	return vscode.workspace.getConfiguration("nvmstudio").get<boolean>("nvm.skills.applyStructs", true);
}

/** Decode + document bound blocks in place. Returns quickly when no skill applies. */
export async function applySkillsToBlocks(
	skills: SkillRegistry,
	document: HexDocument,
	blocks: NvmBlockInfo[],
	layoutIds: string[],
): Promise<void> {
	skills.setLayoutContext(document.uri, layoutIds);
	if (!blocks.length || skillsMode() === "off") {
		return;
	}
	const log = getNvmLog();
	try {
		const index = await skills.getIndex(document.uri.fsPath);
		const blockSkills = index.skills.filter(s => s.kind === "block" && s.enabled);
		if (!blockSkills.length) {
			return;
		}
		const bindings = skills.bindings(blocks, blockSkills, { ids: layoutIds });
		const boundCount = [...bindings.values()].reduce((n, v) => n + v.length, 0);
		if (boundCount === 0) {
			return;
		}
		const diagnostics: SkillDiagnostic[] = [];
		const catalogs = await skills.catalogsFor(blockSkills, diagnostics);
		const read = catalogs.size && applyStructsEnabled() ? await makeReader(document) : undefined;
		const r = applyBlockSkills(blocks, blockSkills, bindings, {
			applyStructs: applyStructsEnabled(),
			catalogs,
			read,
		});
		const used = [...bindings].filter(([, v]) => v.length).map(([k, v]) => `${k}(${v.length})`);
		log.info(`  Skills: bound ${used.join(", ")} — decoded ${r.decoded} block(s), documented ${r.documented} field(s)`);
		for (const d of [...diagnostics, ...r.diagnostics]) {
			const line = `  Skills: ${d.skill ? `[${d.skill}] ` : ""}${d.message}`;
			if (d.severity === "info") {
				log.info(line);
			} else {
				log.warn(line);
			}
		}
	} catch (e) {
		log.warn(`  Skills: decode pass failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** A synchronous byte reader over the document (pre-read once). */
async function makeReader(document: HexDocument): Promise<((offset: number, length: number) => Uint8Array) | undefined> {
	const size = await document.size();
	if (size === undefined || size > WHOLE_READ_LIMIT) {
		return undefined;
	}
	const buf = await document.readBufferWithEdits(0, size);
	return (offset, length) => buf.subarray(Math.max(0, offset), Math.max(0, offset) + Math.max(0, length));
}
