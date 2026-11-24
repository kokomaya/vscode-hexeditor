// Merge-sync this repo's install server (code + engine packs + published data) into a
// deployed server folder WITHOUT clobbering what was edited there.
//
//   node server/sync-server.mjs <serverDir> [--dry-run] [--force <relPath>]...
//
// <serverDir> is a deployed server (e.g. a copy of dist/server): its data root
// is <serverDir>/data when that folder exists, else <serverDir> itself.
//
// WHAT is published is an allowlist, server/publish.json — server/demo is a local demo
// data root and is NOT published wholesale:
//   engines.<id>                     dist/engines/<id>/ (no conf/, *.map) → data/engines/<target>/
//   engines.<id>.conf                dist/engines/<id>/conf/<file>         → data/conf/<target>/<file>
//   data[]                           server/demo/<path> (file or folder)   → data/<path>
//   server code (always)             server/{index→nvm-engine-install-server,fsutil,engines,configs,skills}.js
//                                    → <serverDir>/   (only when the target looks like a dist/server deployment)
//
// Built engine packs and server code are REPO-OWNED (build output, never hand-edited): always
// updated; a locally edited copy is backed up first. Everything else (conf/, skills/ definitions)
// follows the merge rules below.
//
// Merge rules — the deployed server's own definitions always win:
//   * target missing                       → copied
//   * target identical                     → skipped
//   * target unchanged since the last sync → updated (tracked by hash in <serverDir>/.nvmsync.json)
//   * target edited locally                → CONFLICT: kept as is and reported; `--force <relPath>`
//                                            (path or folder prefix, repeatable) overwrites it after a
//                                            backup to <serverDir>/backup/sync-<timestamp>/
//   * nothing is ever deleted
//   * paths listed in <serverDir>/.nvmsyncignore (one relative path / folder prefix per line, `#`
//     comments) are never written.
//
// First run against an existing server (no .nvmsync.json yet): every differing file is a conflict,
// so nothing that was hand-edited is lost. Review the report, then --force what should be replaced.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CODE_FILES = { "index.js": "nvm-engine-install-server.js", "fsutil.js": "fsutil.js", "engines.js": "engines.js", "configs.js": "configs.js", "skills.js": "skills.js" };
const MANIFEST = ".nvmsync.json";
const IGNORE = ".nvmsyncignore";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publish = JSON.parse(readFileSync(join(repoRoot, "server", "publish.json"), "utf8"));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = [];
let serverDir;
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--force") {
		force.push(norm(args[++i] ?? ""));
	} else if (args[i] !== "--dry-run") {
		serverDir = resolve(args[i]);
	}
}
if (!serverDir || !existsSync(serverDir)) {
	console.error("usage: node server/sync-server.mjs <serverDir> [--dry-run] [--force <relPath>]...");
	process.exit(2);
}

function norm(p) {
	return p.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
}
const hasData = existsSync(join(serverDir, "data"));
const dataPrefix = hasData ? "data/" : "";
const isDistDeployment = existsSync(join(serverDir, "nvm-engine-install-server.js"));

/** Hash with line endings normalized, so a CRLF checkout is not a "local edit". */
function hashOf(file) {
	const buf = readFileSync(file);
	const text = buf.includes(0) ? buf : Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"));
	return createHash("sha256").update(text).digest("hex");
}

function walk(dir, filter = () => true) {
	const out = [];
	if (!existsSync(dir)) {
		return out;
	}
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			out.push(...walk(full, filter));
		} else if (filter(full)) {
			out.push(full);
		}
	}
	return out;
}

// --- plan: [{ src, rel }] where rel is relative to serverDir ---
const plan = [];
const add = (src, rel, owned = false) => plan.push({ src, rel: norm(rel), owned });

for (const [id, spec] of Object.entries(publish.engines ?? {})) {
	const built = join(repoRoot, "dist", "engines", id);
	if (!existsSync(join(built, "engine.json"))) {
		console.warn(`skip engine ${id}: not built (run npm run compile)`);
		continue;
	}
	for (const f of walk(built, f => !f.endsWith(".map"))) {
		const r = norm(relative(built, f));
		if (!r.startsWith("conf/")) {
			add(f, `${dataPrefix}engines/${spec.target}/${r}`, true);
		}
	}
	for (const file of spec.conf ?? []) {
		const f = join(built, "conf", file);
		if (existsSync(f)) {
			add(f, `${dataPrefix}conf/${spec.target}/${norm(file)}`);
		} else {
			console.warn(`skip ${id} conf ${file}: not in the build output`);
		}
	}
}
const demo = join(repoRoot, "server", "demo");
for (const entry of publish.data ?? []) {
	const src = join(demo, ...norm(entry).split("/"));
	if (!existsSync(src)) {
		console.warn(`skip ${entry}: not found under server/demo`);
		continue;
	}
	for (const f of statSync(src).isDirectory() ? walk(src) : [src]) {
		add(f, dataPrefix + norm(relative(demo, f)));
	}
}
if (isDistDeployment) {
	for (const [src, dst] of Object.entries(CODE_FILES)) {
		add(join(repoRoot, "server", src), dst, true);
	}
}

// --- apply ---
const manifestPath = join(serverDir, MANIFEST);
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { files: {} };
const ignore = existsSync(join(serverDir, IGNORE))
	? readFileSync(join(serverDir, IGNORE), "utf8")
			.split(/\r?\n/)
			.map(l => norm(l.replace(/#.*/, "").trim()))
			.filter(Boolean)
	: [];
const under = (rel, prefixes) => prefixes.some(p => rel === p || rel.startsWith(p + "/") || rel === dataPrefix + p || rel.startsWith(dataPrefix + p + "/"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = join(serverDir, "backup", `sync-${stamp}`);
const report = { added: [], updated: [], forced: [], same: [], conflicts: [], ignored: [] };

for (const { src, rel, owned } of plan) {
	if (under(rel, ignore)) {
		report.ignored.push(rel);
		continue;
	}
	const dst = join(serverDir, ...rel.split("/"));
	const srcHash = hashOf(src);
	let action;
	if (!existsSync(dst)) {
		action = "added";
	} else {
		const dstHash = hashOf(dst);
		if (dstHash === srcHash) {
			report.same.push(rel);
			manifest.files[rel] = srcHash;
			continue;
		}
		if (manifest.files[rel] === dstHash) {
			action = "updated";
		} else if (owned || under(rel, force)) {
			action = "forced";
		} else {
			report.conflicts.push(rel);
			continue;
		}
	}
	report[action].push(rel);
	if (!dryRun) {
		if (action === "forced") {
			const b = join(backupDir, ...rel.split("/"));
			mkdirSync(dirname(b), { recursive: true });
			copyFileSync(dst, b);
		}
		mkdirSync(dirname(dst), { recursive: true });
		copyFileSync(src, dst);
		manifest.files[rel] = srcHash;
	}
}
if (!dryRun) {
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

const show = (title, list) => {
	if (list.length) {
		console.log(`\n${title} (${list.length}):`);
		for (const r of list) {
			console.log(`  ${r}`);
		}
	}
};
console.log(`${dryRun ? "[dry run] " : ""}sync ${repoRoot} → ${serverDir}`);
show("added", report.added);
show("updated (unchanged on the server since the last sync)", report.updated);
show(`forced (old version backed up to ${relative(serverDir, backupDir)})`, report.forced);
show("CONFLICT — edited on the server, kept; re-run with --force <path> to replace", report.conflicts);
show(`ignored via ${IGNORE}`, report.ignored);
console.log(`\n${report.same.length} identical file(s) skipped.${isDistDeployment ? "" : " (no nvm-engine-install-server.js here: server code not synced)"}`);
if (!dryRun && (report.added.length || report.updated.length || report.forced.length) && isDistDeployment) {
	console.log("Restart the server to load updated code/data. The .exe is NOT rebuilt — use start-nvm-engine-install-server.cmd (node), or rebuild with server/build-server.mjs.");
}
