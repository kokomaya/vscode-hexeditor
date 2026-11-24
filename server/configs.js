"use strict";

/**
 * Layout-descriptor distribution routes. Descriptors (`*.nvmlayout.json`) live
 * under `<data root>/conf/` in any folder structure the maintainer likes,
 * typically mirroring the skills: `conf/<product>/<platform>/<project>/x.nvmlayout.json`.
 * A descriptor is addressed by its relative path; a project binding
 * (`skills/<…>/level.json` → `"conf"`) lists the paths it needs.
 *
 *   GET /v1/configs                       → { configs: [{ path, name, vendor, engines, skillContext, requires, hash, downloadUrl }] }
 *   GET /v1/configs/file?path={rel}       → one descriptor, or a shared file it requires
 *
 * `requires` lists the shared files a descriptor references through a source
 * written relative to itself (`"sources": { "demStructs": "../../vector/dem/x.nvmstructs.json" }`),
 * as paths under conf/. The client downloads them alongside the descriptor so
 * the relative reference still resolves after install.
 */

const fsp = require("fs/promises");
const path = require("path");
const { contentHash, validName, safeParts, parseJson, sendFile } = require("./fsutil");

const MAX_DEPTH = 5; // folders + file name
const SUFFIX = ".nvmlayout.json";
/** Shared files a descriptor may reference (reusable struct packs). */
const SHARED_SUFFIXES = [".nvmstructs.json"];
const servable = name => [SUFFIX, ...SHARED_SUFFIXES].some(s => name.toLowerCase().endsWith(s));
const str = v => (typeof v === "string" && v ? v : undefined);

/** Descriptor-relative shared sources (`./x`, `../y/x`) as normalized paths under conf/. */
function requiresOf(list, relPath) {
	const out = new Set();
	const dir = path.posix.dirname(relPath);
	for (const c of list) {
		for (const file of Object.values((c && c.sources) || {})) {
			if (typeof file !== "string" || !/^\.\.?[\\/]/.test(file)) {
				continue;
			}
			const target = path.posix.normalize(path.posix.join(dir, file.replace(/\\/g, "/")));
			if (!target.startsWith("../") && SHARED_SUFFIXES.some(s => target.toLowerCase().endsWith(s))) {
				out.add(target);
			}
		}
	}
	return [...out].sort();
}

/** What the client needs to plan an install, read from the descriptor (an object or an array of them). */
function summarize(raw, relPath) {
	const list = Array.isArray(raw) ? raw : [raw];
	const engines = [...new Set(list.map(c => c && str(c.engine)).filter(Boolean))];
	const first = list.find(c => c && typeof c === "object") || {};
	return {
		vendor: str(first.vendor),
		engines,
		skillContext: str(first.skillContext),
		requires: requiresOf(list, relPath),
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
		if (!validName(d.name)) {
			continue;
		}
		const next = [...parts, d.name];
		if (d.isDirectory() && next.length < MAX_DEPTH) {
			await walk(root, next, out);
		} else if (d.isFile() && d.name.toLowerCase().endsWith(SUFFIX)) {
			let info = {};
			try {
				info = summarize(parseJson(await fsp.readFile(path.join(root, ...next), "utf8")), next.join("/"));
			} catch {
				info = { invalid: true };
			}
			const rel = next.join("/");
			// Descriptor + the shared files it requires: a struct-pack change is an update too.
			const hash = info.invalid ? undefined : await contentHash(root, [rel, ...info.requires]);
			out.push({ path: rel, name: d.name, ...info, hash });
		}
	}
}

async function listConfigs(root) {
	await fsp.mkdir(root, { recursive: true });
	const out = [];
	await walk(root, [], out);
	return out.filter(c => !c.invalid).sort((a, b) => a.path.localeCompare(b.path));
}

const fileUrl = (base, rel) => `${base}/v1/configs/file?path=${encodeURIComponent(rel)}`;

function createConfigRoutes({ root, json, baseUrl }) {
	return async function handle(req, res, method, pathname, url) {
		if (method === "GET" && pathname === "/v1/configs") {
			const base = baseUrl(req);
			const configs = (await listConfigs(root)).map(c => ({ ...c, downloadUrl: fileUrl(base, c.path) }));
			json(res, 200, { configs });
			return true;
		}
		if (method === "GET" && pathname === "/v1/configs/file") {
			const rel = safeParts(url.searchParams.get("path"), MAX_DEPTH);
			if (!rel || !servable(rel[rel.length - 1])) {
				json(res, 400, { error: "Invalid descriptor path." });
			} else {
				await sendFile(res, json, path.join(root, ...rel), `Config ${rel.join("/")} not found.`);
			}
			return true;
		}
		return false;
	};
}

module.exports = { createConfigRoutes, listConfigs };
