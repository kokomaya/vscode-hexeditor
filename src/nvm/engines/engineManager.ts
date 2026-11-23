// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Engine pack manager — install / download / resolve external NVM engines.
 *
 * The extension core ships no vendor layout. Engines are **packs** the user
 * installs (from a local folder/file, a URL, or an install server) into the
 * NVM Studio home, organised like the server: `<home>/engines/<vendor>/<layout>/`
 * (e.g. `vector/fee-v3`). A `*.nvmlayout.json` references a pack by that folder
 * path (`"engine": "vector/fee-v3"`) or, for older packs, by the `id` in its
 * `engine.json` (`"engine": "vector-fee-v3"`); the manager resolves it to the
 * pack's entry script, which the (gated) loader then runs.
 *
 * Installing / running workspace or downloaded JavaScript is code execution and
 * stays gated by Workspace Trust + `nvmstudio.nvm.allowExternalEngines` + a
 * per-file confirmation (enforced in `hexEditorProvider.ts`).
 */

import * as vscode from "vscode";
import { engineFileUrl, MAX_ENGINE_DEPTH, parseEngineRef, RemoteEngine } from "../../../shared/nvm/install/remoteEngines";
import { downloadFolder } from "../install/download";
import { nvmStudioEnginesUri } from "../paths";

/** An engine pack manifest (`engine.json`). */
export interface EngineManifest {
	/** Pack id; older descriptors reference it via `"engine"`. */
	id: string;
	/** Semver-ish version string. */
	version?: string;
	displayName?: string;
	description?: string;
	/** Entry script file name, relative to the pack folder. */
	entry: string;
	publisher?: string;
	/** Where the pack came from (e.g. "bundled", a URL, a folder path). */
	source?: string;
	/** SDK contract version the pack was written against. */
	sdkVersion?: number;
	capabilities?: {
		sources?: Record<string, string>;
		options?: string[];
	};
}

/** A pack installed under global storage. */
export interface InstalledEngine {
	/** Folder path under the engine root, e.g. "vector/fee-v3" (what descriptors reference). */
	ref: string;
	manifest: EngineManifest;
	/** The pack folder. */
	dir: vscode.Uri;
	/** The resolved entry script. */
	entryUri: vscode.Uri;
}

function isManifest(value: unknown): value is EngineManifest {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as EngineManifest).entry === "string"
	);
}

/** Sanitize an id into a safe folder name. */
function safeId(id: string): string {
	return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Infer an engine id from a download URL. Understands the old registry layout
 * `.../v1/engines/<id>/<version>/engine.js` (returns `<id>`), and otherwise
 * falls back to the file base name without `.engine.js`/`.js`.
 */
function inferEngineIdFromUrl(url: string): string | undefined {
	let pathname: string;
	try {
		pathname = new URL(url).pathname;
	} catch {
		pathname = url.replace(/[?#].*$/, "");
	}
	const segments = pathname.split("/").filter(Boolean);
	const enginesIdx = segments.lastIndexOf("engines");
	if (enginesIdx >= 0 && segments.length > enginesIdx + 1) {
		return segments[enginesIdx + 1];
	}
	const base = segments[segments.length - 1] || "";
	const candidate = base.replace(/\.engine\.js$/i, "").replace(/\.js$/i, "").trim();
	return candidate || undefined;
}

export class EngineManager {
	/** Root folder for user-installed / downloaded packs: `<home>/engines`. */
	private readonly root: vscode.Uri;
	/** Read-only packs shipped with the extension: `<extension>/dist/engines`. */
	private readonly bundledRoot: vscode.Uri;
	/** Only resolve bundled packs in the F5 dev host, never in a shipped build. */
	private readonly allowBundled: boolean;

	constructor(private readonly context: vscode.ExtensionContext) {
		// Engines install under the unified NVM Studio user home (shared with conf),
		// not the extension's global storage.
		this.root = nvmStudioEnginesUri();
		this.bundledRoot = vscode.Uri.joinPath(context.extensionUri, "dist", "engines");
		this.allowBundled = context.extensionMode === vscode.ExtensionMode.Development;
	}

	private async ensureRoot(): Promise<void> {
		await vscode.workspace.fs.createDirectory(this.root);
	}

	/** List every pack below `root` (a folder with `engine.json` is a pack; others are vendors). */
	public list(root = this.root): Promise<InstalledEngine[]> {
		return this.scan(root, [], []);
	}

	private async scan(root: vscode.Uri, path: string[], out: InstalledEngine[]): Promise<InstalledEngine[]> {
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, ...path));
		} catch {
			return out;
		}
		for (const [name, type] of entries) {
			if (type !== vscode.FileType.Directory || name.startsWith(".")) {
				continue;
			}
			const next = [...path, name];
			const pack = await this.readPack(vscode.Uri.joinPath(root, ...next), next.join("/"));
			if (pack) {
				out.push(pack);
			} else if (next.length < MAX_ENGINE_DEPTH) {
				await this.scan(root, next, out);
			}
		}
		return out;
	}

	/**
	 * Resolve a reference: the pack's folder path ("vector/fee-v3") or, for
	 * older descriptors, its manifest id ("vector-fee-v3"). An `@version`
	 * suffix is ignored.
	 */
	public async resolve(ref: string): Promise<InstalledEngine | undefined> {
		const path = parseEngineRef(ref);
		if (!path) {
			return undefined;
		}
		const key = path.join("/");
		// 1. A user-installed / downloaded pack wins (lets a user override a
		//    bundled engine by installing their own with the same reference).
		const direct = await this.readPack(vscode.Uri.joinPath(this.root, ...path), key);
		if (direct) {
			return direct;
		}
		const installed = await this.list();
		const scanned = installed.find(e => e.ref === key) ?? installed.find(e => e.manifest.id === key);
		if (scanned || !this.allowBundled) {
			return scanned;
		}
		// 2. DEBUG ONLY: fall back to a pack the extension ships under
		//    `dist/engines/*`, loaded in place — `npm run compile` writes it there,
		//    so there is nothing to install: rebuild + reload the window and the new
		//    code is picked up. Disabled in shipped builds, where production must use
		//    a real install or a project-local `engineScript`.
		const bundled = await this.list(this.bundledRoot);
		return bundled.find(e => e.ref === key) ?? bundled.find(e => e.manifest.id === key);
	}

	/** Read + validate a pack folder's manifest and entry. */
	private async readPack(dir: vscode.Uri, ref: string): Promise<InstalledEngine | undefined> {
		try {
			const manifestUri = vscode.Uri.joinPath(dir, "engine.json");
			const buf = await vscode.workspace.fs.readFile(manifestUri);
			const manifest = JSON.parse(new TextDecoder("utf8").decode(buf));
			if (!isManifest(manifest)) {
				return undefined;
			}
			manifest.id = typeof manifest.id === "string" && manifest.id ? manifest.id : ref;
			const entryUri = vscode.Uri.joinPath(dir, manifest.entry);
			await vscode.workspace.fs.stat(entryUri);
			return { ref, manifest, dir, entryUri };
		} catch {
			return undefined;
		}
	}

	/**
	 * Install a pack from an install server into `<root>/<vendor>/<layout>/`,
	 * replacing what was there. The caller must have confirmed trust.
	 */
	public async installFromServer(base: string, engine: RemoteEngine): Promise<InstalledEngine> {
		await this.ensureRoot();
		const dir = vscode.Uri.joinPath(this.root, ...engine.path);
		await downloadFolder(
			dir,
			engine.files.map(rel => ({ rel, url: engineFileUrl(base, engine.id, rel) })),
		);
		const installed = await this.readPack(dir, engine.id);
		if (!installed) {
			throw new Error(`Engine ${engine.id} has no valid engine.json / entry script.`);
		}
		return installed;
	}

	/**
	 * Install a pack from a local folder containing an `engine.json`. Copies the
	 * whole folder into global storage under the pack id.
	 */
	public async installFromFolder(src: vscode.Uri): Promise<InstalledEngine> {
		const pack = await this.readPack(src, src.path.replace(/\/+$/, "").replace(/^.*\//, ""));
		if (!pack) {
			throw new Error(`No valid engine.json found in ${src.fsPath}`);
		}
		await this.ensureRoot();
		const ref = safeId(pack.manifest.id);
		const dest = vscode.Uri.joinPath(this.root, ref);
		await this.copyRecursive(src, dest);
		const installed = await this.readPack(dest, ref);
		if (!installed) {
			throw new Error("Engine pack failed to install (copy incomplete).");
		}
		return installed;
	}

	/**
	 * Install a pack from a single `.engine.js` file. Synthesizes a manifest with
	 * the given id (defaults to the file's base name).
	 */
	public async installFromFile(src: vscode.Uri, id?: string): Promise<InstalledEngine> {
		const base = src.path.replace(/^.*\//, "");
		const packId = safeId(id || base.replace(/\.engine\.js$/i, "").replace(/\.js$/i, ""));
		await this.ensureRoot();
		const dest = vscode.Uri.joinPath(this.root, packId);
		await vscode.workspace.fs.createDirectory(dest);
		const entryName = "engine.js";
		await vscode.workspace.fs.copy(src, vscode.Uri.joinPath(dest, entryName), { overwrite: true });
		await this.writeManifest(dest, {
			id: packId,
			entry: entryName,
			displayName: packId,
			source: src.fsPath,
		});
		return (await this.readPack(dest, packId))!;
	}

	/**
	 * Download a single-file engine from a URL into a new pack. The caller must
	 * have already confirmed trust in the source (see the install command).
	 */
	public async installFromUrl(url: string, id?: string): Promise<InstalledEngine> {
		const res = await fetch(url);
		if (!res.ok) {
			throw new Error(`Download failed: ${res.status} ${res.statusText}`);
		}
		const text = await res.text();
		const packId = safeId((id || inferEngineIdFromUrl(url) || "engine").trim());
		await this.ensureRoot();
		const dest = vscode.Uri.joinPath(this.root, packId);
		await vscode.workspace.fs.createDirectory(dest);
		const entryName = "engine.js";
		await vscode.workspace.fs.writeFile(
			vscode.Uri.joinPath(dest, entryName),
			new TextEncoder().encode(text),
		);
		await this.writeManifest(dest, {
			id: packId,
			entry: entryName,
			displayName: packId,
			source: url,
		});
		return (await this.readPack(dest, packId))!;
	}

	/** Remove an installed pack. */
	public async remove(engine: InstalledEngine): Promise<void> {
		try {
			await vscode.workspace.fs.delete(engine.dir, { recursive: true, useTrash: false });
		} catch {
			// already gone
		}
	}

	private async writeManifest(dir: vscode.Uri, manifest: EngineManifest): Promise<void> {
		await vscode.workspace.fs.writeFile(
			vscode.Uri.joinPath(dir, "engine.json"),
			new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
		);
	}

	private async copyRecursive(src: vscode.Uri, dest: vscode.Uri): Promise<void> {
		await vscode.workspace.fs.createDirectory(dest);
		for (const [name, type] of await vscode.workspace.fs.readDirectory(src)) {
			const s = vscode.Uri.joinPath(src, name);
			const d = vscode.Uri.joinPath(dest, name);
			if (type === vscode.FileType.Directory) {
				await this.copyRecursive(s, d);
			} else {
				await vscode.workspace.fs.copy(s, d, { overwrite: true });
			}
		}
	}
}
