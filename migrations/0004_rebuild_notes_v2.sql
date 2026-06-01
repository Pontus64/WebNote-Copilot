DROP TABLE IF EXISTS note_assets;
DROP TABLE IF EXISTS notes;

CREATE TABLE notes (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	title TEXT NOT NULL DEFAULT '',
	markdown TEXT NOT NULL DEFAULT '',
	excerpt TEXT NOT NULL DEFAULT '',
	schema_version INTEGER NOT NULL DEFAULT 2,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX idx_notes_user_updated_at
ON notes(user_id, updated_at DESC, created_at DESC);

CREATE TABLE note_assets (
	id TEXT PRIMARY KEY,
	note_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	r2_key TEXT NOT NULL UNIQUE,
	mime_type TEXT NOT NULL,
	byte_size INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
	FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX idx_note_assets_note_id
ON note_assets(note_id, created_at ASC);
