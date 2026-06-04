export type User = {
	id: string;
	email: string;
	createdAt: number;
	updatedAt: number;
};

export type AuthResponse = {
	user: User;
	sessionToken: string;
};

export type ChatThread = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
};

export type ChatMessage = {
	id: string;
	threadId: string;
	role: "user" | "assistant" | "system";
	content: string;
	status: string;
	metadata: Record<string, unknown>;
	createdAt: number;
};

export type AgentNoteDecision = "confirm" | "dismiss";

export type AgentNoteResult =
	| {
			status: "created";
			note?: {
				id: string;
				title: string;
				markdown: string;
			};
			noteId?: string;
	  }
	| {
			status: "dismissed";
	  };

export type ApiErrorBody = {
	message?: string;
};

export type AiSettings = {
	baseUrl: string;
	model: string;
	apiKey: string;
};

// 三项整体覆盖：留空即清除并回退到部署者配置的默认值。
export type AiSettingsUpdate = AiSettings;

const SESSION_TOKEN_KEY = "floating-notes-session-token";

export function getSessionToken() {
	return window.localStorage.getItem(SESSION_TOKEN_KEY) || "";
}

function setSessionToken(token: string) {
	if (token) {
		window.localStorage.setItem(SESSION_TOKEN_KEY, token);
	}
}

// 把外部(弹窗 SSO)拿到的 token 写入当前上下文的 localStorage。
// 供数据 iframe 接收宿主注入的跨站 token 时调用。
export function applyExternalToken(token: string) {
	setSessionToken(token);
}

function clearSessionToken() {
	window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

function endpoint(apiBase: string, path: string) {
	return `${apiBase.replace(/\/$/, "")}${path}`;
}

export async function apiRequest<T>(
	apiBase: string,
	path: string,
	options: RequestInit = {}
): Promise<T> {
	const response = await fetchWithAuth(apiBase, path, options);
	if (!response.ok) {
		throw new Error(await readApiError(response));
	}
	return response.json() as Promise<T>;
}

export function fetchWithAuth(
	apiBase: string,
	path: string,
	options: RequestInit = {}
): Promise<Response> {
	const token = getSessionToken();
	const headers = new Headers(options.headers);
	if (!headers.has("Content-Type") && options.body) {
		headers.set("Content-Type", "application/json");
	}
	if (token && !headers.has("Authorization")) {
		headers.set("Authorization", `Bearer ${token}`);
	}

	return fetch(endpoint(apiBase, path), {
		...options,
		headers,
		credentials: "include",
	});
}

export async function readApiError(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as ApiErrorBody;
		return body.message || `Request failed: ${response.status}`;
	} catch {
		return `Request failed: ${response.status}`;
	}
}

export async function register(apiBase: string, email: string, password: string) {
	const response = await apiRequest<AuthResponse>(apiBase, "/api/auth/register", {
		method: "POST",
		body: JSON.stringify({ email, password }),
	});
	setSessionToken(response.sessionToken);
	return response;
}

export async function login(apiBase: string, email: string, password: string) {
	const response = await apiRequest<AuthResponse>(apiBase, "/api/auth/login", {
		method: "POST",
		body: JSON.stringify({ email, password }),
	});
	setSessionToken(response.sessionToken);
	return response;
}

export async function logout(apiBase: string) {
	try {
		await apiRequest<{ success: true }>(apiBase, "/api/auth/logout", { method: "POST" });
	} finally {
		clearSessionToken();
	}
}

export function getMe(apiBase: string) {
	return apiRequest<{ user: User }>(apiBase, "/api/auth/me");
}

// 宿主(嵌入到第三方页面的 widget)登录/注册用：直接打后端，返回 user + token，
// 但【不写本地 localStorage】——宿主在第三方页面，不该把 token 落到宿主存储。
// 跨站登录态靠服务端种的 SameSite=None cookie；本站即时生效靠把 token 注入数据 iframe。
export async function authenticate(
	apiBase: string,
	mode: "login" | "register",
	email: string,
	password: string
) {
	const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
	return apiRequest<AuthResponse>(apiBase, path, {
		method: "POST",
		body: JSON.stringify({ email, password }),
	});
}

export function listThreads(apiBase: string) {
	return apiRequest<ChatThread[]>(apiBase, "/api/chat/threads");
}

export function createThread(apiBase: string, title: string) {
	return apiRequest<ChatThread>(apiBase, "/api/chat/threads", {
		method: "POST",
		body: JSON.stringify({ title }),
	});
}

export function renameThread(apiBase: string, id: string, title: string) {
	return apiRequest<ChatThread>(apiBase, `/api/chat/threads/${encodeURIComponent(id)}`, {
		method: "PATCH",
		body: JSON.stringify({ title }),
	});
}

export function deleteThread(apiBase: string, id: string) {
	return apiRequest<{ success: true }>(apiBase, `/api/chat/threads/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}

export function listMessages(apiBase: string, threadId: string) {
	return apiRequest<ChatMessage[]>(
		apiBase,
		`/api/chat/threads/${encodeURIComponent(threadId)}/messages`
	);
}

export function sendChatMessage(
	apiBase: string,
	threadId: string,
	content: string,
	signal: AbortSignal
) {
	return fetchWithAuth(apiBase, `/api/chat/threads/${encodeURIComponent(threadId)}/messages`, {
		method: "POST",
		body: JSON.stringify({ content }),
		signal,
	});
}

export function summarizeChatContent(apiBase: string, content: string) {
	return apiRequest<{ summary: string }>(apiBase, "/api/chat/summary", {
		method: "POST",
		body: JSON.stringify({ content }),
	});
}

export function generateChatTitle(apiBase: string, content: string) {
	return apiRequest<{ title: string }>(apiBase, "/api/chat/title", {
		method: "POST",
		body: JSON.stringify({ content }),
	});
}

export function getAiSettings(apiBase: string) {
	return apiRequest<AiSettings>(apiBase, "/api/settings/ai");
}

export function updateAiSettings(apiBase: string, update: AiSettingsUpdate) {
	return apiRequest<AiSettings>(apiBase, "/api/settings/ai", {
		method: "PUT",
		body: JSON.stringify(update),
	});
}

export function resolveAgentNote(
	apiBase: string,
	threadId: string,
	messageId: string,
	decision: AgentNoteDecision
) {
	return apiRequest<AgentNoteResult>(
		apiBase,
		`/api/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/agent-note`,
		{
			method: "POST",
			body: JSON.stringify({ decision }),
		}
	);
}
