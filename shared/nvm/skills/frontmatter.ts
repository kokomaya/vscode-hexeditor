// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Safe, dependency-free YAML **subset** parser for `SKILL.md` frontmatter.
 *
 * Supported (enough for every field in docs/features/skills.md):
 * - `key: scalar` (plain / "double" / 'single' quoted; numbers, true/false, null)
 * - nested block maps by indentation
 * - block lists (`- item`), including list items that are maps (`- id: x`)
 * - flow collections: `[a, "b", 3]`, `{ a: 1, b: [x, y] }` (nestable)
 * - folded (`>`) and literal (`|`) block scalars (with optional `-`/`+` chomping)
 * - `# comments` outside quotes
 *
 * Deliberately NOT supported: anchors/aliases, tags, multi-documents, complex
 * keys. Nothing is ever executed. Errors throw {@link FrontmatterError} with a
 * 1-based line number so the registry can surface a precise diagnostic.
 */

import { FrontmatterError, parseFlow, YamlValue } from "./yamlFlow";

export { FrontmatterError } from "./yamlFlow";
export type { YamlValue } from "./yamlFlow";

/** Split a `SKILL.md` into its frontmatter text and Markdown body. */
export function splitFrontmatter(text: string): { frontmatter?: string; body: string; bodyLine: number } {
	const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const m = /^---[ \t]*\r?\n/.exec(src);
	if (!m) {
		return { body: src, bodyLine: 1 };
	}
	const rest = src.slice(m[0].length);
	const end = /^---[ \t]*(\r?\n|$)/m.exec(rest);
	if (!end) {
		throw new FrontmatterError("frontmatter is not closed with '---'", 1);
	}
	const frontmatter = rest.slice(0, end.index);
	const body = rest.slice(end.index + end[0].length);
	const bodyLine = frontmatter.split(/\r?\n/).length + 2;
	return { frontmatter, body, bodyLine };
}

/** Parse a YAML-subset document into a plain object. */
export function parseYamlSubset(text: string, lineOffset = 1): { [k: string]: YamlValue } {
	const p = new BlockParser(text.split(/\r?\n/), lineOffset);
	const value = p.parseDocument();
	if (value === null) {
		return {};
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new FrontmatterError("frontmatter must be a key/value map", lineOffset);
	}
	return value;
}

/** Remove a trailing `# comment` that is outside quotes/brackets-strings. */
function stripComment(s: string): string {
	let quote: string | undefined;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quote) {
			if (c === "\\" && quote === '"') {
				i++;
			} else if (c === quote) {
				quote = undefined;
			}
			continue;
		}
		if (c === '"' || c === "'") {
			quote = c;
		} else if (c === "#" && (i === 0 || s[i - 1] === " " || s[i - 1] === "\t")) {
			return s.slice(0, i).trimEnd();
		}
	}
	return s.trimEnd();
}

function indentOf(raw: string): number {
	let i = 0;
	while (i < raw.length && raw[i] === " ") {
		i++;
	}
	if (raw[i] === "\t") {
		// Tabs are not valid YAML indentation; reported by the caller.
		return -1;
	}
	return i;
}

class BlockParser {
	private i = 0;

	constructor(
		private readonly lines: string[],
		private readonly lineOffset: number,
	) {}

	private lineNo(idx: number): number {
		return idx + this.lineOffset;
	}

	private content(idx: number): string {
		return stripComment(this.lines[idx]).trim();
	}

	/** Index of the next line with content (skipping blanks/comments), or -1. */
	private nextContent(from: number): number {
		for (let k = from; k < this.lines.length; k++) {
			if (this.content(k) !== "") {
				return k;
			}
		}
		return -1;
	}

	public parseDocument(): YamlValue {
		const first = this.nextContent(0);
		if (first < 0) {
			return null;
		}
		const ind = indentOf(this.lines[first]);
		if (ind < 0) {
			throw new FrontmatterError("tab indentation is not allowed", this.lineNo(first));
		}
		this.i = first;
		const v = this.parseNode(ind);
		const trailing = this.nextContent(this.i);
		if (trailing >= 0) {
			throw new FrontmatterError("unexpected content (check indentation)", this.lineNo(trailing));
		}
		return v;
	}

	private parseNode(indent: number): YamlValue {
		const k = this.nextContent(this.i);
		if (k < 0) {
			return null;
		}
		const c = this.content(k);
		return c === "-" || c.startsWith("- ") ? this.parseList(indent) : this.parseMap(indent);
	}

	private parseMap(indent: number): { [k: string]: YamlValue } {
		const out: { [k: string]: YamlValue } = {};
		for (;;) {
			const k = this.nextContent(this.i);
			if (k < 0) {
				this.i = this.lines.length;
				break;
			}
			const ind = indentOf(this.lines[k]);
			if (ind < 0) {
				throw new FrontmatterError("tab indentation is not allowed", this.lineNo(k));
			}
			if (ind < indent) {
				this.i = k;
				break;
			}
			if (ind > indent) {
				throw new FrontmatterError("unexpected indentation", this.lineNo(k));
			}
			const c = this.content(k);
			if (c === "-" || c.startsWith("- ")) {
				// A list at the same indent ends this map (owned by the parent key).
				this.i = k;
				break;
			}
			const { key, rest } = splitKey(c, this.lineNo(k));
			if (Object.prototype.hasOwnProperty.call(out, key)) {
				throw new FrontmatterError(`duplicate key "${key}"`, this.lineNo(k));
			}
			this.i = k + 1;
			if (rest === "") {
				const n = this.nextContent(this.i);
				if (n >= 0) {
					const nInd = indentOf(this.lines[n]);
					const nc = this.content(n);
					const isList = nc === "-" || nc.startsWith("- ");
					if (nInd > indent || (nInd === indent && isList)) {
						this.i = n;
						out[key] = this.parseNode(nInd);
						continue;
					}
				}
				out[key] = null;
			} else if (/^[>|][-+]?$/.test(rest)) {
				out[key] = this.parseBlockScalar(rest, indent);
			} else {
				out[key] = parseFlow(rest, this.lineNo(k));
			}
		}
		return out;
	}

	private parseList(indent: number): YamlValue[] {
		const out: YamlValue[] = [];
		for (;;) {
			const k = this.nextContent(this.i);
			if (k < 0) {
				this.i = this.lines.length;
				break;
			}
			const ind = indentOf(this.lines[k]);
			const c = this.content(k);
			if (ind < indent || !(c === "-" || c.startsWith("- "))) {
				if (ind > indent) {
					throw new FrontmatterError("unexpected indentation in list", this.lineNo(k));
				}
				this.i = k;
				break;
			}
			if (ind > indent) {
				throw new FrontmatterError("unexpected indentation in list", this.lineNo(k));
			}
			const raw = this.lines[k];
			const dash = raw.indexOf("-");
			const afterDash = raw.slice(dash + 1);
			const itemText = stripComment(afterDash).trim();
			if (itemText === "") {
				this.i = k + 1;
				const n = this.nextContent(this.i);
				if (n >= 0 && indentOf(this.lines[n]) > indent) {
					this.i = n;
					out.push(this.parseNode(indentOf(this.lines[n])));
				} else {
					out.push(null);
				}
				continue;
			}
			const lead = afterDash.length - afterDash.trimStart().length;
			const itemIndent = dash + 1 + lead;
			if (looksLikeMapEntry(itemText)) {
				// Re-indent the "- key: v" line as "  key: v" and parse a map there.
				this.lines[k] = " ".repeat(itemIndent) + afterDash.trimStart();
				this.i = k;
				out.push(this.parseMap(itemIndent));
				continue;
			}
			this.i = k + 1;
			if (/^[>|][-+]?$/.test(itemText)) {
				out.push(this.parseBlockScalar(itemText, indent));
			} else {
				out.push(parseFlow(itemText, this.lineNo(k)));
			}
		}
		return out;
	}

	/** `>` folds lines with spaces (blank line = newline); `|` keeps newlines. */
	private parseBlockScalar(header: string, parentIndent: number): string {
		const folded = header[0] === ">";
		const chomp = header[1];
		const collected: string[] = [];
		let blockIndent = -1;
		let k = this.i;
		for (; k < this.lines.length; k++) {
			const raw = this.lines[k];
			if (raw.trim() === "") {
				collected.push("");
				continue;
			}
			const ind = indentOf(raw);
			if (ind <= parentIndent) {
				break;
			}
			if (blockIndent < 0) {
				blockIndent = ind;
			}
			collected.push(raw.slice(Math.min(ind, blockIndent)));
		}
		this.i = k;
		// Trailing blank lines are not part of the scalar unless "+" chomping.
		while (chomp !== "+" && collected.length && collected[collected.length - 1] === "") {
			collected.pop();
		}
		let text: string;
		if (folded) {
			text = "";
			for (let j = 0; j < collected.length; j++) {
				const line = collected[j];
				if (line === "") {
					text += "\n";
				} else {
					text += text === "" || text.endsWith("\n") ? line : ` ${line}`;
				}
			}
		} else {
			text = collected.join("\n");
		}
		return chomp === "-" ? text : `${text}\n`.replace(/\n+$/, chomp === "+" ? "\n" : "");
	}
}

/** `key: rest` — the key may be quoted and may contain `[]`, `.`, `-`, CJK, …. */
function splitKey(c: string, line: number): { key: string; rest: string } {
	if (c[0] === '"' || c[0] === "'") {
		const end = c.indexOf(c[0], 1);
		if (end < 0 || c[end + 1] !== ":") {
			throw new FrontmatterError("malformed quoted key", line);
		}
		return { key: c.slice(1, end), rest: c.slice(end + 2).trim() };
	}
	for (let j = 0; j < c.length; j++) {
		if (c[j] === ":" && (j === c.length - 1 || c[j + 1] === " " || c[j + 1] === "\t")) {
			const key = c.slice(0, j).trim();
			if (!key) {
				break;
			}
			return { key, rest: c.slice(j + 1).trim() };
		}
	}
	throw new FrontmatterError(`expected "key: value" but got "${c.slice(0, 40)}"`, line);
}

function looksLikeMapEntry(s: string): boolean {
	if (s[0] === "[" || s[0] === "{") {
		return false;
	}
	if (s[0] === '"' || s[0] === "'") {
		const end = s.indexOf(s[0], 1);
		return end > 0 && s[end + 1] === ":";
	}
	return /^[^:]+:(\s|$)/.test(s);
}
