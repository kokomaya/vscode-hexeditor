// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Inline (flow) part of the YAML subset used by `SKILL.md` frontmatter:
 * quoted strings, plain scalars and nestable `[...]` / `{...}` collections.
 * Pure; nothing is ever executed. See {@link ./frontmatter} for block syntax.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

export class FrontmatterError extends Error {
	constructor(
		message: string,
		public readonly line?: number,
	) {
		super(line !== undefined ? `line ${line}: ${message}` : message);
	}
}

/** Parse an inline value: a flow collection, a quoted string or a plain scalar. */
export function parseFlow(text: string, line?: number): YamlValue {
	const s = text.trim();
	if (s[0] === "[" || s[0] === "{") {
		const fp = new FlowParser(s, line);
		const v = fp.value(true);
		fp.ws();
		if (fp.pos !== s.length) {
			throw new FrontmatterError(`unexpected trailing text in "${s.slice(0, 40)}"`, line);
		}
		return v;
	}
	if (s[0] === '"' || s[0] === "'") {
		const fp = new FlowParser(s, line);
		const v = fp.quoted();
		fp.ws();
		if (fp.pos !== s.length) {
			throw new FrontmatterError("unexpected text after quoted string", line);
		}
		return v;
	}
	return plainScalar(s);
}

function plainScalar(s: string): YamlValue {
	if (s === "" || s === "~" || s === "null") {
		return null;
	}
	if (s === "true") {
		return true;
	}
	if (s === "false") {
		return false;
	}
	// Only plain decimal numbers become numbers; hex ids (0x..) stay strings.
	if (/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) {
		return Number(s);
	}
	return s;
}

class FlowParser {
	public pos = 0;

	constructor(
		private readonly s: string,
		private readonly line?: number,
	) {}

	public ws(): void {
		while (this.pos < this.s.length && /\s/.test(this.s[this.pos])) {
			this.pos++;
		}
	}

	private err(msg: string): never {
		throw new FrontmatterError(`${msg} in "${this.s.slice(0, 60)}"`, this.line);
	}

	public value(top = false): YamlValue {
		this.ws();
		const c = this.s[this.pos];
		if (c === "[") {
			return this.list();
		}
		if (c === "{") {
			return this.map();
		}
		if (c === '"' || c === "'") {
			return this.quoted();
		}
		return this.plain(top);
	}

	public quoted(): string {
		const q = this.s[this.pos++];
		let out = "";
		while (this.pos < this.s.length) {
			const c = this.s[this.pos++];
			if (q === '"' && c === "\\") {
				const e = this.s[this.pos++];
				out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e ?? "";
				continue;
			}
			if (c === q) {
				if (q === "'" && this.s[this.pos] === "'") {
					out += "'";
					this.pos++;
					continue;
				}
				return out;
			}
			out += c;
		}
		return this.err("unterminated string");
	}

	private plain(top: boolean): YamlValue {
		const start = this.pos;
		while (this.pos < this.s.length) {
			const c = this.s[this.pos];
			if (!top && (c === "," || c === "]" || c === "}")) {
				break;
			}
			if (!top && c === ":" && /\s/.test(this.s[this.pos + 1] ?? " ")) {
				break;
			}
			this.pos++;
		}
		return plainScalar(this.s.slice(start, this.pos).trim());
	}

	private list(): YamlValue[] {
		this.pos++; // [
		const out: YamlValue[] = [];
		this.ws();
		if (this.s[this.pos] === "]") {
			this.pos++;
			return out;
		}
		for (;;) {
			out.push(this.value());
			this.ws();
			const c = this.s[this.pos++];
			if (c === "]") {
				return out;
			}
			if (c !== ",") {
				this.err("expected ',' or ']'");
			}
			this.ws();
			if (this.s[this.pos] === "]") {
				this.pos++;
				return out; // trailing comma
			}
		}
	}

	private map(): { [k: string]: YamlValue } {
		this.pos++; // {
		const out: { [k: string]: YamlValue } = {};
		this.ws();
		if (this.s[this.pos] === "}") {
			this.pos++;
			return out;
		}
		for (;;) {
			this.ws();
			let key: string;
			if (this.s[this.pos] === '"' || this.s[this.pos] === "'") {
				key = this.quoted();
			} else {
				const start = this.pos;
				while (this.pos < this.s.length && this.s[this.pos] !== ":" && this.s[this.pos] !== "}") {
					this.pos++;
				}
				key = this.s.slice(start, this.pos).trim();
			}
			this.ws();
			if (this.s[this.pos] !== ":") {
				this.err("expected ':' in flow map");
			}
			this.pos++;
			out[key] = this.value();
			this.ws();
			const c = this.s[this.pos++];
			if (c === "}") {
				return out;
			}
			if (c !== ",") {
				this.err("expected ',' or '}'");
			}
			this.ws();
			if (this.s[this.pos] === "}") {
				this.pos++;
				return out;
			}
		}
	}
}
