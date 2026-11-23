// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TelemetryReporter } from "@vscode/extension-telemetry";
import * as vscode from "vscode";
import { HexDocumentEditOp } from "../shared/hexDocumentModel";
import { MessageType } from "../shared/protocol";
import { openCompareSelected } from "./compareSelected";
import { copyAs } from "./copyAs";
import { DataInspectorView } from "./dataInspectorView";
import { showGoToOffset } from "./goToOffset";
import { HexDiffFSProvider } from "./hexDiffFS";
import { HexEditorProvider } from "./hexEditorProvider";
import { HexEditorRegistry } from "./hexEditorRegistry";
import { prepareLazyInitDiffWorker } from "./initWorker";
import { registerChatParticipant } from "./nvm/ai/chatParticipant";
import { registerLmTools } from "./nvm/ai/lmTools";
import { NvmCapabilities } from "./nvm/ai/nvmCapabilities";
import { registerShowCapabilities } from "./nvm/ai/showCapabilities";
import { registerAnnotationCommands } from "./nvm/annotations/annotationCommands";
import { AnnotationInteractions } from "./nvm/annotations/annotationInteractions";
import { AnnotationService } from "./nvm/annotations/annotationService";
import { parseArxmlFile } from "./nvm/arxmlParser";
import { mapBlocksToBuffer } from "./nvm/blockMapper";
import { registerNvmBlocksTable } from "./nvm/blocks/blockTablePanel";
import { registerNvmBlocksView } from "./nvm/blocks/nvmBlocksView";
import { registerNvmCustomViewsPanel } from "./nvm/customViews/customViewPanel";
import { CustomViewService } from "./nvm/customViews/customViewService";
import { registerConfigInstallCommand } from "./nvm/discovery/configInstall";
import { invalidateDependencyResolver } from "./nvm/discovery/fileIndex";
import { registerReselectDependency } from "./nvm/discovery/reselectCommand";
import { registerEngineCommands } from "./nvm/engines/engineCommands";
import { EngineManager } from "./nvm/engines/engineManager";
import { registerServerInstallCommand } from "./nvm/install/serverInstall";
import { registerReportCommands, ReportBuilder } from "./nvm/report/reportCommands";
import { registerReportPreview } from "./nvm/report/reportPanel";
import { registerSkillCommands } from "./nvm/skills/skillCommands";
import { initContextMemory } from "./nvm/skills/contextMemory";
import { registerSkillContextCommand } from "./nvm/skills/skillContextCommand";
import { registerResourcesPanel } from "./nvm/resources/resourcesPanel";
import { registerSkillInstallCommand } from "./nvm/skills/skillInstall";
import { SkillRegistry } from "./nvm/skills/skillRegistry";
import { registerNvmStudioView } from "./nvm/ui/nvmStudioTree";
import { WorkbenchHost } from "./nvm/workbench/workbenchHost";
import { registerWorkbenchCommands } from "./nvm/workbench/workbenchCommands";
import { SceneLayoutFinder, SkillSceneSource, WorkspaceSceneSource } from "./nvm/workbench/sceneLayouts";
import { NvmFocusStatusBar } from "./nvm/workbench/focusStatusBar";
import { registerDumpConfigView } from "./nvm/diagnostics/dumpConfigView";
import { LoadDiagnosticsStore } from "./nvm/diagnostics/loadDiagnostics";
import { registerOnboardingCommands } from "./nvm/onboarding/onboardingCommands";
import { showSelectBetweenOffsets } from "./selectBetweenOffsets";
import StatusEditMode from "./statusEditMode";
import StatusFocus from "./statusFocus";
import StatusHoverAndSelection from "./statusHoverAndSelection";

function readConfigFromPackageJson(extension: vscode.Extension<any>): {
	aiKey: string;
} {
	const packageJSON = extension.packageJSON;
	return {
		aiKey: packageJSON.aiKey,
	};
}

function reopenWithHexEditor() {
	const activeTabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input as {
		[key: string]: any;
		uri: vscode.Uri | undefined;
	};
	if (activeTabInput.uri) {
		vscode.commands.executeCommand("vscode.openWith", activeTabInput.uri, "nvmStudio.hexedit");
	}
}

export async function activate(context: vscode.ExtensionContext) {
	// Prepares the worker to be lazily initialized
	const initWorker = prepareLazyInitDiffWorker(context.extensionUri, workerDispose =>
		context.subscriptions.push(workerDispose),
	);
	const registry = new HexEditorRegistry(initWorker);
	// Register the data inspector as a separate view on the side
	const dataInspectorProvider = new DataInspectorView(context.extensionUri, registry);
	const configValues = readConfigFromPackageJson(context.extension);
	context.subscriptions.push(
		registry,
		dataInspectorProvider,
		vscode.window.registerWebviewViewProvider(DataInspectorView.viewType, dataInspectorProvider),
	);

	const telemetryReporter = new TelemetryReporter(configValues.aiKey);
	context.subscriptions.push(telemetryReporter);
	const openWithCommand = vscode.commands.registerCommand(
		"nvmStudio.openFile",
		reopenWithHexEditor,
	);
	const goToOffsetCommand = vscode.commands.registerCommand("nvmStudio.goToOffset", () => {
		const first = registry.activeMessaging[Symbol.iterator]().next();
		if (first.value) {
			showGoToOffset(first.value);
		}
	});
	const selectBetweenOffsetsCommand = vscode.commands.registerCommand(
		"nvmStudio.selectBetweenOffsets",
		() => {
			const first = registry.activeMessaging[Symbol.iterator]().next();
			if (first.value) {
				showSelectBetweenOffsets(first.value, registry);
			}
		},
	);

	const copyAsCommand = vscode.commands.registerCommand("nvmStudio.copyAs", () => {
		const first = registry.activeMessaging[Symbol.iterator]().next();
		if (first.value) {
			copyAs(first.value);
		}
	});

	const switchEditModeCommand = vscode.commands.registerCommand("nvmStudio.switchEditMode", () => {
		if (registry.activeDocument) {
			registry.activeDocument.editMode =
				registry.activeDocument.editMode === HexDocumentEditOp.Insert
					? HexDocumentEditOp.Replace
					: HexDocumentEditOp.Insert;
		}
	});

	const copyOffsetAsHex = vscode.commands.registerCommand("nvmStudio.copyOffsetAsHex", () => {
		if (registry.activeDocument) {
			const focused = registry.activeDocument.selectionState.focused;
			if (focused !== undefined) {
				vscode.env.clipboard.writeText(focused.toString(16).toUpperCase());
			}
		}
	});

	const copyOffsetAsDec = vscode.commands.registerCommand("nvmStudio.copyOffsetAsDec", () => {
		if (registry.activeDocument) {
			const focused = registry.activeDocument.selectionState.focused;
			if (focused !== undefined) {
				vscode.env.clipboard.writeText(focused.toString());
			}
		}
	});

	const compareSelectedCommand = vscode.commands.registerCommand(
		"nvmStudio.compareSelected",
		async (...args) => {
			if (args.length !== 2 && !(args[1] instanceof Array)) {
				return;
			}
			const [leftFile, rightFile] = args[1];
			if (!(leftFile instanceof vscode.Uri && rightFile instanceof vscode.Uri)) {
				return;
			}
			openCompareSelected(leftFile, rightFile);
		},
	);

	const loadNvmArxmlCommand = vscode.commands.registerCommand("nvmStudio.loadNvmArxml", async () => {
		if (!registry.activeDocument) {
			vscode.window.showInformationMessage("No active hex document to associate ARXML with.");
			return;
		}
		const uris = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { "ARXML": ["arxml", "xml"] } });
		if (!uris || uris.length === 0) return;
		const file = uris[0];
		try {
			const blocks = await parseArxmlFile(file.fsPath);
			const size = await registry.activeDocument.size();
			if (size === undefined) {
				vscode.window.showErrorMessage("Cannot map NVM blocks for documents with unknown/infinite size.");
				return;
			}
			const mapped = mapBlocksToBuffer(size, blocks, registry.activeDocument.baseAddress ?? 0);
			registry.setNvmBlocks(registry.activeDocument, mapped);
			for (const messaging of registry.getMessaging(registry.activeDocument)) {
				messaging.sendEvent({ type: MessageType.SetNvmBlocks, blocks: mapped });
			}
			vscode.window.showInformationMessage(`Loaded ARXML and mapped ${mapped.length} NVM blocks.`);
		} catch (e: any) {
			vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
		}
	});

	context.subscriptions.push(new StatusEditMode(registry));
	context.subscriptions.push(new StatusFocus(registry));
	context.subscriptions.push(new StatusHoverAndSelection(registry));
	context.subscriptions.push(goToOffsetCommand);
	context.subscriptions.push(selectBetweenOffsetsCommand);
	context.subscriptions.push(copyAsCommand);
	context.subscriptions.push(switchEditModeCommand);
	context.subscriptions.push(openWithCommand);
	context.subscriptions.push(telemetryReporter);
	context.subscriptions.push(copyOffsetAsDec, copyOffsetAsHex);
	context.subscriptions.push(compareSelectedCommand);
	context.subscriptions.push(loadNvmArxmlCommand);
	initContextMemory(context.globalState);
	const engineManager = new EngineManager(context);
	context.subscriptions.push(...registerEngineCommands(engineManager));
	context.subscriptions.push(registerServerInstallCommand(context, engineManager));
	context.subscriptions.push(registerConfigInstallCommand(context));
	context.subscriptions.push(registerSkillInstallCommand(context));
	const annotationService = new AnnotationService(context);
	const customViewService = new CustomViewService(context);
	const annotationInteractions = new AnnotationInteractions(annotationService);
	context.subscriptions.push(
		...registerAnnotationCommands(registry, annotationService, annotationInteractions),
	);
	context.subscriptions.push(...registerNvmStudioView(registry, annotationService));
	context.subscriptions.push(...registerNvmBlocksView(registry, context.workspaceState));
	context.subscriptions.push(
		...registerNvmBlocksTable(context.extensionUri, registry, customViewService),
	);
	context.subscriptions.push(
		...registerNvmCustomViewsPanel(context.extensionUri, registry, customViewService),
	);
	const reports = new ReportBuilder(registry, annotationService);
	context.subscriptions.push(...registerReportCommands(reports));
	context.subscriptions.push(...registerReportPreview(reports));
	// One vendor-blind capability facade backs both AI surfaces (LM tools + chat).
	// Skills: external, pure-data knowledge (playbooks + block knowledge) shared by
	// the decode pass, the AI surfaces and the Skills view.
	const skillRegistry = new SkillRegistry(context.extensionUri);
	context.subscriptions.push(skillRegistry);
	// The NVM workbench (dock layout inside the editor) — host side of layouts / focus / ask-AI.
	const workbenchHost = new WorkbenchHost(
		context,
		registry,
		new SceneLayoutFinder([new WorkspaceSceneSource(), new SkillSceneSource(skillRegistry)]),
	);
	// Load diagnostics: why a dump was / wasn't recognized (Dump & Config view, /why).
	const loadDiagnostics = new LoadDiagnosticsStore();
	context.subscriptions.push(loadDiagnostics, ...registerDumpConfigView(registry, loadDiagnostics));
	context.subscriptions.push(...registerWorkbenchCommands(registry, workbenchHost));
	context.subscriptions.push(new NvmFocusStatusBar(registry));
	context.subscriptions.push(...registerOnboardingCommands(context));
	const nvmCapabilities = new NvmCapabilities(
		registry,
		annotationService,
		skillRegistry,
		workbenchHost,
		loadDiagnostics,
	);
	workbenchHost.setInsightsSource(() => nvmCapabilities.insights.insights());
	reports.setInsightsSource(() => nvmCapabilities.insights.insights());
	context.subscriptions.push(...registerSkillCommands(skillRegistry, registry, nvmCapabilities.skills));
	context.subscriptions.push(registerSkillContextCommand(skillRegistry, registry));
	context.subscriptions.push(
		registerResourcesPanel({ context, skills: skillRegistry, registry, engines: engineManager, diagnostics: loadDiagnostics }),
	);
	context.subscriptions.push(...registerLmTools(nvmCapabilities));
	context.subscriptions.push(...registerChatParticipant(nvmCapabilities));
	context.subscriptions.push(registerShowCapabilities(context));
	context.subscriptions.push(registerReselectDependency(context));
	// Rebuild the dependency index when the configured roots change.
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration("nvmstudio.nvm.workspaceRoots") ||
				e.affectsConfiguration("nvmstudio.nvm.workspaceRoots")
			) {
				invalidateDependencyResolver();
			}
		}),
	);
	context.subscriptions.push(
		vscode.workspace.registerFileSystemProvider("hexdiff", new HexDiffFSProvider(), {
			isCaseSensitive: typeof process !== 'undefined' && process.platform !== 'win32' && process.platform !== 'darwin',
		}),
	);
	context.subscriptions.push(
		HexEditorProvider.register(
			context,
			telemetryReporter,
			dataInspectorProvider,
			registry,
			annotationService,
			customViewService,
			skillRegistry,
			workbenchHost,
			loadDiagnostics,
		),
	);
}

export function deactivate(): void {
	/* no-op */
}
