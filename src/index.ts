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

type AssetKind = "image" | "video" | "audio" | "document" | "archive" | "file";

type NoteAsset = {
	id: string;
	noteId: string;
	fileName: string;
	mimeType: string;
	byteSize: number;
	assetKind: AssetKind;
	publicUrl: string;
	markdown: string;
	createdAt: number;
	updatedAt: number;
};

type NoteAssetRow = {
	id: string;
	note_id: string;
	user_id: string;
	r2_key: string;
	public_url: string;
	file_name: string;
	mime_type: string;
	byte_size: number;
	asset_kind: string;
	created_at: number;
	updated_at: number;
	deleted_at: number | null;
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

type AgentAction =
	| { action: "chat"; reply?: string }
	| {
			action: "create_note";
			title: string;
			markdown: string;
			reply: string;
			confidence?: number;
	  };

type EnvWithBindings = Env & {
	wranglerdemo: D1Database;
	ASSETS?: Fetcher;
	DEEPSEEK_API_KEY?: string;
	DEEPSEEK_BASE_URL?: string;
	DEEPSEEK_MODEL?: string;
	NOTE_ASSETS?: R2Bucket;
	NOTE_ASSETS_PUBLIC_BASE_URL?: string;
	SESSION_COOKIE_NAME?: string;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 100_000;
const SESSION_COOKIE_FALLBACK = "fn_session";
const MAX_ASSET_UPLOAD_BYTES = 80 * 1024 * 1024;
const MAX_AGENT_NOTE_TITLE_CHARS = 80;
const MAX_AGENT_NOTE_MARKDOWN_CHARS = 30_000;
const AGENT_CONTEXT_MESSAGE_LIMIT = 20;
const AGENT_ACTION_HEADER = "X-Floating-Notes-Action";
const AGENT_MESSAGE_ID_HEADER = "X-Floating-Notes-Message-Id";
const AGENT_NOTE_ID_HEADER = "X-Floating-Notes-Note-Id";
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8" };
const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";
const encoder = new TextEncoder();

const ALLOWED_ASSET_MIME_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"video/mp4",
	"video/webm",
	"audio/mpeg",
	"audio/wav",
	"application/pdf",
	"text/plain",
	"text/markdown",
	"application/zip",
]);

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
	const path = url.pathname.startsWith("/api/notes")
		? url.pathname.replace(/^\/api\/notes\/?/, "")
		: url.pathname.replace(/^\/notes\/?/, "");
	const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
	const noteId = parts[0] ?? "";
	const isCollection = url.pathname === "/api/notes" || url.pathname === "/notes";

	if (
		parts.length === 4 &&
		parts[1] === "assets" &&
		parts[3] === "content" &&
		request.method === "GET"
	) {
		return serveNoteAssetContent(env, noteId, parts[2], request);
	}

	const auth = await requireAuth(request, env);

	if (isCollection && request.method === "GET") {
		return json(await listNotes(env.wranglerdemo, auth.user.id), 200, request);
	}

	if (isCollection && request.method === "POST") {
		return createNote(request, env.wranglerdemo, auth.user.id);
	}

	if (parts.length === 2 && parts[1] === "assets" && request.method === "GET") {
		return listNoteAssets(env.wranglerdemo, auth.user.id, noteId, request);
	}

	if (parts.length === 2 && parts[1] === "assets" && request.method === "POST") {
		return uploadNoteAsset(request, env, auth.user.id, noteId);
	}

	if (parts.length === 3 && parts[1] === "assets" && request.method === "DELETE") {
		return deleteNoteAsset(env, auth.user.id, noteId, parts[2], request);
	}

	if (parts.length === 1 && noteId && request.method === "GET") {
		return getNote(env.wranglerdemo, auth.user.id, noteId, request);
	}

	if (parts.length === 1 && noteId && request.method === "PUT") {
		return updateNote(request, env.wranglerdemo, auth.user.id, noteId);
	}

	if (parts.length === 1 && noteId && request.method === "DELETE") {
		return deleteNote(env, auth.user.id, noteId, request);
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

		if (
			parts.length === 5 &&
			parts[2] === "messages" &&
			parts[4] === "agent-note" &&
			request.method === "POST"
		) {
			return resolveAgentNoteAction(request, env, auth, threadId, parts[3]);
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
			`SELECT
				notes.id,
				notes.title,
				notes.markdown,
				notes.excerpt,
				notes.schema_version,
				COUNT(note_assets.id) AS asset_count,
				notes.created_at,
				notes.updated_at
			 FROM notes
			 LEFT JOIN note_assets
				ON note_assets.note_id = notes.id
				AND note_assets.deleted_at IS NULL
			 WHERE notes.user_id = ?
			 GROUP BY
				notes.id,
				notes.title,
				notes.markdown,
				notes.excerpt,
				notes.schema_version,
				notes.created_at,
				notes.updated_at
			 ORDER BY notes.updated_at DESC, notes.created_at DESC`
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
	const note = await insertNote(db, userId, {
		title: normalizeText(body.title),
		markdown: normalizeText(body.markdown),
	});

	return json(note, 201, request);
}

async function insertNote(
	db: D1Database,
	userId: string,
	input: { title: string; markdown: string }
): Promise<Note> {
	const now = Date.now();
	const markdown = normalizeText(input.markdown);
	const note: Note = {
		id: crypto.randomUUID(),
		title: normalizeText(input.title),
		markdown,
		excerpt: makeMarkdownExcerpt(markdown),
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

	return note;
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

async function listNoteAssets(
	db: D1Database,
	userId: string,
	noteId: string,
	request: Request
): Promise<Response> {
	const note = await findNote(db, userId, noteId);
	if (!note) {
		throw new ApiError(404, "note not found");
	}

	const { results } = await db
		.prepare(
			`SELECT id, note_id, user_id, r2_key, public_url, file_name, mime_type, byte_size, asset_kind, created_at, updated_at, deleted_at
			 FROM note_assets
			 WHERE note_id = ? AND user_id = ? AND deleted_at IS NULL
			 ORDER BY created_at ASC`
		)
		.bind(noteId, userId)
		.all<NoteAssetRow>();

	return json(results.map(noteAssetFromRow), 200, request);
}

async function uploadNoteAsset(
	request: Request,
	env: EnvWithBindings,
	userId: string,
	noteId: string
): Promise<Response> {
	if (!env.NOTE_ASSETS) {
		throw new ApiError(503, "asset storage is not configured");
	}
	const note = await findNote(env.wranglerdemo, userId, noteId);
	if (!note) {
		throw new ApiError(404, "note not found");
	}
	if (!request.body) {
		throw new ApiError(400, "file body is required");
	}

	const mimeType = normalizeAssetMimeType(request.headers.get("Content-Type"));
	if (!ALLOWED_ASSET_MIME_TYPES.has(mimeType)) {
		throw new ApiError(400, "unsupported file type");
	}
	const byteSize = parseAssetByteSize(request);
	if (byteSize <= 0) {
		throw new ApiError(400, "file size is required");
	}
	if (byteSize > MAX_ASSET_UPLOAD_BYTES) {
		throw new ApiError(413, "file too large");
	}

	const now = Date.now();
	const assetId = crypto.randomUUID();
	const fileName = normalizeFileName(request.headers.get("X-File-Name"));
	const r2Key = `users/${userId}/notes/${noteId}/${assetId}-${safeFileName(fileName)}`;
	const publicUrl = publicUrlForUploadedAsset(env, request, noteId, assetId, r2Key);
	const assetKind = assetKindFromMimeType(mimeType);

	try {
		const uploadStream = new FixedLengthStream(byteSize);
		const pipePromise = request.body.pipeTo(uploadStream.writable);
		await Promise.all([
			env.NOTE_ASSETS.put(r2Key, uploadStream.readable, {
				httpMetadata: {
					contentType: mimeType,
					cacheControl: "public, max-age=31536000, immutable",
				},
				customMetadata: {
					noteId,
					userId,
					fileName,
				},
			}),
			pipePromise,
		]);
	} catch (error) {
		console.error(
			JSON.stringify({
				message: "r2 asset upload failed",
				error: error instanceof Error ? error.message : String(error),
			})
		);
		throw new ApiError(503, "asset storage unavailable");
	}

	try {
		await env.wranglerdemo
			.prepare(
				`INSERT INTO note_assets
					(id, note_id, user_id, r2_key, public_url, file_name, mime_type, byte_size, asset_kind, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				assetId,
				noteId,
				userId,
				r2Key,
				publicUrl,
				fileName,
				mimeType,
				byteSize,
				assetKind,
				now,
				now
			)
			.run();
	} catch (error) {
		await deleteR2Keys(env, [r2Key]);
		throw error;
	}

	return json(
		{
			id: assetId,
			noteId,
			fileName,
			mimeType,
			byteSize,
			assetKind,
			publicUrl,
			markdown: markdownForAsset(fileName, assetKind, publicUrl),
			createdAt: now,
			updatedAt: now,
		} satisfies NoteAsset,
		201,
		request
	);
}

async function deleteNoteAsset(
	env: EnvWithBindings,
	userId: string,
	noteId: string,
	assetId: string,
	request: Request
): Promise<Response> {
	const row = await env.wranglerdemo
		.prepare(
			`SELECT id, note_id, user_id, r2_key, public_url, file_name, mime_type, byte_size, asset_kind, created_at, updated_at, deleted_at
			 FROM note_assets
			 WHERE id = ? AND note_id = ? AND user_id = ? AND deleted_at IS NULL`
		)
		.bind(assetId, noteId, userId)
		.first<NoteAssetRow>();

	if (!row) {
		throw new ApiError(404, "asset not found");
	}

	const now = Date.now();
	await env.wranglerdemo
		.prepare("UPDATE note_assets SET deleted_at = ?, updated_at = ? WHERE id = ?")
		.bind(now, now, assetId)
		.run();
	await deleteR2Keys(env, [row.r2_key]);
	return json({ success: true }, 200, request);
}

async function serveNoteAssetContent(
	env: EnvWithBindings,
	noteId: string,
	assetId: string,
	request: Request
): Promise<Response> {
	if (!env.NOTE_ASSETS) {
		throw new ApiError(503, "asset storage is not configured");
	}

	const row = await env.wranglerdemo
		.prepare(
			`SELECT id, note_id, user_id, r2_key, public_url, file_name, mime_type, byte_size, asset_kind, created_at, updated_at, deleted_at
			 FROM note_assets
			 WHERE id = ? AND note_id = ? AND deleted_at IS NULL`
		)
		.bind(assetId, noteId)
		.first<NoteAssetRow>();

	if (!row) {
		throw new ApiError(404, "asset not found");
	}

	const object = await env.NOTE_ASSETS.get(row.r2_key);
	if (!object) {
		throw new ApiError(404, "asset content not found");
	}

	const headers = new Headers(corsHeaders(request));
	object.writeHttpMetadata(headers);
	if (!headers.has("Content-Type")) {
		headers.set("Content-Type", row.mime_type);
	}
	headers.set("Content-Length", String(row.byte_size));
	headers.set("Cache-Control", "public, max-age=31536000, immutable");
	headers.set("Content-Disposition", `inline; filename="${contentDispositionFileName(row.file_name)}"`);
	return new Response(object.body, { status: 200, headers });
}

async function deleteNote(
	env: EnvWithBindings,
	userId: string,
	id: string,
	request: Request
): Promise<Response> {
	const { results } = await env.wranglerdemo
		.prepare(
			`SELECT r2_key
			 FROM note_assets
			 WHERE note_id = ? AND user_id = ? AND deleted_at IS NULL`
		)
		.bind(id, userId)
		.all<{ r2_key: string }>();

	const result = await env.wranglerdemo
		.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?")
		.bind(id, userId)
		.run();

	if (Number(result.meta.changes ?? 0) === 0) {
		throw new ApiError(404, "note not found");
	}

	await deleteR2Keys(env, results.map((row) => row.r2_key));
	return json({ success: true }, 200, request);
}

async function findNote(db: D1Database, userId: string, id: string): Promise<Note | null> {
	const row = await db
		.prepare(
			`SELECT
				notes.id,
				notes.title,
				notes.markdown,
				notes.excerpt,
				notes.schema_version,
				COUNT(note_assets.id) AS asset_count,
				notes.created_at,
				notes.updated_at
			 FROM notes
			 LEFT JOIN note_assets
				ON note_assets.note_id = notes.id
				AND note_assets.deleted_at IS NULL
			 WHERE notes.id = ? AND notes.user_id = ?
			 GROUP BY
				notes.id,
				notes.title,
				notes.markdown,
				notes.excerpt,
				notes.schema_version,
				notes.created_at,
				notes.updated_at`
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

	const messages = await listThreadMessages(env.wranglerdemo, auth.user.id, thread.id);
	const agentAction = await routeAgentAction(env, messages, userContent);
	if (agentAction.action === "create_note") {
		return createPendingAgentNoteResponse(
			request,
			env,
			auth,
			thread.id,
			assistantMessageId,
			agentAction
		);
	}

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

async function routeAgentAction(
	env: EnvWithBindings,
	messages: ChatMessage[],
	userContent: string
): Promise<AgentAction> {
	if (!env.DEEPSEEK_API_KEY || !shouldConsiderAgentAction(userContent)) {
		return { action: "chat" };
	}

	try {
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
				messages: buildAgentRouterMessages(messages, userContent),
			}),
		});

		if (!upstream.ok) {
			const detail = await readLimitedText(upstream, 1800);
			console.error(
				JSON.stringify({
					message: "agent intent request failed",
					status: upstream.status,
					detail,
				})
			);
			return { action: "chat" };
		}

		const parsed = (await upstream.json().catch(() => null)) as {
			choices?: Array<{ message?: { content?: unknown } }>;
		} | null;
		const content = parsed?.choices?.[0]?.message?.content;
		if (typeof content !== "string") {
			return { action: "chat" };
		}
		return normalizeAgentAction(content);
	} catch (error) {
		console.error(
			JSON.stringify({
				message: "agent intent failed",
				error: error instanceof Error ? error.message : String(error),
			})
		);
		return { action: "chat" };
	}
}

async function createPendingAgentNoteResponse(
	request: Request,
	env: EnvWithBindings,
	auth: AuthContext,
	threadId: string,
	assistantMessageId: string,
	action: Extract<AgentAction, { action: "create_note" }>
): Promise<Response> {
	let metadata: Record<string, unknown> = {
		agentAction: "pending_create_note",
		agentNoteStatus: "pending",
		title: action.title,
		markdown: action.markdown,
	};
	if (typeof action.confidence === "number") {
		metadata = {
			...metadata,
			confidence: action.confidence,
		};
	}

	const reply = `需要我帮你生成一篇「${action.title || "AI笔记"}」的笔记吗？`;
	const now = Date.now();
	await env.wranglerdemo.batch([
		env.wranglerdemo
			.prepare(
				`INSERT INTO auth_chat_messages (id, thread_id, user_id, role, content, status, metadata, created_at)
				 VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?)`
			)
			.bind(assistantMessageId, threadId, auth.user.id, reply, "complete", JSON.stringify(metadata), now),
		env.wranglerdemo
			.prepare(
				`UPDATE auth_chat_threads
				 SET updated_at = ?
				 WHERE id = ? AND user_id = ?`
			)
			.bind(now, threadId, auth.user.id),
	]);

	const headers: HeadersInit = {
		...corsHeaders(request),
		...TEXT_HEADERS,
		"Cache-Control": "no-store",
	};
	headers[AGENT_ACTION_HEADER] = "note_pending";
	headers[AGENT_MESSAGE_ID_HEADER] = assistantMessageId;

	return new Response(reply, { headers });
}

async function resolveAgentNoteAction(
	request: Request,
	env: EnvWithBindings,
	auth: AuthContext,
	threadId: string,
	messageId: string
): Promise<Response> {
	const body = await readJsonBody(request);
	const decision = normalizeAgentNoteDecision(body.decision);
	if (!decision) {
		throw new ApiError(400, "agent note decision is required");
	}

	const row = await env.wranglerdemo
		.prepare(
			`SELECT id, thread_id, role, content, status, metadata, created_at
			 FROM auth_chat_messages
			 WHERE id = ? AND thread_id = ? AND user_id = ? AND role = 'assistant'`
		)
		.bind(messageId, threadId, auth.user.id)
		.first<ChatMessageRow>();

	if (!row) {
		throw new ApiError(404, "agent message not found");
	}

	const metadata = parseMetadata(row.metadata);
	if (metadata.agentAction !== "pending_create_note") {
		throw new ApiError(400, "agent note is not pending");
	}

	const currentStatus = normalizeText(metadata.agentNoteStatus) || "pending";
	if (currentStatus === "created") {
		const noteId = normalizeText(metadata.noteId);
		const headers: HeadersInit = noteId
			? {
					[AGENT_ACTION_HEADER]: "note_created",
					[AGENT_NOTE_ID_HEADER]: noteId,
				}
			: {};
		return json({ status: "created", noteId }, 200, request, headers);
	}
	if (currentStatus === "dismissed") {
		return json({ status: "dismissed" }, 200, request);
	}
	if (currentStatus !== "pending") {
		throw new ApiError(400, "agent note is not pending");
	}

	if (decision === "dismiss") {
		const nextMetadata: Record<string, unknown> = { ...metadata, agentNoteStatus: "dismissed" };
		delete nextMetadata.markdown;
		const dismissed = await updateAgentMessageMetadataIfUnchanged(
			env.wranglerdemo,
			auth.user.id,
			threadId,
			messageId,
			row.metadata || "{}",
			nextMetadata
		);
		if (!dismissed) {
			return respondCurrentAgentNoteState(request, env.wranglerdemo, auth.user.id, threadId, messageId);
		}
		return json({ status: "dismissed" }, 200, request);
	}

	const markdown = truncateText(
		normalizeText(metadata.markdown).trim(),
		MAX_AGENT_NOTE_MARKDOWN_CHARS
	);
	if (!markdown) {
		throw new ApiError(400, "agent note content is missing");
	}

	const title = makeAgentNoteTitle(normalizeText(metadata.title), markdown);
	const creatingMetadata: Record<string, unknown> = { ...metadata, agentNoteStatus: "creating" };
	const locked = await updateAgentMessageMetadataIfUnchanged(
		env.wranglerdemo,
		auth.user.id,
		threadId,
		messageId,
		row.metadata || "{}",
		creatingMetadata
	);
	if (!locked) {
		return respondCurrentAgentNoteState(request, env.wranglerdemo, auth.user.id, threadId, messageId);
	}

	let note: Note;
	try {
		note = await insertNote(env.wranglerdemo, auth.user.id, { title, markdown });
	} catch (error) {
		await updateAgentMessageMetadata(env.wranglerdemo, auth.user.id, threadId, messageId, {
			...metadata,
			agentNoteStatus: "pending",
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
	const nextMetadata: Record<string, unknown> = {
		...creatingMetadata,
		agentNoteStatus: "created",
		noteId: note.id,
		noteTitle: note.title,
	};
	delete nextMetadata.markdown;
	await updateAgentMessageMetadata(env.wranglerdemo, auth.user.id, threadId, messageId, nextMetadata);

	return json(
		{ status: "created", note },
		200,
		request,
		{
			[AGENT_ACTION_HEADER]: "note_created",
			[AGENT_NOTE_ID_HEADER]: note.id,
		}
	);
}

async function respondCurrentAgentNoteState(
	request: Request,
	db: D1Database,
	userId: string,
	threadId: string,
	messageId: string
): Promise<Response> {
	const row = await db
		.prepare(
			`SELECT id, thread_id, role, content, status, metadata, created_at
			 FROM auth_chat_messages
			 WHERE id = ? AND thread_id = ? AND user_id = ? AND role = 'assistant'`
		)
		.bind(messageId, threadId, userId)
		.first<ChatMessageRow>();

	if (!row) {
		throw new ApiError(404, "agent message not found");
	}

	const metadata = parseMetadata(row.metadata);
	const currentStatus = normalizeText(metadata.agentNoteStatus);
	if (metadata.agentAction !== "pending_create_note") {
		throw new ApiError(400, "agent note is not pending");
	}
	if (currentStatus === "created") {
		const noteId = normalizeText(metadata.noteId);
		const headers: HeadersInit = noteId
			? {
					[AGENT_ACTION_HEADER]: "note_created",
					[AGENT_NOTE_ID_HEADER]: noteId,
				}
			: {};
		return json({ status: "created", noteId }, 200, request, headers);
	}
	if (currentStatus === "dismissed") {
		return json({ status: "dismissed" }, 200, request);
	}
	throw new ApiError(409, "agent note state changed");
}

async function updateAgentMessageMetadataIfUnchanged(
	db: D1Database,
	userId: string,
	threadId: string,
	messageId: string,
	previousMetadata: string,
	metadata: Record<string, unknown>
): Promise<boolean> {
	const now = Date.now();
	const result = await db
		.prepare(
			`UPDATE auth_chat_messages
			 SET metadata = ?
			 WHERE id = ? AND thread_id = ? AND user_id = ? AND metadata = ?`
		)
		.bind(JSON.stringify(metadata), messageId, threadId, userId, previousMetadata)
		.run();

	if (Number(result.meta.changes ?? 0) === 0) {
		return false;
	}

	await db
		.prepare(
			`UPDATE auth_chat_threads
			 SET updated_at = ?
			 WHERE id = ? AND user_id = ?`
		)
		.bind(now, threadId, userId)
		.run();
	return true;
}

async function updateAgentMessageMetadata(
	db: D1Database,
	userId: string,
	threadId: string,
	messageId: string,
	metadata: Record<string, unknown>
): Promise<void> {
	const now = Date.now();
	await db.batch([
		db
			.prepare(
				`UPDATE auth_chat_messages
				 SET metadata = ?
				 WHERE id = ? AND thread_id = ? AND user_id = ?`
			)
			.bind(JSON.stringify(metadata), messageId, threadId, userId),
		db
			.prepare(
				`UPDATE auth_chat_threads
				 SET updated_at = ?
				 WHERE id = ? AND user_id = ?`
			)
			.bind(now, threadId, userId),
	]);
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

function buildAgentRouterMessages(messages: ChatMessage[], userContent: string) {
	const filtered = messages
		.filter((message) => message.role === "user" || message.role === "assistant")
		.slice(-AGENT_CONTEXT_MESSAGE_LIMIT)
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
				"You are an intent router inside a chat-and-notes product. Return strict JSON only. Allowed actions: chat, create_note. Choose create_note only when the user wants to create, save, record, remember, organize, or turn the current discussion into a Markdown note, document, todo, or plan. If intent is unclear, choose chat. Never invent facts not present in the conversation. For create_note, return title, markdown, reply, and confidence from 0 to 1. For chat, return {\"action\":\"chat\"}. Use the user's language.",
		},
		...filtered,
	];
}

function normalizeAgentAction(content: string): AgentAction {
	const parsed = safeJsonParse(extractJsonObject(content) || content);
	if (!isRecord(parsed)) {
		return { action: "chat" };
	}

	if (parsed.action !== "create_note") {
		return { action: "chat", reply: normalizeText(parsed.reply).trim() };
	}

	const markdown = truncateText(normalizeText(parsed.markdown).trim(), MAX_AGENT_NOTE_MARKDOWN_CHARS);
	if (!markdown) {
		return { action: "chat" };
	}

	const confidence = typeof parsed.confidence === "number" ? parsed.confidence : undefined;
	if (typeof confidence === "number" && confidence < 0.55) {
		return { action: "chat" };
	}

	const title = makeAgentNoteTitle(normalizeText(parsed.title), markdown);
	const reply = normalizeText(parsed.reply).trim() || `已生成笔记：${title}`;
	return {
		action: "create_note",
		title,
		markdown,
		reply,
		confidence,
	};
}

function shouldConsiderAgentAction(userContent: string): boolean {
	const normalized = userContent.trim().toLowerCase();
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

function makeAgentNoteTitle(rawTitle: string, markdown: string): string {
	const normalized = rawTitle.trim().replace(/\s+/g, " ");
	if (normalized) {
		return truncateText(normalized, MAX_AGENT_NOTE_TITLE_CHARS);
	}
	const excerpt = makeMarkdownExcerpt(markdown).trim();
	if (excerpt) {
		return truncateText(excerpt, MAX_AGENT_NOTE_TITLE_CHARS);
	}
	return "AI笔记";
}

function truncateText(value: string, maxChars: number): string {
	const chars = Array.from(value);
	if (chars.length <= maxChars) {
		return value;
	}
	return chars.slice(0, maxChars).join("");
}

function extractJsonObject(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		return trimmed;
	}
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) {
		return "";
	}
	return trimmed.slice(start, end + 1);
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

function noteAssetFromRow(row: NoteAssetRow): NoteAsset {
	const assetKind = normalizeAssetKind(row.asset_kind);
	return {
		id: row.id,
		noteId: row.note_id,
		fileName: row.file_name,
		mimeType: row.mime_type,
		byteSize: row.byte_size,
		assetKind,
		publicUrl: row.public_url,
		markdown: markdownForAsset(row.file_name, assetKind, row.public_url),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function normalizeAssetKind(value: string): AssetKind {
	if (
		value === "image" ||
		value === "video" ||
		value === "audio" ||
		value === "document" ||
		value === "archive" ||
		value === "file"
	) {
		return value;
	}
	return "file";
}

function assetKindFromMimeType(mimeType: string): AssetKind {
	if (mimeType.startsWith("image/")) {
		return "image";
	}
	if (mimeType.startsWith("video/")) {
		return "video";
	}
	if (mimeType.startsWith("audio/")) {
		return "audio";
	}
	if (mimeType === "application/pdf" || mimeType === "text/plain" || mimeType === "text/markdown") {
		return "document";
	}
	if (mimeType === "application/zip") {
		return "archive";
	}
	return "file";
}

function markdownForAsset(fileName: string, assetKind: AssetKind, publicUrl: string): string {
	const label = escapeMarkdownLabel(fileName || "pasted-file");
	if (assetKind === "image") {
		return `![${label}](${publicUrl})`;
	}
	if (assetKind === "video") {
		return `<video controls src="${escapeHtmlAttribute(publicUrl)}"></video>`;
	}
	if (assetKind === "audio") {
		return `<audio controls src="${escapeHtmlAttribute(publicUrl)}"></audio>`;
	}
	return `[${label}](${publicUrl})`;
}

function normalizeAssetMimeType(value: string | null): string {
	return (value || "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function parseAssetByteSize(request: Request): number {
	const raw = request.headers.get("X-File-Size") || request.headers.get("Content-Length") || "";
	const value = Number.parseInt(raw, 10);
	return Number.isFinite(value) ? value : 0;
}

function normalizeFileName(value: string | null): string {
	const withoutPath = (value || "pasted-file").split(/[\\/]/).pop() || "pasted-file";
	const normalized = withoutPath.replace(/[\u0000-\u001f\u007f]/g, "").trim();
	return Array.from(normalized || "pasted-file").slice(0, 180).join("");
}

function safeFileName(value: string): string {
	const safe = value
		.normalize("NFKD")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 90);
	return safe || "file";
}

function publicUrlForUploadedAsset(
	env: EnvWithBindings,
	request: Request,
	noteId: string,
	assetId: string,
	r2Key: string
): string {
	if (isLocalAssetRequest(request)) {
		return workerAssetContentUrl(request, noteId, assetId);
	}
	const publicBaseUrl = (env.NOTE_ASSETS_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
	if (publicBaseUrl) {
		return publicUrlForR2Key(publicBaseUrl, r2Key);
	}
	return workerAssetContentUrl(request, noteId, assetId);
}

function publicUrlForR2Key(baseUrl: string, r2Key: string): string {
	return `${baseUrl}/${r2Key.split("/").map(encodeURIComponent).join("/")}`;
}

function workerAssetContentUrl(request: Request, noteId: string, assetId: string): string {
	return new URL(
		`/api/notes/${encodeURIComponent(noteId)}/assets/${encodeURIComponent(assetId)}/content`,
		request.url
	).href;
}

function isLocalAssetRequest(request: Request): boolean {
	const hostname = new URL(request.url).hostname;
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function deleteR2Keys(env: EnvWithBindings, keys: string[]) {
	if (!env.NOTE_ASSETS || !keys.length) {
		return;
	}
	try {
		await env.NOTE_ASSETS.delete(keys);
	} catch (error) {
		console.error(
			JSON.stringify({
				message: "r2 asset delete failed",
				error: error instanceof Error ? error.message : String(error),
			})
		);
	}
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

function contentDispositionFileName(value: string) {
	return safeFileName(value).replace(/"/g, "");
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

function normalizeAgentNoteDecision(value: unknown): "confirm" | "dismiss" | "" {
	if (value === "confirm" || value === "dismiss") {
		return value;
	}
	return "";
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
		"Access-Control-Allow-Headers": "Content-Type, Authorization, X-File-Name, X-File-Size",
		"Access-Control-Expose-Headers": `${AGENT_ACTION_HEADER}, ${AGENT_MESSAGE_ID_HEADER}, ${AGENT_NOTE_ID_HEADER}`,
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
