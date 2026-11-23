"use strict";

/**
 * Engine distribution routes. Engines are organised by folders under
 * `<data root>/engines/`:
 *
 *   <vendor>/engine.json                     a vendor with a single layout
 *   <vendor>/<layout>/engine.json            one engine per layout version (e.g. vector/fee-v3)
 *   <vendor>/vendor.json                     optional { "title", "description" }
 *
 * A folder holding `engine.json` is an engine pack (its `entry` script plus any
 * resources), any other folder is a vendor. An engine is addressed by its id =
 * folder path ("vector/fee-v3"); descriptors and project bindings reference it
 * the same way (`"engine": "vector/fee-v3"`). The release version lives in
 * `engine.json` (`version`); publishing replaces the folder.
 *
 *   GET  /v1/engines                             → { engines: [...], vendors: [...] }
 *   GET  /v1/engines/file?engine={id}&path={rel} → one file of a pack
 *   POST /v1/admin/engines?engine={id}           → publish/replace
 *        { "files": { "engine.json": "…", "engine.js": "…" } }
 *     or { "engineScript": "…", "version", "displayName", "description", "sdkVersion", "id" }
 */

const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");
const { validName, safeParts, exists, readJsonSafe, listFiles, sendFile, replaceFolder, checkFileMap } = require("./fsutil");

const MAX_DEPTH = 2; // vendor / layout
const MANIFEST = "engine.json";
const VENDOR_FILE = "vendor.json";
const str = v => (typeof v === "string" ? v : undefined);

async function readEngine(dir, parts) {
	const manifest = await readJsonSafe(path.join(dir, MANIFEST));
	if (!manifest || typeof manifest !== "object" || !str(manifest.entry)) {
		return undefined;
	}
	const files = (await listFiles(dir)).sort();
	if (!files.includes(MANIFEST) || !files.includes(path.basename(manifest.entry))) {
		return undefined;
	}
	return {
		id: parts.join("/"),
		vendor: parts[0],
		layout: parts[1],
		manifestId: str(manifest.id),
		version: str(manifest.version),
		displayName: str(manifest.displayName) || parts.join("/"),
		description: str(manifest.description) || "",
		sdkVersion: typeof manifest.sdkVersion === "number" ? manifest.sdkVersion : undefined,
		files,
	};
}

async function walk(root, parts, out) {
	let entries;
	try {
		entries = await fsp.readdir(path.join(root, ...parts), { withFileTypes: true });
	} catch {
		return;
	}
	for (const d of entries) {
		if (!d.isDirectory() || !validName(d.name)) {
			continue;
		}
		const next = [...parts, d.name];
		const dir = path.join(root, ...next);
		if (await exists(path.join(dir, MANIFEST))) {
			const engine = await readEngine(dir, next);
			if (engine) {
				out.engines.push(engine);
			}
		} else if (next.length < MAX_DEPTH) {
			const info = (await readJsonSafe(path.join(dir, VENDOR_FILE))) || {};
			out.vendors.push({ id: d.name, title: str(info.title) || d.name, description: str(info.description) || "" });
			await walk(root, next, out);
		}
	}
}

async function listEngines(root) {
	await fsp.mkdir(root, { recursive: true });
	const out = { engines: [], vendors: [] };
	await walk(root, [], out);
	out.engines.sort((a, b) => a.id.localeCompare(b.id));
	out.vendors.sort((a, b) => a.id.localeCompare(b.id));
	return out;
}

/** Turn a publish body into the files of the pack. */
function packFiles(idParts, payload) {
	if (payload && typeof payload.files === "object" && payload.files) {
		const files = checkFileMap(payload.files);
		if (!files.some(([p]) => p.length === 1 && p[0] === MANIFEST)) {
			throw new Error(`"files" must contain ${MANIFEST}.`);
		}
		return files;
	}
	const script = payload && str(payload.engineScript);
	if (!script || !script.trim()) {
		throw new Error('Body must be { "files": { "engine.json": "…", … } } or { "engineScript": "…" }.');
	}
	const manifest = {
		id: str(payload.id) || idParts.join("-"),
		version: str(payload.version),
		displayName: str(payload.displayName) || idParts.join("/"),
		description: str(payload.description) || "",
		sdkVersion: typeof payload.sdkVersion === "number" ? payload.sdkVersion : undefined,
		entry: "engine.js",
		sha256: crypto.createHash("sha256").update(script).digest("hex"),
		publishedAt: new Date().toISOString(),
	};
	return [
		[["engine.js"], script],
		[[MANIFEST], JSON.stringify(manifest, null, 2)],
	];
}

async function publishEngine(root, idParts, payload) {
	const files = packFiles(idParts, payload);
	if (idParts.length > 1 && (await exists(path.join(root, idParts[0], MANIFEST)))) {
		throw new Error(`"${idParts[0]}" is an engine, not a vendor folder.`);
	}
	// A one-segment id may name an existing vendor folder: never replace it (that would delete its engines).
	const dir = path.join(root, ...idParts);
	if (idParts.length === 1 && (await exists(dir)) && !(await exists(path.join(dir, MANIFEST)))) {
		throw new Error(`"${idParts.join("/")}" is a vendor folder, not an engine.`);
	}
	await replaceFolder(dir, files);
	return files.length;
}

function createEngineRoutes({ root, json, readBody, requireAdmin }) {
	return async function handle(req, res, method, pathname, url) {
		if (method === "GET" && pathname === "/v1/engines") {
			json(res, 200, await listEngines(root));
			return true;
		}
		if (method === "GET" && pathname === "/v1/engines/file") {
			const id = safeParts(url.searchParams.get("engine"), MAX_DEPTH);
			const rel = safeParts(url.searchParams.get("path"), 5);
			if (!id || !rel) {
				json(res, 400, { error: "Invalid engine id or file path." });
			} else {
				await sendFile(res, json, path.join(root, ...id, ...rel), `Engine file ${id.join("/")}/${rel.join("/")} not found.`);
			}
			return true;
		}
		if (method === "POST" && pathname === "/v1/admin/engines") {
			const auth = requireAdmin(req);
			if (!auth.ok) {
				json(res, 403, { error: auth.reason });
				return true;
			}
			const id = safeParts(url.searchParams.get("engine"), MAX_DEPTH);
			if (!id) {
				json(res, 400, { error: "Query parameter engine=<vendor>[/<layout>] is required." });
				return true;
			}
			try {
				const count = await publishEngine(root, id, JSON.parse(await readBody(req)));
				json(res, 201, { ok: true, id: id.join("/"), files: count });
			} catch (error) {
				json(res, 400, { error: error instanceof Error ? error.message : String(error) });
			}
			return true;
		}
		return false;
	};
}

module.exports = { createEngineRoutes, listEngines };
