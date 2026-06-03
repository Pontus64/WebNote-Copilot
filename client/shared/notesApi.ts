import { fetchWithAuth, readApiError } from "./apiClient";
import type { DraftNote, Note, NoteAsset } from "./types";

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

export async function uploadNoteAsset(
	noteId: string,
	file: File,
	apiBase = ""
): Promise<NoteAsset> {
	const contentType = file.type || "application/octet-stream";
	const response = await fetchWithAuth(apiBase, `/api/notes/${encodeURIComponent(noteId)}/assets`, {
		method: "POST",
		headers: {
			"Content-Type": contentType,
			"X-File-Name": file.name || "pasted-file",
			"X-File-Size": String(file.size),
		},
		body: file,
	});

	if (!response.ok) {
		throw new Error(await readApiError(response));
	}

	return response.json() as Promise<NoteAsset>;
}

export function listNoteAssets(noteId: string, apiBase = ""): Promise<NoteAsset[]> {
	return request<NoteAsset[]>(apiBase, `/api/notes/${encodeURIComponent(noteId)}/assets`);
}

export async function downloadNoteAssetContent(
	noteId: string,
	assetId: string,
	apiBase = ""
): Promise<ArrayBuffer> {
	const response = await fetchWithAuth(
		apiBase,
		`/api/notes/${encodeURIComponent(noteId)}/assets/${encodeURIComponent(assetId)}/content`
	);

	if (!response.ok) {
		throw new Error(await readApiError(response));
	}

	return response.arrayBuffer();
}

export function deleteNoteAsset(
	noteId: string,
	assetId: string,
	apiBase = ""
): Promise<{ success: true }> {
	return request<{ success: true }>(
		apiBase,
		`/api/notes/${encodeURIComponent(noteId)}/assets/${encodeURIComponent(assetId)}`,
		{ method: "DELETE" }
	);
}
