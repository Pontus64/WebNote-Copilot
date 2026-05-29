import type { DraftNote, Note } from "./types";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(path, {
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

export function listNotes(): Promise<Note[]> {
	return request<Note[]>("/notes");
}

export function createNote(note: DraftNote): Promise<Note> {
	return request<Note>("/notes", {
		method: "POST",
		body: JSON.stringify(note),
	});
}

export function updateNote(id: string, note: DraftNote): Promise<Note> {
	return request<Note>(`/notes/${encodeURIComponent(id)}`, {
		method: "PUT",
		body: JSON.stringify(note),
	});
}

export function deleteNote(id: string): Promise<{ success: true }> {
	return request<{ success: true }>(`/notes/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}
