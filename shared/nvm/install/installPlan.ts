// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Decides what to install from a server for one product / platform / project.
 *
 * A level's `level.json` may bind an engine (`"engine": "vector/fee-v3"`) and
 * descriptors (`"conf": [...]`). Bindings are inherited down the hierarchy and
 * the nearest level that sets a field wins — so a platform can fix the AUTOSAR
 * stack for all its projects and a project can still override it. Engines the
 * chosen descriptors reference are added too, so a descriptor never arrives
 * without its engine.
 */

import { formatHierarchyPath, hierarchyContexts, HierarchyLevel, levelOf, visibleIn } from "../skills/hierarchy";
import { RemoteLevel, RemoteSkill, SkillListing } from "../skills/remoteSkills";
import { EngineListing, findEngine, RemoteEngine } from "./remoteEngines";
import { RemoteConfig } from "./remoteConfigs";

export interface ServerCatalog {
	engines: EngineListing;
	configs: RemoteConfig[];
	skills: SkillListing;
}

export interface ProjectBinding {
	engines: string[];
	configs: string[];
	/** The level each field came from (undefined = no level sets it). */
	enginesFrom?: string[];
	configsFrom?: string[];
}

export interface InstallTarget {
	context: string[];
	level: HierarchyLevel;
	/** Display path, using level titles ("雷达 Radar › chipA › customerB"). */
	title: string;
	description: string;
	binding: ProjectBinding;
	skills: number;
}

export interface InstallPlan {
	engines: RemoteEngine[];
	configs: RemoteConfig[];
	skills: RemoteSkill[];
	/** References the server cannot satisfy, e.g. "engine vector/fee-v4". */
	missing: string[];
}

/** The binding in effect for `context`: per field, the nearest level that sets it. */
export function bindingFor(levels: readonly RemoteLevel[], context: readonly string[]): ProjectBinding {
	const byPath = new Map(levels.map(l => [formatHierarchyPath(l.path), l]));
	const out: ProjectBinding = { engines: [], configs: [] };
	for (let i = context.length; i > 0; i--) {
		const level = byPath.get(formatHierarchyPath(context.slice(0, i)));
		if (level?.engines && !out.enginesFrom) {
			out.engines = level.engines;
			out.enginesFrom = level.path;
		}
		if (level?.configs && !out.configsFrom) {
			out.configs = level.configs;
			out.configsFrom = level.path;
		}
	}
	return out;
}

/** Every product / platform / project on the server, as install choices. */
export function installTargets(catalog: ServerCatalog): InstallTarget[] {
	const { levels, skills } = catalog.skills;
	const titles = new Map(levels.map(l => [formatHierarchyPath(l.path), l]));
	const paths = hierarchyContexts([...levels.map(l => l.path), ...skills.map(s => s.path)]);
	return paths.map(context => ({
		context,
		level: levelOf(context),
		title: context.map((_, i) => titles.get(formatHierarchyPath(context.slice(0, i + 1)))?.title ?? context[i]).join(" › "),
		description: titles.get(formatHierarchyPath(context))?.description ?? "",
		binding: bindingFor(levels, context),
		skills: skills.filter(s => visibleIn(s.path, context)).length,
	}));
}

/**
 * What to install for `context`, or for everything on the server when
 * `context` is undefined. Descriptors = the binding's `conf` plus those that
 * declare this exact `skillContext`; engines = the binding's `engine` plus
 * every engine those descriptors use; skills = those visible in the context.
 */
export function planInstall(catalog: ServerCatalog, context?: readonly string[]): InstallPlan {
	const missing: string[] = [];
	if (!context) {
		return { engines: catalog.engines.engines, configs: catalog.configs, skills: catalog.skills.skills, missing };
	}
	const binding = bindingFor(catalog.skills.levels, context);
	const key = formatHierarchyPath(context);
	const configs = new Map<string, RemoteConfig>();
	for (const path of binding.configs) {
		const found = catalog.configs.find(c => c.path === path);
		if (found) {
			configs.set(found.path, found);
		} else {
			missing.push(`conf ${path}`);
		}
	}
	for (const c of catalog.configs) {
		if (c.skillContext === key) {
			configs.set(c.path, c);
		}
	}
	const engines = new Map<string, RemoteEngine>();
	for (const ref of [...binding.engines, ...[...configs.values()].flatMap(c => c.engines)]) {
		const found = findEngine(catalog.engines.engines, ref);
		if (found) {
			engines.set(found.id, found);
		} else if (!missing.includes(`engine ${ref}`)) {
			missing.push(`engine ${ref}`);
		}
	}
	return {
		engines: [...engines.values()],
		configs: [...configs.values()],
		skills: catalog.skills.skills.filter(s => visibleIn(s.path, context)),
		missing,
	};
}
