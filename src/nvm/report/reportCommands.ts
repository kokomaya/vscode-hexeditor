// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The "Export Report" command: renders a Markdown analysis report for the active
 * dump from its parsed blocks + the user's annotations, then saves/opens it.
 */

import * as vscode from "vscode";
import { NvmInsights } from "../../../shared/nvm/views/insights";
import { NvmBlockInfo } from "../../../shared/protocol";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { AnnotationService } from "../annotations/annotationService";
import { generateReport } from "./reportGenerator";

export interface ActiveReport {
	fileName: string;
	markdown: string;
	docUri: vscode.Uri;
}

/** Build the report markdown for the active dump. Exported for reuse by AI tools. */
export async function buildActiveReport(
	registry: HexEditorRegistry,
	annotations: AnnotationService,
	options: { aiSummary?: string; insights?: NvmInsights } = {},
): Promise<ActiveReport | undefined> {
	const doc = registry.activeDocument;
	if (!doc) {
		return undefined;
	}
	const blocks = registry.getNvmBlocks(doc) as NvmBlockInfo[];
	const set = await annotations.get(doc.uri);
	const noteBodies = new Map<string, string>();
	for (const note of set.notes) {
		noteBodies.set(note.id, await annotations.readNote(doc.uri, note.id));
	}
	const fileName = doc.uri.path.replace(/^.*\//, "");
	const markdown = generateReport({ fileName, blocks, annotations: set, noteBodies, ...options });
	return { fileName, markdown, docUri: doc.uri };
}

/**
 * Builds reports for the commands and the preview. The Overview findings come
 * from `caps.insights`, which is created after the report commands — so the
 * source is attached later (same pattern as the workbench host).
 */
export class ReportBuilder {
	private insightsSource?: () => Promise<NvmInsights>;

	constructor(
		private readonly registry: HexEditorRegistry,
		private readonly annotations: AnnotationService,
	) {}

	public setInsightsSource(source: () => Promise<NvmInsights>): void {
		this.insightsSource = source;
	}

	public async build(): Promise<ActiveReport | undefined> {
		let insights: NvmInsights | undefined;
		try {
			insights = await this.insightsSource?.();
		} catch {
			insights = undefined; // the report is still useful without findings
		}
		return buildActiveReport(this.registry, this.annotations, { insights });
	}
}

export function registerReportCommands(reports: ReportBuilder): vscode.Disposable[] {
	const exportReport = vscode.commands.registerCommand("nvmStudio.nvm.exportReport", async () => {
		const report = await reports.build();
		if (!report) {
			void vscode.window.showWarningMessage("Open an NVM dump first to export a report.");
			return;
		}
		const target = await vscode.window.showSaveDialog({
			title: "Export NVM report",
			defaultUri: report.docUri.with({ path: `${report.docUri.path}.report.md` }),
			filters: { Markdown: ["md"] },
		});
		if (!target) {
			return;
		}
		await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(report.markdown));
		await vscode.window.showTextDocument(target, { preview: false });
	});

	return [exportReport];
}
