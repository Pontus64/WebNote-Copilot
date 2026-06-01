type Note = {
	id: string;
	title: string;
	markdown: string;
	excerpt: string;
	contentFormat: "markdown";
	schemaVersion: 2;
	assetCount: number;
	createdAt: number;
	updatedAt: number;
};

type NoteRow = {
	id: string;
	title: string | null;
	markdown: string | null;
	excerpt: string | null;
	schema_version: number | null;
	asset_count: number | null;
	created_at: number;
	updated_at: number;
};

type User = {
	id: string;
	email: string;
	createdAt: number;
	updatedAt: number;
};

type UserRow = {
	id: string;
	email: string;
	password_salt: string;
	password_hash: string;
	password_iterations: number;
	created_at: number;
	updated_at: number;
};

type AuthContext = {
	user: User;
	sessionId: string;
	token: string;
};

type ChatThread = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
};

type ChatThreadRow = {
	id: string;
	title: string | null;
	created_at: number;
	updated_at: number;
};

type ChatMessage = {
	id: string;
	threadId: string;
	role: "user" | "assistant" | "system";
	content: string;
	status: string;
	metadata: Record<string, unknown>;
	createdAt: number;
};

type ChatMessageRow = {
	id: string;
	thread_id: string;
	role: string;
	content: string | null;
	status: string | null;
	metadata: string | null;
	created_at: number;
};

type EnvWithBindings = Env & {
	wranglerdemo: D1Database;
	ASSETS?: Fetcher;
	DEEPSEEK_API_KEY?: string;
	DEEPSEEK_BASE_URL?: string;
	DEEPSEEK_MODEL?: string;
	SESSION_COOKIE_NAME?: string;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 100_000;
const SESSION_COOKIE_FALLBACK = "fn_session";
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8" };
const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";
const encoder = new TextEncoder();

class ApiError extends Error {
	readonly isApiError = true;

	constructor(
		public readonly status: number,
		message: string,
		public readonly expose = true
	) {
		super(message);
		this.name = "ApiError";
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders(request) });
		}

		try {
			if (url.pathname.startsWith("/api/auth/")) {
				return await handleAuthRequest(request, env, url);
			}

			if (url.pathname.startsWith("/api/chat/")) {
				return await handleChatRequest(request, env, ctx, url);
			}

			if (
				url.pathname === "/api/notes" ||
				url.pathname.startsWith("/api/notes/") ||
				url.pathname === "/notes" ||
				url.pathname.startsWith("/notes/")
			) {
				return await handleNotesRequest(request, env, url);
			}
		} catch (error) {
			return handleApiError(error, request);
		}

		if (env.ASSETS) {
			return env.ASSETS.fetch(request);
		}

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<EnvWithBindings>;

async function handleAuthRequest(
	request: Request,
	env: EnvWithBindings,
	url: URL
): Promise<Response> {
	const action = url.pathname.replace(/^\/api\/auth\/?/, "");

	if (action === "register" && request.method === "POST") {
		const body = await readJsonBody(request);
		const email = normalizeEmail(body.email);
		const password = normalizeText(body.password);
		if (!isValidEmail(email)) {
			throw new ApiError(400, "invalid email");
		}
		if (password.length < 8) {
			throw new ApiError(400, "password must be at least 8 characters");
		}

		const existing = await env.wranglerdemo
			.prepare("SELECT id FROM auth_users WHERE email = ?")
			.bind(email)
			.first<{ id: string }>();
		if (existing) {
			throw new ApiError(409, "email already registered");
		}

		const now = Date.now();
		const salt = randomHex(16);
		const passwordHash = await hashPassword(password, salt, PASSWORD_ITERATIONS);
		const user: User = {
			id: crypto.randomUUID(),
			email,
			createdAt: now,
			updatedAt: now,
		};

		await env.wranglerdemo
			.prepare(
				`INSERT INTO auth_users (id, email, password_salt, password_hash, password_iterations, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(user.id, user.email, salt, passwordHash, PASSWORD_ITERATIONS, now, now)
			.run();

		await env.wranglerdemo
			.prepare("UPDATE notes SET user_id = ? WHERE user_id IS NULL")
			.bind(user.id)
			.run();

		const session = await createSession(env.wranglerdemo, user.id);
		return json(
			{ user, sessionToken: session.token },
			201,
			request,
			{ "Set-Cookie": makeSessionCookie(env, request, session.token, SESSION_TTL_MS) }
		);
	}

	if (action === "login" && request.method === "POST") {
		const body = await readJsonBody(request);
		const email = normalizeEmail(body.email);
		const password = normalizeText(body.password);
		const row = await env.wranglerdemo
			.prepare(
				`SELECT id, email, password_salt, password_hash, password_iterations, created_at, updated_at
				 FROM auth_users
				 WHERE email = ?`
			)
			.bind(email)
			.first<UserRow>();

		if (!row) {
			throw new ApiError(401, "invalid email or password");
		}

		const passwordHash = await hashPassword(password, row.password_salt, row.password_iterations);
		if (!timingSafeEqual(passwordHash, row.password_hash)) {
			throw new ApiError(401, "invalid email or password");
		}

		const user = userFromRow(row);
		const session = await createSession(env.wranglerdemo, user.id);
		return json(
			{ user, sessionToken: session.token },
			200,
			request,
			{ "Set-Cookie": makeSessionCookie(env, request, session.token, SESSION_TTL_MS) }
		);
	}

	if (action === "logout" && request.method === "POST") {
		const auth = await getAuthContext(request, env, false);
		if (auth) {
			await env.wranglerdemo
				.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?")
				.bind(Date.now(), auth.sessionId)
				.run();
		}
		return json(
			{ success: true },
			200,
			request,
			{ "Set-Cookie": clearSessionCookie(env, request) }
		);
	}

	if (action === "me" && request.method === "GET") {
		const auth = await getAuthContext(request, env, false);
		if (!auth) {
			throw new ApiError(401, "unauthorized");
		}
		return json({ user: auth.user }, 200, request);
	}

	throw new ApiError(405, "method not allowed");
}

async function handleNotesRequest(
	request: Request,
	env: EnvWithBindings,
	url: URL
): Promise<Response> {
	const auth = await requireAuth(request, env);
	const path = url.pathname.startsWith("/api/notes")
		? url.pathname.replace(/^\/api\/notes\/?/, "")
		: url.pathname.replace(/^\/notes\/?/, "");
	const noteId = decodeURIComponent(path);
	const isCollection = url.pathname === "/api/notes" || url.pathname === "/notes";

	if (isCollection && request.method === "GET") {
		return json(await listNotes(env.wranglerdemo, auth.user.id), 200, request);
	}

	if (isCollection && request.method === "POST") {
		return createNote(request, env.wranglerdemo, auth.user.id);
	}

	if (noteId && request.method === "GET") {
		return getNote(env.wranglerdemo, auth.user.id, noteId, request);
	}

	if (noteId && request.method === "PUT") {
		return updateNote(request, env.wranglerdemo, auth.user.id, noteId);
	}

	if (noteId && request.method === "DELETE") {
		return deleteNote(env.wranglerdemo, auth.user.id, noteId, request);
	}

	throw new ApiError(405, "method not allowed");
}

async function handleChatRequest(
	request: Request,
	env: EnvWithBindings,
	ctx: ExecutionContext,
	url: URL
): Promise<Response> {
	const auth = await requireAuth(request, env);
	const path = url.pathname.replace(/^\/api\/chat\/?/, "");
	const parts = path.split("/").filter(Boolean).map(decodeURIComponent);

	if (parts.length === 1 && parts[0] === "summary" && request.method === "POST") {
		const body = await readJsonBody(request);
		const content = normalizeText(body.content).trim();
		if (!content) {
			throw new ApiError(400, "summary content is required");
		}
		return json({ summary: await summarizeChatContent(env, content) }, 200, request);
	}

	if (parts.length === 1 && parts[0] === "threads" && request.method === "GET") {
		return json(await listThreads(env.wranglerdemo, auth.user.id), 200, request);
	}

	if (parts.length === 1 && parts[0] === "threads" && request.method === "POST") {
		const body = await readJsonBody(request);
		const thread = await createThread(env.wranglerdemo, auth.user.id, normalizeText(body.title));
		return json(thread, 201, request);
	}

	if (parts[0] === "threads" && parts[1]) {
		const threadId = parts[1];
		const thread = await requireThread(env.wranglerdemo, auth.user.id, threadId);

		if (parts.length === 2 && request.method === "GET") {
			return json(thread, 200, request);
		}

		if (parts.length === 2 && request.method === "PATCH") {
			const body = await readJsonBody(request);
			const updated = await renameThread(
				env.wranglerdemo,
				auth.user.id,
				threadId,
				normalizeText(body.title)
			);
			return json(updated, 200, request);
		}

		if (parts.length === 2 && request.method === "DELETE") {
			await archiveThread(env.wranglerdemo, auth.user.id, threadId);
			return json({ success: true }, 200, request);
		}

		if (parts.length === 3 && parts[2] === "messages" && request.method === "GET") {
			return json(await listThreadMessages(env.wranglerdemo, auth.user.id, threadId), 200, request);
		}

		if (parts.length === 3 && parts[2] === "messages" && request.method === "POST") {
			const body = await readJsonBody(request);
			const content = normalizeText(body.content).trim();
			if (!content) {
				throw new ApiError(400, "message content is required");
			}
			return streamAssistantReply(request, env, ctx, auth, thread, content);
		}
	}

	throw new ApiError(405, "method not allowed");
}

async function listNotes(db: D1Database, userId: string): Promise<Note[]> {
	const { results } = await db
		.prepare(
			`SELECT id, title, markdown, excerpt, schema_version, 0 AS asset_count, created_at, updated_at
			 FROM notes
			 WHERE user_id = ?
			 ORDER BY updated_at DESC, created_at DESC`
		)
		.bind(userId)
		.all<NoteRow>();

	return results.map(noteFromRow);
}

async function getNote(
	db: D1Database,
	userId: string,
	id: string,
	request: Request
): Promise<Response> {
	const note = await findNote(db, userId, id);
	if (!note) {
		throw new ApiError(404, "note not found");
	}
	return json(note, 200, request);
}

async function createNote(request: Request, db: D1Database, userId: string): Promise<Response> {
	const body = await readJsonBody(request);
	const now = Date.now();
	const note: Note = {
		id: crypto.randomUUID(),
		title: normalizeText(body.title),
		markdown: normalizeText(body.markdown),
		excerpt: makeMarkdownExcerpt(normalizeText(body.markdown)),
		contentFormat: "markdown",
		schemaVersion: 2,
		assetCount: 0,
		createdAt: now,
		updatedAt: now,
	};

	await db
		.prepare(
			`INSERT INTO notes (id, user_id, title, markdown, excerpt, schema_version, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			note.id,
			userId,
			note.title,
			note.markdown,
			note.excerpt,
			note.schemaVersion,
			note.createdAt,
			note.updatedAt
		)
		.run();

	return json(note, 201, request);
}

async function updateNote(
	request: Request,
	db: D1Database,
	userId: string,
	id: string
): Promise<Response> {
	const existing = await findNote(db, userId, id);
	if (!existing) {
		throw new ApiError(404, "note not found");
	}

	const body = await readJsonBody(request);
	const markdown = normalizeText(body.markdown);
	const updated: Note = {
		...existing,
		title: normalizeText(body.title),
		markdown,
		excerpt: makeMarkdownExcerpt(markdown),
		updatedAt: Date.now(),
	};

	await db
		.prepare(
			`UPDATE notes
			 SET title = ?, markdown = ?, excerpt = ?, schema_version = ?, updated_at = ?
			 WHERE id = ? AND user_id = ?`
		)
		.bind(
			updated.title,
			updated.markdown,
			updated.excerpt,
			updated.schemaVersion,
			updated.updatedAt,
			id,
			userId
		)
		.run();

	return json(updated, 200, request);
}

async function deleteNote(
	db: D1Database,
	userId: string,
	id: string,
	request: Request
): Promise<Response> {
	const result = await db
		.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?")
		.bind(id, userId)
		.run();

	if (Number(result.meta.changes ?? 0) === 0) {
		throw new ApiError(404, "note not found");
	}

	return json({ success: true }, 200, request);
}

async function findNote(db: D1Database, userId: string, id: string): Promise<Note | null> {
	const row = await db
		.prepare(
			`SELECT id, title, markdown, excerpt, schema_version, 0 AS asset_count, created_at, updated_at
			 FROM notes
			 WHERE id = ? AND user_id = ?`
		)
		.bind(id, userId)
		.first<NoteRow>();

	return row ? noteFromRow(row) : null;
}

async function listThreads(db: D1Database, userId: string): Promise<ChatThread[]> {
	const { results } = await db
		.prepare(
			`SELECT id, title, created_at, updated_at
			 FROM auth_chat_threads
			 WHERE user_id = ? AND archived_at IS NULL
			 ORDER BY updated_at DESC, created_at DESC`
		)
		.bind(userId)
		.all<ChatThreadRow>();

	return results.map(threadFromRow);
}

async function createThread(
	db: D1Database,
	userId: string,
	rawTitle: string
): Promise<ChatThread> {
	const now = Date.now();
	const title = makeThreadTitle(rawTitle);
	const thread: ChatThread = {
		id: crypto.randomUUID(),
		title,
		createdAt: now,
		updatedAt: now,
	};

	await db
		.prepare(
			`INSERT INTO auth_chat_threads (id, user_id, title, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?)`
		)
		.bind(thread.id, userId, thread.title, thread.createdAt, thread.updatedAt)
		.run();

	return thread;
}

async function requireThread(
	db: D1Database,
	userId: string,
	threadId: string
): Promise<ChatThread> {
	const row = await db
		.prepare(
			`SELECT id, title, created_at, updated_at
			 FROM auth_chat_threads
			 WHERE id = ? AND user_id = ? AND archived_at IS NULL`
		)
		.bind(threadId, userId)
		.first<ChatThreadRow>();

	if (!row) {
		throw new ApiError(404, "thread not found");
	}
	return threadFromRow(row);
}

async function renameThread(
	db: D1Database,
	userId: string,
	threadId: string,
	rawTitle: string
): Promise<ChatThread> {
	const title = makeThreadTitle(rawTitle);
	const updatedAt = Date.now();
	const result = await db
		.prepare(
			`UPDATE auth_chat_threads
			 SET title = ?, updated_at = ?
			 WHERE id = ? AND user_id = ? AND archived_at IS NULL`
		)
		.bind(title, updatedAt, threadId, userId)
		.run();

	if (Number(result.meta.changes ?? 0) === 0) {
		throw new ApiError(404, "thread not found");
	}

	return requireThread(db, userId, threadId);
}

async function archiveThread(db: D1Database, userId: string, threadId: string): Promise<void> {
	const now = Date.now();
	const result = await db
		.prepare(
			`UPDATE auth_chat_threads
			 SET archived_at = ?, updated_at = ?
			 WHERE id = ? AND user_id = ? AND archived_at IS NULL`
		)
		.bind(now, now, threadId, userId)
		.run();

	if (Number(result.meta.changes ?? 0) === 0) {
		throw new ApiError(404, "thread not found");
	}
}

async function listThreadMessages(
	db: D1Database,
	userId: string,
	threadId: string
): Promise<ChatMessage[]> {
	const { results } = await db
		.prepare(
			`SELECT id, thread_id, role, content, status, metadata, created_at
			 FROM auth_chat_messages
			 WHERE thread_id = ? AND user_id = ?
			 ORDER BY created_at ASC`
		)
		.bind(threadId, userId)
		.all<ChatMessageRow>();

	return results.map(chatMessageFromRow);
}

async function streamAssistantReply(
	request: Request,
	env: EnvWithBindings,
	ctx: ExecutionContext,
	auth: AuthContext,
	thread: ChatThread,
	userContent: string
): Promise<Response> {
	const now = Date.now();
	const userMessageId = crypto.randomUUID();
	const assistantMessageId = crypto.randomUUID();

	await env.wranglerdemo.batch([
		env.wranglerdemo
			.prepare(
				`INSERT INTO auth_chat_messages (id, thread_id, user_id, role, content, status, metadata, created_at)
				 VALUES (?, ?, ?, 'user', ?, 'complete', '{}', ?)`
			)
			.bind(userMessageId, thread.id, auth.user.id, userContent, now),
		env.wranglerdemo
			.prepare(
				`UPDATE auth_chat_threads
				 SET title = CASE WHEN title = '新聊天' THEN ? ELSE title END,
				     updated_at = ?
				 WHERE id = ? AND user_id = ?`
			)
			.bind(makeThreadTitle(userContent), now, thread.id, auth.user.id),
	]);

	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
	const writer = writable.getWriter();
	const pump = pumpDeepSeekResponse(
		env,
		auth,
		thread.id,
		assistantMessageId,
		userContent,
		writer
	);

	ctx.waitUntil(
		pump.catch((error) => {
			console.error(
				JSON.stringify({
					message: "chat stream failed",
					error: error instanceof Error ? error.message : String(error),
				})
			);
		})
	);

	return new Response(readable, {
		headers: {
			...corsHeaders(request),
			...TEXT_HEADERS,
			"Cache-Control": "no-store",
		},
	});
}

async function pumpDeepSeekResponse(
	env: EnvWithBindings,
	auth: AuthContext,
	threadId: string,
	assistantMessageId: string,
	userContent: string,
	writer: WritableStreamDefaultWriter<Uint8Array>
): Promise<void> {
	let assistantContent = "";
	let status = "complete";
	let metadata: Record<string, unknown> = {};

	try {
		if (!env.DEEPSEEK_API_KEY) {
			throw new ApiError(503, "DeepSeek API key is not configured");
		}

		const messages = await listThreadMessages(env.wranglerdemo, auth.user.id, threadId);
		const upstream = await fetch(`${getDeepSeekBaseUrl(env)}/chat/completions`, {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: env.DEEPSEEK_MODEL || DEEPSEEK_DEFAULT_MODEL,
				stream: true,
				thinking: { type: "disabled" },
				messages: buildDeepSeekMessages(messages, userContent),
			}),
		});

		if (!upstream.ok || !upstream.body) {
			const detail = await readLimitedText(upstream, 1800);
			throw new Error(`DeepSeek request failed: ${upstream.status} ${detail}`);
		}

		const reader = upstream.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let done = false;

		while (!done) {
			const chunk = await reader.read();
			done = chunk.done;
			buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !done });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) {
					continue;
				}
				const data = trimmed.slice(5).trim();
				if (!data || data === "[DONE]") {
					continue;
				}
				const parsed = safeJsonParse(data);
				const delta = parsed?.choices?.[0]?.delta?.content;
				if (typeof delta === "string" && delta) {
					assistantContent += delta;
					await writer.write(encoder.encode(delta));
				}
			}
		}
	} catch (error) {
		status = "error";
		metadata = { error: error instanceof Error ? error.message : String(error) };
		if (!assistantContent) {
			assistantContent =
				isApiError(error) && error.status === 503
					? "DeepSeek API key is not configured."
					: "AI reply failed. Please try again later.";
			await writer.write(encoder.encode(assistantContent));
		}
	} finally {
		const now = Date.now();
		await env.wranglerdemo.batch([
			env.wranglerdemo
				.prepare(
				`INSERT INTO auth_chat_messages (id, thread_id, user_id, role, content, status, metadata, created_at)
					 VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?)`
				)
				.bind(
					assistantMessageId,
					threadId,
					auth.user.id,
					assistantContent,
					status,
					JSON.stringify(metadata),
					now
				),
			env.wranglerdemo
				.prepare(
					`UPDATE auth_chat_threads
					 SET updated_at = ?
					 WHERE id = ? AND user_id = ?`
				)
				.bind(now, threadId, auth.user.id),
		]);
		await writer.close();
	}
}

function buildDeepSeekMessages(messages: ChatMessage[], userContent: string) {
	const filtered = messages
		.filter((message) => message.role === "user" || message.role === "assistant")
		.slice(-20)
		.map((message) => ({
			role: message.role,
			content: message.content,
		}));

	const last = filtered.at(-1);
	if (!last || last.role !== "user" || last.content !== userContent) {
		filtered.push({ role: "user", content: userContent });
	}

	return [
		{
			role: "system",
			content:
				"You are a concise assistant inside a chat-and-notes product. Answer in the user's language.",
		},
		...filtered,
	];
}

async function summarizeChatContent(env: EnvWithBindings, content: string): Promise<string> {
	if (!env.DEEPSEEK_API_KEY) {
		throw new ApiError(503, "DeepSeek API key is not configured");
	}

	const upstream = await fetch(`${getDeepSeekBaseUrl(env)}/chat/completions`, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: env.DEEPSEEK_MODEL || DEEPSEEK_DEFAULT_MODEL,
			stream: false,
			thinking: { type: "disabled" },
			messages: [
				{
					role: "system",
					content:
						"Summarize the user's text into concise notes in the same language. Keep key facts, decisions, and next actions. Do not add facts that are not in the text.",
				},
				{
					role: "user",
					content,
				},
			],
		}),
	});

	if (!upstream.ok) {
		const detail = await readLimitedText(upstream, 1800);
		console.error(
			JSON.stringify({
				message: "DeepSeek summary request failed",
				status: upstream.status,
				detail,
			})
		);
		throw new ApiError(502, "summary failed");
	}

	const parsed = (await upstream.json().catch(() => null)) as {
		choices?: Array<{ message?: { content?: unknown } }>;
	} | null;
	const summary = parsed?.choices?.[0]?.message?.content;
	if (typeof summary !== "string" || !summary.trim()) {
		throw new ApiError(502, "summary failed");
	}
	return summary.trim();
}

async function getAuthContext(
	request: Request,
	env: EnvWithBindings,
	throwOnMissing: boolean
): Promise<AuthContext | null> {
	const token = getBearerToken(request) || getCookie(request, sessionCookieName(env));
	if (!token) {
		if (throwOnMissing) {
			throw new ApiError(401, "unauthorized");
		}
		return null;
	}

	const tokenHash = await sha256Hex(token);
	const row = await env.wranglerdemo
		.prepare(
			`SELECT s.id AS session_id, u.id, u.email, u.created_at, u.updated_at
			 FROM auth_sessions s
			 INNER JOIN auth_users u ON u.id = s.user_id
			 WHERE s.token_hash = ?
			   AND s.revoked_at IS NULL
			   AND s.expires_at > ?`
		)
		.bind(tokenHash, Date.now())
		.first<{
			session_id: string;
			id: string;
			email: string;
			created_at: number;
			updated_at: number;
		}>();

	if (!row) {
		if (throwOnMissing) {
			throw new ApiError(401, "unauthorized");
		}
		return null;
	}

	return {
		sessionId: row.session_id,
		token,
		user: {
			id: row.id,
			email: row.email,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		},
	};
}

async function requireAuth(request: Request, env: EnvWithBindings): Promise<AuthContext> {
	const auth = await getAuthContext(request, env, true);
	if (!auth) {
		throw new ApiError(401, "unauthorized");
	}
	return auth;
}

async function createSession(db: D1Database, userId: string) {
	const now = Date.now();
	const token = randomToken();
	const tokenHash = await sha256Hex(token);
	const session = {
		id: crypto.randomUUID(),
		token,
		expiresAt: now + SESSION_TTL_MS,
	};

	await db
		.prepare(
			`INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at)
			 VALUES (?, ?, ?, ?, ?)`
		)
		.bind(session.id, userId, tokenHash, now, session.expiresAt)
		.run();

	return session;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
	try {
		const body: unknown = await request.json();
		return isRecord(body) ? body : {};
	} catch {
		return {};
	}
}

async function hashPassword(password: string, saltHex: string, iterations: number): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		"PBKDF2",
		false,
		["deriveBits"]
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt: hexToBytes(saltHex),
			iterations,
		},
		key,
		256
	);
	return bytesToHex(new Uint8Array(bits));
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
	return bytesToHex(new Uint8Array(digest));
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
	if (!response.body) {
		return "";
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	let done = false;
	while (!done && text.length < limit) {
		const chunk = await reader.read();
		done = chunk.done;
		text += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !done });
	}
	return text.slice(0, limit);
}

function noteFromRow(row: NoteRow): Note {
	return {
		id: row.id,
		title: row.title ?? "",
		markdown: row.markdown ?? "",
		excerpt: row.excerpt ?? makeMarkdownExcerpt(row.markdown ?? ""),
		contentFormat: "markdown",
		schemaVersion: 2,
		assetCount: Number(row.asset_count ?? 0),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function makeMarkdownExcerpt(markdown: string): string {
	const normalized = markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/^>\s?/gm, "")
		.replace(/^[-*+]\s+/gm, "")
		.replace(/^\d+\.\s+/gm, "")
		.replace(/[*_~>#|[\]()]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return Array.from(normalized).slice(0, 120).join("");
}

function userFromRow(row: UserRow): User {
	return {
		id: row.id,
		email: row.email,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function threadFromRow(row: ChatThreadRow): ChatThread {
	return {
		id: row.id,
		title: row.title || "新聊天",
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function chatMessageFromRow(row: ChatMessageRow): ChatMessage {
	const role =
		row.role === "assistant" || row.role === "system" || row.role === "user"
			? row.role
			: "assistant";
	return {
		id: row.id,
		threadId: row.thread_id,
		role,
		content: row.content ?? "",
		status: row.status ?? "complete",
		metadata: parseMetadata(row.metadata),
		createdAt: row.created_at,
	};
}

function parseMetadata(value: string | null): Record<string, unknown> {
	const parsed = safeJsonParse(value || "{}");
	return isRecord(parsed) ? parsed : {};
}

function makeThreadTitle(value: string): string {
	const normalized = value.trim().replace(/\s+/g, " ");
	if (!normalized) {
		return "新聊天";
	}
	const chars = Array.from(normalized).slice(0, 24).join("");
	return normalized.length > 24 ? `${chars}...` : chars;
}

function normalizeText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function normalizeEmail(value: unknown): string {
	return normalizeText(value).trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonParse(value: string): any {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function randomToken(): string {
	return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function randomHex(byteCount: number): string {
	return bytesToHex(crypto.getRandomValues(new Uint8Array(byteCount)));
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(Math.floor(hex.length / 2));
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

function timingSafeEqual(a: string, b: string): boolean {
	let diff = a.length ^ b.length;
	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
	}
	return diff === 0;
}

function getBearerToken(request: Request): string {
	const authorization = request.headers.get("Authorization") || "";
	const match = authorization.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || "";
}

function getCookie(request: Request, name: string): string {
	const header = request.headers.get("Cookie") || "";
	const cookies = header.split(/;\s*/);
	for (const cookie of cookies) {
		const [key, ...parts] = cookie.split("=");
		if (key === name) {
			return decodeURIComponent(parts.join("="));
		}
	}
	return "";
}

function sessionCookieName(env: EnvWithBindings): string {
	return env.SESSION_COOKIE_NAME || SESSION_COOKIE_FALLBACK;
}

function makeSessionCookie(
	env: EnvWithBindings,
	request: Request,
	token: string,
	maxAgeMs: number
): string {
	const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
	return `${sessionCookieName(env)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}

function clearSessionCookie(env: EnvWithBindings, request: Request): string {
	const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
	return `${sessionCookieName(env)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function getDeepSeekBaseUrl(env: EnvWithBindings): string {
	return (env.DEEPSEEK_BASE_URL || DEEPSEEK_DEFAULT_BASE_URL).replace(/\/$/, "");
}

function corsHeaders(request: Request): HeadersInit {
	const origin = request.headers.get("Origin");
	return {
		"Access-Control-Allow-Origin": origin || "*",
		"Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Allow-Credentials": "true",
		"Vary": "Origin",
	};
}

function json(
	data: unknown,
	status = 200,
	request: Request,
	headers: HeadersInit = {}
): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			...corsHeaders(request),
			...JSON_HEADERS,
			...headers,
		},
	});
}

function handleApiError(error: unknown, request: Request): Response {
	if (isApiError(error)) {
		return json(
			{ message: error.expose ? error.message : "request failed" },
			error.status,
			request
		);
	}

	console.error(
		JSON.stringify({
			message: "api error",
			error: error instanceof Error ? error.message : String(error),
		})
	);
	return json({ message: "internal server error" }, 500, request);
}

function isApiError(error: unknown): error is ApiError {
	if (error instanceof ApiError) {
		return true;
	}

	if (!isRecord(error)) {
		return false;
	}

	return (
		error.isApiError === true &&
		error.name === "ApiError" &&
		typeof error.status === "number" &&
		typeof error.message === "string"
	);
}
