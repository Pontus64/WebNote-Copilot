import { createRoot, type Root } from "react-dom/client";
import {
	FloatingNotesCore,
	type FloatingNotesCoreHandle,
} from "../shared/FloatingNotesCore";
import widgetCss from "../shared/floatingNotes.css?inline";

const WIDGET_VERSION = "1.0.14";

type FloatingNotesOptions = {
	apiBase?: string;
	floatButton?: boolean;
	title?: string;
	trigger?: string;
};

type FloatingNotesInstance = FloatingNotesCoreHandle & {
	destroy: () => void;
	version: string;
};

type FloatingNotesGlobal = {
	version: string;
	instance?: FloatingNotesInstance | null;
	init: (options?: FloatingNotesOptions) => FloatingNotesInstance;
};

declare global {
	interface Window {
		FloatingNotes?: FloatingNotesGlobal;
	}
}

function normalizeApiBase(value: string | undefined) {
	return String(value || window.location.origin).replace(/\/$/, "");
}

function createWidgetHost() {
	const host = document.createElement("floating-notes-widget");
	host.setAttribute("data-version", WIDGET_VERSION);
	document.body.appendChild(host);

	const shadow = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent = widgetCss;
	const mount = document.createElement("div");
	shadow.append(style, mount);

	return { host, mount };
}

function bindTriggers(
	trigger: string | undefined,
	instance: FloatingNotesInstance,
	signal: AbortSignal
) {
	const selectors = ["[data-floating-notes-trigger]"];
	if (trigger) {
		selectors.unshift(trigger);
	}

	for (const selector of selectors) {
		try {
			document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
				element.addEventListener(
					"click",
					(event) => {
						event.preventDefault();
						instance.open("notes");
					},
					{ signal }
				);
			});
		} catch (error) {
			console.warn("[FloatingNotes] invalid trigger selector:", selector, error);
		}
	}
}

function mountWidget(options: FloatingNotesOptions = {}): FloatingNotesInstance {
	const { host, mount } = createWidgetHost();
	const root: Root = createRoot(mount);
	const handleRef = { current: null as FloatingNotesCoreHandle | null };
	const triggerAbortController = new AbortController();
	const instance: FloatingNotesInstance = {
		version: WIDGET_VERSION,
		open(page) {
			handleRef.current?.open(page);
		},
		close() {
			handleRef.current?.close();
		},
		toggle() {
			handleRef.current?.toggle();
		},
		refresh() {
			return handleRef.current?.refresh() ?? Promise.resolve();
		},
		destroy() {
			triggerAbortController.abort();
			root.unmount();
			host.remove();
			if (window.FloatingNotes?.instance === instance) {
				window.FloatingNotes.instance = null;
			}
		},
	};

	root.render(
		<FloatingNotesCore
			ref={(value) => {
				handleRef.current = value;
			}}
			apiBase={normalizeApiBase(options.apiBase)}
			floatButton={options.floatButton ?? true}
			title={options.title || "笔记"}
		/>
	);
	bindTriggers(options.trigger, instance, triggerAbortController.signal);

	return instance;
}

function init(options?: FloatingNotesOptions) {
	if (window.FloatingNotes?.instance) {
		return window.FloatingNotes.instance;
	}

	const instance = mountWidget(options);
	if (window.FloatingNotes) {
		window.FloatingNotes.instance = instance;
	}
	return instance;
}

function getCurrentWidgetScript() {
	const currentScript = document.currentScript;
	if (!(currentScript instanceof HTMLScriptElement)) {
		return null;
	}
	if (!currentScript.src.includes("floating-notes-widget.js")) {
		return null;
	}
	return currentScript;
}

window.FloatingNotes = {
	version: WIDGET_VERSION,
	instance: null,
	init,
};

const script = getCurrentWidgetScript();
const autoInit = Boolean(script) && script?.dataset.autoInit !== "false";

if (autoInit) {
	const options: FloatingNotesOptions = {
		apiBase: script?.dataset.apiBase || (script?.src ? new URL(script.src).origin : ""),
		floatButton: script?.dataset.floatButton !== "false",
		title: script?.dataset.title || "笔记",
		trigger: script?.dataset.trigger || "",
	};

	if (document.body) {
		window.FloatingNotes.instance = init(options);
	} else {
		document.addEventListener(
			"DOMContentLoaded",
			() => {
				window.FloatingNotes!.instance = init(options);
			},
			{ once: true }
		);
	}
}
