"use strict";

/**
 * Skill distribution routes for the install server.
 *
 * Skills are organised purely by folders under `<data root>/skills/`; the
 * maintainer decides the structure:
 *
 *   <skill>/SKILL.md                                general
 *   <product>/<skill>/SKILL.md                      product   (e.g. radar, camera)
 *   <product>/<platform>/<skill>/SKILL.md           platform  (chip platform / variant)
 *   <product>/<platform>/<project>/<skill>/SKILL.md project   (customer application)
 *
 * A folder holding SKILL.md is a skill, any other folder is a level (max three
 * deep). A level may carry an optional `level.json`:
 *
 *   { "title": "…", "description": "…",
 *     "engine": "vector/fee-v3",                       // engine(s) this level's dumps use (string or array)
 *     "conf": ["radar/chipA/customerB/x.nvmlayout.json"] } // descriptors under conf/
 *
 * `engine` / `conf` are the *project binding*: the client installs exactly
 * what the chosen product / platform / project needs; the nearest level that
 * sets a field wins. Names only need to be unique inside one folder. A skill
 * is addressed by its id = its folder path, e.g. "radar/chipA/reset-counter".
 *
 *   GET  /v1/skills                                → { skills: [...], levels: [...] }
 *   GET  /v1/skills/file?skill={id}&path={rel}     → one file of a skill
 *   POST /v1/admin/skills?skill={id}               → publish/replace ({ files: { "SKILL.md": "…", … } })
 *
 * Skills are pure data (Markdown + JSON) — nothing here executes them.
 */

const fsp = require("fs/promises");
const path = require("path");
const { contentHash, validName, safeParts, exists, readJsonSafe, listFiles, sendFile, replaceFolder, checkFileMap } = require("./fsutil");

const LEVELS = ["product", "platform", "project"];
const MAX_FILE_DEPTH = 4;
const SKILL_FILE = "SKILL.md";
const LEVEL_FILE = "level.json";

/** A skill id: 1–4 segments (up to three levels + the skill folder). */
const parseSkillId = id => safeParts(id, LEVELS.length + 1);

/** Minimal front-matter reader (`key: value` lines between `---`). */
function frontMatter(text) {
	const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	const out = {};
	if (m) {
		for (const line of m[1].split(/\r?\n/)) {
			const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
			if (kv) {
				out[kv[1]] = kv[2].trim();
			}
		}
	}
	return out;
}

/** A string or array of strings → string[] (undefined when absent, so inheritance can tell "unset" from "empty"). */
function stringList(v) {
	if (typeof v === "string") {
		return v ? [v] : [];
	}
	return Array.isArray(v) ? v.filter(x => typeof x === "string" && x) : undefined;
}

function levelEntry(parts, info) {
	return {
		path: parts,
		level: LEVELS[parts.length - 1],
		title: typeof info.title === "string" ? info.title : parts[parts.length - 1],
		description: typeof info.description === "string" ? info.description : "",
		engines: stringList(info.engine),
		configs: stringList(info.conf),
	};
}

/** Walk the levels: collect skills and level folders. */
async function walk(root, levelPath, out) {
	let entries;
	try {
		entries = await fsp.readdir(path.join(root, ...levelPath), { withFileTypes: true });
	} catch {
		return;
	}
	for (const d of entries) {
		if (!d.isDirectory() || !validName(d.name)) {
			continue;
		}
		const parts = [...levelPath, d.name];
		const dir = path.join(root, ...parts);
		let text;
		try {
			text = await fsp.readFile(path.join(dir, SKILL_FILE), "utf8");
		} catch {
			text = undefined;
		}
		if (text !== undefined) {
			const meta = frontMatter(text);
			const files = (await listFiles(dir, { maxDepth: MAX_FILE_DEPTH })).sort();
			out.skills.push({
				id: parts.join("/"),
				name: d.name,
				path: levelPath,
				level: levelPath.length ? LEVELS[levelPath.length - 1] : "general",
				kind: meta.kind || undefined,
				description: meta.description || "",
				version: meta.version || undefined,
				files,
				hash: await contentHash(dir, files),
			});
		} else if (levelPath.length < LEVELS.length) {
			out.levels.push(levelEntry(parts, (await readJsonSafe(path.join(dir, LEVEL_FILE))) || {}));
			await walk(root, parts, out);
		}
	}
}

async function listSkills(root) {
	await fsp.mkdir(root, { recursive: true });
	const out = { skills: [], levels: [] };
	await walk(root, [], out);
	out.skills.sort((a, b) => a.id.localeCompare(b.id));
	out.levels.sort((a, b) => a.path.join("/").localeCompare(b.path.join("/")));
	return out;
}

async function publishSkill(root, idParts, payload) {
	const files = payload && typeof payload.files === "object" ? payload.files : undefined;
	if (!files || typeof files[SKILL_FILE] !== "string") {
		throw new Error('Body must be { "files": { "SKILL.md": "…", … } }.');
	}
	// Validate everything first so a bad entry never leaves a half-written skill.
	const checked = checkFileMap(files, { maxDepth: MAX_FILE_DEPTH + 1 });
	// Parents must be level folders, not skills.
	for (let i = 1; i < idParts.length; i++) {
		if (await exists(path.join(root, ...idParts.slice(0, i), SKILL_FILE))) {
			throw new Error(`"${idParts.slice(0, i).join("/")}" is a skill, not a level folder.`);
		}
	}
	// Never replace a level folder (that would delete every skill below it).
	const dir = path.join(root, ...idParts);
	if ((await exists(dir)) && !(await exists(path.join(dir, SKILL_FILE)))) {
		throw new Error(`"${idParts.join("/")}" is a level folder, not a skill.`);
	}
	await replaceFolder(dir, checked);
	return checked.length;
}

/**
 * Create the route handler. Returns `true` when the request was a skills
 * route (handled), `false` otherwise.
 */
function createSkillRoutes({ root, json, readBody, requireAdmin }) {
	return async function handle(req, res, method, pathname, url) {
		if (method === "GET" && pathname === "/v1/skills") {
			json(res, 200, await listSkills(root));
			return true;
		}

		if (method === "GET" && pathname === "/v1/skills/file") {
			const id = parseSkillId(url.searchParams.get("skill"));
			const rel = safeParts(url.searchParams.get("path"), MAX_FILE_DEPTH + 1);
			if (!id || !rel) {
				json(res, 400, { error: "Invalid skill id or file path." });
			} else {
				await sendFile(res, json, path.join(root, ...id, ...rel), `Skill file ${id.join("/")}/${rel.join("/")} not found.`);
			}
			return true;
		}

		if (method === "POST" && pathname === "/v1/admin/skills") {
			const auth = requireAdmin(req);
			if (!auth.ok) {
				json(res, 403, { error: auth.reason });
				return true;
			}
			const id = parseSkillId(url.searchParams.get("skill"));
			if (!id) {
				json(res, 400, { error: "Query parameter skill=<product>/<platform>/<project>/<name> (1–4 segments) is required." });
				return true;
			}
			try {
				const count = await publishSkill(root, id, JSON.parse(await readBody(req)));
				json(res, 201, { ok: true, id: id.join("/"), files: count });
			} catch (error) {
				json(res, 400, { error: error instanceof Error ? error.message : String(error) });
			}
			return true;
		}
		return false;
	};
}

module.exports = { createSkillRoutes, listSkills, parseSkillId, frontMatter };
