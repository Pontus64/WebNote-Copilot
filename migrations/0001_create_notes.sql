CREATE TABLE IF NOT EXISTS notes (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL DEFAULT '',
	content TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);

INSERT INTO notes (id, title, content, created_at, updated_at)
SELECT 'a3d0f771-0dec-47a7-a86b-3308bebc619a', '666', '888', 1779714294031, 1779714294031
WHERE NOT EXISTS (SELECT 1 FROM notes WHERE id = 'a3d0f771-0dec-47a7-a86b-3308bebc619a');

INSERT INTO notes (id, title, content, created_at, updated_at)
SELECT '1', '词汇', '什么怪物协会 天龙八部都来了 你咋不说三体', 1716630000000, 1716630000000
WHERE NOT EXISTS (SELECT 1 FROM notes WHERE id = '1');

INSERT INTO notes (id, title, content, created_at, updated_at)
SELECT '2', '打压', '对方自夸的时候不要一直顺着 可以轻微打压制造张力', 1716630000001, 1716630000001
WHERE NOT EXISTS (SELECT 1 FROM notes WHERE id = '2');

INSERT INTO notes (id, title, content, created_at, updated_at)
SELECT '4', '构图', '人物不要总站在正中心 留一些负空间会更高级', 1716630000003, 1716630000003
WHERE NOT EXISTS (SELECT 1 FROM notes WHERE id = '4');

INSERT INTO notes (id, title, content, created_at, updated_at)
SELECT '5', '复盘', '今天输出太密 中段没有停顿 对方参与感下降', 1716630000004, 1716630000004
WHERE NOT EXISTS (SELECT 1 FROM notes WHERE id = '5');
