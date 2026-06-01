import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { commandsCtx, editorViewCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { toggleLinkCommand } from "@milkdown/kit/component/link-tooltip";
import type { MarkType } from "@milkdown/kit/prose/model";
import { toggleMark } from "@milkdown/kit/prose/commands";
import {
	addColAfterCommand,
	addRowAfterCommand,
	createTable,
	strikethroughSchema,
} from "@milkdown/kit/preset/gfm";
import {
	addBlockTypeCommand,
	blockquoteSchema,
	bulletListSchema,
	codeBlockSchema,
	emphasisSchema,
	headingSchema,
	inlineCodeSchema,
	isMarkSelectedCommand,
	linkSchema,
	listItemSchema,
	orderedListSchema,
	paragraphSchema,
	selectTextNearPosCommand,
	setBlockTypeCommand,
	strongSchema,
	toggleInlineCodeCommand,
	wrapInBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";
import {
	deleteColumn,
	deleteRow,
	deleteTable,
	isInTable,
} from "@milkdown/kit/prose/tables";
import { redo, undo } from "@milkdown/kit/prose/history";
import { TextSelection, type Command } from "@milkdown/kit/prose/state";
import { uploadConfig } from "@milkdown/kit/plugin/upload";
import { $markAttr, $markSchema } from "@milkdown/kit/utils";
import {
	type ClipboardEvent as ReactClipboardEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";

const markdownHeadingOptions = [
	{ label: "正文", level: null },
	{ label: "H1", level: 1 },
	{ label: "H2", level: 2 },
	{ label: "H3", level: 3 },
	{ label: "H4", level: 4 },
	{ label: "H5", level: 5 },
	{ label: "H6", level: 6 },
];

const underlineAttr = $markAttr("underline");

const underlineSchema = $markSchema("underline", (ctx) => ({
	parseDOM: [
		{ tag: "u" },
		{
			style: "text-decoration",
			getAttrs: (value) =>
				typeof value === "string" && value.includes("underline") ? null : false,
		},
	],
	toDOM: (mark) => ["u", ctx.get(underlineAttr.key)(mark)],
	parseMarkdown: {
		match: isUnderlineHtmlNode,
		runner: (state, node, markType) => {
			if (getUnderlineHtmlTag(node) === "open") {
				state.openMark(markType);
				return;
			}
			state.closeMark(markType);
		},
	},
	toMarkdown: {
		match: (mark) => mark.type.name === "underline",
		runner: (state, mark) => {
			state.withMark(mark, "underline");
		},
	},
}));

export type MarkdownNoteEditorHandle = {
	getMarkdown: () => string;
	focus: () => void;
};

type MarkdownNoteEditorProps = {
	value: string;
	onChange: (markdown: string) => void;
	onReady?: (markdown: string) => void;
	onSave: (markdown: string) => void;
	onUnsupportedImagePaste: () => void;
};

export const MarkdownNoteEditor = forwardRef<
	MarkdownNoteEditorHandle,
	MarkdownNoteEditorProps
>(function MarkdownNoteEditor(
	{ value, onChange, onReady, onSave, onUnsupportedImagePaste },
	ref
) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const crepeRef = useRef<Crepe | null>(null);
	const latestValueRef = useRef(value);
	const onChangeRef = useRef(onChange);
	const onReadyRef = useRef(onReady);
	const onSaveRef = useRef(onSave);
	const onUnsupportedImagePasteRef = useRef(onUnsupportedImagePaste);

	useEffect(() => {
		latestValueRef.current = value;
	}, [value]);

	useEffect(() => {
		onChangeRef.current = onChange;
		onReadyRef.current = onReady;
		onSaveRef.current = onSave;
		onUnsupportedImagePasteRef.current = onUnsupportedImagePaste;
	}, [onChange, onReady, onSave, onUnsupportedImagePaste]);

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
		let disposed = false;
		let isInitialMount = true;
		let topBarTooltipObserver: MutationObserver | null = null;

		const crepe = new Crepe({
			root,
			defaultValue: latestValueRef.current,
			features: {
				[CrepeFeature.Toolbar]: false,
				[CrepeFeature.TopBar]: true,
				[CrepeFeature.ImageBlock]: false,
			},
			featureConfigs: {
				[CrepeFeature.Cursor]: {
					virtual: false,
				},
				[CrepeFeature.TopBar]: {
					headingOptions: markdownHeadingOptions,
					buildTopBar: (builder) => {
						builder.clear();
						const toolbar = builder.addGroup("fixed-layout", "工具栏");

						toolbar
							.addItem("heading-selector", buildHeadingSelectorItem())
							.addItem("separator-after-heading", {
								...toolbarSeparatorItem,
							})
							.addItem("bold", {
								icon: withSvgTitle(topBarIcons.bold, "加粗"),
								active: (ctx: Ctx) => isMarkActive(ctx, strongSchema.type(ctx)),
								onRun: (ctx: Ctx) => toggleMarkType(ctx, strongSchema.type(ctx)),
							})
							.addItem("italic", {
								icon: withSvgTitle(topBarIcons.italic, "斜体"),
								active: (ctx: Ctx) => isMarkActive(ctx, emphasisSchema.type(ctx)),
								onRun: (ctx: Ctx) => toggleMarkType(ctx, emphasisSchema.type(ctx)),
							})
							.addItem("strikethrough", {
								icon: withSvgTitle(topBarIcons.strikethrough, "删除线"),
								active: (ctx: Ctx) => isMarkActive(ctx, strikethroughSchema.type(ctx)),
								onRun: (ctx: Ctx) => toggleMarkType(ctx, strikethroughSchema.type(ctx)),
							})
							.addItem("inline-code", {
								icon: withSvgTitle(topBarIcons.inlineCode, "行内代码"),
								active: (ctx: Ctx) => isMarkActive(ctx, inlineCodeSchema.type(ctx)),
								onRun: toggleInlineCode,
							})
							.addItem("quote", {
								icon: withSvgTitle(topBarIcons.quote, "引用块"),
								active: () => false,
								onRun: (ctx: Ctx) =>
									ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, {
										nodeType: blockquoteSchema.type(ctx),
									}),
							})
							.addItem("underline", {
								icon: withSvgTitle(topBarIcons.underline, "下划线"),
								active: (ctx: Ctx) => isMarkActive(ctx, underlineSchema.type(ctx)),
								onRun: (ctx: Ctx) => toggleMarkType(ctx, underlineSchema.type(ctx)),
							})
							.addItem("bullet-list", {
								icon: withSvgTitle(topBarIcons.bulletList, "无序列表"),
								active: () => false,
								onRun: (ctx: Ctx) =>
									ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, {
										nodeType: bulletListSchema.type(ctx),
									}),
							})
							.addItem("ordered-list", {
								icon: withSvgTitle(topBarIcons.orderedList, "有序列表"),
								active: () => false,
								onRun: (ctx: Ctx) =>
									ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, {
										nodeType: orderedListSchema.type(ctx),
									}),
							})
							.addItem("task-list", {
								icon: withSvgTitle(topBarIcons.taskList, "任务列表"),
								active: () => false,
								onRun: (ctx: Ctx) =>
									ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, {
										nodeType: listItemSchema.type(ctx),
										attrs: { checked: false },
									}),
							})
							.addItem("separator-after-lists", {
								...toolbarSeparatorItem,
							})
							.addItem("code-block", {
								icon: withSvgTitle(topBarIcons.codeBlock, "代码块"),
								active: () => false,
								onRun: (ctx: Ctx) =>
									ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
										nodeType: codeBlockSchema.type(ctx),
									}),
							})
							.addItem("math", {
								icon: withSvgTitle(topBarIcons.math, "公式"),
								active: () => false,
								onRun: (ctx: Ctx) =>
									ctx.get(commandsCtx).call(addBlockTypeCommand.key, {
										nodeType: codeBlockSchema.type(ctx),
										attrs: { language: "LaTeX" },
									}),
							})
							.addItem("link", {
								icon: withSvgTitle(topBarIcons.link, "插入链接"),
								active: (ctx: Ctx) => isMarkActive(ctx, linkSchema.type(ctx)),
								onRun: toggleLink,
							})
							.addItem("separator-after-link", {
								...toolbarSeparatorItem,
							})
							.addItem("undo", {
								icon: withSvgTitle(topBarIcons.undo, "回退"),
								active: () => false,
								onRun: (ctx: Ctx) => runProseCommand(ctx, undo),
							})
							.addItem("redo", {
								icon: withSvgTitle(topBarIcons.redo, "重做"),
								active: () => false,
								onRun: (ctx: Ctx) => runProseCommand(ctx, redo),
							})
							.addItem("table-insert", {
								icon: withSvgTitle(topBarIcons.table, "插入表格"),
								active: () => false,
								onRun: insertTable,
							})
							.addItem("table-add-row", {
								icon: textIcon("+行", "添加行"),
								active: isCursorInTable,
								onRun: (ctx: Ctx) => ctx.get(commandsCtx).call(addRowAfterCommand.key),
							})
							.addItem("table-add-col", {
								icon: textIcon("+列", "添加列"),
								active: isCursorInTable,
								onRun: (ctx: Ctx) => ctx.get(commandsCtx).call(addColAfterCommand.key),
							})
							.addItem("table-delete-row", {
								icon: textIcon("-行", "删除行"),
								active: isCursorInTable,
								onRun: (ctx: Ctx) => runProseCommand(ctx, deleteRow),
							})
							.addItem("table-delete-col", {
								icon: textIcon("-列", "删除列"),
								active: isCursorInTable,
								onRun: (ctx: Ctx) => runProseCommand(ctx, deleteColumn),
							})
							.addItem("table-delete-all", {
								icon: textIcon("删表", "删除表格"),
								active: isCursorInTable,
								onRun: (ctx: Ctx) => runProseCommand(ctx, deleteTable),
							});
					},
				},
				[CrepeFeature.CodeMirror]: {
					searchPlaceholder: "搜索语言",
					noResultText: "未找到语言",
					copyText: "复制",
					previewToggleText: (previewOnlyMode) => (previewOnlyMode ? "编辑" : "隐藏"),
					previewLabel: "预览",
					previewLoading: "加载中...",
				},
			},
			});

			crepe.editor.use([underlineAttr, ...underlineSchema]);

			crepe.editor.config((ctx) => {
				ctx.update(remarkStringifyOptionsCtx, (options) => ({
					...options,
					handlers: {
						...(options.handlers ?? {}),
						underline: underlineRemarkHandler,
					},
				}));
				ctx.update(uploadConfig.key, (config) => ({
					...config,
					uploader: async () => [],
				}));
		});

		crepe.on((listener) => {
			listener.markdownUpdated((_, markdown) => {
				latestValueRef.current = markdown;
				if (isInitialMount) {
					return;
				}
				onChangeRef.current(markdown);
			});
		});

		crepeRef.current = crepe;
		void crepe
			.create()
			.then(() => {
				if (disposed) {
					return;
				}
				const markdown = readMarkdown(crepe, latestValueRef.current);
				latestValueRef.current = markdown;
				onReadyRef.current?.(markdown);
				isInitialMount = false;
				applyTopBarTooltips(root);
				topBarTooltipObserver = new MutationObserver(() => {
					applyTopBarTooltips(root);
				});
				topBarTooltipObserver.observe(root, {
					childList: true,
					subtree: true,
				});
			})
			.catch((error) => {
				console.error("[FloatingNotes] Milkdown editor failed to mount", error);
			});

		return () => {
			disposed = true;
			topBarTooltipObserver?.disconnect();
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

function readMarkdown(crepe: Crepe | null, fallback: string) {
	if (!crepe) {
		return fallback;
	}
	try {
		return crepe.getMarkdown();
	} catch {
		return fallback;
	}
}

function isCursorInTable(ctx: Ctx) {
	return isInTable(ctx.get(editorViewCtx).state);
}

function buildHeadingSelectorItem() {
	return {
		icon: "",
		active: () => false,
		selector: {
			chevronIcon: chevronDownIcon,
			activeLabel: getCurrentHeadingLabel,
			options: markdownHeadingOptions.map((option) => ({
				label: option.label,
				onSelect: (ctx: Ctx) => setHeading(ctx, option.level),
			})),
		},
	};
}

function getCurrentHeadingLabel(ctx: Ctx) {
	const view = ctx.get(editorViewCtx);
	const node = view.state.selection.$from.parent;
	if (node.type === headingSchema.type(ctx)) {
		const level = node.attrs.level as number;
		return markdownHeadingOptions.find((option) => option.level === level)?.label ?? "正文";
	}
	return "正文";
}

function setHeading(ctx: Ctx, level: number | null) {
	if (level === null) {
		ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
			nodeType: paragraphSchema.type(ctx),
		});
		return;
	}
	ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
		nodeType: headingSchema.type(ctx),
		attrs: { level },
	});
}

function isMarkActive(ctx: Ctx, markType: MarkType): boolean {
	const commands = ctx.get(commandsCtx);
	if (commands.call(isMarkSelectedCommand.key, markType)) {
		return true;
	}
	const { state } = ctx.get(editorViewCtx);
	if (state.storedMarks?.some((mark) => mark.type === markType)) {
		return true;
	}
	if (state.selection instanceof TextSelection) {
		return state.selection.$cursor?.marks().some((mark) => mark.type === markType) ?? false;
	}
	return false;
}

function toggleMarkType(ctx: Ctx, markType: MarkType) {
	return runProseCommand(ctx, toggleMark(markType));
}

function toggleInlineCode(ctx: Ctx) {
	const view = ctx.get(editorViewCtx);
	const { state } = view;
	const markType = inlineCodeSchema.type(ctx);
	if (!state.selection.empty) {
		ctx.get(commandsCtx).call(toggleInlineCodeCommand.key);
		return;
	}
	if (isMarkActive(ctx, markType)) {
		view.dispatch(state.tr.removeStoredMark(markType));
		return;
	}
	view.dispatch(state.tr.addStoredMark(markType.create()));
}

function toggleLink(ctx: Ctx) {
	const view = ctx.get(editorViewCtx);
	const { state } = view;
	const markType = linkSchema.type(ctx);
	if (state.selection.empty && isMarkActive(ctx, markType)) {
		view.dispatch(state.tr.removeStoredMark(markType));
		return;
	}
	ctx.get(commandsCtx).call(toggleLinkCommand.key);
}

function insertTable(ctx: Ctx) {
	const commands = ctx.get(commandsCtx);
	const { from } = ctx.get(editorViewCtx).state.selection;
	commands.call(addBlockTypeCommand.key, {
		nodeType: createTable(ctx, 3, 3),
	});
	commands.call(selectTextNearPosCommand.key, { pos: from });
}

function runProseCommand(ctx: Ctx, command: Command) {
	const view = ctx.get(editorViewCtx);
	const handled = command(view.state, view.dispatch, view);
	if (handled) {
		view.focus();
	}
	return handled;
}

function textIcon(label: string, tooltip: string) {
	const width = Math.max(24, label.length * 15);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">
		<title>${escapeSvgText(tooltip)}</title>
		<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-size="11" font-weight="800" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif" fill="currentColor">${escapeSvgText(label)}</text>
		</svg>`;
}

function isUnderlineHtmlNode(node: unknown) {
	return (
		typeof node === "object" &&
		node !== null &&
		(node as { type?: unknown }).type === "html" &&
		getUnderlineHtmlTag(node) !== null
	);
}

function getUnderlineHtmlTag(node: unknown) {
	if (typeof node !== "object" || node === null) {
		return null;
	}
	const value = (node as { value?: unknown }).value;
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim().toLowerCase();
	if (/^<u(?:\s[^>]*)?>$/.test(normalized)) {
		return "open";
	}
	if (normalized === "</u>") {
		return "close";
	}
	return null;
}

function underlineRemarkHandler(node: any, _: any, state: any, info: any) {
	const exit = state.enter("underline");
	const tracker = state.createTracker(info);
	let value = tracker.move("<u>");
	value += tracker.move(
		state.containerPhrasing(node, {
			before: value,
			after: "</u>",
			...tracker.current(),
		})
	);
	value += tracker.move("</u>");
	exit();
	return value;
}

function withSvgTitle(svg: string, title: string) {
	return svg.replace(/<svg\b([^>]*)>/, `<svg$1><title>${escapeSvgText(title)}</title>`);
}

function escapeSvgText(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const chevronDownIcon =
	'<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>';

const toolbarSeparatorItem = {
	icon: textIcon("|", "分割线"),
	active: () => false,
	onRun: () => false,
};

const topBarIcons = {
	bold:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M8.85758 18.625C8.4358 18.625 8.07715 18.4772 7.78163 18.1817C7.48613 17.8862 7.33838 17.5275 7.33838 17.1058V6.8942C7.33838 6.47242 7.48613 6.11377 7.78163 5.81825C8.07715 5.52275 8.4358 5.375 8.85758 5.375H12.1999C13.2191 5.375 14.1406 5.69231 14.9643 6.32693C15.788 6.96154 16.1999 7.81603 16.1999 8.89038C16.1999 9.63779 16.0194 10.2471 15.6585 10.7183C15.2976 11.1894 14.9088 11.5314 14.4922 11.7442C15.005 11.9211 15.4947 12.2708 15.9614 12.7933C16.428 13.3157 16.6614 14.0192 16.6614 14.9038C16.6614 16.182 16.1902 17.1217 15.2479 17.723C14.3056 18.3243 13.3563 18.625 12.3999 18.625H8.85758ZM9.4883 16.6327H12.3191C13.1063 16.6327 13.6627 16.4141 13.9884 15.9769C14.314 15.5397 14.4768 15.1205 14.4768 14.7192C14.4768 14.3179 14.314 13.8987 13.9884 13.4615C13.6627 13.0243 13.0909 12.8057 12.273 12.8057H9.4883V16.6327ZM9.4883 10.875H12.0826C12.6903 10.875 13.172 10.7013 13.5278 10.3539C13.8836 10.0064 14.0615 9.59037 14.0615 9.10575C14.0615 8.59035 13.8733 8.16918 13.497 7.84225C13.1207 7.51533 12.6595 7.35188 12.1133 7.35188H9.4883V10.875Z"/></svg>',
	italic:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M6.29811 18.625C6.04505 18.625 5.83115 18.5375 5.65641 18.3626C5.48166 18.1877 5.39429 17.9736 5.39429 17.7203C5.39429 17.467 5.48166 17.2532 5.65641 17.0788C5.83115 16.9045 6.04505 16.8173 6.29811 16.8173H9.21159L12.452 7.18265H9.53851C9.28545 7.18265 9.07155 7.0952 8.89681 6.9203C8.72206 6.7454 8.63469 6.5313 8.63469 6.278C8.63469 6.02472 8.72206 5.81089 8.89681 5.63652C9.07155 5.46217 9.28545 5.375 9.53851 5.375H16.8847C17.1377 5.375 17.3516 5.46245 17.5264 5.63735C17.7011 5.81225 17.7885 6.02634 17.7885 6.27962C17.7885 6.53293 17.7011 6.74676 17.5264 6.92113C17.3516 7.09548 17.1377 7.18265 16.8847 7.18265H14.2789L11.0385 16.8173H13.6443C13.8973 16.8173 14.1112 16.9048 14.286 17.0797C14.4607 17.2546 14.5481 17.4687 14.5481 17.722C14.5481 17.9752 14.4607 18.1891 14.286 18.3634C14.1112 18.5378 13.8973 18.625 13.6443 18.625H6.29811Z"/></svg>',
	strikethrough:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3.25 13.7404C3.0375 13.7404 2.85938 13.6684 2.71563 13.5246C2.57188 13.3808 2.5 13.2026 2.5 12.99C2.5 12.7774 2.57188 12.5993 2.71563 12.4558C2.85938 12.3122 3.0375 12.2404 3.25 12.2404H20.75C20.9625 12.2404 21.1406 12.3123 21.2843 12.4561C21.4281 12.5999 21.5 12.7781 21.5 12.9907C21.5 13.2033 21.4281 13.3814 21.2843 13.525C21.1406 13.6686 20.9625 13.7404 20.75 13.7404H3.25ZM10.9423 10.2596V6.62495H6.5673C6.2735 6.62495 6.02377 6.52201 5.8181 6.31613C5.61245 6.11026 5.50963 5.86027 5.50963 5.56615C5.50963 5.27205 5.61245 5.02083 5.8181 4.8125C6.02377 4.60417 6.2735 4.5 6.5673 4.5H17.4423C17.7361 4.5 17.9858 4.60294 18.1915 4.80883C18.3971 5.01471 18.5 5.2647 18.5 5.5588C18.5 5.85292 18.3971 6.10413 18.1915 6.31245C17.9858 6.52078 17.7361 6.62495 17.4423 6.62495H13.0673V10.2596H10.9423ZM10.9423 15.7211H13.0673V18.4423C13.0673 18.7361 12.9643 18.9858 12.7584 19.1915C12.5526 19.3971 12.3026 19.5 12.0085 19.5C11.7144 19.5 11.4631 19.3962 11.2548 19.1887C11.0465 18.9811 10.9423 18.7291 10.9423 18.4327V15.7211Z"/></svg>',
	underline:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M6 4v6a6 6 0 0 0 12 0V4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
	inlineCode:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M9.4 16.6L4.8 12L9.4 7.4L8 6L2 12L8 18L9.4 16.6ZM14.6 16.6L19.2 12L14.6 7.4L16 6L22 12L16 18L14.6 16.6Z"/></svg>',
	quote:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M7.17 17C7.68 17 8.15 16.71 8.37 16.26L9.79 13.42C9.93 13.14 10 12.84 10 12.53V8C10 7.45 9.55 7 9 7H5C4.45 7 4 7.45 4 8V12C4 12.55 4.45 13 5 13H7L5.97 15.06C5.52 15.95 6.17 17 7.17 17ZM17.17 17C17.68 17 18.15 16.71 18.37 16.26L19.79 13.42C19.93 13.14 20 12.84 20 12.53V8C20 7.45 19.55 7 19 7H15C14.45 7 14 7.45 14 8V12C14 12.55 14.45 13 15 13H17L15.97 15.06C15.52 15.95 16.17 17 17.17 17Z"/></svg>',
	bulletList:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 10.5C3.17 10.5 2.5 11.17 2.5 12C2.5 12.83 3.17 13.5 4 13.5C4.83 13.5 5.5 12.83 5.5 12C5.5 11.17 4.83 10.5 4 10.5ZM4 4.5C3.17 4.5 2.5 5.17 2.5 6C2.5 6.83 3.17 7.5 4 7.5C4.83 7.5 5.5 6.83 5.5 6C5.5 5.17 4.83 4.5 4 4.5ZM4 16.5C3.17 16.5 2.5 17.18 2.5 18C2.5 18.82 3.18 19.5 4 19.5C4.82 19.5 5.5 18.82 5.5 18C5.5 17.18 4.83 16.5 4 16.5ZM8 19H20C20.55 19 21 18.55 21 18C21 17.45 20.55 17 20 17H8C7.45 17 7 17.45 7 18C7 18.55 7.45 19 8 19ZM8 13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11H8C7.45 11 7 11.45 7 12C7 12.55 7.45 13 8 13ZM7 6C7 6.55 7.45 7 8 7H20C20.55 7 21 6.55 21 6C21 5.45 20.55 5 20 5H8C7.45 5 7 5.45 7 6Z"/></svg>',
	orderedList:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M8 7H20C20.55 7 21 6.55 21 6C21 5.45 20.55 5 20 5H8C7.45 5 7 5.45 7 6C7 6.55 7.45 7 8 7ZM20 17H8C7.45 17 7 17.45 7 18C7 18.55 7.45 19 8 19H20C20.55 19 21 18.55 21 18C21 17.45 20.55 17 20 17ZM20 11H8C7.45 11 7 11.45 7 12C7 12.55 7.45 13 8 13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11ZM4.5 16H2.5C2.22 16 2 16.22 2 16.5C2 16.78 2.22 17 2.5 17H4V17.5H3.5C3.22 17.5 3 17.72 3 18C3 18.28 3.22 18.5 3.5 18.5H4V19H2.5C2.22 19 2 19.22 2 19.5C2 19.78 2.22 20 2.5 20H4.5C4.78 20 5 19.78 5 19.5V16.5C5 16.22 4.78 16 4.5 16ZM2.5 5H3V7.5C3 7.78 3.22 8 3.5 8C3.78 8 4 7.78 4 7.5V4.5C4 4.22 3.78 4 3.5 4H2.5C2.22 4 2 4.22 2 4.5C2 4.78 2.22 5 2.5 5ZM4.5 10H2.5C2.22 10 2 10.22 2 10.5C2 10.78 2.22 11 2.5 11H3.8L2.12 12.96C2.04 13.05 2 13.17 2 13.28V13.5C2 13.78 2.22 14 2.5 14H4.5C4.78 14 5 13.78 5 13.5C5 13.22 4.78 13 4.5 13H3.2L4.88 11.04C4.96 10.95 5 10.83 5 10.72V10.5C5 10.22 4.78 10 4.5 10Z"/></svg>',
	taskList:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5.66936 16.3389L9.39244 12.6158C9.54115 12.4671 9.71679 12.3937 9.91936 12.3957C10.1219 12.3976 10.2975 12.4761 10.4463 12.6312C10.5847 12.7823 10.654 12.9585 10.654 13.1599C10.654 13.3613 10.5847 13.5363 10.4463 13.6851L6.32704 17.8197C6.14627 18.0004 5.93538 18.0908 5.69436 18.0908C5.45333 18.0908 5.24243 18.0004 5.06166 17.8197L3.01744 15.7754C2.87899 15.637 2.81136 15.4629 2.81456 15.2533C2.81776 15.0437 2.88859 14.8697 3.02706 14.7312C3.16551 14.5928 3.34008 14.5235 3.55076 14.5235C3.76144 14.5235 3.93494 14.5928 4.07126 14.7312L5.66936 16.3389ZM5.66936 8.72359L9.39244 5.00049C9.54115 4.85177 9.71679 4.77838 9.91936 4.78031C10.1219 4.78223 10.2975 4.86075 10.4463 5.01586C10.5847 5.16691 10.654 5.34314 10.654 5.54454C10.654 5.74592 10.5847 5.92097 10.4463 6.06969L6.32704 10.2043C6.14627 10.3851 5.93538 10.4755 5.69436 10.4755C5.45333 10.4755 5.24243 10.3851 5.06166 10.2043L3.01744 8.16009C2.87899 8.02162 2.81136 7.84759 2.81456 7.63799C2.81776 7.42837 2.88859 7.25433 3.02706 7.11586C3.16551 6.97741 3.34008 6.90819 3.55076 6.90819C3.76144 6.90819 3.93494 6.97741 4.07126 7.11586L5.66936 8.72359ZM13.7597 16.5581C13.5472 16.5581 13.3691 16.4862 13.2253 16.3424C13.0816 16.1986 13.0097 16.0204 13.0097 15.8078C13.0097 15.5952 13.0816 15.4171 13.2253 15.2735C13.3691 15.13 13.5472 15.0582 13.7597 15.0582H20.7597C20.9722 15.0582 21.1503 15.1301 21.2941 15.2739C21.4378 15.4177 21.5097 15.5959 21.5097 15.8085C21.5097 16.0211 21.4378 16.1992 21.2941 16.3427C21.1503 16.4863 20.9722 16.5581 20.7597 16.5581H13.7597ZM13.7597 8.94276C13.5472 8.94276 13.3691 8.87085 13.2253 8.72704C13.0816 8.58324 13.0097 8.40504 13.0097 8.19244C13.0097 7.97985 13.0816 7.80177 13.2253 7.65819C13.3691 7.5146 13.5472 7.44281 13.7597 7.44281H20.7597C20.9722 7.44281 21.1503 7.51471 21.2941 7.65851C21.4378 7.80233 21.5097 7.98053 21.5097 8.19311C21.5097 8.40571 21.4378 8.5838 21.2941 8.72739C21.1503 8.87097 20.9722 8.94276 20.7597 8.94276H13.7597Z"/></svg>',
	codeBlock:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 3h18a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v14h16V5H4zm8 10h6v2h-6v-2zm-3.333-3L5.838 9.172l1.415-1.415L11.495 12l-4.242 4.243-1.415-1.415L8.667 12z"/></svg>',
	math:
		'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M7 19v-.808L13.096 12L7 5.808V5h10v1.25H9.102L14.727 12l-5.625 5.77H17V19z"/></svg>',
	link:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M17.0385 19.5003V16.5388H14.0769V15.0388H17.0385V12.0773H18.5384V15.0388H21.5V16.5388H18.5384V19.5003H17.0385ZM10.8077 16.5388H7.03845C5.78282 16.5388 4.7125 16.0963 3.8275 15.2114C2.9425 14.3266 2.5 13.2564 2.5 12.0009C2.5 10.7454 2.9425 9.67504 3.8275 8.78979C4.7125 7.90454 5.78282 7.46191 7.03845 7.46191H10.8077V8.96186H7.03845C6.1987 8.96186 5.48235 9.25834 4.8894 9.85129C4.29645 10.4442 3.99998 11.1606 3.99998 12.0003C3.99998 12.8401 4.29645 13.5564 4.8894 14.1494C5.48235 14.7423 6.1987 15.0388 7.03845 15.0388H10.8077V16.5388ZM8.25 12.7503V11.2504H15.75V12.7503H8.25ZM21.5 12.0003H20C20 11.1606 19.7035 10.4442 19.1106 9.85129C18.5176 9.25834 17.8013 8.96186 16.9615 8.96186H13.1923V7.46191H16.9615C18.2171 7.46191 19.2875 7.90441 20.1725 8.78939C21.0575 9.67439 21.5 10.7447 21.5 12.0003Z"/></svg>',
	table:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M20 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H20C21.1 21 22 20.1 22 19V5C22 3.9 21.1 3 20 3ZM20 5V8H5V5H20ZM15 19H10V10H15V19ZM5 10H8V19H5V10ZM17 19V10H20V19H17Z"/></svg>',
	undo:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 7H5V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 7.5C7.1 5.35 9.65 4 12.5 4C17.2 4 21 7.8 21 12.5C21 17.2 17.2 21 12.5 21C9.4 21 6.7 19.35 5.2 16.88" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
	redo:
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M15 7H19V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 7.5C16.9 5.35 14.35 4 11.5 4C6.8 4 3 7.8 3 12.5C3 17.2 6.8 21 11.5 21C14.6 21 17.3 19.35 18.8 16.88" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

const tableTopBarTooltips = new Map([
	["|", "分割线"],
	["表格", "插入表格"],
	["+行", "添加行"],
	["+列", "添加列"],
	["-行", "删除行"],
	["-列", "删除列"],
	["删表", "删除表格"],
]);

function applyTopBarTooltips(root: HTMLElement) {
	const topBar = root.querySelector(".milkdown-top-bar");
	if (!topBar) {
		return;
	}

	ensureTopBarRows(topBar);
	setTooltip(topBar.querySelector(".top-bar-heading-button"), "正文/标题");

	topBar.querySelectorAll(".top-bar-item").forEach((button) => {
		const textLabel = button.querySelector("text")?.textContent?.trim();
		if (textLabel === "|") {
			markToolbarSeparator(button);
			return;
		}
		const titleLabel = button.querySelector("title")?.textContent?.trim();
		const label = titleLabel ?? (textLabel ? tableTopBarTooltips.get(textLabel) : undefined) ?? "工具";
		setTooltip(button, label);
	});
}

function setTooltip(element: Element | null, label: string) {
	if (!(element instanceof HTMLElement)) {
		return;
	}
	element.dataset.tooltip = label;
	element.setAttribute("aria-label", label);
}

function ensureTopBarRows(topBar: Element) {
	const inner = topBar.querySelector(".top-bar-inner");
	if (!(inner instanceof HTMLElement) || inner.dataset.layoutUpdating === "true") {
		return;
	}

	const directChildren = Array.from(inner.children);
	const directControls = directChildren.filter(isTopBarControlElement);
	const existingRows = directChildren.filter((child) => child.classList.contains("top-bar-row"));
	if (existingRows.length === 3 && directControls.length === 0) {
		return;
	}

	inner.dataset.layoutUpdating = "true";
	try {
		existingRows.forEach((row) => {
			while (row.firstChild) {
				inner.insertBefore(row.firstChild, row);
			}
			row.remove();
		});

		const controls = Array.from(inner.children).filter(isTopBarControlElement) as HTMLElement[];
		const rowTwoStart = controls.findIndex((element) => getTopBarControlLabel(element) === "无序列表");
		const rowThreeStart = controls.findIndex((element) => getTopBarControlLabel(element) === "插入表格");
		if (rowTwoStart <= 0 || rowThreeStart <= rowTwoStart) {
			return;
		}

		[
			controls.slice(0, rowTwoStart),
			controls.slice(rowTwoStart, rowThreeStart),
			controls.slice(rowThreeStart),
		].forEach((rowControls, index) => {
			const row = document.createElement("div");
			row.className = "top-bar-row";
			row.dataset.toolbarRow = String(index + 1);
			inner.append(row);
			rowControls.forEach((element) => row.append(element));
		});
	} finally {
		delete inner.dataset.layoutUpdating;
	}
}

function isTopBarControlElement(element: Element): element is HTMLElement {
	return (
		element instanceof HTMLElement &&
		(element.classList.contains("top-bar-heading-selector") ||
			element.classList.contains("top-bar-item"))
	);
}

function getTopBarControlLabel(element: Element) {
	const titleLabel = element.querySelector("title")?.textContent?.trim();
	if (titleLabel) {
		return titleLabel;
	}
	const textLabel = element.querySelector("text")?.textContent?.trim();
	return textLabel ? tableTopBarTooltips.get(textLabel) ?? textLabel : "";
}

function markToolbarSeparator(element: Element) {
	if (!(element instanceof HTMLElement)) {
		return;
	}
	delete element.dataset.tooltip;
	element.dataset.toolbarRole = "separator";
	element.tabIndex = -1;
	element.setAttribute("aria-hidden", "true");
	element.removeAttribute("aria-label");
}

function hasImageClipboardItem(data: DataTransfer) {
	return Array.from(data.items).some(
		(item) => item.kind === "file" && item.type.toLowerCase().startsWith("image/")
	);
}
