// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Fetch everything an install server offers (engines, layout descriptors,
 * skills + project bindings) in one go. A server may serve only some kinds;
 * a failed listing becomes an empty one plus an error line.
 */

import { ServerCatalog } from "../../../shared/nvm/install/installPlan";
import { parseConfigListing } from "../../../shared/nvm/install/remoteConfigs";
import { parseEngineListing } from "../../../shared/nvm/install/remoteEngines";
import { parseSkillListing } from "../../../shared/nvm/skills/remoteSkills";
import { rememberServerLevels } from "../skills/contextMemory";
import { fetchJson } from "./download";

export async function fetchCatalog(base: string): Promise<{ catalog: ServerCatalog; errors: string[] }> {
	const [engines, configs, skills] = await Promise.allSettled([
		fetchJson(`${base}/v1/engines`),
		fetchJson(`${base}/v1/configs`),
		fetchJson(`${base}/v1/skills`),
	]);
	const errors: string[] = [];
	const value = (name: string, r: PromiseSettledResult<unknown>) => {
		if (r.status === "fulfilled") {
			return r.value;
		}
		errors.push(`${name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
		return undefined;
	};
	const catalog: ServerCatalog = {
		engines: parseEngineListing(value("engines", engines)),
		configs: parseConfigListing(value("configs", configs)),
		skills: parseSkillListing(value("skills", skills)),
	};
	rememberServerLevels(catalog.skills.levels, catalog.skills.skills);
	return { catalog, errors };
}
