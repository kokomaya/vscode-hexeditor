"use strict";

/**
 * Layout-descriptor distribution routes. Descriptors (`*.nvmlayout.json`) live
 * under `<data root>/conf/` in any folder structure the maintainer likes,
 * typically mirroring the skills: `conf/<product>/<platform>/<project>/x.nvmlayout.json`.
 * A descriptor is addressed by its relative path; a project binding
 * (`skills/<…>/level.json` → `"conf"`) lists the paths it needs.
 *
 *   GET /v1/configs                       → { configs: [{ path, name, vendor, engines, skillContext, downloadUrl }] }
 *   GET /v1/configs/file?path={rel}       → one descriptor
 */

const fsp = require("fs/promises");
const path = require("path");
const { validName, safeParts, parseJson, sendFile } = require("./fsutil");

const MAX_DEPTH = 5; // folders + file name
const SUFFIX = ".nvmlayout.json";
const str = v => (typeof v === "string" && v ? v : undefined);

/** What the client needs to plan an install, read from the descriptor (an object or an array of them). */
function summarize(raw) {
	const list = Array.isArray(raw) ? raw : [raw];
	const engines = [...new Set(list.map(c => c && str(c.engine)).filter(Boolean))];
	const first = list.find(c => c && typeof c === "object") || {};
	return { vendor: str(first.vendor), engines, skillContext: str(first.skillContext) };
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
				info = summarize(parseJson(await fsp.readFile(path.join(root, ...next), "utf8")));
			} catch {
				info = { invalid: true };
			}
			out.push({ path: next.join("/"), name: d.name, ...info });
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
			if (!rel || !rel[rel.length - 1].toLowerCase().endsWith(SUFFIX)) {
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
