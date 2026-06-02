import {
	Bot,
	Copy,
	FilePlus2,
	MessageSquareText,
	Moon,
	Save,
	Sun,
	X,
} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import {
	createNote as createBackendNote,
	deleteNote as deleteBackendNote,
	listNotes as listBackendNotes,
	updateNote as updateBackendNote,
	uploadNoteAsset as uploadBackendNoteAsset,
} from "./notesApi";
import {
	MarkdownNoteEditor,
	type MarkdownNoteEditorHandle,
} from "./MarkdownNoteEditor";
import type { DraftNote, Note, NoteAsset, SelectionToolbar } from "./types";

type Page = "chat" | "notes";
export type FloatingNotesCoreHandle = {
	open: (page?: Page) => void;
	close: () => void;
	toggle: () => void;
	refresh: () => Promise<void>;
};

type FloatingNotesCoreProps = {
	apiBase?: string;
	floatButton?: boolean;
	title?: string;
};

type Particle = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	decay: number;
	size: number;
	hue: number;
};

type SwipeState = {
	noteId: string;
	startX: number;
	startY: number;
	lastX: number;
	dragging: boolean;
	moved: boolean;
};

type NoteBridgeRequest =
	| { action: "list"; payload?: undefined }
	| { action: "create"; payload: { note: DraftNote } }
	| { action: "update"; payload: { id: string; note: DraftNote } }
	| { action: "delete"; payload: { id: string } }
	| { action: "uploadAsset"; payload: { id: string; file: File } };

type PendingBridgeRequest = {
	resolve: (value: unknown) => void;
	reject: (reason?: unknown) => void;
	timer: number;
};

type BridgeStatus = "pending" | "ready" | "unauthenticated";

type PendingBridgeReady = {
	resolve: () => void;
	reject: (reason?: unknown) => void;
	timer: number;
};

function makeSelectionTitle(text: string) {
	const normalized = String(text || "").trim().replace(/\s+/g, " ");
	const prefix = Array.from(normalized).slice(0, 10).join("") || "新笔记";
	return `${prefix}...`;
}

function noteLoadErrorMessage(error: unknown) {
	const message = error instanceof Error ? error.message : String(error || "");
	if (/unauthorized/i.test(message)) {
		return "请先在 AI 聊天页登录后查看笔记";
	}
	if (message.includes("AI 聊天页")) {
		return "AI 聊天页加载中，请稍后重试";
	}
	return "笔记加载失败，请确认后端服务已启动";
}

const MAX_PASTE_FILE_COUNT = 5;

function makePastedAssetMarkdown(file: File, url: string) {
	const name = escapeMarkdownLabel(file.name || "pasted-file");
	const mimeType = (file.type || "").toLowerCase();
	if (mimeType.startsWith("image/")) {
		return `![${name}](${url})`;
	}
	if (mimeType.startsWith("video/")) {
		return `<video controls src="${escapeHtmlAttribute(url)}"></video>`;
	}
	if (mimeType.startsWith("audio/")) {
		return `<audio controls src="${escapeHtmlAttribute(url)}"></audio>`;
	}
	return `[${name}](${url})`;
}

function containsPendingAssetReference(markdown: string) {
	return /\bblob:|__uploading_asset_/.test(markdown);
}

function hasDetailChanges(
	title: string,
	markdown: string,
	savedTitle: string,
	savedMarkdown: string
) {
	return title.trim() !== savedTitle.trim() || markdown !== savedMarkdown;
}

function escapeMarkdownLabel(value: string) {
	return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function escapeHtmlAttribute(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function assetUploadErrorMessage(error: unknown) {
	const message = error instanceof Error ? error.message : String(error || "");
	if (/413|too large|file too large|exceeds/i.test(message)) {
		return "附件太大";
	}
	if (/unsupported|mime|content type|file type/i.test(message)) {
		return "文件类型暂不支持";
	}
	if (/unauthorized/i.test(message)) {
		return "请先登录后上传附件";
	}
	return "附件上传失败";
}

async function copyText(text: string) {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}

	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "readonly");
	textarea.style.position = "fixed";
	textarea.style.left = "-9999px";
	textarea.style.top = "0";
	document.body.appendChild(textarea);
	textarea.select();
	const ok = document.execCommand("copy");
	textarea.remove();
	if (!ok) {
		throw new Error("copy failed");
	}
}

function isTextControl(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
	return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

const TOOLBAR_WIDTH_GUESS = 155;
const TOOLBAR_HEIGHT_GUESS = 37;
const TOOLBAR_EDGE_GAP = 8;

type ToolbarRect = {
	left: number;
	top: number;
	width: number;
	height: number;
	bottom: number;
};

function getDeepActiveElement(root: Document | ShadowRoot = document): Element | null {
	const activeElement = root.activeElement;
	if (!activeElement) {
		return null;
	}
	if (activeElement.shadowRoot?.activeElement) {
		return getDeepActiveElement(activeElement.shadowRoot) ?? activeElement;
	}
	return activeElement;
}

function getToolbarPosition(rect: ToolbarRect) {
	const left = Math.max(
		TOOLBAR_EDGE_GAP + TOOLBAR_WIDTH_GUESS / 2,
		Math.min(
			rect.left + rect.width / 2,
			window.innerWidth - TOOLBAR_EDGE_GAP - TOOLBAR_WIDTH_GUESS / 2
		)
	);
	const top = Math.max(
		TOOLBAR_EDGE_GAP,
		Math.min(rect.bottom + TOOLBAR_EDGE_GAP, window.innerHeight - TOOLBAR_HEIGHT_GUESS)
	);
	return { left, top };
}

function getTextControlSelectionRect(
	control: HTMLInputElement | HTMLTextAreaElement,
	start: number,
	end: number
): ToolbarRect | null {
	const ownerDocument = control.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	const body = ownerDocument.body;
	if (!ownerWindow || !body) {
		return null;
	}

	const controlRect = control.getBoundingClientRect();
	if (!controlRect.width && !controlRect.height) {
		return null;
	}

	const computed = ownerWindow.getComputedStyle(control);
	const mirror = ownerDocument.createElement("div");
	const marker = ownerDocument.createElement("span");
	const copyProperties = [
		"box-sizing",
		"font-family",
		"font-size",
		"font-style",
		"font-weight",
		"letter-spacing",
		"line-height",
		"text-align",
		"text-indent",
		"text-transform",
		"word-spacing",
		"word-break",
		"overflow-wrap",
		"padding-top",
		"padding-right",
		"padding-bottom",
		"padding-left",
		"border-top-width",
		"border-right-width",
		"border-bottom-width",
		"border-left-width",
		"border-top-style",
		"border-right-style",
		"border-bottom-style",
		"border-left-style",
		"tab-size",
		"direction",
	];

	copyProperties.forEach((property) => {
		mirror.style.setProperty(property, computed.getPropertyValue(property));
	});

	mirror.style.position = "fixed";
	mirror.style.left = `${controlRect.left}px`;
	mirror.style.top = `${controlRect.top}px`;
	mirror.style.width = `${controlRect.width}px`;
	mirror.style.height = `${controlRect.height}px`;
	mirror.style.overflow = "hidden";
	mirror.style.visibility = "hidden";
	mirror.style.pointerEvents = "none";
	mirror.style.background = "transparent";
	mirror.style.color = "transparent";
	mirror.style.zIndex = "-1";
	mirror.style.whiteSpace = control instanceof HTMLInputElement ? "pre" : "pre-wrap";
	mirror.style.overflowWrap = computed.overflowWrap || "break-word";

	marker.style.whiteSpace = "inherit";
	marker.textContent = control.value.slice(start, end) || "\u200b";
	mirror.textContent = control.value.slice(0, start);
	mirror.append(marker, ownerDocument.createTextNode(control.value.slice(end) || "\u200b"));
	body.appendChild(mirror);

	mirror.scrollTop = control.scrollTop;
	mirror.scrollLeft = control.scrollLeft;

	const rects = Array.from(marker.getClientRects()).filter(
		(rect) => rect.width > 0 && rect.height > 0
	);
	const rect = rects[0] ?? marker.getBoundingClientRect();
	const result =
		rect && (rect.width || rect.height)
			? {
					left: rect.left,
					top: rect.top,
					width: rect.width,
					height: rect.height,
					bottom: rect.bottom,
				}
			: null;

	mirror.remove();
	return result;
}

function getTextControlSelectionToolbar(
	control: HTMLInputElement | HTMLTextAreaElement
): SelectionToolbar | null {
	const selectionStart = control.selectionStart;
	const selectionEnd = control.selectionEnd;
	if (selectionStart === null || selectionEnd === null || selectionStart === selectionEnd) {
		return null;
	}

	const start = Math.min(selectionStart, selectionEnd);
	const end = Math.max(selectionStart, selectionEnd);
	const text = control.value.slice(start, end).trim();
	if (!text) {
		return null;
	}

	const rect = getTextControlSelectionRect(control, start, end) ?? control.getBoundingClientRect();
	const position = getToolbarPosition(rect);
	return { text, ...position };
}

export const FloatingNotesCore = forwardRef<FloatingNotesCoreHandle, FloatingNotesCoreProps>(
function FloatingNotesCore(
	{ apiBase = "", floatButton = true, title = "笔记" },
	ref
) {
	const [notes, setNotes] = useState<Note[]>([]);
	const [notesState, setNotesState] = useState("加载中...");
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [activePage, setActivePage] = useState<Page>("notes");
	const [isDark, setIsDark] = useState(true);
	const [toolbar, setToolbar] = useState<SelectionToolbar | null>(null);
	const [toolbarText, setToolbarText] = useState("");
	const [detailOpen, setDetailOpen] = useState(false);
	const [currentNoteId, setCurrentNoteId] = useState<string | null>(null);
	const [detailTitle, setDetailTitle] = useState("");
	const [detailMarkdown, setDetailMarkdown] = useState("");
	const [savedDetailTitle, setSavedDetailTitle] = useState("");
	const [savedDetailMarkdown, setSavedDetailMarkdown] = useState("");
	const [detailEditorKey, setDetailEditorKey] = useState(0);
	const [toast, setToast] = useState("");
	const [bottomGlow, setBottomGlow] = useState(false);
	const [rightGlow, setRightGlow] = useState(false);
	const [edgeGlow, setEdgeGlow] = useState(false);
	const [swipedNoteId, setSwipedNoteId] = useState<string | null>(null);

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const drawerRef = useRef<HTMLElement | null>(null);
	const toolbarRef = useRef<HTMLDivElement | null>(null);
	const chatFrameRef = useRef<HTMLIFrameElement | null>(null);
	const markdownEditorRef = useRef<MarkdownNoteEditorHandle | null>(null);
	const particlesRef = useRef<Particle[]>([]);
	const particleRafRef = useRef(0);
	const selectionTimerRef = useRef(0);
	const toastTimerRef = useRef(0);
	const toolbarActionRef = useRef({ action: "", at: 0 });
	const swipeRef = useRef<SwipeState | null>(null);
	const blockedNoteClickRef = useRef("");
	const bridgeRequestIdRef = useRef(0);
	const pendingBridgeRequestsRef = useRef<Map<number, PendingBridgeRequest>>(new Map());
	const bridgeStatusRef = useRef<BridgeStatus>("pending");
	const pendingBridgeReadyRef = useRef<Set<PendingBridgeReady>>(new Set());
	const currentNoteIdRef = useRef<string | null>(null);
	const detailTitleRef = useRef("");
	const pendingAssetUploadsRef = useRef<Set<Promise<void>>>(new Set());
	const ensureUploadNotePromiseRef = useRef<Promise<string> | null>(null);
	const chatFrameSrc = `${apiBase.replace(/\/$/, "") || window.location.origin}/?embed=1`;

	const hasUnsavedDetail =
		detailOpen &&
		hasDetailChanges(detailTitle, detailMarkdown, savedDetailTitle, savedDetailMarkdown);

	const showToast = useCallback((message: string) => {
		window.clearTimeout(toastTimerRef.current);
		setToast(message);
		toastTimerRef.current = window.setTimeout(() => setToast(""), 900);
	}, []);

	useEffect(() => {
		currentNoteIdRef.current = currentNoteId;
	}, [currentNoteId]);

	useEffect(() => {
		detailTitleRef.current = detailTitle;
	}, [detailTitle]);

	const useNotesBridge = useCallback(() => {
		try {
			return new URL(chatFrameSrc).origin !== window.location.origin;
		} catch {
			return false;
		}
	}, [chatFrameSrc]);

	const updateBridgeStatus = useCallback((status: BridgeStatus) => {
		bridgeStatusRef.current = status;
		if (status === "pending") {
			return;
		}

		pendingBridgeReadyRef.current.forEach((pending) => {
			window.clearTimeout(pending.timer);
			if (status === "ready") {
				pending.resolve();
			} else {
				pending.reject(new Error("unauthorized"));
			}
		});
		pendingBridgeReadyRef.current.clear();
	}, []);

	const waitForNotesBridge = useCallback(() => {
		if (!useNotesBridge()) {
			return Promise.resolve();
		}
		if (bridgeStatusRef.current === "ready") {
			return Promise.resolve();
		}
		if (bridgeStatusRef.current === "unauthenticated") {
			return Promise.reject(new Error("unauthorized"));
		}

		return new Promise<void>((resolve, reject) => {
			const pending: PendingBridgeReady = {
				resolve,
				reject,
				timer: window.setTimeout(() => {
					pendingBridgeReadyRef.current.delete(pending);
					reject(new Error("AI 聊天页未响应"));
				}, 8000),
			};
			pendingBridgeReadyRef.current.add(pending);
		});
	}, [useNotesBridge]);

	const requestNotesBridge = useCallback(
		async <T,>(request: NoteBridgeRequest): Promise<T> => {
			await waitForNotesBridge();
			const target = chatFrameRef.current?.contentWindow;
			if (!target) {
				throw new Error("AI 聊天页尚未加载");
			}

			const id = (bridgeRequestIdRef.current += 1);
			const origin = new URL(chatFrameSrc).origin;
			const result = new Promise<T>((resolve, reject) => {
				const timer = window.setTimeout(() => {
					pendingBridgeRequestsRef.current.delete(id);
					reject(new Error("AI 聊天页未响应"));
				}, 5000);
				pendingBridgeRequestsRef.current.set(id, {
					resolve: resolve as (value: unknown) => void,
					reject,
					timer,
				});
			});

			target.postMessage(
				{
					type: "floating-notes:notes-request",
					id,
					action: request.action,
					payload: request.payload,
				},
				origin
			);
			return result;
		},
		[chatFrameSrc, waitForNotesBridge]
	);

	const listCurrentNotes = useCallback(async () => {
		if (useNotesBridge()) {
			return requestNotesBridge<Note[]>({ action: "list" });
		}
		return listBackendNotes(apiBase);
	}, [apiBase, requestNotesBridge, useNotesBridge]);

	const createCurrentNote = useCallback(
		async (note: DraftNote) => {
			if (useNotesBridge()) {
				return requestNotesBridge<Note>({ action: "create", payload: { note } });
			}
			return createBackendNote(note, apiBase);
		},
		[apiBase, requestNotesBridge, useNotesBridge]
	);

	const updateCurrentNote = useCallback(
		async (id: string, note: DraftNote) => {
			if (useNotesBridge()) {
				return requestNotesBridge<Note>({ action: "update", payload: { id, note } });
			}
			return updateBackendNote(id, note, apiBase);
		},
		[apiBase, requestNotesBridge, useNotesBridge]
	);

	const deleteCurrentNote = useCallback(
		async (id: string) => {
			if (useNotesBridge()) {
				return requestNotesBridge<{ success: true }>({ action: "delete", payload: { id } });
			}
			return deleteBackendNote(id, apiBase);
		},
		[apiBase, requestNotesBridge, useNotesBridge]
	);

	const uploadCurrentNoteAsset = useCallback(
		async (id: string, file: File): Promise<NoteAsset> => {
			if (useNotesBridge()) {
				return requestNotesBridge<NoteAsset>({
					action: "uploadAsset",
					payload: { id, file },
				});
			}
			return uploadBackendNoteAsset(id, file, apiBase);
		},
		[apiBase, requestNotesBridge, useNotesBridge]
	);

	const fetchNotes = useCallback(async () => {
		setNotesState("加载中...");
		try {
			const nextNotes = await listCurrentNotes();
			setNotes(nextNotes);
			setNotesState(nextNotes.length ? "" : "暂无笔记");
		} catch (error) {
			console.error(error);
			setNotesState(noteLoadErrorMessage(error));
		}
	}, [listCurrentNotes]);

	const setupCanvas = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.floor(window.innerWidth * ratio);
		canvas.height = Math.floor(window.innerHeight * ratio);
		canvas.style.width = `${window.innerWidth}px`;
		canvas.style.height = `${window.innerHeight}px`;
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	}, []);

	const drawParticles = useCallback(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) {
			particleRafRef.current = 0;
			return;
		}

		ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
		particlesRef.current = particlesRef.current.filter((particle) => particle.life > 0);
		particlesRef.current.forEach((particle) => {
			particle.x += particle.vx;
			particle.y += particle.vy;
			particle.vx *= 0.962;
			particle.vy *= 0.962;
			particle.life -= particle.decay;
			const radius = Math.max(0.01, particle.size * Math.max(0, particle.life));
			ctx.save();
			ctx.globalAlpha = Math.max(0, particle.life);
			ctx.fillStyle = `hsl(${particle.hue}, 90%, 70%)`;
			ctx.shadowColor = `hsl(${particle.hue}, 90%, 70%)`;
			ctx.shadowBlur = 7;
			ctx.beginPath();
			ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		});

		if (particlesRef.current.length) {
			particleRafRef.current = requestAnimationFrame(drawParticles);
		} else {
			particleRafRef.current = 0;
			ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
		}
	}, []);

	const spawnParticles = useCallback(
		(x: number, y: number, count: number, edge: "right" | "bottom") => {
			for (let index = 0; index < count; index += 1) {
				const speed = 2.5 + Math.random() * 5.2;
				const angle =
					edge === "right"
						? Math.random() * Math.PI * 0.68 - Math.PI * 0.34
						: Math.random() * Math.PI * 0.72 + Math.PI * 0.14;
				const hue = Math.random() > 0.48 ? 245 : 186;
				particlesRef.current.push({
					x,
					y,
					vx: edge === "right" ? Math.cos(angle) * speed : (Math.random() - 0.5) * speed,
					vy:
						edge === "bottom"
							? Math.abs(Math.sin(angle) * speed) + 1.5
							: Math.sin(angle) * speed,
					life: 1,
					decay: 0.02 + Math.random() * 0.022,
					size: 2 + Math.random() * 3,
					hue,
				});
			}
			if (!particleRafRef.current) {
				particleRafRef.current = requestAnimationFrame(drawParticles);
			}
		},
		[drawParticles]
	);

	useEffect(() => {
		void fetchNotes();
		setupCanvas();
		window.addEventListener("resize", setupCanvas);
		return () => {
			window.removeEventListener("resize", setupCanvas);
			window.clearTimeout(selectionTimerRef.current);
			window.clearTimeout(toastTimerRef.current);
			if (particleRafRef.current) {
				cancelAnimationFrame(particleRafRef.current);
			}
			pendingBridgeRequestsRef.current.forEach((pending) => {
				window.clearTimeout(pending.timer);
				pending.reject(new Error("组件已卸载"));
			});
			pendingBridgeRequestsRef.current.clear();
			pendingBridgeReadyRef.current.forEach((pending) => {
				window.clearTimeout(pending.timer);
				pending.reject(new Error("组件已卸载"));
			});
			pendingBridgeReadyRef.current.clear();
		};
	}, [fetchNotes, setupCanvas]);

	useEffect(() => {
		const handleSelectionChange = () => {
			window.clearTimeout(selectionTimerRef.current);
			selectionTimerRef.current = window.setTimeout(() => {
				const activeElement = getDeepActiveElement();
				const detailElement = drawerRef.current?.querySelector("#dst-note-detail") ?? null;
				if (
					activePage === "notes" &&
					detailOpen &&
					isTextControl(activeElement) &&
					detailElement?.contains(activeElement)
				) {
					const textControlToolbar = getTextControlSelectionToolbar(activeElement);
					if (textControlToolbar) {
						setToolbarText(textControlToolbar.text);
						setToolbar(textControlToolbar);
						return;
					}
				}

				const selection = window.getSelection();
				const text = selection?.toString().trim() ?? "";
				const anchor = selection?.anchorNode ?? null;
				const focus = selection?.focusNode ?? null;
				const anchorInDrawer = Boolean(anchor && drawerRef.current?.contains(anchor));
				const focusInDrawer = Boolean(focus && drawerRef.current?.contains(focus));
				const anchorInDetail = Boolean(anchor && detailElement?.contains(anchor));
				const focusInDetail = Boolean(focus && detailElement?.contains(focus));
				if (
					(anchor && toolbarRef.current?.contains(anchor)) ||
					(focus && toolbarRef.current?.contains(focus))
				) {
					setToolbar(null);
					return;
				}
				if (!selection || !selection.rangeCount || !text) {
					setToolbar(null);
					return;
				}
				if (
					(anchorInDrawer || focusInDrawer) &&
					(activePage !== "notes" ||
						!detailOpen ||
						!anchorInDetail ||
						!focusInDetail)
				) {
					setToolbar(null);
					return;
				}

				try {
					const range = selection.getRangeAt(0);
					const rects = Array.from(range.getClientRects()).filter(
						(rect) => rect.width > 0 && rect.height > 0
					);
					const rect = rects[0] ?? range.getBoundingClientRect();
					if (!rect || (!rect.width && !rect.height)) {
						setToolbar(null);
						return;
					}
					const { left, top } = getToolbarPosition(rect);
					setToolbarText(text);
					setToolbar({ text, left, top });
				} catch {
					setToolbar(null);
				}
			}, 110);
		};

		const handleOutsidePointer = (event: MouseEvent | TouchEvent) => {
			const target = event.target;
			if (
				target instanceof Element &&
				(target.closest("#dst-toolbar") ||
					target.closest("#dst-float"))
			) {
				return;
			}
			setToolbar(null);
		};

		document.addEventListener("selectionchange", handleSelectionChange);
		document.addEventListener("select", handleSelectionChange, true);
		document.addEventListener("keyup", handleSelectionChange, true);
		document.addEventListener("mouseup", handleSelectionChange, true);
		document.addEventListener("touchend", handleSelectionChange, true);
		document.addEventListener("mousedown", handleOutsidePointer, true);
		document.addEventListener("touchstart", handleOutsidePointer, true);
		return () => {
			document.removeEventListener("selectionchange", handleSelectionChange);
			document.removeEventListener("select", handleSelectionChange, true);
			document.removeEventListener("keyup", handleSelectionChange, true);
			document.removeEventListener("mouseup", handleSelectionChange, true);
			document.removeEventListener("touchend", handleSelectionChange, true);
			document.removeEventListener("mousedown", handleOutsidePointer, true);
			document.removeEventListener("touchstart", handleOutsidePointer, true);
		};
	}, [activePage, detailOpen]);

	const isMobile = () => window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
	const getSaveEdge = (): "right" | "bottom" => (isMobile() ? "bottom" : "right");

	const playSaveAnimation = useCallback(
		(afterAnimation?: () => void) => {
			const edge = getSaveEdge();
			const targetX = edge === "right" ? window.innerWidth - 8 : window.innerWidth / 2;
			const targetY = edge === "right" ? window.innerHeight / 2 : window.innerHeight - 8;
			setRightGlow(edge === "right");
			setBottomGlow(edge === "bottom");
			setEdgeGlow(true);
			spawnParticles(targetX, targetY, 28, edge);
			window.setTimeout(() => {
				setRightGlow(false);
				setBottomGlow(false);
				setEdgeGlow(false);
				afterAnimation?.();
			}, 430);
		},
		[spawnParticles]
	);

	const open = (page: Page = "notes") => {
		setActivePage(page);
		setDrawerOpen(true);
		if (page === "notes") {
			void fetchNotes();
		}
	};

	const confirmDiscardDetailChanges = () => {
		const currentMarkdown = markdownEditorRef.current?.getMarkdown() ?? detailMarkdown;
		const isDirty =
			detailOpen &&
			hasDetailChanges(detailTitle, currentMarkdown, savedDetailTitle, savedDetailMarkdown);
		if (!isDirty) {
			return true;
		}
		return window.confirm("有未保存修改，确定离开吗？");
	};

	const close = () => {
		if (!confirmDiscardDetailChanges()) {
			return;
		}
		setDrawerOpen(false);
		setDetailOpen(false);
	};

	const openDrawerWithText = (text: string) => {
		open("chat");
		window.setTimeout(() => {
			postSelectionToChat(text);
		}, 260);
	};

	const postSelectionToChat = (text: string) => {
		const target = chatFrameRef.current?.contentWindow;
		if (!target) {
			return;
		}
		target.postMessage({ type: "floating-notes:ask", text }, new URL(chatFrameSrc).origin);
	};

	const postThemeToChat = useCallback(() => {
		const target = chatFrameRef.current?.contentWindow;
		if (!target) {
			return;
		}
		target.postMessage(
			{ type: "floating-notes:theme", theme: isDark ? "dark" : "light" },
			new URL(chatFrameSrc).origin
		);
	}, [chatFrameSrc, isDark]);

	useEffect(() => {
		postThemeToChat();
	}, [postThemeToChat]);

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			if (
				event.source !== chatFrameRef.current?.contentWindow ||
				event.origin !== new URL(chatFrameSrc).origin ||
				typeof event.data !== "object" ||
				event.data === null
			) {
				return;
			}

			if (event.data.type === "floating-notes:notes-response") {
				const id = typeof event.data.id === "number" ? event.data.id : 0;
				const pending = pendingBridgeRequestsRef.current.get(id);
				if (!pending) {
					return;
				}
				window.clearTimeout(pending.timer);
				pendingBridgeRequestsRef.current.delete(id);
				if (event.data.ok === true) {
					pending.resolve(event.data.data);
				} else {
					pending.reject(new Error(typeof event.data.error === "string" ? event.data.error : "请求失败"));
				}
				return;
			}

			if (event.data.type === "floating-notes:bridge-ready") {
				if (event.data.authenticated === true) {
					updateBridgeStatus("ready");
					void fetchNotes();
				} else {
					updateBridgeStatus("unauthenticated");
					setNotes([]);
					setNotesState("请先在 AI 聊天页登录后查看笔记");
				}
				return;
			}

			if (event.data.type !== "floating-notes:notes-changed") {
				return;
			}
			if (event.data.animateSave === true) {
				playSaveAnimation(() => void fetchNotes());
				return;
			}
			void fetchNotes();
		};

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [chatFrameSrc, fetchNotes, playSaveAnimation, updateBridgeStatus]);

	const saveSelectionNote = async (text: string) => {
		const content = text.trim();
		if (!content) {
			return;
		}
		playSaveAnimation(() => {
			void (async () => {
				try {
					await createCurrentNote({ title: makeSelectionTitle(content), markdown: content });
					await fetchNotes();
					showToast("已存入笔记");
				} catch (error) {
					console.error(error);
					showToast("保存失败");
				}
			})();
		});
	};

	const runToolbarAction = (action: "ask" | "copy" | "save") => {
		const now = Date.now();
		if (
			toolbarActionRef.current.action === action &&
			now - toolbarActionRef.current.at < 600
		) {
			return;
		}
		toolbarActionRef.current = { action, at: now };
		const text = action === "save" ? toolbarText : toolbar?.text || toolbarText;
		if (!text) {
			showToast("未获取到选中文字");
			return;
		}

		if (action === "ask") {
			openDrawerWithText(text);
			setToolbar(null);
			return;
		}

		if (action === "copy") {
			void copyText(text)
				.then(() => showToast("已复制"))
				.catch(() => showToast("复制失败"));
			setToolbar(null);
			setToolbarText("");
			return;
		}

		setToolbar(null);
		void saveSelectionNote(text).finally(() => setToolbarText(""));
	};

	const scheduleSelectionToolbar = () => {
		window.clearTimeout(selectionTimerRef.current);
		selectionTimerRef.current = window.setTimeout(() => {
			document.dispatchEvent(new Event("selectionchange"));
		}, 0);
	};

	const stopToolbarPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const ensureCurrentNoteForUpload = useCallback(
		async (markdownSnapshot: string) => {
			const existingId = currentNoteIdRef.current;
			if (existingId) {
				return existingId;
			}
			if (ensureUploadNotePromiseRef.current) {
				return ensureUploadNotePromiseRef.current;
			}

			const titleForUpload = detailTitleRef.current.trim() || "未命名笔记";
			if (!detailTitleRef.current.trim()) {
				detailTitleRef.current = titleForUpload;
				setDetailTitle(titleForUpload);
			}

			const promise = createCurrentNote({ title: titleForUpload, markdown: markdownSnapshot })
				.then((created) => {
					const title = created.title || titleForUpload;
					currentNoteIdRef.current = created.id;
					detailTitleRef.current = title;
					setCurrentNoteId(created.id);
					setDetailTitle(title);
					setSavedDetailTitle(title);
					setSavedDetailMarkdown(markdownSnapshot);
					setNotes((current) => [created, ...current.filter((note) => note.id !== created.id)]);
					setNotesState("");
					return created.id;
				})
				.finally(() => {
					ensureUploadNotePromiseRef.current = null;
				});
			ensureUploadNotePromiseRef.current = promise;
			return promise;
		},
		[createCurrentNote]
	);

	const waitForPendingAssetUploads = useCallback(async () => {
		const pendingUploads = Array.from(pendingAssetUploadsRef.current);
		if (!pendingUploads.length) {
			return;
		}
		showToast("附件上传中");
		await Promise.allSettled(pendingUploads);
	}, [showToast]);

	const uploadPastedFile = useCallback(
		async (file: File, tempUrl: string, markdownBeforePaste: string) => {
			try {
				const noteId = await ensureCurrentNoteForUpload(markdownBeforePaste);
				const asset = await uploadCurrentNoteAsset(noteId, file);
				const editor = markdownEditorRef.current;
				const currentMarkdown = editor?.getMarkdown() ?? detailMarkdown;
				const nextMarkdown = editor
					? editor.replaceMarkdown(tempUrl, asset.publicUrl)
					: currentMarkdown.split(tempUrl).join(asset.publicUrl);
				setDetailMarkdown(nextMarkdown);
				window.URL.revokeObjectURL(tempUrl);

				if (containsPendingAssetReference(nextMarkdown)) {
					return;
				}

				const titleForSave = detailTitleRef.current.trim() || "未命名笔记";
				if (!detailTitleRef.current.trim()) {
					detailTitleRef.current = titleForSave;
					setDetailTitle(titleForSave);
				}
				await updateCurrentNote(noteId, { title: titleForSave, markdown: nextMarkdown });
				setSavedDetailTitle(titleForSave);
				setSavedDetailMarkdown(nextMarkdown);
				await fetchNotes();
				showToast("附件已上传");
			} catch (error) {
				console.error(error);
				showToast(assetUploadErrorMessage(error));
			}
		},
		[
			detailMarkdown,
			ensureCurrentNoteForUpload,
			fetchNotes,
			showToast,
			updateCurrentNote,
			uploadCurrentNoteAsset,
		]
	);

	const handlePasteFiles = useCallback(
		(files: File[]) => {
			const editor = markdownEditorRef.current;
			if (!editor) {
				showToast("编辑器尚未准备好");
				return;
			}

			const selectedFiles = files.slice(0, MAX_PASTE_FILE_COUNT);
			if (files.length > MAX_PASTE_FILE_COUNT) {
				showToast(`一次最多粘贴 ${MAX_PASTE_FILE_COUNT} 个文件`);
			}

			const markdownBeforePaste = editor.getMarkdown() ?? detailMarkdown;
			selectedFiles.forEach((file) => {
				const tempUrl = window.URL.createObjectURL(file);
				editor.insertMarkdown(`${makePastedAssetMarkdown(file, tempUrl)}\n\n`);
				const task = uploadPastedFile(file, tempUrl, markdownBeforePaste);
				pendingAssetUploadsRef.current.add(task);
				void task.finally(() => {
					pendingAssetUploadsRef.current.delete(task);
				});
			});
		},
		[detailMarkdown, showToast, uploadPastedFile]
	);

	const createNewNote = () => {
		if (!confirmDiscardDetailChanges()) {
			return;
		}
		currentNoteIdRef.current = null;
		detailTitleRef.current = "";
		setCurrentNoteId(null);
		setDetailTitle("");
		setDetailMarkdown("");
		setSavedDetailTitle("");
		setSavedDetailMarkdown("");
		setDetailEditorKey((value) => value + 1);
		setDetailOpen(true);
	};

	const openDetail = (note: Note) => {
		if (!confirmDiscardDetailChanges()) {
			return;
		}
		setActivePage("notes");
		setSwipedNoteId(null);
		currentNoteIdRef.current = note.id;
		detailTitleRef.current = note.title || "";
		setCurrentNoteId(note.id);
		setDetailTitle(note.title || "");
		setDetailMarkdown(note.markdown || "");
		setSavedDetailTitle(note.title || "");
		setSavedDetailMarkdown(note.markdown || "");
		setDetailEditorKey((value) => value + 1);
		setDetailOpen(true);
	};

	const saveDetailNote = async (markdownOverride?: string) => {
		const title = detailTitle.trim();
		if (!title) {
			window.alert("请输入标题");
			return;
		}
		await waitForPendingAssetUploads();
		const markdown = markdownOverride ?? markdownEditorRef.current?.getMarkdown() ?? detailMarkdown;
		if (containsPendingAssetReference(markdown)) {
			showToast("有附件上传失败，请删除占位内容后再保存");
			return;
		}
		if (
			currentNoteId &&
			!hasDetailChanges(title, markdown, savedDetailTitle, savedDetailMarkdown)
		) {
			return;
		}
		try {
			if (currentNoteId) {
				await updateCurrentNote(currentNoteId, { title, markdown });
			} else {
				await createCurrentNote({ title, markdown });
			}
			setDetailMarkdown(markdown);
			setSavedDetailTitle(title);
			setSavedDetailMarkdown(markdown);
			await fetchNotes();
			setDetailOpen(false);
			showToast("已保存");
		} catch (error) {
			console.error(error);
			showToast("保存失败");
		}
	};

	const removeNote = async (note: Note) => {
		try {
			await deleteCurrentNote(note.id);
			await fetchNotes();
			if (currentNoteId === note.id) {
				currentNoteIdRef.current = null;
				setDetailOpen(false);
				setCurrentNoteId(null);
			}
			showToast("删除成功");
		} catch (error) {
			console.error(error);
			showToast("删除失败");
		}
	};

	const handleNoteSwipeStart = (note: Note, event: ReactPointerEvent<HTMLDivElement>) => {
		swipeRef.current = {
			noteId: note.id,
			startX: event.clientX,
			startY: event.clientY,
			lastX: event.clientX,
			dragging: false,
			moved: false,
		};
	};

	const handleNoteSwipeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const swipe = swipeRef.current;
		if (!swipe) {
			return;
		}
		const deltaX = event.clientX - swipe.startX;
		const deltaY = event.clientY - swipe.startY;
		swipe.lastX = event.clientX;
		if (Math.hypot(deltaX, deltaY) > 4) {
			swipe.moved = true;
		}
		if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1) {
			swipe.dragging = true;
		}
	};

	const finishNoteSwipe = (note: Note) => {
		const swipe = swipeRef.current;
		if (!swipe || swipe.noteId !== note.id) {
			swipeRef.current = null;
			return;
		}
		const deltaX = swipe.lastX - swipe.startX;
		if (swipe.dragging && deltaX < -34) {
			setSwipedNoteId(note.id);
			blockedNoteClickRef.current = note.id;
			window.setTimeout(() => {
				if (blockedNoteClickRef.current === note.id) {
					blockedNoteClickRef.current = "";
				}
			}, 0);
		} else if (swipe.dragging && deltaX > 34) {
			setSwipedNoteId((current) => (current === note.id ? null : current));
			blockedNoteClickRef.current = note.id;
			window.setTimeout(() => {
				if (blockedNoteClickRef.current === note.id) {
					blockedNoteClickRef.current = "";
				}
			}, 0);
		} else if (swipe.moved) {
			blockedNoteClickRef.current = note.id;
			window.setTimeout(() => {
				if (blockedNoteClickRef.current === note.id) {
					blockedNoteClickRef.current = "";
				}
			}, 0);
		}
		swipeRef.current = null;
	};

	const cancelNoteSwipe = () => {
		swipeRef.current = null;
	};

	const askWithNote = (note: Note) => {
		const text = (note.markdown || note.title || "").trim();
		if (!text) {
			showToast("笔记内容为空");
			return;
		}
		setSwipedNoteId(null);
		openDrawerWithText(text);
	};

	const handleNoteClick = (note: Note) => {
		if (blockedNoteClickRef.current === note.id) {
			blockedNoteClickRef.current = "";
			return;
		}
		const selectedText = window.getSelection()?.toString().trim() ?? "";
		if (selectedText) {
			return;
		}
		openDetail(note);
	};

	const handleNoteKeyDown = (note: Note, event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}
		event.preventDefault();
		handleNoteClick(note);
	};

	const toggle = () => {
		if (drawerOpen) {
			close();
			return;
		}
		open("notes");
	};

	useImperativeHandle(ref, () => ({
		open,
		close,
		toggle,
		refresh: fetchNotes,
	}));

	return (
		<div className={`floating-notes-scope ${isDark ? "dark" : "light"}`}>
			{floatButton ? (
			<button type="button" id="dst-float" aria-label="打开 AI 聊天" onClick={() => open("chat")}>
				<Bot aria-hidden="true" size={21} />
			</button>
			) : null}
			<canvas id="dst-canvas" ref={canvasRef}></canvas>
			<div id="dst-bottom-wormhole" className={bottomGlow ? "glow" : ""}></div>
			<div id="dst-right-wormhole" className={rightGlow ? "glow" : ""}></div>
			<div id="dst-overlay" className={drawerOpen ? "show" : ""} onClick={close}></div>

			{toolbar ? (
				<div
					id="dst-toolbar"
					className="visible"
					ref={toolbarRef}
					style={{ left: toolbar.left, top: toolbar.top }}
					onPointerDown={stopToolbarPointer}
				>
					<button
						type="button"
						className="dst-primary"
						title="问 AI"
						onClick={() => runToolbarAction("ask")}
					>
						<MessageSquareText aria-hidden="true" size={9} />
						问AI
					</button>
					<span className="dst-divider" aria-hidden="true"></span>
					<button type="button" title="复制" onClick={() => runToolbarAction("copy")}>
						<Copy aria-hidden="true" size={9} />
						复制
					</button>
					<span className="dst-divider" aria-hidden="true"></span>
					<button
						type="button"
						className="dst-save"
						title="存笔记"
						onClick={() => runToolbarAction("save")}
					>
						<Save aria-hidden="true" size={9} />
						笔记
					</button>
				</div>
			) : null}

			<aside
				id="dst-drawer"
				className={drawerOpen ? "open" : ""}
				aria-label="DeepSeek Typora 抽屉"
				ref={drawerRef}
			>
				<div className="dst-mobile-handle"></div>
				<div className={`dst-viewport ${activePage === "notes" ? "show-notes" : ""}`}>
					<section className="dst-page" aria-label="DeepSeek 智聊">
						<header className="dst-header">
							<div className="dst-title">
								<span className="dst-dot"></span>
								<span>DeepSeek 智聊</span>
							</div>
							<div className="dst-actions">
								<button type="button" className="dst-icon-btn" title="切换主题" onClick={() => setIsDark((value) => !value)}>
									{isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
								</button>
								<button
									type="button"
									className="dst-icon-btn"
									title="笔记"
									onClick={() => {
										setActivePage("notes");
										void fetchNotes();
									}}
								>
									<FilePlus2 aria-hidden="true" />
									<span id="dst-note-badge" className={notes.length ? "pulse" : ""}>
										{notes.length > 99 ? "99+" : notes.length}
									</span>
								</button>
								<button type="button" className="dst-icon-btn" title="关闭" onClick={close}>
									<X aria-hidden="true" />
								</button>
							</div>
						</header>
						<div className="dst-chat-scroll dst-chat-frame-wrap">
							<div id="dst-wormhole-edge" className={edgeGlow ? "glow" : ""}></div>
							<iframe
								ref={chatFrameRef}
								className="dst-chat-frame"
								title="AI 聊天"
								src={chatFrameSrc}
								onLoad={() => {
									postThemeToChat();
									if (toolbarText) {
										postSelectionToChat(toolbarText);
									}
								}}
							></iframe>
						</div>
					</section>

					<section
						className={`dst-page notes-page ${detailOpen ? "detail-open" : ""}`}
						aria-label="笔记"
					>
						<header className="dst-header">
							<div className="dst-title">
								<span className="dst-dot cyan"></span>
								<span>{title}</span>
							</div>
							<div className="dst-actions">
								<button type="button" className="dst-icon-btn" title="切换主题" onClick={() => setIsDark((value) => !value)}>
									{isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
								</button>
								<button
									type="button"
									className="dst-icon-btn"
									title="回到 AI"
									onClick={() => {
										if (!confirmDiscardDetailChanges()) {
											return;
										}
										setDetailOpen(false);
										setActivePage("chat");
									}}
								>
									<MessageSquareText aria-hidden="true" />
								</button>
								<button type="button" className="dst-icon-btn" title="关闭" onClick={close}>
									<X aria-hidden="true" />
								</button>
							</div>
						</header>

						<div id="dst-notes-list">
							{notesState ? <div className="state dst-notes-empty">{notesState}</div> : null}
							{!notesState
								? notes.map((note) => (
										<div
											className={`swipe-item ${swipedNoteId === note.id ? "open" : ""}`}
											key={note.id}
											onPointerDown={(event) => handleNoteSwipeStart(note, event)}
											onPointerMove={handleNoteSwipeMove}
											onPointerUp={() => finishNoteSwipe(note)}
											onPointerCancel={cancelNoteSwipe}
										>
											<div className="actions">
												<button
													type="button"
													className="ask-btn"
													onClick={() => askWithNote(note)}
												>
													问AI
												</button>
												<button
													type="button"
													className="copy-btn"
													onClick={() => {
														setSwipedNoteId(null);
														void copyText(note.markdown || "")
															.then(() => showToast("复制成功"))
															.catch(() => showToast("复制失败"));
													}}
												>
													复制
												</button>
												<button
													type="button"
													className="delete-btn"
													onClick={() => {
														setSwipedNoteId(null);
														void removeNote(note);
													}}
												>
													删除
												</button>
											</div>
											<div
												role="button"
												tabIndex={0}
												className="note-item"
												onClick={() => handleNoteClick(note)}
												onKeyDown={(event) => handleNoteKeyDown(note, event)}
											>
												<div className="note-title">{note.title || "未命名"}</div>
												<div className="note-desc">{note.excerpt || note.markdown || ""}</div>
											</div>
										</div>
									))
								: null}
							<div className="add-item">
								<button
									type="button"
									className="add-circle"
									aria-label="新增笔记"
									onClick={createNewNote}
								>
									<FilePlus2 aria-hidden="true" size={28} />
								</button>
							</div>
						</div>

						<section className="detail-page" id="dst-note-detail" aria-label="编辑笔记">
							<div className="detail-header">
								<button
									type="button"
									className="back-btn"
									aria-label="返回"
									onClick={() => {
										if (confirmDiscardDetailChanges()) {
											setDetailOpen(false);
										}
									}}
								>
									←
								</button>
								<input
									className="detail-title"
									value={detailTitle}
									onChange={(event) => setDetailTitle(event.target.value)}
									onKeyUp={scheduleSelectionToolbar}
									onMouseUp={scheduleSelectionToolbar}
									onSelect={scheduleSelectionToolbar}
									onTouchEnd={scheduleSelectionToolbar}
									placeholder="输入标题"
								/>
								<button
									type="button"
									className="save-btn"
									disabled={Boolean(currentNoteId) && !hasUnsavedDetail}
									onClick={() => void saveDetailNote()}
								>
									{hasUnsavedDetail ? "保存*" : "保存"}
								</button>
							</div>
							<MarkdownNoteEditor
								key={detailEditorKey}
								ref={markdownEditorRef}
								value={detailMarkdown}
								onChange={setDetailMarkdown}
								onReady={(markdown) => {
									setDetailMarkdown(markdown);
									setSavedDetailMarkdown(markdown);
								}}
								onSave={(markdown) => void saveDetailNote(markdown)}
								onPasteFiles={handlePasteFiles}
							/>
						</section>
					</section>
				</div>
			</aside>

			{toast ? (
				<div id="dst-toast" className="show" role="status" aria-live="polite">
					{toast}
				</div>
			) : null}
		</div>
	);
});
