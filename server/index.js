"use strict";

/**
 * NVM Studio install server: one data root, three kinds of content, each
 * served by its own route module.
 *
 *   <root>/engines/<vendor>/[<layout>/]   engine packs        → engines.js
 *   <root>/conf/**\/*.nvmlayout.json       layout descriptors  → configs.js
 *   <root>/skills/<product>/<platform>/<project>/<skill>/
 *                                         skills + project bindings (level.json) → skills.js
 *
 * Root = NVM_ENGINE_REGISTRY_HOME, or the current working directory. See
 * `server/demo/` for a ready-to-run example root.
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfigRoutes } = require("./configs");
const { createEngineRoutes } = require("./engines");
const { createSkillRoutes } = require("./skills");

const HOST = process.env.NVM_ENGINE_SERVER_HOST || "127.0.0.1";
const PORT = Number(process.env.NVM_ENGINE_SERVER_PORT || 7788);
const DATA_ROOT = path.resolve(process.env.NVM_ENGINE_REGISTRY_HOME || process.cwd());
const ADMIN_TOKEN = process.env.NVM_ENGINE_SERVER_ADMIN_TOKEN || "";
const MAX_BODY_BYTES = 10 * 1024 * 1024;

function json(res, statusCode, payload) {
	const body = Buffer.from(JSON.stringify(payload, null, 2));
	res.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": body.length,
	});
	res.end(body);
}

function baseUrl(req) {
	return `http://${req.headers.host || `${HOST}:${PORT}`}`;
}

async function readBody(req) {
	let total = 0;
	const chunks = [];
	for await (const chunk of req) {
		total += chunk.length;
		if (total > MAX_BODY_BYTES) {
			throw new Error(`Request body too large. Limit is ${MAX_BODY_BYTES} bytes.`);
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function requireAdmin(req) {
	if (!ADMIN_TOKEN) {
		return { ok: false, reason: "Admin token is not configured on server." };
	}
	return req.headers["x-api-token"] === ADMIN_TOKEN ? { ok: true } : { ok: false, reason: "Invalid admin token." };
}

function createServer(root = DATA_ROOT) {
	const deps = { json, readBody, requireAdmin, baseUrl };
	const routes = [
		createEngineRoutes({ ...deps, root: path.join(root, "engines") }),
		createConfigRoutes({ ...deps, root: path.join(root, "conf") }),
		createSkillRoutes({ ...deps, root: path.join(root, "skills") }),
	];
	return http.createServer(async (req, res) => {
		const method = req.method || "GET";
		const url = new URL(req.url || "/", baseUrl(req));
		try {
			if (method === "GET" && url.pathname === "/health") {
				return json(res, 200, { ok: true, name: "nvm-engine-install-server", port: PORT, dataRoot: root, time: new Date().toISOString() });
			}
			for (const route of routes) {
				if (await route(req, res, method, url.pathname, url)) {
					return;
				}
			}
			return json(res, 404, { error: `Route not found: ${method} ${url.pathname}` });
		} catch (error) {
			return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	});
}

function startServer() {
	createServer().listen(PORT, HOST, () => {
		// eslint-disable-next-line no-console
		console.log(`NVM engine install server listening on http://${HOST}:${PORT}`);
		// eslint-disable-next-line no-console
		console.log(`Data root: ${DATA_ROOT}`);
		if (!["engines", "conf", "skills"].some(d => fs.existsSync(path.join(DATA_ROOT, d)))) {
			// eslint-disable-next-line no-console
			console.warn(
				`WARNING: the data root has no engines/, conf/ or skills/ folder — every listing will be empty.\n` +
					`         Check NVM_ENGINE_REGISTRY_HOME (currently ${process.env.NVM_ENGINE_REGISTRY_HOME || "not set"}).`,
			);
		}
	});
}

if (require.main === module) {
	startServer();
}

module.exports = { createServer, startServer };
