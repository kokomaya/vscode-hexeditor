"use strict";

/**
 * Demo engine pack "demo-vendor/log-v1" — a tiny, self-contained example of a
 * vendor engine served by the install server. It parses the synthetic log
 * format of `samples/basic-log/sample-nvm.mot`:
 *
 *   header  id u16 | len u16 | ver u16 | stat u16   (little endian)
 *   payload `len` bytes, then CRC16-CCITT-FALSE over header+payload (u16)
 *   records aligned to `options.alignment` (8); id 0xFFFF ends the log
 *
 * Project-specific knowledge (block names) does NOT live here: it comes from
 * the project's descriptor (`options.names`, see conf/radar/...). That is the
 * split this demo shows: engine = vendor format, conf = project configuration.
 */

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const hex = (v, w = 4) => "0x" + v.toString(16).toUpperCase().padStart(w, "0");

module.exports.createEngine = sdk => ({
	id: "demo-vendor/log-v1",
	parse(input, options = {}) {
		let image;
		try {
			image = sdk.loadHexImage(input.text).toFlat(0xff);
		} catch {
			return [];
		}
		const bytes = image.bytes;
		const align = Number(options.alignment) || 8;
		const names = options.names || {};
		const crcModel = sdk.resolveCrcPreset("CRC16-CCITT-FALSE");
		const blocks = [];
		const writes = new Map();
		for (let off = 0, seq = 0; off + 8 <= bytes.length; seq++) {
			const id = u16(bytes, off);
			const len = u16(bytes, off + 2);
			if (id === 0xffff || off + 8 + len + 2 > bytes.length) {
				break;
			}
			const stored = u16(bytes, off + 8 + len);
			const crcOk = sdk.computeCrc(bytes, crcModel, off, off + 8 + len) === stored;
			const name = names[hex(id)] || names[hex(id, 2)] || `Block_${hex(id)}`;
			const blockId = `rec${seq}`;
			const field = (n, kind, o, l) => ({ name: n, kind, offset: off + o, length: l, unit: blockId });
			blocks.push({
				id: blockId,
				name,
				offset: off,
				length: 8 + len + 2,
				sequence: seq,
				identity: { key: `id:${hex(id)}`, label: name },
				attributes: [
					{ key: "blockId", label: "Block id", value: hex(id) },
					{ key: "version", label: "Version", value: u16(bytes, off + 4) },
					{ key: "status", label: "Status", value: u16(bytes, off + 6) },
					{ key: "crc", label: "CRC", value: crcOk ? "ok" : "mismatch", kind: crcOk ? undefined : "error" },
				],
				fields: [
					field("Block id", "blockId", 0, 2),
					field("Payload length", "payloadLength", 2, 2),
					field("Version", "version", 4, 2),
					field("Status", "status", 6, 2),
					field("Payload", "payload", 8, len),
					field("CRC", "crc", 8 + len, 2),
				],
			});
			writes.set(id, blockId);
			off += Math.ceil((8 + len + 2) / align) * align;
		}
		const latest = new Set(writes.values());
		for (const b of blocks) {
			b.isLatest = latest.has(b.id);
		}
		return blocks;
	},
});
