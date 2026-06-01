export type Note = {
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

export type DraftNote = {
	title: string;
	markdown: string;
};

export type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	body: string;
	title?: string;
};

export type SelectionToolbar = {
	text: string;
	left: number;
	top: number;
};
