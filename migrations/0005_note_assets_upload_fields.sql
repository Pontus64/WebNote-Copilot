ALTER TABLE note_assets ADD COLUMN public_url TEXT NOT NULL DEFAULT '';
ALTER TABLE note_assets ADD COLUMN file_name TEXT NOT NULL DEFAULT '';
ALTER TABLE note_assets ADD COLUMN asset_kind TEXT NOT NULL DEFAULT 'file';
ALTER TABLE note_assets ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE note_assets ADD COLUMN deleted_at INTEGER;

CREATE INDEX idx_note_assets_note_active
ON note_assets(note_id, deleted_at, created_at ASC);

CREATE INDEX idx_note_assets_user_note
ON note_assets(user_id, note_id);
