import { fetchWithAuth, readApiError } from "./apiClient";
import type { DraftNote, Note } from "./types";

async function request<T>(
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

export function listNotes(apiBase = ""): Promise<Note[]> {
	return request<Note[]>(apiBase, "/api/notes");
}

export function createNote(note: DraftNote, apiBase = ""): Promise<Note> {
	return request<Note>(apiBase, "/api/notes", {
		method: "POST",
		body: JSON.stringify(note),
	});
}

export function updateNote(id: string, note: DraftNote, apiBase = ""): Promise<Note> {
	return request<Note>(apiBase, `/api/notes/${encodeURIComponent(id)}`, {
		method: "PUT",
		body: JSON.stringify(note),
	});
}

export function deleteNote(id: string, apiBase = ""): Promise<{ success: true }> {
	return request<{ success: true }>(apiBase, `/api/notes/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}
