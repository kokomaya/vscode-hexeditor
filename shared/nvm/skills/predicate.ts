// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Whitelisted predicate / expression evaluator for skill rules, relations and
 * the ad-hoc `nvm_evaluate` tool. Like `expr.ts` it never uses `eval`; unlike
 * it, it understands comparisons, logic, strings and field PATHS:
 *
 *   Counter >= HistoryIdx
 *   (Status & 0x08) != 0 && exists(FreezeFrame)
 *   self.Counter == other.Counter
 *   $sequence > other.$sequence
 *   count(History[]) <= 8 && sum(Errors[].Count) < 100
 *
 * Identifiers are resolved through a caller-supplied {@link PredicateScope};
 * an unknown identifier raises {@link PredicateError} so a rule is reported as
 * "not evaluable" rather than silently passing.
 */

import { globRegExp } from "./match";
import type { Scalar } from "./paths";

export class PredicateError extends Error {}

/** How identifiers / paths are resolved. */
export interface PredicateScope {
	/** Single value for a path (`undefined` = unknown → error). */
	value(path: string): Scalar | undefined;
	/** Every value a (wildcard) path matches — for count/sum/exists/any/all. */
	values(path: string): Scalar[];
	/** Display label of a path (enum label when present, else the value as text). */
	label?(path: string): string | undefined;
}

type Tok =
	| { k: "num"; v: number }
	| { k: "str"; v: string }
	| { k: "id"; v: string }
	| { k: "op"; v: string };

const OPS = ["==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "<", ">", "!", "+", "-", "*", "/", "%", "&", "|", "^", "~", "(", ")", ","];

function lex(src: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (/[0-9]/.test(c)) {
			const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+(\.\d+)?([eE][-+]?\d+)?)/.exec(src.slice(i))!;
			const t = m[0];
			out.push({ k: "num", v: /^0[bB]/.test(t) ? parseInt(t.slice(2), 2) : Number(t) });
			i += t.length;
			continue;
		}
		if (c === '"' || c === "'") {
			const end = src.indexOf(c, i + 1);
			if (end < 0) {
				throw new PredicateError("unterminated string literal");
			}
			out.push({ k: "str", v: src.slice(i + 1, end) });
			i = end + 1;
			continue;
		}
		if (/[A-Za-z_$]/.test(c)) {
			// A path: ident ( .ident | [n] | [] )*
			const m = /^[A-Za-z_$][\w$]*(\s*(\.[A-Za-z_$][\w$]*|\[\d*\]))*/.exec(src.slice(i))!;
			out.push({ k: "id", v: m[0].replace(/\s+/g, "") });
			i += m[0].length;
			continue;
		}
		const op = OPS.find(o => src.startsWith(o, i));
		if (!op) {
			throw new PredicateError(`unexpected character "${c}"`);
		}
		out.push({ k: "op", v: op });
		i += op.length;
	}
	return out;
}

/** Resolves everything to 0 — used for syntax checks and skipped branches. */
const SILENT_SCOPE: PredicateScope = { value: () => 0, values: () => [] };

const KEYWORDS: Record<string, Scalar> = { true: true, false: false };
const WORD_OPS: Record<string, string> = { and: "&&", or: "||", not: "!" };

/** Truthiness used by rules: non-zero number, `true`, non-empty string. */
export function truthy(v: Scalar | undefined): boolean {
	return typeof v === "string" ? v.length > 0 : !!v;
}

function toNum(v: Scalar, what: string): number {
	if (typeof v === "number") {
		return v;
	}
	if (typeof v === "boolean") {
		return v ? 1 : 0;
	}
	const n = Number(v);
	if (!Number.isFinite(n)) {
		throw new PredicateError(`${what}: "${v}" is not a number`);
	}
	return n;
}

function eq(a: Scalar, b: Scalar): boolean {
	if (typeof a === "string" || typeof b === "string") {
		const na = Number(a);
		const nb = Number(b);
		if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== "" && String(b).trim() !== "") {
			return na === nb;
		}
		return String(a).toLowerCase() === String(b).toLowerCase();
	}
	return toNum(a, "==") === toNum(b, "==");
}

const BIN_PREC: Record<string, number> = {
	"||": 1,
	"&&": 2,
	"==": 3,
	"!=": 3,
	"<": 4,
	"<=": 4,
	">": 4,
	">=": 4,
	"|": 5,
	"^": 6,
	"&": 7,
	"<<": 8,
	">>": 8,
	"+": 9,
	"-": 9,
	"*": 10,
	"/": 10,
	"%": 10,
};

class Evaluator {
	private p = 0;
	private readonly t: Tok[];

	constructor(
		tokens: Tok[],
		private scope: PredicateScope,
	) {
		this.t = tokens.map(x =>
			x.k === "id" && WORD_OPS[x.v.toLowerCase()] ? { k: "op", v: WORD_OPS[x.v.toLowerCase()] } : x,
		);
	}

	public run(): Scalar {
		const v = this.expr(0);
		if (this.p !== this.t.length) {
			throw new PredicateError("unexpected trailing tokens");
		}
		return v;
	}

	private peekOp(): string | undefined {
		const x = this.t[this.p];
		return x?.k === "op" ? x.v : undefined;
	}

	private expect(op: string): void {
		if (this.peekOp() !== op) {
			throw new PredicateError(`expected "${op}"`);
		}
		this.p++;
	}

	private expr(min: number): Scalar {
		let left = this.unary();
		for (;;) {
			const op = this.peekOp();
			const prec = op ? BIN_PREC[op] : undefined;
			if (!op || prec === undefined || prec < min) {
				return left;
			}
			this.p++;
			// Short-circuit logic so `exists(x) && x > 0` is safe.
			if (op === "&&" && !truthy(left)) {
				this.skip(prec + 1);
				left = false;
				continue;
			}
			if (op === "||" && truthy(left)) {
				this.skip(prec + 1);
				left = true;
				continue;
			}
			const right = this.expr(prec + 1);
			left = this.binary(op, left, right);
		}
	}

	/** Parse-but-discard the right operand of a short-circuited operator. */
	private skip(min: number): void {
		const saved = this.scope;
		this.scope = SILENT_SCOPE;
		try {
			this.expr(min);
		} catch {
			// The discarded branch may be ill-typed for these values; only syntax matters.
		} finally {
			this.scope = saved;
		}
	}

	private binary(op: string, a: Scalar, b: Scalar): Scalar {
		switch (op) {
			case "&&":
				return truthy(a) && truthy(b);
			case "||":
				return truthy(a) || truthy(b);
			case "==":
				return eq(a, b);
			case "!=":
				return !eq(a, b);
			case "<":
				return toNum(a, op) < toNum(b, op);
			case "<=":
				return toNum(a, op) <= toNum(b, op);
			case ">":
				return toNum(a, op) > toNum(b, op);
			case ">=":
				return toNum(a, op) >= toNum(b, op);
			case "+":
				return typeof a === "string" && !Number.isFinite(Number(a)) ? `${a}${b}` : toNum(a, op) + toNum(b, op);
			case "-":
				return toNum(a, op) - toNum(b, op);
			case "*":
				return toNum(a, op) * toNum(b, op);
			case "/": {
				const d = toNum(b, op);
				if (d === 0) {
					throw new PredicateError("division by zero");
				}
				return toNum(a, op) / d;
			}
			case "%":
				return toNum(a, op) % toNum(b, op);
			case "&":
				return Number(BigInt.asUintN(64, BigInt(Math.trunc(toNum(a, op))) & BigInt(Math.trunc(toNum(b, op)))));
			case "|":
				return Number(BigInt.asUintN(64, BigInt(Math.trunc(toNum(a, op))) | BigInt(Math.trunc(toNum(b, op)))));
			case "^":
				return Number(BigInt.asUintN(64, BigInt(Math.trunc(toNum(a, op))) ^ BigInt(Math.trunc(toNum(b, op)))));
			case "<<":
				return toNum(a, op) * 2 ** toNum(b, op);
			case ">>":
				return Math.floor(toNum(a, op) / 2 ** toNum(b, op));
		}
		throw new PredicateError(`unknown operator ${op}`);
	}

	private unary(): Scalar {
		const op = this.peekOp();
		if (op === "!") {
			this.p++;
			return !truthy(this.unary());
		}
		if (op === "-") {
			this.p++;
			return -toNum(this.unary(), "-");
		}
		if (op === "~") {
			this.p++;
			return Number(BigInt.asUintN(32, ~BigInt(Math.trunc(toNum(this.unary(), "~")))));
		}
		return this.primary();
	}

	private primary(): Scalar {
		const x = this.t[this.p++];
		if (!x) {
			throw new PredicateError("unexpected end of expression");
		}
		if (x.k === "num" || x.k === "str") {
			return x.v;
		}
		if (x.k === "op") {
			if (x.v === "(") {
				const v = this.expr(0);
				this.expect(")");
				return v;
			}
			throw new PredicateError(`unexpected "${x.v}"`);
		}
		if (this.peekOp() === "(") {
			return this.call(x.v);
		}
		const kw = KEYWORDS[x.v.toLowerCase()];
		if (kw !== undefined) {
			return kw;
		}
		const v = this.scope.value(x.v);
		if (v === undefined) {
			throw new PredicateError(`unknown field "${x.v}"`);
		}
		return v;
	}

	/** Functions taking a PATH argument are resolved over all matches. */
	private call(name: string): Scalar {
		this.expect("(");
		const fn = name.toLowerCase();
		if (fn === "label") {
			// label(path): the enum label (or value text) — compare symbolic names, not raw ints.
			const t = this.t[this.p++];
			if (!t || t.k !== "id") {
				throw new PredicateError("label() expects a field path");
			}
			this.expect(")");
			const l = this.scope.label ? this.scope.label(t.v) : undefined;
			const v = l ?? this.scope.value(t.v);
			if (v === undefined) {
				throw new PredicateError(`unknown field "${t.v}"`);
			}
			return String(v);
		}
		const pathFns = ["exists", "count", "sum", "any", "all", "distinct"];
		if (pathFns.includes(fn)) {
			const t = this.t[this.p++];
			if (!t || t.k !== "id") {
				throw new PredicateError(`${fn}() expects a field path`);
			}
			this.expect(")");
			const vals = this.scope.values(t.v);
			switch (fn) {
				case "exists":
					return vals.length > 0;
				case "count":
					return vals.length;
				case "sum":
					return vals.reduce<number>((s, v) => s + toNum(v, "sum"), 0);
				case "any":
					return vals.some(truthy);
				case "all":
					return vals.length > 0 && vals.every(truthy);
				case "distinct":
					return new Set(vals.map(v => String(v))).size;
			}
		}
		const args: Scalar[] = [];
		if (this.peekOp() !== ")") {
			args.push(this.expr(0));
			while (this.peekOp() === ",") {
				this.p++;
				args.push(this.expr(0));
			}
		}
		this.expect(")");
		const nums = () => args.map(a => toNum(a, fn));
		switch (fn) {
			case "min":
				return Math.min(...nums());
			case "max":
				return Math.max(...nums());
			case "abs":
				return Math.abs(nums()[0] ?? 0);
			case "bit": {
				// bit(value, n) → 0/1
				const [v, n] = nums();
				return Math.floor(v / 2 ** n) % 2;
			}
			case "contains":
				return String(args[0] ?? "").toLowerCase().includes(String(args[1] ?? "").toLowerCase());
			case "glob":
				// glob(text, "FS_RESET_ECC*") — case-insensitive `*`/`?` match.
				return globRegExp(String(args[1] ?? "")).test(String(args[0] ?? ""));
			case "trailingnumber": {
				// trailingNumber("Record2") → 2 (e.g. a slot number encoded in a block name).
				const m = /(\d+)\s*$/.exec(String(args[0] ?? ""));
				if (!m) {
					throw new PredicateError(`trailingNumber(): "${args[0]}" has no trailing number`);
				}
				return Number(m[1]);
			}
		}
		throw new PredicateError(`unknown function "${name}"`);
	}
}

/** Evaluate an expression. Throws {@link PredicateError} on bad syntax / unknown fields. */
export function evaluatePredicate(expression: string, scope: PredicateScope): Scalar {
	return new Evaluator(lex(expression), scope).run();
}

/** Syntax check only (no scope needed). Returns an error message or undefined. */
export function checkPredicateSyntax(expression: string): string | undefined {
	try {
		new Evaluator(lex(expression), { value: () => 0, values: () => [] }).run();
		return undefined;
	} catch (e) {
		return e instanceof PredicateError ? e.message : String(e);
	}
}
