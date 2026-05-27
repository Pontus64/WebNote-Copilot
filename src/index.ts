type Note = {
	id: string;
	title: string;
	content: string;
	createdAt: number;
	updatedAt: number;
};

type NoteRow = {
	id: string;
	title: string | null;
	content: string | null;
	created_at: number;
	updated_at: number;
};

type EnvWithBindings = Env & {
	wranglerdemo: D1Database;
	ASSETS?: Fetcher;
};

// These headers let the notes API be called from the hosted page and from pages
// that embed the floating widget script.
const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		// 这就是线上请求的总入口。浏览器访问任何路径，都会先到这里判断：
		// /notes 走后端 API，其它路径交给 public 目录里的静态资源。

		// Browsers send OPTIONS before some cross-origin JSON requests.
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		// API requests go to this Worker code and read/write D1.
		// 嵌入脚本里的 fetch(`${apiBase}/notes`) 最终会命中这里。
		if (url.pathname === "/notes" || url.pathname.startsWith("/notes/")) {
			return handleNotesRequest(request, env, url);
		}

		// Everything else is static frontend: public/index.html, embed demo, widget JS.
		// 例如 /、/embed/floating-notes-widget.js、/floating-notes.user.js 都从 public 目录返回。
		if (env.ASSETS) {
			return env.ASSETS.fetch(request);
		}

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<EnvWithBindings>;

async function handleNotesRequest(
	request: Request,
	env: EnvWithBindings,
	url: URL
): Promise<Response> {
	try {
		// /notes has no id; /notes/<id> extracts the id after the prefix.
		const noteId = decodeURIComponent(url.pathname.replace(/^\/notes\/?/, ""));

		// GET /notes：列表页打开时拉取所有笔记。
		if (url.pathname === "/notes" && request.method === "GET") {
			return json(await listNotes(env.wranglerdemo));
		}

		// POST /notes：编辑页保存一条新笔记。
		if (url.pathname === "/notes" && request.method === "POST") {
			return createNote(request, env.wranglerdemo);
		}

		// GET /notes/:id：按 id 查询单条笔记，目前主要给 API 完整性使用。
		if (noteId && request.method === "GET") {
			return getNote(env.wranglerdemo, noteId);
		}

		// PUT /notes/:id：编辑已有笔记后保存。
		if (noteId && request.method === "PUT") {
			return updateNote(request, env.wranglerdemo, noteId);
		}

		// DELETE /notes/:id：列表里删除笔记。
		if (noteId && request.method === "DELETE") {
			return deleteNote(env.wranglerdemo, noteId);
		}

		return json({ message: "method not allowed" }, 405);
	} catch (error) {
		console.error(
			JSON.stringify({
				message: "notes api error",
				error: error instanceof Error ? error.message : String(error),
			})
		);
		return json({ message: "internal server error" }, 500);
	}
}

async function listNotes(db: D1Database): Promise<Note[]> {
	// D1 returns database column names, so noteFromRow converts snake_case to
	// the camelCase shape expected by the frontend.
	const { results } = await db
		.prepare(
			`SELECT id, title, content, created_at, updated_at
			 FROM notes
			 ORDER BY updated_at DESC, created_at DESC`
		)
		.all<NoteRow>();

	return results.map(noteFromRow);
}

async function getNote(db: D1Database, id: string): Promise<Response> {
	const note = await findNote(db, id);

	if (!note) {
		return json({ message: "note not found" }, 404);
	}

	return json(note);
}

async function createNote(request: Request, db: D1Database): Promise<Response> {
	const body = await readJsonBody(request);
	const now = Date.now();
	const note: Note = {
		// Use Web Crypto for unique IDs; this works in the Workers runtime.
		id: crypto.randomUUID(),
		title: normalizeText(body.title),
		content: normalizeText(body.content),
		createdAt: now,
		updatedAt: now,
	};

	await db
		.prepare(
			`INSERT INTO notes (id, title, content, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?)`
		)
		// Binding parameters keeps user-entered text out of the SQL string.
		.bind(note.id, note.title, note.content, note.createdAt, note.updatedAt)
		.run();

	return json(note, 201);
}

async function updateNote(
	request: Request,
	db: D1Database,
	id: string
): Promise<Response> {
	const existing = await findNote(db, id);

	if (!existing) {
		return json({ message: "note not found" }, 404);
	}

	const body = await readJsonBody(request);
	const updated: Note = {
		...existing,
		title: normalizeText(body.title),
		content: normalizeText(body.content),
		updatedAt: Date.now(),
	};

	await db
		.prepare(
			`UPDATE notes
			 SET title = ?, content = ?, updated_at = ?
			 WHERE id = ?`
		)
		.bind(updated.title, updated.content, updated.updatedAt, id)
		.run();

	return json(updated);
}

async function deleteNote(db: D1Database, id: string): Promise<Response> {
	const result = await db.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();

	if (Number(result.meta.changes ?? 0) === 0) {
		return json({ message: "note not found" }, 404);
	}

	return json({ success: true });
}

async function findNote(db: D1Database, id: string): Promise<Note | null> {
	const row = await db
		.prepare(
			`SELECT id, title, content, created_at, updated_at
			 FROM notes
			 WHERE id = ?`
		)
		.bind(id)
		.first<NoteRow>();

	return row ? noteFromRow(row) : null;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
	try {
		const body: unknown = await request.json();
		return isRecord(body) ? body : {};
	} catch {
		return {};
	}
}

function noteFromRow(row: NoteRow): Note {
	return {
		id: row.id,
		title: row.title ?? "",
		content: row.content ?? "",
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function normalizeText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(data: unknown, status = 200): Response {
	// All API responses use the same JSON/CORS headers.
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			...CORS_HEADERS,
			"Content-Type": "application/json; charset=utf-8",
		},
	});
}
