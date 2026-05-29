import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { unstable_splitSqlQuery } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare, type MiniflareOptions } from "miniflare";

type TestUser = {
	sessionToken: string;
};

type JsonResponse = {
	json(): Promise<unknown>;
};

const compatibilityFlags = [
	"nodejs_compat",
	"global_fetch_strictly_public",
	"disable_ctx_exports",
] as const;

describe("floating notes worker", () => {
	let mf: Miniflare;
	let db: D1Database;

	beforeAll(async () => {
		mf = new Miniflare({
			name: "y-test",
			scriptPath: "dist/y/index.js",
			modules: true,
			modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
			compatibilityDate: "2026-05-29",
			compatibilityFlags: [...compatibilityFlags],
			bindings: {
				DEEPSEEK_BASE_URL: "https://api.deepseek.com",
				DEEPSEEK_MODEL: "deepseek-v4-flash",
			},
			d1Databases: ["wranglerdemo"],
			assets: {
				directory: "./public",
				binding: "ASSETS",
				routerConfig: {
					has_user_worker: true,
					static_routing: {
						user_worker: ["/api/*", "/notes", "/notes/*"],
					},
				},
				assetConfig: {
					not_found_handling: "single-page-application",
				},
			},
		} satisfies MiniflareOptions);
		await mf.ready;
		db = await mf.getD1Database("wranglerdemo");
		await resetDatabase(db);
	});

	afterAll(async () => {
		await mf.dispose();
	});

	it("requires auth for notes", async () => {
		const response = await mf.dispatchFetch("http://example.com/api/notes");
		const text = await response.clone().text();
		const body = JSON.parse(text) as { message: string };

		expect(response.status).toBe(401);
		expect(body.message).toBe("unauthorized");
	});

	it("registers a user and claims seeded notes", async () => {
		const auth = await registerTestUser(mf, "reader@example.com");
		const response = await mf.dispatchFetch("http://example.com/api/notes", {
			headers: authHeaders(auth.sessionToken),
		});
		const notes = await readJson<unknown[]>(response);

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

	it("creates, reads, updates, and deletes a user note", async () => {
		const auth = await registerTestUser(mf, "notes@example.com");
		const headers = authHeaders(auth.sessionToken);
		const createResponse = await mf.dispatchFetch("http://example.com/api/notes", {
			method: "POST",
			headers,
			body: JSON.stringify({ title: "测试笔记", content: "本地 D1 测试" }),
		});
		const created = await readJson<{
			id: string;
			title: string;
			content: string;
		}>(createResponse);

		expect(createResponse.status).toBe(201);
		expect(created.title).toBe("测试笔记");
		expect(created.content).toBe("本地 D1 测试");

		const getResponse = await mf.dispatchFetch(`http://example.com/api/notes/${created.id}`, {
			headers,
		});
		await expect(getResponse.json()).resolves.toEqual(
			expect.objectContaining({
				id: created.id,
				title: "测试笔记",
			})
		);

		const updateResponse = await mf.dispatchFetch(`http://example.com/api/notes/${created.id}`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ title: "已更新", content: "更新内容" }),
		});
		await expect(updateResponse.json()).resolves.toEqual(
			expect.objectContaining({
				id: created.id,
				title: "已更新",
				content: "更新内容",
			})
		);

		const deleteResponse = await mf.dispatchFetch(`http://example.com/api/notes/${created.id}`, {
			method: "DELETE",
			headers,
		});
		await expect(deleteResponse.json()).resolves.toEqual({ success: true });

		const missingResponse = await mf.dispatchFetch(`http://example.com/api/notes/${created.id}`, {
			headers,
		});
		console.log("missing response", missingResponse.status, await missingResponse.clone().text());
		expect(missingResponse.status).toBe(404);
	});

	it("creates chat threads and lists messages", async () => {
		const auth = await registerTestUser(mf, "chat@example.com");
		const headers = authHeaders(auth.sessionToken);
		const createResponse = await mf.dispatchFetch("http://example.com/api/chat/threads", {
			method: "POST",
			headers,
			body: JSON.stringify({ title: "第一轮聊天" }),
		});
		const thread = await readJson<{ id: string; title: string }>(createResponse);

		expect(createResponse.status).toBe(201);
		expect(thread.title).toBe("第一轮聊天");

		const listResponse = await mf.dispatchFetch("http://example.com/api/chat/threads", {
			headers,
		});
		const threads = await readJson<Array<{ id: string }>>(listResponse);
		expect(threads).toEqual(expect.arrayContaining([expect.objectContaining({ id: thread.id })]));

		const messagesResponse = await mf.dispatchFetch(
			`http://example.com/api/chat/threads/${thread.id}/messages`,
			{ headers }
		);
		await expect(messagesResponse.json()).resolves.toEqual([]);
	});

	it("streams a fallback message when DeepSeek key is missing", async () => {
		const auth = await registerTestUser(mf, "stream@example.com");
		const headers = authHeaders(auth.sessionToken);
		const threadResponse = await mf.dispatchFetch("http://example.com/api/chat/threads", {
			method: "POST",
			headers,
			body: JSON.stringify({ title: "无密钥测试" }),
		});
		const thread = await readJson<{ id: string }>(threadResponse);
		const response = await mf.dispatchFetch(
			`http://example.com/api/chat/threads/${thread.id}/messages`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({ content: "hello" }),
			}
		);
		const text = await response.text();

		expect(response.status).toBe(200);
		expect(text).toContain("DeepSeek API key is not configured");
	});

	it("serves the floating notes injector as a static asset", async () => {
		const response = await mf.dispatchFetch("http://example.com/embed/inject-floating-notes.js");
		const source = await response.text();

		expect(response.status).toBe(200);
		expect(source).toContain("FloatingNotesInjectConfig");
		expect(source).toContain("/embed/floating-notes-widget.js");
	});

	it("serves the Tampermonkey userscript as a static asset", async () => {
		const response = await mf.dispatchFetch("http://example.com/floating-notes.user.js");
		const source = await response.text();

		expect(response.status).toBe(200);
		expect(source).toContain("// ==UserScript==");
		expect(source).toContain("@match        https://*/*");
		expect(source).toContain("https://notes.edmund.xin/embed/floating-notes-widget.js");
	});
});

async function registerTestUser(fetcher: Miniflare, email: string): Promise<TestUser> {
	const response = await fetcher.dispatchFetch("http://example.com/api/auth/register", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password: "password123" }),
	});
	expect(response.status).toBe(201);
	return readJson<TestUser>(response);
}

function authHeaders(sessionToken: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		"Authorization": `Bearer ${sessionToken}`,
	};
}

async function readJson<T>(response: JsonResponse): Promise<T> {
	return (await response.json()) as T;
}

async function resetDatabase(db: D1Database) {
	await db.exec("DROP TABLE IF EXISTS d1_migrations");
	await db.exec("DROP TABLE IF EXISTS chat_messages");
	await db.exec("DROP TABLE IF EXISTS chat_threads");
	await db.exec("DROP TABLE IF EXISTS sessions");
	await db.exec("DROP TABLE IF EXISTS users");
	await db.exec("DROP TABLE IF EXISTS notes");

	for (const query of migrationQueries()) {
		await db.prepare(query).run();
	}
}

function migrationQueries(): string[] {
	return readdirSync("migrations")
		.filter((name) => name.endsWith(".sql"))
		.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
		.flatMap((name) => unstable_splitSqlQuery(readFileSync(join("migrations", name), "utf8")));
}
