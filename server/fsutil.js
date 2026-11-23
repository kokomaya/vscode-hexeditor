"use strict";

/**
 * Small filesystem helpers shared by the route modules (engines, configs,
 * skills). Every path that comes from a request goes through `safeParts`, so
 * a request can never reach outside its data folder.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

/** Any non-hidden name without separators / reserved / control characters (Unicode allowed). */
// eslint-disable-next-line no-control-regex
const validName = name => typeof name === "string" && name !== "" && name.trim() === name && !name.startsWith(".") && !/[\\/:*?"<>|\x00-\x1f]/.test(name);

/** Split + validate a relative path ("a/b/c"); undefined when unsafe or deeper than `maxParts`. */
function safeParts(rel, maxParts) {
	const parts = String(rel ?? "").split(/[\\/]+/).filter(Boolean);
	return parts.length && parts.length <= maxParts && parts.every(validName) ? parts : undefined;
}

async function exists(file) {
	try {
		await fsp.stat(file);
		return true;
	} catch {
		return false;
	}
}

/** Parse JSON (a leading BOM from PowerShell `Set-Content -Encoding UTF8` is tolerated). */
function parseJson(raw) {
	return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
}

async function readJsonSafe(file) {
	try {
		return parseJson(await fsp.readFile(file, "utf8"));
	} catch {
		return undefined;
	}
}

/** Every file below `dir` as relative "a/b.c" paths (hidden entries skipped). */
async function listFiles(dir, { maxDepth = 4, maxFiles = 200 } = {}, prefix = "", depth = 0, out = []) {
	if (depth > maxDepth || out.length >= maxFiles) {
		return out;
	}
	for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
		if (!validName(d.name)) {
			continue;
		}
		const rel = prefix ? `${prefix}/${d.name}` : d.name;
		if (d.isDirectory()) {
			await listFiles(path.join(dir, d.name), { maxDepth, maxFiles }, rel, depth + 1, out);
		} else if (d.isFile() && out.length < maxFiles) {
			out.push(rel);
		}
	}
	return out;
}

const CONTENT_TYPES = { ".json": "application/json", ".js": "application/javascript", ".md": "text/markdown" };

/** Stream a file, or answer 404 with `notFound`. */
async function sendFile(res, json, file, notFound) {
	try {
		const stat = await fsp.stat(file);
		if (!stat.isFile()) {
			throw new Error("not a file");
		}
		res.writeHead(200, {
			"Content-Type": `${CONTENT_TYPES[path.extname(file).toLowerCase()] || "text/plain"}; charset=utf-8`,
			"Content-Length": stat.size,
			"Cache-Control": "public, max-age=300",
		});
		fs.createReadStream(file).pipe(res);
	} catch {
		json(res, 404, { error: notFound });
	}
}

/**
 * Replace the folder `dir` with `files` ([relParts, content][]), all validated
 * by the caller beforehand so a bad entry never leaves a half-written folder.
 */
async function replaceFolder(dir, files) {
	await fsp.rm(dir, { recursive: true, force: true });
	for (const [parts, content] of files) {
		const target = path.join(dir, ...parts);
		await fsp.mkdir(path.dirname(target), { recursive: true });
		await fsp.writeFile(target, content, "utf8");
	}
}

/** Validate a `{ "rel/path": "content" }` map into [parts, content][]; throws on the first bad entry. */
function checkFileMap(files, { maxFiles = 200, maxDepth = 5 } = {}) {
	const entries = Object.entries(files);
	if (entries.length > maxFiles) {
		throw new Error(`At most ${maxFiles} files.`);
	}
	return entries.map(([rel, content]) => {
		const parts = safeParts(rel, maxDepth);
		if (!parts || typeof content !== "string") {
			throw new Error(`Invalid file entry: ${rel}`);
		}
		return [parts, content];
	});
}

module.exports = { validName, safeParts, exists, parseJson, readJsonSafe, listFiles, sendFile, replaceFolder, checkFileMap };
