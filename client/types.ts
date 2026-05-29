export type Note = {
	id: string;
	title: string;
	content: string;
	createdAt: number;
	updatedAt: number;
};

export type DraftNote = {
	title: string;
	content: string;
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
