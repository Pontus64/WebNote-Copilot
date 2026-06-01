import { CrepeBuilder } from "@milkdown/crepe/builder";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
import { cursor } from "@milkdown/crepe/feature/cursor";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { placeholder } from "@milkdown/crepe/feature/placeholder";
import { table } from "@milkdown/crepe/feature/table";
import { toolbar } from "@milkdown/crepe/feature/toolbar";
import { uploadConfig } from "@milkdown/kit/plugin/upload";
import {
	type ClipboardEvent as ReactClipboardEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";

export type MarkdownNoteEditorHandle = {
	getMarkdown: () => string;
	focus: () => void;
};

type MarkdownNoteEditorProps = {
	value: string;
	onChange: (markdown: string) => void;
	onSave: (markdown: string) => void;
	onUnsupportedImagePaste: () => void;
};

export const MarkdownNoteEditor = forwardRef<
	MarkdownNoteEditorHandle,
	MarkdownNoteEditorProps
>(function MarkdownNoteEditor(
	{ value, onChange, onSave, onUnsupportedImagePaste },
	ref
) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const crepeRef = useRef<CrepeBuilder | null>(null);
	const latestValueRef = useRef(value);
	const onChangeRef = useRef(onChange);
	const onSaveRef = useRef(onSave);
	const onUnsupportedImagePasteRef = useRef(onUnsupportedImagePaste);

	useEffect(() => {
		latestValueRef.current = value;
	}, [value]);

	useEffect(() => {
		onChangeRef.current = onChange;
		onSaveRef.current = onSave;
		onUnsupportedImagePasteRef.current = onUnsupportedImagePaste;
	}, [onChange, onSave, onUnsupportedImagePaste]);

	useImperativeHandle(
		ref,
		() => ({
			getMarkdown() {
				return readMarkdown(crepeRef.current, latestValueRef.current);
			},
			focus() {
				rootRef.current?.querySelector<HTMLElement>("[contenteditable='true']")?.focus();
			},
		}),
		[]
	);

	useEffect(() => {
		const root = rootRef.current;
		if (!root) {
			return;
		}

		const crepe = new CrepeBuilder({
			root,
			defaultValue: latestValueRef.current,
		});

		crepe
			.addFeature(cursor)
			.addFeature(listItem)
			.addFeature(linkTooltip)
			.addFeature(blockEdit)
			.addFeature(toolbar)
			.addFeature(table)
			.addFeature(placeholder, { text: "输入 Markdown...", mode: "doc" });

		crepe.editor.config((ctx) => {
			ctx.update(uploadConfig.key, (config) => ({
				...config,
				uploader: async () => [],
			}));
		});

		crepe.on((listener) => {
			listener.markdownUpdated((_, markdown) => {
				latestValueRef.current = markdown;
				onChangeRef.current(markdown);
			});
		});

		crepeRef.current = crepe;
		void crepe.create().catch((error) => {
			console.error("[FloatingNotes] Milkdown editor failed to mount", error);
		});

		return () => {
			crepeRef.current = null;
			void crepe.destroy().catch((error) => {
				console.error("[FloatingNotes] Milkdown editor failed to destroy", error);
			});
		};
	}, []);

	const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			const markdown = readMarkdown(crepeRef.current, latestValueRef.current);
			latestValueRef.current = markdown;
			onChangeRef.current(markdown);
			onSaveRef.current(markdown);
		}
	};

	const handlePasteCapture = (event: ReactClipboardEvent<HTMLDivElement>) => {
		if (!hasImageClipboardItem(event.clipboardData)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		// TODO(next): upload pasted image to R2, persist note_assets metadata,
		// and insert the returned Markdown image URL at the current cursor position.
		onUnsupportedImagePasteRef.current();
	};

	return (
		<div
			className="markdown-editor-shell"
			onKeyDownCapture={handleKeyDownCapture}
			onPasteCapture={handlePasteCapture}
		>
			<div className="markdown-editor-root" ref={rootRef}></div>
		</div>
	);
});

function readMarkdown(crepe: CrepeBuilder | null, fallback: string) {
	if (!crepe) {
		return fallback;
	}
	try {
		return crepe.getMarkdown();
	} catch {
		return fallback;
	}
}

function hasImageClipboardItem(data: DataTransfer) {
	return Array.from(data.items).some(
		(item) => item.kind === "file" && item.type.toLowerCase().startsWith("image/")
	);
}
