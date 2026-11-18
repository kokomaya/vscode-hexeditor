// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The Skill Index (skills.md §5.2): discovers skills across all roots, merges
 * them by name (higher-priority root wins), lazily loads bodies / catalogs,
 * memoizes block bindings, watches the roots and records diagnostics.
 *
 * Binding policy (the open question in §5.2): bindings are computed ON DEMAND
 * and memoized per `(blocks array, index generation)` — a dump is only matched
 * when a consumer (AI tool, tree, decode pass) needs it, and repeated tool
 * calls on the same dump cost a WeakMap lookup.
 */

import * as vscode from "vscode";
import { NvmBlockInfo } from "../../../shared/protocol";
import { NvmStructCatalog } from "../../../shared/nvm/structRich";
import { computeBindings, LayoutContext } from "../../../shared/nvm/skills/match";
import { LoadedSkill, SCOPE_PRIORITY, SkillBindings, SkillDiagnostic, SkillMeta } from "../../../shared/nvm/skills/types";
import { listResources, loadBody, loadCatalog, scanRoot } from "./skillLoader";
import { descriptorSkillRoots, globalSkillRoots, SkillRoot } from "./skillRoots";

export interface SkillIndex {
	skills: SkillMeta[];
	diagnostics: SkillDiagnostic[];
	/** True when workspace-controlled roots were skipped (untrusted workspace). */
	restricted: boolean;
}

interface CachedScan {
	skills: SkillMeta[];
	diagnostics: SkillDiagnostic[];
}

export class SkillRegistry implements vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	/** Fires when skills were added/removed/edited or roots changed. */
	public readonly onDidChange = this.changeEmitter.event;

	private generation = 0;
	private readonly scans = new Map<string, Promise<CachedScan>>();
	private readonly bodies = new Map<string, Promise<LoadedSkill>>();
	private readonly catalogs = new Map<string, Promise<NvmStructCatalog | undefined>>();
	private readonly bindingMemo = new WeakMap<readonly NvmBlockInfo[], { gen: number; key: string; value: SkillBindings }>();
	private readonly layoutIds = new Map<string, string[]>();
	private readonly watched = new Set<string>();
	private readonly disposables: vscode.Disposable[] = [];
	private debounce?: ReturnType<typeof setTimeout>;

	constructor(private readonly extensionUri: vscode.Uri) {
		this.disposables.push(
			this.changeEmitter,
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration("nvmstudio.nvm.skillRoots") || e.affectsConfiguration("nvmstudio.nvm.layoutRoots")) {
					this.reload();
				}
			}),
			vscode.workspace.onDidGrantWorkspaceTrust(() => this.reload()),
		);
	}

	/** Drop every cache and notify listeners (command "NVM: Reload Skills"). */
	public reload(): void {
		this.generation++;
		this.scans.clear();
		this.bodies.clear();
		this.catalogs.clear();
		this.changeEmitter.fire();
	}

	/** Current index generation (changes on every reload). */
	public get version(): number {
		return this.generation;
	}

	/** Remember the opaque layout identifiers (provider id, vendor) of a dump. */
	public setLayoutContext(dumpUri: vscode.Uri, ids: string[]): void {
		this.layoutIds.set(dumpUri.toString(), ids.filter(Boolean));
	}

	public layoutContext(dumpUri: vscode.Uri | undefined): LayoutContext | undefined {
		const ids = dumpUri && this.layoutIds.get(dumpUri.toString());
		return ids ? { ids } : undefined;
	}

	/** The merged index for a dump (global roots + roots beside its descriptors). */
	public async getIndex(dumpFsPath?: string): Promise<SkillIndex> {
		const roots = [...globalSkillRoots(this.extensionUri), ...descriptorSkillRoots(dumpFsPath)]
			// stable priority order: setting, descriptor, workspace, user, builtin
			.sort((a, b) => order(a) - order(b));
		const scans = await Promise.all(roots.map(r => this.scan(r)));
		const byName = new Map<string, SkillMeta>();
		const diagnostics: SkillDiagnostic[] = [];
		scans.forEach(s => {
			diagnostics.push(...s.diagnostics);
			for (const meta of s.skills) {
				const prev = byName.get(meta.name);
				if (prev) {
					diagnostics.push({
						severity: "info",
						skill: meta.name,
						location: meta.dir,
						message: `overridden by the ${prev.scope} skill at ${prev.dir}`,
					});
				} else {
					byName.set(meta.name, meta);
				}
			}
		});
		const skills = [...byName.values()];
		for (const s of skills) {
			for (const u of s.uses) {
				if (!byName.has(u)) {
					diagnostics.push({ severity: "warning", skill: s.name, location: s.dir, message: `uses unknown skill "${u}"` });
				}
			}
		}
		return { skills, diagnostics, restricted: !vscode.workspace.isTrusted };
	}

	private scan(root: SkillRoot): Promise<CachedScan> {
		const key = `${root.scope}|${root.uri.toString()}`;
		let p = this.scans.get(key);
		if (!p) {
			p = scanRoot(root);
			this.scans.set(key, p);
			this.watch(root.uri);
		}
		return p;
	}

	/** Watch a root (once) so edits refresh the index. */
	private watch(uri: vscode.Uri): void {
		const key = uri.toString();
		if (this.watched.has(key)) {
			return;
		}
		this.watched.add(key);
		try {
			const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(uri, "**/*"));
			const onEvent = () => {
				if (this.debounce) {
					clearTimeout(this.debounce);
				}
				this.debounce = setTimeout(() => this.reload(), 300);
			};
			w.onDidChange(onEvent);
			w.onDidCreate(onEvent);
			w.onDidDelete(onEvent);
			this.disposables.push(w);
		} catch {
			// Unwatchable location: the manual reload command still works.
		}
	}

	/** Full skill (body + resources + catalog), loaded lazily and cached. */
	public load(meta: SkillMeta): Promise<LoadedSkill> {
		const key = `${meta.dir}|${this.generation}`;
		let p = this.bodies.get(key);
		if (!p) {
			p = (async () => ({
				meta,
				body: await loadBody(meta),
				resources: await listResources(meta),
				catalog: await this.catalog(meta).catch(() => undefined),
			}))();
			this.bodies.set(key, p);
		}
		return p;
	}

	/** The block skill's struct catalog (undefined when none / unreadable). */
	public catalog(meta: SkillMeta): Promise<NvmStructCatalog | undefined> {
		const key = `${meta.dir}|${this.generation}`;
		let p = this.catalogs.get(key);
		if (!p) {
			p = loadCatalog(meta);
			this.catalogs.set(key, p);
		}
		return p;
	}

	/** Catalogs for every block skill that declares one (errors → diagnostics). */
	public async catalogsFor(skills: readonly SkillMeta[], diagnostics?: SkillDiagnostic[]): Promise<Map<string, NvmStructCatalog>> {
		const out = new Map<string, NvmStructCatalog>();
		await Promise.all(
			skills
				.filter(s => s.kind === "block" && s.enabled && s.struct)
				.map(async s => {
					try {
						const c = await this.catalog(s);
						if (c) {
							if (s.structRoot && !c.structs[s.structRoot]) {
								diagnostics?.push({ severity: "warning", skill: s.name, location: s.dir, message: `structRoot "${s.structRoot}" not found in ${s.struct}` });
							}
							out.set(s.name, c);
						}
					} catch (e) {
						diagnostics?.push({ severity: "error", skill: s.name, location: s.dir, message: `struct "${s.struct}": ${e instanceof Error ? e.message : String(e)}` });
					}
				}),
		);
		return out;
	}

	/** Memoized `skill → block indices` for a dump's blocks. */
	public bindings(blocks: readonly NvmBlockInfo[], skills: readonly SkillMeta[], layout?: LayoutContext): SkillBindings {
		const key = `${skills.map(s => s.name).join(",")}|${layout?.ids.join(",") ?? ""}`;
		const hit = this.bindingMemo.get(blocks);
		if (hit && hit.gen === this.generation && hit.key === key) {
			return hit.value;
		}
		const value = computeBindings(skills, blocks, layout);
		this.bindingMemo.set(blocks, { gen: this.generation, key, value });
		return value;
	}

	public dispose(): void {
		if (this.debounce) {
			clearTimeout(this.debounce);
		}
		this.disposables.forEach(d => d.dispose());
	}
}

const order = (r: SkillRoot) => SCOPE_PRIORITY[r.scope];
