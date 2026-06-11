import {
	AssistantRuntimeProvider,
	type ChatModelAdapter,
	type ThreadMessage,
	type ThreadMessageLike,
	useLocalRuntime,
	useThread,
	useThreadRuntime,
} from "@assistant-ui/react";
import {
	Bot,
	Check,
	ChevronLeft,
	Copy,
	Eye,
	EyeOff,
	FilePlus2,
	LoaderCircle,
	LogOut,
	Menu,
	MessageSquarePlus,
	MessageSquareText,
	MoreHorizontal,
	PenLine,
	Plus,
	Send,
	Settings,
	Sparkles,
	Trash2,
	UserRound,
	X,
} from "lucide-react";
import {
	type FormEvent,
	type KeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	type TouchEvent as ReactTouchEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	type AiSettings,
	type ChatMessage,
	type ChatThread,
	type User,
	SESSION_TOKEN_KEY,
	SESSION_INVALID_EVENT,
	applyExternalToken,
	createThread,
	deleteThread,
	generateChatTitle,
	getAiSettings,
	getMe,
	login,
	logout,
	register,
	listMessages,
	listThreads,
	renameThread,
	readApiError,
	resolveAgentNote,
	sendChatMessage,
	summarizeChatContent,
	updateAiSettings,
} from "../shared/apiClient";
import {
	createNote,
	deleteNote,
	downloadNoteAssetContent,
	listNoteAssets,
	listNotes,
	updateNote,
	uploadNoteAsset,
} from "../shared/notesApi";
import { resolvePostMessageTargetOrigin } from "../shared/postMessage";

type ChatAppProps = {
	apiBase?: string;
	embed?: boolean;
};

type AuthMode = "login" | "register";
type AiTheme = "dark" | "light";

type PendingSelectionMessage = {
	id: number;
	text: string;
};

type AiSelectionToolbar = {
	text: string;
	left: number;
	top: number;
};

const EMPTY_MESSAGES: ThreadMessageLike[] = [];
const AGENT_ACTION_HEADER = "X-Floating-Notes-Action";
const AGENT_MESSAGE_ID_HEADER = "X-Floating-Notes-Message-Id";
const AGENT_NOTE_TITLE_HEADER = "X-Floating-Notes-Note-Title";
const AGENT_PENDING_ACTION = "note_pending";
const AGENT_METADATA_ACTION = "pending_create_note";
const AGENT_ACTIONS_TRANSITION_MS = 180;
const AI_LOADING_TEXT = "正在思考";
const AGENT_NOTE_LOADING_TEXT = "正在整理待确认笔记";

async function generateNoteTitleOrFallback(
	apiBase: string,
	content: string,
	fallback: string
) {
	try {
		const { title } = await generateChatTitle(apiBase, content);
		return title.trim() || fallback;
	} catch (error) {
		console.error(error);
		return fallback;
	}
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

function notifyNotesChanged(options: { animateSave?: boolean } = {}) {
	if (window.parent && window.parent !== window) {
		window.parent.postMessage(
			{ type: "floating-notes:notes-changed", animateSave: options.animateSave === true },
			"*"
		);
	}
}

function notifyBridgeReady(authenticated: boolean) {
	if (window.parent && window.parent !== window) {
		window.parent.postMessage(
			{ type: "floating-notes:bridge-ready", authenticated },
			"*"
		);
	}
}

function getInitialTheme(): AiTheme {
	const theme = new URL(window.location.href).searchParams.get("theme");
	return theme === "light" ? "light" : "dark";
}

export function ChatApp({ apiBase = "", embed = false }: ChatAppProps) {
	const [user, setUser] = useState<User | null>(null);
	const [authLoading, setAuthLoading] = useState(true);
	const [authError, setAuthError] = useState("");
	const [threads, setThreads] = useState<ChatThread[]>([]);
	const [threadsLoading, setThreadsLoading] = useState(false);
	const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
	const [initialMessages, setInitialMessages] =
		useState<readonly ThreadMessageLike[]>(EMPTY_MESSAGES);
	const [runtimeKey, setRuntimeKey] = useState("empty");
	const [historyOpen, setHistoryOpen] = useState(!embed && window.innerWidth >= 900);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [pendingSelection, setPendingSelection] = useState<PendingSelectionMessage | null>(null);
	const [theme, setTheme] = useState<AiTheme>(getInitialTheme);
	const activeThreadIdRef = useRef<string | null>(null);

	useEffect(() => {
		activeThreadIdRef.current = activeThreadId;
	}, [activeThreadId]);

	const refreshThreads = useCallback(async () => {
		setThreadsLoading(true);
		try {
			const nextThreads = await listThreads(apiBase);
			setThreads(nextThreads);
			return nextThreads;
		} finally {
			setThreadsLoading(false);
		}
	}, [apiBase]);

	const loadThreadMessages = useCallback(
		async (threadId: string) => {
			const messages = await listMessages(apiBase, threadId);
			setInitialMessages(messages.map(toThreadMessageLike));
			setRuntimeKey(`${threadId}:${messages.length}:${messages.at(-1)?.id ?? "none"}`);
		},
		[apiBase]
	);

	const loadInitialState = useCallback(async () => {
		setAuthLoading(true);
		setAuthError("");
		try {
			const me = await getMe(apiBase);
			setUser(me.user);
			const nextThreads = await refreshThreads();
			const firstThread = nextThreads[0];
			if (firstThread) {
				setActiveThreadId(firstThread.id);
				await loadThreadMessages(firstThread.id);
			} else {
				setActiveThreadId(null);
				setInitialMessages(EMPTY_MESSAGES);
				setRuntimeKey(`empty:${Date.now()}`);
			}
		} catch {
			setUser(null);
			setActiveThreadId(null);
			setInitialMessages(EMPTY_MESSAGES);
			setRuntimeKey(`signed-out:${Date.now()}`);
		} finally {
			setAuthLoading(false);
		}
	}, [apiBase, loadThreadMessages, refreshThreads]);

	useEffect(() => {
		void loadInitialState();
	}, [loadInitialState]);

	const handleNotesBridgeRequest = useCallback(
		async (event: MessageEvent) => {
			const id = typeof event.data.id === "number" ? event.data.id : 0;
			const source = event.source;
			const respond = (body: Record<string, unknown>) => {
				(source as Window | null)?.postMessage(
					{
						type: "floating-notes:notes-response",
						id,
						...body,
					},
					resolvePostMessageTargetOrigin(event.origin)
				);
			};

			try {
				if (!user) {
					throw new Error("unauthorized");
				}

				const action = typeof event.data.action === "string" ? event.data.action : "";
				const payload = event.data.payload;
				if (action === "list") {
					respond({ ok: true, data: await listNotes(apiBase) });
					return;
				}
				if (action === "title") {
					const content = typeof payload?.content === "string" ? payload.content : "";
					respond({ ok: true, data: await generateChatTitle(apiBase, content) });
					return;
				}
				if (action === "create") {
					respond({ ok: true, data: await createNote(payload?.note ?? {}, apiBase) });
					return;
				}
				if (action === "update") {
					const noteId = typeof payload?.id === "string" ? payload.id : "";
					if (!noteId) {
						throw new Error("note id is required");
					}
					respond({ ok: true, data: await updateNote(noteId, payload?.note ?? {}, apiBase) });
					return;
				}
				if (action === "delete") {
					const noteId = typeof payload?.id === "string" ? payload.id : "";
					if (!noteId) {
						throw new Error("note id is required");
					}
					respond({ ok: true, data: await deleteNote(noteId, apiBase) });
					return;
				}
				if (action === "uploadAsset") {
					const noteId = typeof payload?.id === "string" ? payload.id : "";
					const file = payload?.file;
					if (!noteId) {
						throw new Error("note id is required");
					}
					if (!(file instanceof File)) {
						throw new Error("file is required");
					}
					respond({ ok: true, data: await uploadNoteAsset(noteId, file, apiBase) });
					return;
				}
				if (action === "listAssets") {
					const noteId = typeof payload?.id === "string" ? payload.id : "";
					if (!noteId) {
						throw new Error("note id is required");
					}
					respond({ ok: true, data: await listNoteAssets(noteId, apiBase) });
					return;
				}
				if (action === "downloadAsset") {
					const noteId = typeof payload?.noteId === "string" ? payload.noteId : "";
					const assetId = typeof payload?.assetId === "string" ? payload.assetId : "";
					if (!noteId || !assetId) {
						throw new Error("asset id is required");
					}
					respond({
						ok: true,
						data: await downloadNoteAssetContent(noteId, assetId, apiBase),
					});
					return;
				}
				throw new Error("unknown notes action");
			} catch (error) {
				respond({
					ok: false,
					error: error instanceof Error ? error.message : "notes request failed",
				});
			}
		},
		[apiBase, user]
	);

	useEffect(() => {
		if (user) {
			notifyNotesChanged();
		}
	}, [user]);

	useEffect(() => {
		const url = new URL(window.location.href);
		const askText = url.searchParams.get("ask");
		if (askText) {
			setPendingSelection({ id: Date.now(), text: askText });
		}

		const handleMessage = (event: MessageEvent) => {
			if (typeof event.data !== "object" || event.data === null) {
				return;
			}
			if (event.data.type === "floating-notes:notes-request") {
				void handleNotesBridgeRequest(event);
				return;
			}
			// 宿主把弹窗 SSO 拿到的跨站 token 注入进来。只信任来自父窗口的消息。
			if (event.data.type === "floating-notes:set-token" && event.source === window.parent) {
				const token = typeof event.data.token === "string" ? event.data.token : "";
				if (token) {
					applyExternalToken(token);
					void loadInitialState();
				}
				return;
			}
			if (event.data.type === "floating-notes:theme") {
				if (event.data.theme === "dark" || event.data.theme === "light") {
					setTheme(event.data.theme);
				}
				return;
			}
			if (event.data.type !== "floating-notes:ask") {
				return;
			}
			const text = typeof event.data.text === "string" ? event.data.text.trim() : "";
			if (text) {
				setPendingSelection({ id: Date.now(), text });
			}
		};

		window.addEventListener("message", handleMessage);
		if (embed && !authLoading) {
			notifyBridgeReady(Boolean(user));
		}
		return () => window.removeEventListener("message", handleMessage);
	}, [authLoading, embed, handleNotesBridgeRequest, loadInitialState, user]);

	// 单账号 SSO 同步 + 401 自愈:
	// - storage 事件:其它同源 iframe/标签发生登录/切号/登出时(写/清 token),本页重新对齐到同一账号。
	// - session-invalid 事件:本上下文请求拿到 401 后回到登录态(removeItem 不会触发自身 storage)。
	// 两者都收口到 loadInitialState();user/authLoading 变化会让上面的 effect 自动 notifyBridgeReady。
	useEffect(() => {
		const resync = () => {
			void loadInitialState();
		};
		const handleStorage = (event: StorageEvent) => {
			if (event.key !== SESSION_TOKEN_KEY) {
				return;
			}
			resync();
		};
		window.addEventListener("storage", handleStorage);
		window.addEventListener(SESSION_INVALID_EVENT, resync);
		return () => {
			window.removeEventListener("storage", handleStorage);
			window.removeEventListener(SESSION_INVALID_EVENT, resync);
		};
	}, [loadInitialState]);

	const createLocalThread = useCallback(
		async (title: string, options: { resetRuntime?: boolean } = {}) => {
			const thread = await createThread(apiBase, title);
			setActiveThreadId(thread.id);
			activeThreadIdRef.current = thread.id;
			if (options.resetRuntime) {
				setInitialMessages(EMPTY_MESSAGES);
				setRuntimeKey(`${thread.id}:new:${Date.now()}`);
			}
			setThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
			if (window.innerWidth < 900) {
				setHistoryOpen(false);
			}
			return thread;
		},
		[apiBase]
	);

	const ensureActiveThread = useCallback(
		async (prompt: string) => {
			if (activeThreadIdRef.current) {
				return activeThreadIdRef.current;
			}
			const thread = await createLocalThread(prompt, { resetRuntime: false });
			return thread.id;
		},
		[createLocalThread]
	);

	const chatModel = useMemo<ChatModelAdapter>(
		() => ({
			async *run(options) {
				const prompt = getLastUserText(options.messages).trim();
				if (!prompt) {
					yield {
						content: [{ type: "text", text: "" }],
						status: { type: "complete", reason: "stop" },
					};
					return;
				}

				yield {
					content: [
						{
							type: "text",
							text: shouldShowAgentNoteLoading(prompt)
								? AGENT_NOTE_LOADING_TEXT
								: AI_LOADING_TEXT,
						},
					],
					status: { type: "running" },
					metadata: { custom: { localLoading: true } },
				};
				const threadId = await ensureActiveThread(prompt);
				const response = await sendChatMessage(apiBase, threadId, prompt, options.abortSignal);
				if (!response.ok || !response.body) {
					const message = await readApiError(response);
					yield {
						content: [{ type: "text", text: message }],
						status: { type: "incomplete", reason: "error", error: message },
					};
					return;
				}

				const agentAction = response.headers.get(AGENT_ACTION_HEADER) || "";
				const agentMessageId = response.headers.get(AGENT_MESSAGE_ID_HEADER) || "";
				const agentNoteTitle = decodeResponseHeader(response.headers.get(AGENT_NOTE_TITLE_HEADER));
				const agentMetadata = {
					custom:
						agentAction === AGENT_PENDING_ACTION && agentMessageId
							? {
									localLoading: false,
									agentAction: AGENT_METADATA_ACTION,
									agentNoteStatus: "pending",
									messageId: agentMessageId,
									threadId,
									title: agentNoteTitle,
								}
							: { localLoading: false },
				};
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let text = "";
				let done = false;
				while (!done) {
					const chunk = await reader.read();
					done = chunk.done;
					text += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !done });
					yield {
						content: [{ type: "text", text }],
						status: done
							? { type: "complete", reason: "stop" }
							: { type: "running" },
						metadata: agentMetadata,
					};
				}

				void refreshThreads();
				return;
			},
		}),
		[apiBase, ensureActiveThread, refreshThreads]
	);

	const selectThread = useCallback(
		async (threadId: string) => {
			setActiveThreadId(threadId);
			activeThreadIdRef.current = threadId;
			await loadThreadMessages(threadId);
			if (window.innerWidth < 900) {
				setHistoryOpen(false);
			}
		},
		[loadThreadMessages]
	);

	const startNewThread = useCallback(() => {
		setActiveThreadId(null);
		activeThreadIdRef.current = null;
		setInitialMessages(EMPTY_MESSAGES);
		setRuntimeKey(`empty:${Date.now()}`);
		if (window.innerWidth < 900) {
			setHistoryOpen(false);
		}
	}, []);

	const handleDeleteThread = useCallback(
		async (threadId: string) => {
			await deleteThread(apiBase, threadId);
			const nextThreads = await refreshThreads();
			if (threadId === activeThreadIdRef.current) {
				const nextActive = nextThreads.find((thread) => thread.id !== threadId) ?? null;
				if (nextActive) {
					setActiveThreadId(nextActive.id);
					activeThreadIdRef.current = nextActive.id;
					await loadThreadMessages(nextActive.id);
				} else {
					startNewThread();
				}
			}
		},
		[apiBase, loadThreadMessages, refreshThreads, startNewThread]
	);

	const handleRenameThread = useCallback(
		async (thread: ChatThread) => {
			const title = window.prompt("重命名聊天", thread.title)?.trim();
			if (!title) {
				return;
			}
			const updated = await renameThread(apiBase, thread.id, title);
			setThreads((current) =>
				current.map((item) => (item.id === updated.id ? { ...item, title: updated.title } : item))
			);
		},
		[apiBase]
	);

	const handleLogout = useCallback(async () => {
		await logout(apiBase);
		setUser(null);
		setThreads([]);
		startNewThread();
	}, [apiBase, startNewThread]);

	const handleAuth = useCallback(
		async (mode: AuthMode, email: string, password: string) => {
			setAuthError("");
			try {
				const response =
					mode === "login"
						? await login(apiBase, email, password)
						: await register(apiBase, email, password);
				setUser(response.user);
				await refreshThreads();
				startNewThread();
			} catch (error) {
				setAuthError(error instanceof Error ? error.message : "登录失败");
			}
		},
		[apiBase, refreshThreads, startNewThread]
	);

	if (authLoading) {
		return <div className={`ai-loading ${theme}`}>Loading</div>;
	}

	if (!user) {
		// 嵌入模式下登录由宿主抽屉里的统一表单负责，iframe 不再渲染自己的登录页。
		// 仍会通过 notifyBridgeReady(false) 通知宿主显示登录浮层。
		if (embed) {
			return <div className={`ai-loading ${theme}`} />;
		}
		return <AuthScreen error={authError} embed={embed} theme={theme} onSubmit={handleAuth} />;
	}

	return (
		<div className={`ai-shell ${theme} ${embed ? "embed" : ""}`}>
			<HistoryDrawer
				activeThreadId={activeThreadId}
				embed={embed}
				open={historyOpen}
				threads={threads}
				threadsLoading={threadsLoading}
				user={user}
				onClose={() => setHistoryOpen(false)}
				onDeleteThread={handleDeleteThread}
				onLogout={handleLogout}
				onNewThread={startNewThread}
				onOpenSettings={() => setSettingsOpen(true)}
				onRenameThread={handleRenameThread}
				onSelectThread={selectThread}
			/>
			<div
				className={`ai-history-scrim ${historyOpen ? "show" : ""}`}
				onClick={() => setHistoryOpen(false)}
			/>
			{settingsOpen ? (
				<AiSettingsPanel
					apiBase={apiBase}
					theme={theme}
					embed={embed}
					onClose={() => setSettingsOpen(false)}
				/>
			) : null}
			<section className="ai-main" aria-label="AI chat">
				<header className="ai-topbar">
					<button
						type="button"
						className="ai-icon-button"
						aria-label="打开历史"
						onClick={() => setHistoryOpen(true)}
					>
						<Menu aria-hidden="true" />
					</button>
					<div className="ai-topbar-title">
						<span>{activeThreadTitle(threads, activeThreadId)}</span>
					</div>
					<button
						type="button"
						className="ai-icon-button"
						aria-label="新聊天"
						onClick={startNewThread}
					>
						<Plus aria-hidden="true" />
					</button>
				</header>

				<ChatRuntime
					key={runtimeKey}
					apiBase={apiBase}
					activeThreadId={activeThreadId}
					chatModel={chatModel}
					initialMessages={initialMessages}
					pendingSelection={pendingSelection}
				/>
			</section>
		</div>
	);
}

function ChatRuntime({
	apiBase,
	activeThreadId,
	chatModel,
	initialMessages,
	pendingSelection,
}: {
	apiBase: string;
	activeThreadId: string | null;
	chatModel: ChatModelAdapter;
	initialMessages: readonly ThreadMessageLike[];
	pendingSelection: PendingSelectionMessage | null;
}) {
	const runtime = useLocalRuntime(chatModel, { initialMessages });

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ChatThreadView
				apiBase={apiBase}
				activeThreadId={activeThreadId}
				pendingSelection={pendingSelection}
			/>
		</AssistantRuntimeProvider>
	);
}

function ChatThreadView({
	apiBase,
	activeThreadId,
	pendingSelection,
}: {
	apiBase: string;
	activeThreadId: string | null;
	pendingSelection: PendingSelectionMessage | null;
}) {
	const thread = useThread();
	const runtime = useThreadRuntime();
	const [draft, setDraft] = useState("");
	const [lastSelectionId, setLastSelectionId] = useState(0);
	const [selectionToolbar, setSelectionToolbar] = useState<AiSelectionToolbar | null>(null);
	const [selectionText, setSelectionText] = useState("");
	const [toast, setToast] = useState("");
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const toolbarRef = useRef<HTMLDivElement | null>(null);
	const composingRef = useRef(false);
	const selectionTimerRef = useRef(0);
	const toastTimerRef = useRef(0);
	const toolbarPointerBlockUntilRef = useRef(0);
	const toolbarActionRef = useRef({ action: "", at: 0 });

	useEffect(() => {
		const viewport = viewportRef.current;
		if (viewport) {
			viewport.scrollTop = viewport.scrollHeight;
		}
	}, [thread.messages.length, thread.isRunning]);

	useEffect(() => {
		if (!pendingSelection || pendingSelection.id === lastSelectionId) {
			return;
		}
		setLastSelectionId(pendingSelection.id);
		setDraft((current) => `【选中内容】${pendingSelection.text}\n\n${current}`.trimEnd());
	}, [lastSelectionId, pendingSelection]);

	useEffect(() => {
		return () => {
			window.clearTimeout(selectionTimerRef.current);
			window.clearTimeout(toastTimerRef.current);
		};
	}, []);

	const showToast = useCallback((message: string) => {
		window.clearTimeout(toastTimerRef.current);
		setToast(message);
		toastTimerRef.current = window.setTimeout(() => setToast(""), 900);
	}, []);

	useEffect(() => {
		const handleSelectionChange = () => {
			window.clearTimeout(selectionTimerRef.current);
			selectionTimerRef.current = window.setTimeout(() => {
				const viewport = viewportRef.current;
				const selection = window.getSelection();
				const text = selection?.toString().trim() ?? "";
				if (!viewport || !selection || !selection.rangeCount || !text) {
					setSelectionToolbar(null);
					return;
				}

				const anchor = selection.anchorNode;
				const focus = selection.focusNode;
				if (!anchor || !focus || !viewport.contains(anchor) || !viewport.contains(focus)) {
					setSelectionToolbar(null);
					return;
				}

				const anchorElement = anchor instanceof Element ? anchor : anchor.parentElement;
				const focusElement = focus instanceof Element ? focus : focus.parentElement;
				if (
					anchorElement?.closest(".ai-message-actions") ||
					focusElement?.closest(".ai-message-actions")
				) {
					setSelectionToolbar(null);
					return;
				}

				try {
					const range = selection.getRangeAt(0);
					const rects = Array.from(range.getClientRects()).filter(
						(rect) => rect.width > 0 && rect.height > 0
					);
					const rect = rects[0] ?? range.getBoundingClientRect();
					if (!rect || (!rect.width && !rect.height)) {
						setSelectionToolbar(null);
						return;
					}
					const widthGuess = 170;
					const left = Math.max(
						8 + widthGuess / 2,
						Math.min(rect.left + rect.width / 2, window.innerWidth - 8 - widthGuess / 2)
					);
					const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 40));
					setSelectionText(text);
					setSelectionToolbar({ text, left, top });
				} catch {
					setSelectionToolbar(null);
				}
			}, 110);
		};

		const handlePointerDown = (event: MouseEvent | PointerEvent | TouchEvent) => {
			if (Date.now() < toolbarPointerBlockUntilRef.current) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			const target = event.target;
			if (target instanceof Element && target.closest(".ai-selection-toolbar")) {
				return;
			}
			setSelectionToolbar(null);
		};

		document.addEventListener("selectionchange", handleSelectionChange);
		document.addEventListener("mousedown", handlePointerDown, true);
		document.addEventListener("mouseup", handlePointerDown, true);
		document.addEventListener("pointerup", handlePointerDown, true);
		document.addEventListener("touchstart", handlePointerDown, true);
		document.addEventListener("touchend", handlePointerDown, true);
		document.addEventListener("click", handlePointerDown, true);
		return () => {
			document.removeEventListener("selectionchange", handleSelectionChange);
			document.removeEventListener("mousedown", handlePointerDown, true);
			document.removeEventListener("mouseup", handlePointerDown, true);
			document.removeEventListener("pointerup", handlePointerDown, true);
			document.removeEventListener("touchstart", handlePointerDown, true);
			document.removeEventListener("touchend", handlePointerDown, true);
			document.removeEventListener("click", handlePointerDown, true);
		};
	}, []);

	const runSelectionAction = useCallback(
		(action: "ask" | "copy" | "save") => {
			const now = Date.now();
			if (
				toolbarActionRef.current.action === action &&
				now - toolbarActionRef.current.at < 600
			) {
				return;
			}
			toolbarActionRef.current = { action, at: now };
			const text = (selectionToolbar?.text || selectionText).trim();
			if (!text) {
				showToast("未获取到选中文字");
				return;
			}

			if (action === "ask") {
				setDraft((current) => `【选中内容】${text}\n\n${current}`.trimEnd());
				setSelectionToolbar(null);
				return;
			}

			if (action === "copy") {
				void copyText(text)
					.then(() => showToast("已复制"))
					.catch(() => showToast("复制失败"));
				setSelectionToolbar(null);
				return;
			}

			void (async () => {
				try {
					const title = await generateNoteTitleOrFallback(apiBase, text, "新笔记");
					await createNote({ title, markdown: text }, apiBase);
					notifyNotesChanged({ animateSave: true });
					showToast("已存入笔记");
				} catch (error) {
					console.error(error);
					showToast("保存失败");
				}
			})();
			setSelectionToolbar(null);
		},
		[apiBase, selectionText, selectionToolbar?.text, showToast]
	);

	const send = useCallback(() => {
		const text = draft.trim();
		if (!text || thread.isRunning) {
			return;
		}
		runtime.append({ role: "user", content: [{ type: "text", text }] });
		setDraft("");
	}, [draft, runtime, thread.isRunning]);

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		send();
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter" || event.shiftKey) {
			return;
		}

		if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) {
			return;
		}

		event.preventDefault();
		send();
	};

	const stopSelectionToolbarEvent = (
		event:
			| ReactPointerEvent<HTMLDivElement>
			| ReactPointerEvent<HTMLButtonElement>
			| ReactMouseEvent<HTMLDivElement>
			| ReactTouchEvent<HTMLButtonElement>
	) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const runSelectionActionFromPress = (
		action: "ask" | "copy" | "save",
		event: ReactPointerEvent<HTMLButtonElement> | ReactTouchEvent<HTMLButtonElement>
	) => {
		stopSelectionToolbarEvent(event);
		toolbarPointerBlockUntilRef.current = Date.now() + 500;
		runSelectionAction(action);
	};

	return (
		<>
			<div className="ai-messages" ref={viewportRef}>
				{thread.messages.length === 0 ? (
					<div className="ai-empty">
						<Bot aria-hidden="true" />
						<h1>ChatGPT</h1>
						<p>直接输入问题开始聊天。</p>
					</div>
				) : (
					thread.messages.map((message, index) => (
						<MessageBubble
							key={message.id}
							apiBase={apiBase}
							activeThreadId={activeThreadId}
							message={message}
							isStreaming={
								message.role === "assistant" &&
								(message.status?.type === "running" ||
									(thread.isRunning && index === thread.messages.length - 1))
							}
							onToast={showToast}
						/>
					))
				)}
			</div>
			{selectionToolbar ? (
				<div
					className="ai-selection-toolbar"
					ref={toolbarRef}
					style={{ left: selectionToolbar.left, top: selectionToolbar.top }}
					onPointerDown={stopSelectionToolbarEvent}
					onPointerUp={stopSelectionToolbarEvent}
					onClick={stopSelectionToolbarEvent}
				>
					<button
						type="button"
						className="primary"
						onPointerDown={(event) => runSelectionActionFromPress("ask", event)}
						onTouchStart={(event) => runSelectionActionFromPress("ask", event)}
					>
						<MessageSquareText aria-hidden="true" />
						问AI
					</button>
					<button
						type="button"
						onPointerDown={(event) => runSelectionActionFromPress("copy", event)}
						onTouchStart={(event) => runSelectionActionFromPress("copy", event)}
					>
						<Copy aria-hidden="true" />
						复制
					</button>
					<button
						type="button"
						onPointerDown={(event) => runSelectionActionFromPress("save", event)}
						onTouchStart={(event) => runSelectionActionFromPress("save", event)}
					>
						<FilePlus2 aria-hidden="true" />
						笔记
					</button>
				</div>
			) : null}
			<form className="ai-composer" onSubmit={handleSubmit}>
				<textarea
					rows={1}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onCompositionStart={() => {
						composingRef.current = true;
					}}
					onCompositionEnd={() => {
						composingRef.current = false;
					}}
					onKeyDown={handleKeyDown}
					placeholder="Message"
				/>
				<button
					type="submit"
					className="ai-send-button"
					aria-label="发送"
					disabled={!draft.trim() || thread.isRunning}
				>
					<Send aria-hidden="true" />
				</button>
			</form>
			{toast ? (
				<div className="ai-toast show" role="status" aria-live="polite">
					{toast}
				</div>
			) : null}
		</>
	);
}

function MessageBubble({
	apiBase,
	activeThreadId,
	isStreaming,
	message,
	onToast,
}: {
	apiBase: string;
	activeThreadId: string | null;
	isStreaming: boolean;
	message: ThreadMessage;
	onToast: (message: string) => void;
}) {
	const text = getMessageText(message);
	const isUser = message.role === "user";
	const customMetadata = getCustomMetadata(message);
	const isLocalLoading =
		!isUser && isStreaming && customMetadata.localLoading === true;
	const initialAgentPending =
		!isUser &&
		customMetadata.agentAction === AGENT_METADATA_ACTION &&
		customMetadata.agentNoteStatus === "pending";
	const agentMessageId =
		normalizeMetadataString(customMetadata.messageId) || (initialAgentPending ? message.id : "");
	const agentThreadId = normalizeMetadataString(customMetadata.threadId) || activeThreadId || "";
	const agentNoteTitle = normalizeMetadataString(customMetadata.title).trim() || "AI笔记";
	const [busyAction, setBusyAction] = useState<"note" | "summary" | null>(null);
	const [agentBusy, setAgentBusy] = useState<"confirm" | null>(null);
	const [agentPanelState, setAgentPanelState] = useState<"confirm" | "resolving" | "normal">(
		initialAgentPending ? "confirm" : "normal"
	);

	useEffect(() => {
		setAgentPanelState(initialAgentPending ? "confirm" : "normal");
		setAgentBusy(null);
	}, [initialAgentPending, message.id]);

	const copyReply = useCallback(() => {
		void copyText(text)
			.then(() => onToast("已复制回复"))
			.catch(() => onToast("复制失败"));
	}, [onToast, text]);

	const saveReply = useCallback(async () => {
		if (!text || busyAction) {
			return;
		}
		setBusyAction("note");
		try {
			const title = await generateNoteTitleOrFallback(apiBase, text, "AI笔记");
			await createNote({ title, markdown: text }, apiBase);
			notifyNotesChanged({ animateSave: true });
			onToast("回复已存为笔记");
		} catch (error) {
			console.error(error);
			onToast("保存失败");
		} finally {
			setBusyAction(null);
		}
	}, [apiBase, busyAction, onToast, text]);

	const summarizeReply = useCallback(async () => {
		if (!text || busyAction) {
			return;
		}
		setBusyAction("summary");
		try {
			const { summary } = await summarizeChatContent(apiBase, text);
			const title = await generateNoteTitleOrFallback(apiBase, summary, "AI概要");
			await createNote({ title, markdown: summary }, apiBase);
			notifyNotesChanged({ animateSave: true });
			onToast("概要已存为笔记");
		} catch (error) {
			console.error(error);
			onToast("概要失败");
		} finally {
			setBusyAction(null);
		}
	}, [apiBase, busyAction, onToast, text]);

	const transitionAgentActionsToNormal = useCallback(() => {
		setAgentPanelState("resolving");
		window.setTimeout(() => setAgentPanelState("normal"), AGENT_ACTIONS_TRANSITION_MS);
	}, []);

	const confirmAgentNote = useCallback(async () => {
		if (!agentThreadId || !agentMessageId || agentBusy) {
			return;
		}
		setAgentBusy("confirm");
		try {
			await resolveAgentNote(apiBase, agentThreadId, agentMessageId, "confirm");
			notifyNotesChanged({ animateSave: true });
			onToast("笔记已生成");
			setAgentBusy(null);
			transitionAgentActionsToNormal();
		} catch (error) {
			console.error(error);
			onToast("生成失败");
			setAgentBusy(null);
		}
	}, [agentBusy, agentMessageId, agentThreadId, apiBase, onToast, transitionAgentActionsToNormal]);

	const dismissAgentNote = useCallback(() => {
		if (agentBusy) {
			return;
		}
		transitionAgentActionsToNormal();
		if (!agentThreadId || !agentMessageId) {
			return;
		}
		void resolveAgentNote(apiBase, agentThreadId, agentMessageId, "dismiss").catch((error) => {
			console.error(error);
			onToast("操作同步失败");
		});
	}, [agentBusy, agentMessageId, agentThreadId, apiBase, onToast, transitionAgentActionsToNormal]);

	return (
		<article className={`ai-message ${isUser ? "user" : "assistant"}`}>
			{!isUser ? (
				<div className="ai-message-avatar">
					<Bot aria-hidden="true" />
				</div>
			) : null}
			<div className="ai-message-stack">
				<div className="ai-message-content">
					{isUser ? (
						<p>{text}</p>
					) : isLocalLoading ? (
						<div className="ai-loading-line" role="status" aria-live="polite">
							<span>{text}</span>
							<span className="ai-loading-dots" aria-hidden="true" />
						</div>
					) : (
						<ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
					)}
				</div>
				{!isUser && !isStreaming ? (
					agentPanelState === "normal" ? (
						<div className="ai-message-actions" aria-label="AI 回复操作">
							<button type="button" onClick={copyReply} disabled={!text || Boolean(busyAction)}>
								<Copy aria-hidden="true" />
								<span>复制回复</span>
							</button>
							<button type="button" onClick={() => void saveReply()} disabled={!text || Boolean(busyAction)}>
								<FilePlus2 aria-hidden="true" />
								<span>{busyAction === "note" ? "保存中" : "存为笔记"}</span>
							</button>
							<button
								type="button"
								className="summary"
								onClick={() => void summarizeReply()}
								disabled={!text || Boolean(busyAction)}
							>
								<Sparkles aria-hidden="true" />
								<span>{busyAction === "summary" ? "总结中" : "总结概要"}</span>
							</button>
						</div>
					) : (
						<div
							className={`ai-message-actions agent-confirm ${agentPanelState === "resolving" ? "resolving" : ""}`}
							aria-label="生成笔记确认"
						>
							<span className="agent-confirm-question">
								需要我帮你生成一篇「{agentNoteTitle}」的笔记吗？
							</span>
							<button
								type="button"
								className="agent-confirm-primary"
								onClick={() => void confirmAgentNote()}
								disabled={Boolean(agentBusy) || !agentThreadId || !agentMessageId}
							>
								{agentBusy === "confirm" ? (
									<LoaderCircle className="agent-spinner" aria-hidden="true" />
								) : (
									<Check aria-hidden="true" />
								)}
								<span>需要</span>
							</button>
							<button
								type="button"
								className="agent-confirm-secondary"
								onClick={dismissAgentNote}
								disabled={Boolean(agentBusy)}
							>
								<X aria-hidden="true" />
								<span>不需要</span>
							</button>
						</div>
					)
				) : null}
			</div>
		</article>
	);
}

function HistoryDrawer({
	activeThreadId,
	embed,
	open,
	threads,
	threadsLoading,
	user,
	onClose,
	onDeleteThread,
	onLogout,
	onNewThread,
	onOpenSettings,
	onRenameThread,
	onSelectThread,
}: {
	activeThreadId: string | null;
	embed: boolean;
	open: boolean;
	threads: ChatThread[];
	threadsLoading: boolean;
	user: User;
	onClose: () => void;
	onDeleteThread: (threadId: string) => Promise<void>;
	onLogout: () => Promise<void>;
	onNewThread: () => void;
	onOpenSettings: () => void;
	onRenameThread: (thread: ChatThread) => Promise<void>;
	onSelectThread: (threadId: string) => Promise<void>;
}) {
	return (
		<aside className={`ai-history ${open ? "open" : ""} ${embed ? "embed" : ""}`}>
			<div className="ai-history-head">
				<button type="button" className="ai-history-new" onClick={onNewThread}>
					<MessageSquarePlus aria-hidden="true" />
					<span>新聊天</span>
				</button>
				<button type="button" className="ai-icon-button" aria-label="关闭历史" onClick={onClose}>
					<X aria-hidden="true" />
				</button>
			</div>
			<div className="ai-thread-list">
				{threadsLoading ? <div className="ai-thread-state">Loading</div> : null}
				{threads.map((thread) => (
					<div
						className={`ai-thread-row ${thread.id === activeThreadId ? "active" : ""}`}
						key={thread.id}
					>
						<button type="button" onClick={() => void onSelectThread(thread.id)}>
							<span>{thread.title || "新聊天"}</span>
						</button>
						<div className="ai-thread-actions">
							<button
								type="button"
								aria-label="重命名"
								onClick={() => void onRenameThread(thread)}
							>
								<PenLine aria-hidden="true" />
							</button>
							<button
								type="button"
								aria-label="删除"
								onClick={() => void onDeleteThread(thread.id)}
							>
								<Trash2 aria-hidden="true" />
							</button>
						</div>
					</div>
				))}
				{!threadsLoading && threads.length === 0 ? (
					<div className="ai-thread-state">No chats</div>
				) : null}
			</div>
			<div className="ai-history-user">
				<div>
					<UserRound aria-hidden="true" />
					<span>{user.email}</span>
				</div>
				<div className="ai-history-user-actions">
					<button
						type="button"
						className="ai-icon-button"
						aria-label="AI 设置"
						onClick={onOpenSettings}
					>
						<Settings aria-hidden="true" />
					</button>
					<button
						type="button"
						className="ai-icon-button"
						aria-label="退出登录"
						onClick={() => void onLogout()}
					>
						<LogOut aria-hidden="true" />
					</button>
				</div>
			</div>
		</aside>
	);
}

function AuthScreen({
	embed,
	error,
	theme,
	onSubmit,
}: {
	embed: boolean;
	error: string;
	theme: AiTheme;
	onSubmit: (mode: AuthMode, email: string, password: string) => Promise<void>;
}) {
	const [mode, setMode] = useState<AuthMode>("login");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		try {
			await onSubmit(mode, email, password);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={`ai-auth ${theme} ${embed ? "embed" : ""}`}>
			<form className="ai-auth-panel" onSubmit={submit}>
				<div className="ai-auth-brand">
					<button
						type="button"
						className="ai-auth-back"
						aria-label="返回"
						onClick={() => window.history.back()}
					>
						<ChevronLeft aria-hidden="true" />
					</button>
					<div>
						<Bot aria-hidden="true" />
						<strong>ChatGPT</strong>
					</div>
					<MoreHorizontal aria-hidden="true" />
				</div>
				<div className="ai-auth-tabs">
					<button
						type="button"
						className={mode === "login" ? "active" : ""}
						onClick={() => setMode("login")}
					>
						登录
					</button>
					<button
						type="button"
						className={mode === "register" ? "active" : ""}
						onClick={() => setMode("register")}
					>
						注册
					</button>
				</div>
				<input
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					type="email"
					autoComplete="email"
					placeholder="Email"
					required
				/>
				<input
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					type="password"
					autoComplete={mode === "login" ? "current-password" : "new-password"}
					placeholder="Password"
					minLength={8}
					required
				/>
				{error ? <div className="ai-auth-error">{error}</div> : null}
				<button type="submit" className="ai-auth-submit" disabled={busy}>
					{mode === "login" ? "登录" : "注册"}
				</button>
			</form>
		</div>
	);
}

function AiSettingsPanel({
	apiBase,
	theme,
	embed,
	onClose,
}: {
	apiBase: string;
	theme: AiTheme;
	embed: boolean;
	onClose: () => void;
}) {
	const [loading, setLoading] = useState(true);
	const [baseUrl, setBaseUrl] = useState("");
	const [model, setModel] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [error, setError] = useState("");
	const [status, setStatus] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		getAiSettings(apiBase)
			.then((settings: AiSettings) => {
				if (cancelled) return;
				setBaseUrl(settings.baseUrl);
				setModel(settings.model);
				setApiKey(settings.apiKey);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "加载设置失败");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [apiBase]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError("");
		setStatus("");
		try {
			const settings = await updateAiSettings(apiBase, {
				baseUrl: baseUrl.trim(),
				model: model.trim(),
				apiKey: apiKey.trim(),
			});
			setBaseUrl(settings.baseUrl);
			setModel(settings.model);
			setApiKey(settings.apiKey);
			setStatus("已保存");
		} catch (err) {
			setError(err instanceof Error ? err.message : "保存失败");
		} finally {
			setBusy(false);
		}
	};

	// 清除：把三个输入框全部清空（保存后即回退到部署者默认值）。
	const clearFields = () => {
		setBaseUrl("");
		setModel("");
		setApiKey("");
		setError("");
		setStatus("");
	};

	return (
		<div className={`ai-auth ai-settings ${theme} ${embed ? "embed" : ""}`} onClick={onClose}>
			<form className="ai-auth-panel" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
				<div className="ai-auth-brand">
					<div>
						<Settings aria-hidden="true" />
						<strong>AI 设置</strong>
					</div>
					<button type="button" className="ai-icon-button" aria-label="关闭" onClick={onClose}>
						<X aria-hidden="true" />
					</button>
				</div>
				<p className="ai-settings-hint">
					填写任意 OpenAI 兼容服务的接口地址、模型名和 API Key（三项都需填写才能使用 AI）。
				</p>
				<label className="ai-settings-label">
					接口地址 Base URL
					<input
						value={baseUrl}
						onChange={(event) => setBaseUrl(event.target.value)}
						type="url"
						placeholder="例如 https://api.openai.com/v1"
						disabled={loading || busy}
					/>
				</label>
				<label className="ai-settings-label">
					模型 Model
					<input
						value={model}
						onChange={(event) => setModel(event.target.value)}
						type="text"
						placeholder="例如 gpt-4o-mini"
						disabled={loading || busy}
					/>
				</label>
				<label className="ai-settings-label">
					API Key
					<div className="ai-settings-key">
						<input
							value={apiKey}
							onChange={(event) => setApiKey(event.target.value)}
							type={showKey ? "text" : "password"}
							autoComplete="off"
							placeholder="sk-..."
							disabled={loading || busy}
						/>
						<button
							type="button"
							className="ai-settings-eye"
							aria-label={showKey ? "隐藏密钥" : "显示密钥"}
							onClick={() => setShowKey((value) => !value)}
							disabled={loading || busy}
						>
							{showKey ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
						</button>
					</div>
				</label>
				{error ? <div className="ai-auth-error">{error}</div> : null}
				{status ? <div className="ai-settings-status">{status}</div> : null}
				<div className="ai-settings-actions">
					<button
						type="button"
						className="ai-settings-clear"
						onClick={clearFields}
						disabled={loading || busy}
					>
						清除
					</button>
					<button type="submit" className="ai-auth-submit" disabled={loading || busy}>
						保存
					</button>
				</div>
			</form>
		</div>
	);
}

function toThreadMessageLike(message: ChatMessage): ThreadMessageLike {
	return {
		id: message.id,
		role: message.role,
		content: [{ type: "text", text: message.content }],
		createdAt: new Date(message.createdAt),
		status:
			message.role === "assistant"
				? message.status === "error"
					? { type: "incomplete", reason: "error" }
					: { type: "complete", reason: "stop" }
				: undefined,
		metadata: { custom: message.metadata },
	};
}

function getLastUserText(messages: readonly ThreadMessage[]): string {
	const last = [...messages].reverse().find((message) => message.role === "user");
	return last ? getMessageText(last) : "";
}

function shouldShowAgentNoteLoading(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	const triggers = [
		"笔记",
		"待办",
		"待做",
		"记下来",
		"记录",
		"保存",
		"存一下",
		"收一下",
		"整理成",
		"沉淀",
		"落一篇",
		"文档",
		"方案",
		"todo",
		"note",
		"save",
		"record",
		"remember",
		"document",
		"plan",
	];
	return triggers.some((trigger) => normalized.includes(trigger));
}

function decodeResponseHeader(value: string | null): string {
	if (!value) {
		return "";
	}
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function getCustomMetadata(message: ThreadMessage): Record<string, unknown> {
	const custom = message.metadata.custom;
	return custom && typeof custom === "object" && !Array.isArray(custom) ? custom : {};
}

function normalizeMetadataString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function getMessageText(message: ThreadMessage): string {
	return message.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
}

function activeThreadTitle(threads: ChatThread[], activeThreadId: string | null): string {
	if (!activeThreadId) {
		return "新聊天";
	}
	return threads.find((thread) => thread.id === activeThreadId)?.title || "聊天";
}
