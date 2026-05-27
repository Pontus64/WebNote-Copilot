import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src";

describe("floating notes worker", () => {
	beforeAll(async () => {
		await seedTestDatabase();
	});

	it("lists seeded notes", async () => {
		const response = await SELF.fetch("http://example.com/notes");
		const notes = await response.json<unknown[]>();

		expect(response.status).toBe(200);
		expect(notes.length).toBeGreaterThanOrEqual(5);
		expect(notes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "1",
					title: "词汇",
				}),
			])
		);
	});

	it("creates, reads, updates, and deletes a note", async () => {
		const createResponse = await SELF.fetch("http://example.com/notes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "测试笔记", content: "本地 D1 测试" }),
		});
		const created = await createResponse.json<{
			id: string;
			title: string;
			content: string;
		}>();

		expect(createResponse.status).toBe(201);
		expect(created.title).toBe("测试笔记");
		expect(created.content).toBe("本地 D1 测试");

		const getResponse = await SELF.fetch(`http://example.com/notes/${created.id}`);
		await expect(getResponse.json()).resolves.toEqual(
			expect.objectContaining({
				id: created.id,
				title: "测试笔记",
			})
		);

		const updateResponse = await SELF.fetch(`http://example.com/notes/${created.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "已更新", content: "更新内容" }),
		});
		await expect(updateResponse.json()).resolves.toEqual(
			expect.objectContaining({
				id: created.id,
				title: "已更新",
				content: "更新内容",
			})
		);

		const deleteResponse = await SELF.fetch(`http://example.com/notes/${created.id}`, {
			method: "DELETE",
		});
		await expect(deleteResponse.json()).resolves.toEqual({ success: true });

		const missingResponse = await SELF.fetch(`http://example.com/notes/${created.id}`);
		expect(missingResponse.status).toBe(404);
	});

	it("handles notes through the exported fetch handler", async () => {
		const request = new Request("http://example.com/notes");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(expect.any(Array));
	});

	it("serves the floating notes injector as a static asset", async () => {
		const response = await SELF.fetch("http://example.com/embed/inject-floating-notes.js");
		const source = await response.text();

		expect(response.status).toBe(200);
		expect(source).toContain("FloatingNotesInjectConfig");
		expect(source).toContain("/embed/floating-notes-widget.js");
	});

	it("serves the Tampermonkey userscript as a static asset", async () => {
		const response = await SELF.fetch("http://example.com/floating-notes.user.js");
		const source = await response.text();

		expect(response.status).toBe(200);
		expect(source).toContain("// ==UserScript==");
		expect(source).toContain("@match        https://*/*");
		expect(source).toContain("https://notes.edmund.xin/embed/floating-notes-widget.js");
	});
});

async function seedTestDatabase(): Promise<void> {
	await env.wranglerdemo.exec("DROP TABLE IF EXISTS notes");
	await env.wranglerdemo.exec(
		"CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
	);
	await env.wranglerdemo.exec(
		"CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC)"
	);

	const seedNotes = [
		["a3d0f771-0dec-47a7-a86b-3308bebc619a", "666", "888", 1779714294031, 1779714294031],
		["1", "词汇", "什么怪物协会 天龙八部都来了 你咋不说三体", 1716630000000, 1716630000000],
		["2", "打压", "对方自夸的时候不要一直顺着 可以轻微打压制造张力", 1716630000001, 1716630000001],
		["4", "构图", "人物不要总站在正中心 留一些负空间会更高级", 1716630000003, 1716630000003],
		["5", "复盘", "今天输出太密 中段没有停顿 对方参与感下降", 1716630000004, 1716630000004],
	] as const;

	await Promise.all(
		seedNotes.map(([id, title, content, createdAt, updatedAt]) =>
			env.wranglerdemo
				.prepare(
					`INSERT OR IGNORE INTO notes (id, title, content, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?)`
				)
				.bind(id, title, content, createdAt, updatedAt)
				.run()
		)
	);
}
