// Copy engine packs built by `npm run compile` (dist/engines/<id>/) into a
// server data root:
//
//   dist/engines/vector-fee-v3/              → engines/vector/fee-v3/      (pack, without conf/ and *.map)
//   dist/engines/vector-fee-v3/conf/*.json   → conf/vector/fee-v3/         (the engine's standard descriptors)
//
//   node server/demo/sync-engines.mjs [dataRoot]      (default: server/demo)
//
// dist is the source of truth: both target folders are replaced. A pack still
// sitting in the old layout (engines/<id>/<version>/) is removed, otherwise it
// would be listed twice. Add a line to ENGINE_FOLDERS for another engine pack.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** dist/engines/<built id> → <vendor>/<layout> on the server. */
const ENGINE_FOLDERS = {
	"vector-fee-v3": "vector/fee-v3",
};

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dataRoot = resolve(process.argv[2] || join(repoRoot, "server", "demo"));
const built = join(repoRoot, "dist", "engines");

function replaceWith(dest, copy) {
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dest, { recursive: true });
	copy(dest);
}

let copied = 0;
for (const [id, target] of Object.entries(ENGINE_FOLDERS)) {
	const src = join(built, id);
	if (!existsSync(join(src, "engine.json"))) {
		console.warn(`skip ${id}: ${src} not built (run npm run compile)`);
		continue;
	}
	const parts = target.split("/");
	const confSrc = join(src, "conf");

	const engineDest = join(dataRoot, "engines", ...parts);
	replaceWith(engineDest, dest => {
		for (const name of readdirSync(src).filter(n => n !== "conf" && !n.endsWith(".map"))) {
			cpSync(join(src, name), join(dest, name), { recursive: true });
		}
	});
	console.log(`engine ${id} → engines/${target}`);

	if (existsSync(confSrc)) {
		const confDest = join(dataRoot, "conf", ...parts);
		replaceWith(confDest, dest => {
			for (const name of readdirSync(confSrc).filter(n => n.toLowerCase().endsWith(".nvmlayout.json"))) {
				cpSync(join(confSrc, name), join(dest, name));
				console.log(`conf   ${name} → conf/${target}/`);
			}
		});
	}

	// Old layout: engines/<id>/<version>/ and the descriptors that used to sit directly in conf/.
	const legacy = join(dataRoot, "engines", id);
	if (id !== parts[0] && existsSync(legacy)) {
		rmSync(legacy, { recursive: true, force: true });
		console.log(`removed old engines/${id}/ (now engines/${target}/)`);
	}
	for (const name of existsSync(confSrc) ? readdirSync(confSrc) : []) {
		const old = join(dataRoot, "conf", name);
		if (name.toLowerCase().endsWith(".nvmlayout.json") && existsSync(old)) {
			rmSync(old);
			console.log(`removed old conf/${name} (now conf/${target}/${name})`);
		}
	}
	copied++;
}
console.log(`${copied} engine pack(s) synced into ${dataRoot}`);
