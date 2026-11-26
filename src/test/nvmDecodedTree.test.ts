/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { expect } from "chai";
import { NvmDecodedNode } from "../../shared/nvm/structRich";
import {
	DECODED_COLLAPSE_THRESHOLD,
	defaultOpen,
	locateDecoded,
} from "../../shared/nvm/views/decodedTree";

/** Generic shapes only: a header scalar, an array of flag bytes, a trailing scalar. */
function sample(count: number): NvmDecodedNode[] {
	return [
		{ name: "Header", type: "u16", offset: 0x10, length: 2, value: 1 },
		{
			name: "Items",
			type: "array",
			offset: 0x12,
			length: count,
			children: Array.from({ length: count }, (_, i) => ({
				name: `Items[${i}]`,
				type: "u8",
				offset: 0x12 + i,
				length: 1,
				hex: "0x00",
				children: [0, 1, 2].map(k => ({
					name: `F${k}`,
					type: "bool",
					offset: 0x12 + i,
					length: 1,
					value: false,
					bits: { width: 1, offset: k },
				})),
			})),
		},
		{ name: "Crc", type: "u16", offset: 0x12 + count, length: 2, value: 7 },
	];
}

describe("NVM decoded tree", () => {
	describe("defaultOpen", () => {
		it("opens small branches and collapses large ones in auto mode", () => {
			const [, small] = sample(4);
			const [, large] = sample(DECODED_COLLAPSE_THRESHOLD + 1);
			expect(defaultOpen(small, "auto")).to.equal(true);
			expect(defaultOpen(large, "auto")).to.equal(false);
		});
		it("follows expand-all / collapse-all regardless of size", () => {
			const [, large] = sample(300);
			expect(defaultOpen(large, "all")).to.equal(true);
			expect(defaultOpen(sample(2)[1], "none")).to.equal(false);
		});
	});

	describe("locateDecoded", () => {
		it("finds a top-level scalar without opening anything", () => {
			expect(locateDecoded(sample(300), 0x11)).to.deep.equal({ path: "0", open: [] });
		});
		it("stops at the element whose bit flags share the byte, opening the path to it", () => {
			// Byte 0x12 + 150 → Items[150]; its 3 flag children all cover that byte.
			expect(locateDecoded(sample(300), 0x12 + 150)).to.deep.equal({ path: "1/150", open: ["1", "1/150"] });
		});
		it("descends to a single covering child", () => {
			const nodes: NvmDecodedNode[] = [
				{
					name: "S",
					type: "S",
					offset: 0,
					length: 8,
					children: [
						{ name: "A", type: "u32", offset: 0, length: 4, value: 1 },
						{ name: "B", type: "u32", offset: 4, length: 4, value: 2 },
					],
				},
			];
			expect(locateDecoded(nodes, 5)).to.deep.equal({ path: "0/1", open: ["0"] });
		});
		it("returns undefined for a byte outside the tree", () => {
			expect(locateDecoded(sample(4), 0x500)).to.equal(undefined);
		});
	});
});
