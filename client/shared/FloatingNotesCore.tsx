import {
	Copy,
	FilePlus2,
	MessageSquareText,
	Moon,
	NotebookPen,
	PanelRightOpen,
	Save,
	Send,
	Sun,
	X,
} from "lucide-react";
import {
	type FormEvent,
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
	listNotes,
	updateNote,
} from "./notesApi";
import type { ChatMessage, Note, SelectionToolbar } from "./types";

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

const INITIAL_MESSAGES: ChatMessage[] = [
	{
		id: "intro-1",
		role: "assistant",
		title: "划词笔记抽屉交互",
		body: "这是一个划词抽屉笔记界面。选中网页文字后，问AI 会打开响应式抽屉，笔记 会沿当前端侧方向触发闪光并保存到后端笔记。",
	},
	{
		id: "intro-2",
		role: "assistant",
		title: "响应式存笔记动效",
		body: "AI 页面里的「存为笔记」会跟随抽屉方向沉淀到笔记页：PC 走右侧虫洞，移动端走底部虫洞。",
	},
	{
		id: "intro-3",
		role: "assistant",
		title: "PC 与移动端抽屉规则",
		body: "移动端抽屉从屏幕底部向上出现，宽度占满屏幕，高度为屏幕的三分之二；PC 端抽屉从右侧滑入，高度占满屏幕，宽度为屏幕四分之一。",
	},
];

function makeId(prefix: string) {
	return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeTitle(text: string) {
	const firstLine = String(text || "").trim().split(/\n+/)[0] || "新笔记";
	const title = Array.from(firstLine).slice(0, 30).join("");
	return firstLine.length > 30 ? `${title}...` : title;
}

function makeSelectionTitle(text: string) {
	const normalized = String(text || "").trim().replace(/\s+/g, " ");
	const prefix = Array.from(normalized).slice(0, 10).join("") || "新笔记";
	return `${prefix}...`;
}

function buildDemoAnswer(text: string) {
	const compact = text.replace(/\s+/g, " ").slice(0, 80);
	return `我已读取这段内容：「${compact}${text.length > 80 ? "..." : ""}」。\n\n可以先沉淀成三类笔记：核心结论、可执行动作、后续追问。点击下方「存为笔记」会跟随当前抽屉方向写入笔记。`;
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
	const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
	const [chatInput, setChatInput] = useState("");
	const [toolbar, setToolbar] = useState<SelectionToolbar | null>(null);
	const [toolbarText, setToolbarText] = useState("");
	const [detailOpen, setDetailOpen] = useState(false);
	const [currentNoteId, setCurrentNoteId] = useState<string | null>(null);
	const [detailTitle, setDetailTitle] = useState("");
	const [detailContent, setDetailContent] = useState("");
	const [toast, setToast] = useState("");
	const [bottomGlow, setBottomGlow] = useState(false);
	const [rightGlow, setRightGlow] = useState(false);
	const [edgeGlow, setEdgeGlow] = useState(false);

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const drawerRef = useRef<HTMLElement | null>(null);
	const toolbarRef = useRef<HTMLDivElement | null>(null);
	const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
	const chatScrollRef = useRef<HTMLDivElement | null>(null);
	const particlesRef = useRef<Particle[]>([]);
	const particleRafRef = useRef(0);
	const selectionTimerRef = useRef(0);
	const toastTimerRef = useRef(0);
	const toolbarActionRef = useRef({ action: "", at: 0 });

	const showToast = useCallback((message: string) => {
		window.clearTimeout(toastTimerRef.current);
		setToast(message);
		toastTimerRef.current = window.setTimeout(() => setToast(""), 900);
	}, []);

	const fetchNotes = useCallback(async () => {
		setNotesState("加载中...");
		try {
			const nextNotes = await listNotes(apiBase);
			setNotes(nextNotes);
			setNotesState(nextNotes.length ? "" : "暂无笔记");
		} catch (error) {
			console.error(error);
			setNotesState("笔记加载失败，请确认后端服务已启动");
		}
	}, [apiBase]);

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
		};
	}, [fetchNotes, setupCanvas]);

	useEffect(() => {
		const handleSelectionChange = () => {
			window.clearTimeout(selectionTimerRef.current);
			selectionTimerRef.current = window.setTimeout(() => {
				const selection = window.getSelection();
				const text = selection?.toString().trim() ?? "";
				if (!selection || !selection.rangeCount || !text) {
					setToolbar(null);
					return;
				}
				const anchor = selection.anchorNode;
				const focus = selection.focusNode;
				if (
					(anchor && drawerRef.current?.contains(anchor)) ||
					(focus && drawerRef.current?.contains(focus)) ||
					(anchor && toolbarRef.current?.contains(anchor)) ||
					(focus && toolbarRef.current?.contains(focus))
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
					const widthGuess = 155;
					const left = Math.max(
						8 + widthGuess / 2,
						Math.min(rect.left + rect.width / 2, window.innerWidth - 8 - widthGuess / 2)
					);
					const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 37));
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
					target.closest("#dst-drawer") ||
					target.closest("#dst-float"))
			) {
				return;
			}
			setToolbar(null);
		};

		document.addEventListener("selectionchange", handleSelectionChange);
		document.addEventListener("mousedown", handleOutsidePointer, true);
		document.addEventListener("touchstart", handleOutsidePointer, true);
		return () => {
			document.removeEventListener("selectionchange", handleSelectionChange);
			document.removeEventListener("mousedown", handleOutsidePointer, true);
			document.removeEventListener("touchstart", handleOutsidePointer, true);
		};
	}, []);

	const isMobile = () => window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
	const getSaveEdge = (): "right" | "bottom" => (isMobile() ? "bottom" : "right");

	const open = (page: Page = "notes") => {
		setActivePage(page);
		setDrawerOpen(true);
		if (page === "notes") {
			void fetchNotes();
		}
	};

	const close = () => {
		setDrawerOpen(false);
		setDetailOpen(false);
	};

	const openDrawerWithText = (text: string) => {
		open("chat");
		setChatInput((current) => `【选中内容】${text}\n\n${current}`);
		window.setTimeout(() => {
			chatInputRef.current?.focus({ preventScroll: true });
			const input = chatInputRef.current;
			if (input) {
				input.setSelectionRange(input.value.length, input.value.length);
			}
		}, 260);
	};

	const saveSelectionNote = async (text: string) => {
		const content = text.trim();
		if (!content) {
			return;
		}
		const edge = getSaveEdge();
		const targetX = edge === "right" ? window.innerWidth - 8 : window.innerWidth / 2;
		const targetY = edge === "right" ? window.innerHeight / 2 : window.innerHeight - 8;
		setRightGlow(edge === "right");
		setBottomGlow(edge === "bottom");
		spawnParticles(targetX, targetY, 28, edge);
		window.setTimeout(async () => {
			setRightGlow(false);
			setBottomGlow(false);
			try {
				await createBackendNote({ title: makeSelectionTitle(content), content }, apiBase);
				await fetchNotes();
				showToast("已存入笔记");
			} catch (error) {
				console.error(error);
				showToast("保存失败");
			}
		}, 430);
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
			setToolbarText("");
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

	const stopToolbarPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const sendMessage = (event?: FormEvent) => {
		event?.preventDefault();
		const text = chatInput.trim();
		if (!text) {
			return;
		}
		const answer = buildDemoAnswer(text);
		setMessages((current) => [
			...current,
			{ id: makeId("you"), role: "user", body: text },
			{ id: makeId("ai"), role: "assistant", body: answer, title: makeTitle(answer) },
		]);
		setChatInput("");
		window.setTimeout(() => {
			if (chatScrollRef.current) {
				chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
			}
		}, 0);
	};

	const saveChatNote = async (title: string, body: string) => {
		const edge = getSaveEdge();
		const rect = drawerRef.current?.getBoundingClientRect();
		const targetX = edge === "right" && rect ? rect.right - 8 : window.innerWidth / 2;
		const targetY =
			edge === "right" && rect ? rect.top + rect.height / 2 : window.innerHeight - 8;
		setEdgeGlow(edge === "right");
		setBottomGlow(edge === "bottom");
		window.setTimeout(() => spawnParticles(targetX, targetY, 30, edge), 120);
		window.setTimeout(async () => {
			setEdgeGlow(false);
			setBottomGlow(false);
			try {
				await createBackendNote({ title, content: body }, apiBase);
				await fetchNotes();
				showToast("已存入笔记");
			} catch (error) {
				console.error(error);
				showToast("保存失败");
			}
		}, 420);
	};

	const createNewNote = () => {
		setCurrentNoteId(null);
		setDetailTitle("");
		setDetailContent("");
		setDetailOpen(true);
	};

	const openDetail = (note: Note) => {
		setActivePage("notes");
		setCurrentNoteId(note.id);
		setDetailTitle(note.title || "");
		setDetailContent(note.content || "");
		setDetailOpen(true);
	};

	const saveDetailNote = async () => {
		const title = detailTitle.trim();
		const content = detailContent.trim();
		if (!title) {
			window.alert("请输入标题");
			return;
		}
		try {
			if (currentNoteId) {
				await updateNote(currentNoteId, { title, content }, apiBase);
			} else {
				await createBackendNote({ title, content }, apiBase);
			}
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
			await deleteBackendNote(note.id, apiBase);
			await fetchNotes();
			if (currentNoteId === note.id) {
				setDetailOpen(false);
				setCurrentNoteId(null);
			}
			showToast("删除成功");
		} catch (error) {
			console.error(error);
			showToast("删除失败");
		}
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
			<button type="button" id="dst-float" aria-label="打开笔记" onClick={() => open("notes")}>
				<NotebookPen aria-hidden="true" size={21} />
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
						<div className="dst-chat-scroll" ref={chatScrollRef}>
							<div id="dst-wormhole-edge" className={edgeGlow ? "glow" : ""}></div>
							{messages.map((message) => (
								<article
									key={message.id}
									className={`dst-chat-card ${message.role === "user" ? "user" : ""}`}
								>
									<div className={`dst-card-label ${message.role === "user" ? "cyan" : ""}`}>
										{message.role === "assistant" ? <span className="dst-ai-dot"></span> : null}
										{message.role === "assistant" ? "AI" : "You"}
									</div>
									<p className="dst-card-body">{message.body}</p>
									{message.role === "assistant" ? (
										<button
											type="button"
											className="dst-save-note-btn"
											onClick={() =>
												void saveChatNote(message.title || makeTitle(message.body), message.body)
											}
										>
											<FilePlus2 aria-hidden="true" size={13} />
											存为笔记
										</button>
									) : null}
								</article>
							))}
						</div>
						<form className="dst-chat-input-bar" onSubmit={sendMessage}>
							<textarea
								id="dst-chat-input"
								ref={chatInputRef}
								rows={1}
								value={chatInput}
								onChange={(event) => setChatInput(event.target.value)}
								placeholder="选中文字点「问AI」，内容会放到这里，可继续补充问题"
							></textarea>
							<button type="submit" className="dst-send-btn" title="发送">
								<Send aria-hidden="true" />
							</button>
						</form>
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
										<div className="swipe-item" key={note.id}>
											<div className="actions">
												<button
													type="button"
													className="copy-btn"
													onClick={() =>
														void copyText(note.content || "")
															.then(() => showToast("复制成功"))
															.catch(() => showToast("复制失败"))
													}
												>
													复制
												</button>
												<button
													type="button"
													className="delete-btn"
													onClick={() => void removeNote(note)}
												>
													删除
												</button>
											</div>
											<button type="button" className="note-item" onClick={() => openDetail(note)}>
												<div className="note-title">{note.title || "未命名"}</div>
												<div className="note-desc">{note.content || ""}</div>
											</button>
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
									onClick={() => setDetailOpen(false)}
								>
									←
								</button>
								<input
									className="detail-title"
									value={detailTitle}
									onChange={(event) => setDetailTitle(event.target.value)}
									placeholder="输入标题"
								/>
								<button type="button" className="save-btn" onClick={() => void saveDetailNote()}>
									保存
								</button>
							</div>
							<textarea
								className="detail-content"
								value={detailContent}
								onChange={(event) => setDetailContent(event.target.value)}
								placeholder="输入内容..."
							></textarea>
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
