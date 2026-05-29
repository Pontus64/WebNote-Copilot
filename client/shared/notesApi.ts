import type { DraftNote, Note } from "./types";

function endpoint(apiBase: string, path: string) {
	return `${apiBase.replace(/\/$/, "")}${path}`;
}

async function request<T>(
	apiBase: string,
	path: string,
	options: RequestInit = {}
): Promise<T> {
	const response = await fetch(endpoint(apiBase, path), {
		...options,
		headers: {
			"Content-Type": "application/json",
			...(options.headers ?? {}),
		},
	});

	if (!response.ok) {
		throw new Error(`Notes request failed: ${response.status}`);
	}

	return response.json() as Promise<T>;
}

export function listNotes(apiBase = ""): Promise<Note[]> {
	return request<Note[]>(apiBase, "/notes");
}

export function createNote(note: DraftNote, apiBase = ""): Promise<Note> {
	return request<Note>(apiBase, "/notes", {
		method: "POST",
		body: JSON.stringify(note),
	});
}

export function updateNote(id: string, note: DraftNote, apiBase = ""): Promise<Note> {
	return request<Note>(apiBase, `/notes/${encodeURIComponent(id)}`, {
		method: "PUT",
		body: JSON.stringify(note),
	});
}

export function deleteNote(id: string, apiBase = ""): Promise<{ success: true }> {
	return request<{ success: true }>(apiBase, `/notes/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}
