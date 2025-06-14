import { TextFileView, WorkspaceLeaf } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { store } from "src/redux/store";
import { LoomState } from "src/shared/loom-state/types/loom-state";
import { deserializeState, serializeState } from "src/data/serialize-state";
import LoomAppWrapper from "src/react/loom-app";
import { createAppId } from "./utils";
import ErrorApp from "src/react/error-app";
import DeserializationError from "src/data/deserialization-error";
import { serializeFrontmatter } from "src/data/serialize-frontmatter";
import EventManager from "src/shared/event/event-manager";
import LastSavedManager from "src/shared/last-saved-manager";

export const DATA_LOOM_VIEW = "dataloom";

export default class DataLoomView extends TextFileView {
	private root: Root | null;
	private appId: string;
	private pluginId: string;
	private pluginVersion: string;
	private focusListener: (event: FocusEvent) => void; // Added property for the event listener

	data: string;

	constructor(leaf: WorkspaceLeaf, pluginId: string, pluginVersion: string) {
		super(leaf);
		this.pluginId = pluginId;
		this.pluginVersion = pluginVersion;
		this.root = null;
		this.data = "";
		this.appId = createAppId();
		this.focusListener = null; // Initialize the listener
	}

	async onOpen() {
		// Add offset to the container to account for the mobile action bar
		this.containerEl.style.paddingBottom = "48px";

		// Add settings button to action bar
		this.addAction("settings", "Settings", () => {
			// Open settings tab
			(this.app as any).setting.open();
			// Navigate to plugin settings
			(this.app as any).setting.openTabById(this.pluginId);
		});

		// Add event listener to scroll focused elements into view
		this.focusListener = (event: FocusEvent) => {
			const target = event.target as HTMLElement;
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
				setTimeout(() => {
					target.scrollIntoView({ behavior: 'smooth', block: 'center' });
				}, 300); // Delay to allow keyboard to appear
			}
		};
		this.containerEl.addEventListener('focusin', this.focusListener, true);
	}

	async onClose() {
		// Remove the event listener to prevent memory leaks
		if (this.focusListener) {
			this.containerEl.removeEventListener('focusin', this.focusListener, true);
		}
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
	}

	setViewData(data: string, clear: boolean): void {
		this.data = data;

		// This is only called when the view is initially opened
		if (clear) {
			if (this.root) {
				this.root.unmount();
			}

			const container = this.containerEl.children[1];
			const root = createRoot(container);
			this.root = root;

			try {
				const state = deserializeState(data, this.pluginVersion);
				this.renderApp(this.appId, state);
			} catch (err: unknown) {
				this.renderErrorApp(err as DeserializationError);
			}
		}
	}

	clear(): void {
		this.data = "{}";
	}

	getViewData(): string {
		return this.data;
	}

	getViewType() {
		return DATA_LOOM_VIEW;
	}

	getDisplayText() {
		if (!this.file) return "";

		const fileName = this.file.name;
		const extensionIndex = fileName.lastIndexOf(".");
		return fileName.substring(0, extensionIndex);
	}

	private handleSaveLoomState = async (
		appId: string,
		state: LoomState,
		shouldSaveFrontmatter: boolean
	) => {
		if (!this.file) return;

		if (shouldSaveFrontmatter) {
			await serializeFrontmatter(this.app, state);
		}

		const serialized = serializeState(state);

		LastSavedManager.getInstance().setLastSavedFile(this.file.path);

		// We need this for when we open a new tab of the same file
		// so that the data is up to date
		this.setViewData(serialized, false);

		// Request a save - every 2s
		this.requestSave();

		// Trigger an event to refresh the other open views of this file
		EventManager.getInstance().emit(
			"app-refresh-by-state",
			this.file.path,
			appId,
			state
		);
	};

	private renderApp(appId: string, state: LoomState) {
		if (!this.file) return;

		if (this.root) {
			this.root.render(
				<LoomAppWrapper
					app={this.app}
					mountLeaf={this.leaf}
					reactAppId={appId}
					loomFile={this.file}
					isMarkdownView={false}
					store={store}
					loomState={state}
					onSaveState={this.handleSaveLoomState}
				/>
			);
		}
	}

	private renderErrorApp(error: DeserializationError) {
		if (this.root) {
			this.root.render(<ErrorApp error={error} />);
		}
	}
}
