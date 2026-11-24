/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
// Tests for the vector-fee-v3 engine pack's automatic RAM-mirror binding and
// sizeof check. The logic lives in the engine (server-distributed), not the
// plugin; it is tested here only because this is where the test runner lives.
import { expect } from "chai";
import {
	buildStructResolver,
	decodeBoundBlock,
	matchBinding,
	structSize,
} from "../../engines/vector-fee-v3/src/feeV3Structs";
import { nvmCfgByName, parseNvmCfg } from "../../engines/vector-fee-v3/src/nvmCfg";
import { parseVariableTypes, ramMirrorBindings } from "../../engines/vector-fee-v3/src/ramMirror";
import { createEngineSdk } from "../nvm/layout/engineSdk";

const NVM_CFG = `
CONST(NvM_BlockDescriptorType, NVM_CONFIG_CONST) NvM_BlockDescriptorTable_at[NVM_TOTAL_NUM_OF_NVRAM_BLOCKS] =
{
  { /*  DemStatusDataBlock  */
    (NvM_RamAddressType)&Dem_Cfg_StatusData /*  NvMRamBlockDataAddress  */ ,
    6u /*  NvMNvBlockLength  */ ,
    0u /*  NvMacSize  */
  },
  { /*  RawBlock  */
    (NvM_RamAddressType)Raw_au8 /*  NvMRamBlockDataAddress  */ ,
    4u /*  NvMNvBlockLength  */ ,
    0u /*  NvMacSize  */
  },
  { /*  NoRamBlock  */
    NULL_PTR /*  NvMRamBlockDataAddress  */ ,
    2u /*  NvMNvBlockLength  */ ,
    0u /*  NvMacSize  */
  }
};`;

const HEADER = `
typedef struct Dem_Cfg_StatusDataType_s {
  uint16 FirstFailedEvent;
  volatile uint8 EventStatus[ 3 /*DEM_G_NUMBER_OF_EVENTS*/];
} Dem_Cfg_StatusDataType;
extern VAR(Dem_Cfg_StatusDataType, DEM_NVM_DATA_NOINIT) Dem_Cfg_StatusData;
extern VAR(uint8, APPL_VAR) Raw_au8[4];
/* extern VAR(Dem_Cfg_StatusDataType, X) Commented_Out; */
`;

describe("vector-fee-v3 engine: RAM-mirror auto binding", () => {
	it("reads NvMRamBlockDataAddress (cast &var, cast var, NULL_PTR)", () => {
		const byName = nvmCfgByName(parseNvmCfg(NVM_CFG));
		expect(byName.get("DemStatusDataBlock")?.ramVariable).to.equal("Dem_Cfg_StatusData");
		expect(byName.get("RawBlock")?.ramVariable).to.equal("Raw_au8");
		expect(byName.get("NoRamBlock")?.ramVariable).to.equal(undefined);
	});

	it("maps declared scalar variables to their type, skipping arrays and comments", () => {
		const types = parseVariableTypes(HEADER);
		expect(types.get("Dem_Cfg_StatusData")).to.equal("Dem_Cfg_StatusDataType");
		expect(types.has("Raw_au8")).to.equal(false);
		expect(types.has("Commented_Out")).to.equal(false);
	});

	it("binds only blocks whose RAM variable has a known struct type", () => {
		const blocks = parseNvmCfg(NVM_CFG);
		const bound = ramMirrorBindings(blocks, parseVariableTypes(HEADER), new Set(["Dem_Cfg_StatusDataType"]));
		expect([...bound.keys()]).to.deep.equal(["DemStatusDataBlock"]);
	});

	const resolver = (options: Record<string, unknown> = {}) =>
		buildStructResolver(
			createEngineSdk() as never,
			{ demLcfg: HEADER },
			{ structs: { fromSources: ["demLcfg"] }, ...options },
			nvmCfgByName(parseNvmCfg(NVM_CFG)),
		)!;

	it("auto-binds with zero config; explicit blockStructs win; autoBind:false disables", () => {
		const info = { name: "DemStatusDataBlock", tag: 1, identityKey: "tag:0x1" };
		expect(matchBinding(resolver(), info)?.struct).to.equal("Dem_Cfg_StatusDataType");
		const explicit = resolver({
			blockStructs: [{ match: { name: "DemStatusDataBlock" }, struct: "Other" }],
		});
		expect(matchBinding(explicit, info)?.struct).to.equal("Other");
		expect(
			buildStructResolver(
				createEngineSdk() as never,
				{ demLcfg: HEADER },
				{ structs: { fromSources: ["demLcfg"], autoBind: false } },
				nvmCfgByName(parseNvmCfg(NVM_CFG)),
			),
		).to.equal(undefined);
	});

	it("measures sizeof with tail padding and flags a mismatch with NvMNvBlockLength", () => {
		const r = resolver();
		// u16 + u8[3] = 5 bytes, padded to the u16 alignment → 6.
		expect(structSize(r, "Dem_Cfg_StatusDataType")).to.equal(6);
		const binding = { match: { name: "DemStatusDataBlock" }, struct: "Dem_Cfg_StatusDataType" };
		const ok = decodeBoundBlock(r, binding, new Uint8Array(6), 0, 6)!;
		expect(ok.some(n => n.type === "note")).to.equal(false);
		const bad = decodeBoundBlock(r, binding, new Uint8Array(8), 0, 8)!;
		expect(bad[0].type).to.equal("note");
		expect(String(bad[0].value)).to.contain("NvMNvBlockLength = 8");
	});
});
