// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Generates the synthetic, vendor-neutral sample dump shipped in
 * `samples/basic-log/` (for the walkthrough and for practising without real
 * project data). Format = the structured profile in `sample.nvmlayout.json`:
 *
 *   header: id u16 | len u16 | ver u16 | stat u16   (little endian)
 *   payload: `len` bytes, then a CRC16-CCITT-FALSE trailer over header+payload
 *   blocks aligned to 8 bytes; 0xFFFF id terminates the log; rest erased (0xFF)
 *
 * Usage: npx esbuild tools/makeSampleDump.ts --bundle --platform=node --outfile=out/makeSample.js
 *        node out/makeSample.js samples/basic-log/sample-nvm.mot
 */

import * as fs from "fs";
import { computeCrc, crcPresets } from "../shared/nvm/crc";

const IMAGE_BASE = 0x10000;
const IMAGE_SIZE = 4096;
const ALIGN = 8;

interface Write {
	id: number;
	payload: number[];
	/** Corrupt the stored CRC (to demonstrate an integrity finding). */
	badCrc?: boolean;
}

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [...u16(v & 0xffff), ...u16(v >>> 16)];

/** A small story: resets accumulate, a DTC appears, calibration is rewritten. */
function writes(): Write[] {
	const out: Write[] = [];
	const resetCounter = (n: number, reason: number) => ({ id: 0x10, payload: [...u32(n), reason, 0, 0, 0] });
	const dtc = (code: number, occ: number) => ({ id: 0x20, payload: [...u32(code), occ, 0x2f, 0, 0] });
	const calib = (v: number) => ({ id: 0x30, payload: Array.from({ length: 16 }, (_, i) => (v + i) & 0xff) });
	const odometer = (km: number) => ({ id: 0x40, payload: u32(km) });

	out.push(calib(0x10), odometer(1200), resetCounter(1, 1));
	for (let i = 2; i <= 6; i++) {
		out.push(resetCounter(i, i % 3 === 0 ? 4 : 1), odometer(1200 + i * 37));
	}
	out.push(dtc(0x00c07300, 1), resetCounter(7, 4), dtc(0x00c07300, 2));
	out.push({ ...calib(0x20), badCrc: true }, calib(0x21), odometer(1650));
	out.push(resetCounter(8, 2), dtc(0x00c07300, 3), odometer(1702));
	return out;
}

function buildImage(): Uint8Array {
	const image = new Uint8Array(IMAGE_SIZE).fill(0xff);
	const crcModel = crcPresets["CRC16-CCITT-FALSE"];
	const version = new Map<number, number>();
	let offset = 0;
	for (const w of writes()) {
		const ver = (version.get(w.id) ?? 0) + 1;
		version.set(w.id, ver);
		const block = [...u16(w.id), ...u16(w.payload.length), ...u16(ver), ...u16(0x0001), ...w.payload];
		const bytes = Uint8Array.from(block);
		let crc = computeCrc(bytes, crcModel);
		if (w.badCrc) {
			crc ^= 0x5a5a;
		}
		const total = Math.ceil((block.length + 2) / ALIGN) * ALIGN;
		image.set([...block, ...u16(crc)], offset);
		image.fill(0x00, offset + block.length + 2, offset + total); // alignment padding
		offset += total;
	}
	image.set(u16(0xffff), offset); // end marker (already erased, explicit for clarity)
	return image;
}

/** Encode as Motorola S-record (S2: 24-bit addresses, 16 data bytes per line). */
function toSrec(image: Uint8Array, base: number): string {
	const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, "0");
	const record = (type: string, fields: number[]) => {
		const count = fields.length + 1;
		const sum = [count, ...fields].reduce((a, b) => a + b, 0);
		return `${type}${hex(count, 2)}${fields.map(b => hex(b, 2)).join("")}${hex(0xff - (sum & 0xff), 2)}`;
	};
	const lines = [record("S0", [0, 0, ...[..."SAMPLE"].map(c => c.charCodeAt(0))])];
	for (let i = 0; i < image.length; i += 16) {
		const addr = base + i;
		lines.push(record("S2", [(addr >> 16) & 0xff, (addr >> 8) & 0xff, addr & 0xff, ...image.slice(i, i + 16)]));
	}
	lines.push(record("S8", [(base >> 16) & 0xff, (base >> 8) & 0xff, base & 0xff]));
	return lines.join("\r\n") + "\r\n";
}

const target = process.argv[2] ?? "samples/basic-log/sample-nvm.mot";
fs.writeFileSync(target, toSrec(buildImage(), IMAGE_BASE));
console.log(`wrote ${target}`);
