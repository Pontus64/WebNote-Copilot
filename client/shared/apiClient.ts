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

export type ApiErrorBody = {
	message?: string;
};

const SESSION_TOKEN_KEY = "floating-notes-session-token";

export function getSessionToken() {
	return window.localStorage.getItem(SESSION_TOKEN_KEY) || "";
}

function setSessionToken(token: string) {
	if (token) {
		window.localStorage.setItem(SESSION_TOKEN_KEY, token);
	}
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
