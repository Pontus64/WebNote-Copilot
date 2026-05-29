ALTER TABLE notes ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_notes_user_updated_at
ON notes(user_id, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL UNIQUE,
	password_salt TEXT NOT NULL,
	password_hash TEXT NOT NULL,
	password_iterations INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	token_hash TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	revoked_at INTEGER,
	FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
ON sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
ON sessions(user_id, expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS chat_threads (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	title TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	archived_at INTEGER,
	FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_user_updated
ON chat_threads(user_id, archived_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
	id TEXT PRIMARY KEY,
	thread_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
	content TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'complete',
	metadata TEXT NOT NULL DEFAULT '{}',
	created_at INTEGER NOT NULL,
	FOREIGN KEY (thread_id) REFERENCES chat_threads(id),
	FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created
ON chat_messages(thread_id, created_at ASC);
