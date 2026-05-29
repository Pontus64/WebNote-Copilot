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
	ChevronLeft,
	LogOut,
	Menu,
	MessageSquarePlus,
	MoreHorizontal,
	PenLine,
	Plus,
	Send,
	Trash2,
	UserRound,
	X,
} from "lucide-react";
import {
	type FormEvent,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	type ChatMessage,
	type ChatThread,
	type User,
	createThread,
	deleteThread,
	getMe,
	login,
	logout,
	register,
	listMessages,
	listThreads,
	renameThread,
	readApiError,
	sendChatMessage,
} from "../shared/apiClient";

type ChatAppProps = {
	apiBase?: string;
	embed?: boolean;
};

type AuthMode = "login" | "register";

type PendingSelectionMessage = {
	id: number;
	text: string;
};

const EMPTY_MESSAGES: ThreadMessageLike[] = [];

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
	const [pendingSelection, setPendingSelection] = useState<PendingSelectionMessage | null>(null);
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
			if (event.data.type !== "floating-notes:ask") {
				return;
			}
			const text = typeof event.data.text === "string" ? event.data.text.trim() : "";
			if (text) {
				setPendingSelection({ id: Date.now(), text });
			}
		};

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, []);

	const createLocalThread = useCallback(
		async (title: string) => {
			const thread = await createThread(apiBase, title);
			setActiveThreadId(thread.id);
			activeThreadIdRef.current = thread.id;
			setInitialMessages(EMPTY_MESSAGES);
			setRuntimeKey(`${thread.id}:new:${Date.now()}`);
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
			const thread = await createLocalThread(prompt);
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
		return <div className="ai-loading">Loading</div>;
	}

	if (!user) {
		return <AuthScreen error={authError} embed={embed} onSubmit={handleAuth} />;
	}

	return (
		<div className={`ai-shell ${embed ? "embed" : ""}`}>
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
				onRenameThread={handleRenameThread}
				onSelectThread={selectThread}
			/>
			<div
				className={`ai-history-scrim ${historyOpen ? "show" : ""}`}
				onClick={() => setHistoryOpen(false)}
			/>
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
					chatModel={chatModel}
					initialMessages={initialMessages}
					pendingSelection={pendingSelection}
				/>
			</section>
		</div>
	);
}

function ChatRuntime({
	chatModel,
	initialMessages,
	pendingSelection,
}: {
	chatModel: ChatModelAdapter;
	initialMessages: readonly ThreadMessageLike[];
	pendingSelection: PendingSelectionMessage | null;
}) {
	const runtime = useLocalRuntime(chatModel, { initialMessages });

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ChatThreadView pendingSelection={pendingSelection} />
		</AssistantRuntimeProvider>
	);
}

function ChatThreadView({ pendingSelection }: { pendingSelection: PendingSelectionMessage | null }) {
	const thread = useThread();
	const runtime = useThreadRuntime();
	const [draft, setDraft] = useState("");
	const [lastSelectionId, setLastSelectionId] = useState(0);
	const viewportRef = useRef<HTMLDivElement | null>(null);

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
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			send();
		}
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
					thread.messages.map((message) => (
						<MessageBubble key={message.id} message={message} />
					))
				)}
			</div>
			<form className="ai-composer" onSubmit={handleSubmit}>
				<textarea
					rows={1}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
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
		</>
	);
}

function MessageBubble({ message }: { message: ThreadMessage }) {
	const text = getMessageText(message);
	const isUser = message.role === "user";

	return (
		<article className={`ai-message ${isUser ? "user" : "assistant"}`}>
			{!isUser ? (
				<div className="ai-message-avatar">
					<Bot aria-hidden="true" />
				</div>
			) : null}
			<div className="ai-message-content">
				{isUser ? (
					<p>{text}</p>
				) : (
					<ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
				)}
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
				<button type="button" className="ai-icon-button" aria-label="退出登录" onClick={() => void onLogout()}>
					<LogOut aria-hidden="true" />
				</button>
			</div>
		</aside>
	);
}

function AuthScreen({
	embed,
	error,
	onSubmit,
}: {
	embed: boolean;
	error: string;
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
		<div className={`ai-auth ${embed ? "embed" : ""}`}>
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
