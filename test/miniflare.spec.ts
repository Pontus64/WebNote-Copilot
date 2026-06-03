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
const deepSeekApiKey = process.env.DEEPSEEK_API_KEY?.trim() || "";
const itWithDeepSeek = deepSeekApiKey ? it : it.skip;

describe("floating notes worker", () => {
	let mf: Miniflare;
	let db: D1Database;

	beforeAll(async () => {
		mf = createMiniflare({ name: "y-test" });
		await mf.ready;
		db = await mf.getD1Database("wranglerdemo");
		await resetDatabase(db);
	});

	afterAll(async () => {
		await mf.dispose();
	});

	it("requires auth for notes", async () => {
		const response = await mf.dispatchFetch("http://example.com/api/notes");
		const body = await readJson<{ message: string }>(response);

		expect(response.status).toBe(401);
		expect(body.message).toBe("unauthorized");
	});

	it("registers a user with an empty v2 notes list", async () => {
		const auth = await registerTestUser(mf, "reader@example.com");
		const response = await mf.dispatchFetch("http://example.com/api/notes", {
			headers: authHeaders(auth.sessionToken),
		});
		const notes = await readJson<unknown[]>(response);

		expect(response.status).toBe(200);
		expect(notes).toEqual([]);
	});

	it("creates, reads, updates, and deletes a markdown note", async () => {
		const auth = await registerTestUser(mf, "notes@example.com");
		const headers = authHeaders(auth.sessionToken);
		const createResponse = await mf.dispatchFetch("http://example.com/api/notes", {
			method: "POST",
			headers,
			body: JSON.stringify({ title: "测试笔记", markdown: "# 本地 D1 测试\n\n- 第一项" }),
		});
		const created = await readJson<{
			id: string;
			title: string;
			markdown: string;
			excerpt: string;
			contentFormat: string;
			schemaVersion: number;
			assetCount: number;
		}>(createResponse);

		expect(createResponse.status).toBe(201);
		expect(created.title).toBe("测试笔记");
		expect(created.markdown).toBe("# 本地 D1 测试\n\n- 第一项");
		expect(created.excerpt).toContain("本地 D1 测试");
		expect(created.contentFormat).toBe("markdown");
		expect(created.schemaVersion).toBe(2);
		expect(created.assetCount).toBe(0);

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
			body: JSON.stringify({ title: "已更新", markdown: "## 更新内容\n\n任务列表\n\n- [ ] 待办" }),
		});
		await expect(updateResponse.json()).resolves.toEqual(
			expect.objectContaining({
				id: created.id,
				title: "已更新",
				markdown: "## 更新内容\n\n任务列表\n\n- [ ] 待办",
				excerpt: expect.stringContaining("更新内容"),
				contentFormat: "markdown",
				schemaVersion: 2,
				assetCount: 0,
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
		expect(missingResponse.status).toBe(404);
	});

	it("does not map legacy content into markdown", async () => {
		const auth = await registerTestUser(mf, "legacy-content@example.com");
		const response = await mf.dispatchFetch("http://example.com/api/notes", {
			method: "POST",
			headers: authHeaders(auth.sessionToken),
			body: JSON.stringify({ title: "旧协议", content: "旧字段内容" }),
		});
		const note = await readJson<{ markdown: string; schemaVersion: number }>(response);

		expect(response.status).toBe(201);
		expect(note.markdown).toBe("");
		expect(note.schemaVersion).toBe(2);
	});

	it("uploads, lists, and deletes note assets through R2", async () => {
		const auth = await registerTestUser(mf, "assets@example.com");
		const headers = authHeaders(auth.sessionToken);
		const createResponse = await mf.dispatchFetch("http://example.com/api/notes", {
			method: "POST",
			headers,
			body: JSON.stringify({ title: "带图笔记", markdown: "正文" }),
		});
		const note = await readJson<{ id: string }>(createResponse);

		const uploadResponse = await mf.dispatchFetch(
			`http://example.com/api/notes/${note.id}/assets`,
			{
				method: "POST",
				headers: assetHeaders(auth.sessionToken, {
					contentType: "image/png",
					fileName: "screen shot.png",
					fileSize: 3,
				}),
				body: "png",
			}
		);
		const asset = await readJson<{
			id: string;
			noteId: string;
			fileName: string;
			mimeType: string;
			byteSize: number;
			assetKind: string;
			publicUrl: string;
			markdown: string;
		}>(uploadResponse);

		expect(uploadResponse.status).toBe(201);
		expect(asset.noteId).toBe(note.id);
		expect(asset.fileName).toBe("screen shot.png");
		expect(asset.mimeType).toBe("image/png");
		expect(asset.byteSize).toBe(3);
		expect(asset.assetKind).toBe("image");
		expect(asset.publicUrl).toContain("https://assets.example.test/users/");
		expect(asset.markdown).toContain("![screen shot.png](https://assets.example.test/");

		const row = await db
			.prepare("SELECT r2_key, deleted_at FROM note_assets WHERE id = ?")
			.bind(asset.id)
			.first<{ r2_key: string; deleted_at: number | null }>();
		expect(row?.deleted_at).toBeNull();

		const r2 = await mf.getR2Bucket("NOTE_ASSETS");
		await expect(r2.get(row!.r2_key).then((object) => object?.text())).resolves.toBe("png");

		const contentResponse = await mf.dispatchFetch(
			`http://example.com/api/notes/${note.id}/assets/${asset.id}/content`
		);
		expect(contentResponse.status).toBe(200);
		expect(contentResponse.headers.get("Content-Type")).toContain("image/png");
		await expect(contentResponse.text()).resolves.toBe("png");

		const getResponse = await mf.dispatchFetch(`http://example.com/api/notes/${note.id}`, {
			headers,
		});
		await expect(getResponse.json()).resolves.toEqual(
			expect.objectContaining({ id: note.id, assetCount: 1 })
		);

		const listResponse = await mf.dispatchFetch(
			`http://example.com/api/notes/${note.id}/assets`,
			{ headers }
		);
		await expect(listResponse.json()).resolves.toEqual([
			expect.objectContaining({ id: asset.id, assetKind: "image" }),
		]);

		const deleteResponse = await mf.dispatchFetch(
			`http://example.com/api/notes/${note.id}/assets/${asset.id}`,
			{
				method: "DELETE",
				headers,
			}
		);
		await expect(deleteResponse.json()).resolves.toEqual({ success: true });
		await expect(r2.get(row!.r2_key)).resolves.toBeNull();
		const deletedRow = await db
			.prepare("SELECT deleted_at FROM note_assets WHERE id = ?")
			.bind(asset.id)
			.first<{ deleted_at: number | null }>();
		expect(deletedRow?.deleted_at).toEqual(expect.any(Number));
	});

	it("uses a same-origin asset content URL for local uploads", async () => {
		const auth = await registerTestUser(mf, "local-assets@example.com");
		const headers = authHeaders(auth.sessionToken);
		const createResponse = await mf.dispatchFetch("http://127.0.0.1/api/notes", {
			method: "POST",
			headers,
			body: JSON.stringify({ title: "本地图片", markdown: "" }),
		});
		const note = await readJson<{ id: string }>(createResponse);

		const uploadResponse = await mf.dispatchFetch(
			`http://127.0.0.1/api/notes/${note.id}/assets`,
			{
				method: "POST",
				headers: assetHeaders(auth.sessionToken, {
					contentType: "image/png",
					fileName: "local.png",
					fileSize: 3,
				}),
				body: "png",
			}
		);
		const asset = await readJson<{ id: string; publicUrl: string; markdown: string }>(
			uploadResponse
		);

		expect(asset.publicUrl).toBe(
			`http://127.0.0.1/api/notes/${note.id}/assets/${asset.id}/content`
		);
		expect(asset.markdown).toContain(asset.publicUrl);
		const contentResponse = await mf.dispatchFetch(asset.publicUrl);
		expect(contentResponse.status).toBe(200);
		await expect(contentResponse.text()).resolves.toBe("png");
	});

	it("validates note asset uploads", async () => {
		const noAuthResponse = await mf.dispatchFetch("http://example.com/api/notes/missing/assets", {
			method: "POST",
			headers: { "Content-Type": "image/png", "X-File-Name": "x.png", "X-File-Size": "1" },
			body: "x",
		});
		expect(noAuthResponse.status).toBe(401);

		const auth = await registerTestUser(mf, "asset-validation@example.com");
		const missingResponse = await mf.dispatchFetch(
			"http://example.com/api/notes/missing-note/assets",
			{
				method: "POST",
				headers: assetHeaders(auth.sessionToken, {
					contentType: "image/png",
					fileName: "x.png",
					fileSize: 1,
				}),
				body: "x",
			}
		);
		expect(missingResponse.status).toBe(404);

		const createResponse = await mf.dispatchFetch("http://example.com/api/notes", {
			method: "POST",
			headers: authHeaders(auth.sessionToken),
			body: JSON.stringify({ title: "校验", markdown: "" }),
		});
		const note = await readJson<{ id: string }>(createResponse);

		const forbiddenTypeResponse = await mf.dispatchFetch(
			`http://example.com/api/notes/${note.id}/assets`,
			{
				method: "POST",
				headers: assetHeaders(auth.sessionToken, {
					contentType: "image/svg+xml",
					fileName: "bad.svg",
					fileSize: 1,
				}),
				body: "x",
			}
		);
		expect(forbiddenTypeResponse.status).toBe(400);

		const oversizedResponse = await mf.dispatchFetch(
			`http://example.com/api/notes/${note.id}/assets`,
			{
				method: "POST",
				headers: assetHeaders(auth.sessionToken, {
					contentType: "text/plain",
					fileName: "big.txt",
					fileSize: 80 * 1024 * 1024 + 1,
				}),
				body: "x",
			}
		);
		expect(oversizedResponse.status).toBe(413);
	});

	it("deletes note R2 objects when deleting a note", async () => {
		const auth = await registerTestUser(mf, "asset-note-delete@example.com");
		const headers = authHeaders(auth.sessionToken);
		const createResponse = await mf.dispatchFetch("http://example.com/api/notes", {
			method: "POST",
			headers,
			body: JSON.stringify({ title: "待删除", markdown: "" }),
		});
		const note = await readJson<{ id: string }>(createResponse);

		const uploadResponse = await mf.dispatchFetch(
			`http://example.com/api/notes/${note.id}/assets`,
			{
				method: "POST",
				headers: assetHeaders(auth.sessionToken, {
					contentType: "text/plain",
					fileName: "a.txt",
					fileSize: 1,
				}),
				body: "a",
			}
		);
		const asset = await readJson<{ id: string }>(uploadResponse);
		const row = await db
			.prepare("SELECT r2_key FROM note_assets WHERE id = ?")
			.bind(asset.id)
			.first<{ r2_key: string }>();
		const r2 = await mf.getR2Bucket("NOTE_ASSETS");
		await expect(r2.get(row!.r2_key)).resolves.not.toBeNull();

		const deleteResponse = await mf.dispatchFetch(`http://example.com/api/notes/${note.id}`, {
			method: "DELETE",
			headers,
		});
		await expect(deleteResponse.json()).resolves.toEqual({ success: true });
		await expect(r2.get(row!.r2_key)).resolves.toBeNull();
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

	it("validates chat summary content", async () => {
		const auth = await registerTestUser(mf, "summary@example.com");
		const response = await mf.dispatchFetch("http://example.com/api/chat/summary", {
			method: "POST",
			headers: authHeaders(auth.sessionToken),
			body: JSON.stringify({ content: "" }),
		});
		const body = await readJson<{ message: string }>(response);

		expect(response.status).toBe(400);
		expect(body.message).toBe("summary content is required");
	});

	it("requires auth for chat title generation", async () => {
		const response = await mf.dispatchFetch("http://example.com/api/chat/title", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content: "这是一段需要生成标题的笔记内容" }),
		});
		const body = await readJson<{ message: string }>(response);

		expect(response.status).toBe(401);
		expect(body.message).toBe("unauthorized");
	});

	it("validates chat title content", async () => {
		const auth = await registerTestUser(mf, "title-empty@example.com");
		const response = await mf.dispatchFetch("http://example.com/api/chat/title", {
			method: "POST",
			headers: authHeaders(auth.sessionToken),
			body: JSON.stringify({ content: "" }),
		});
		const body = await readJson<{ message: string }>(response);

		expect(response.status).toBe(400);
		expect(body.message).toBe("title content is required");
	});

	it("generates and sanitizes chat titles", async () => {
		let titleRequestCount = 0;
		const rawTitle = "AI聊天存笔记标题生成与跨端选词概要保存体验优化升级完整流程";
		const expectedTitle = Array.from(rawTitle).slice(0, 30).join("");
		const titleMf = createMiniflare({
			name: "y-title-test",
			bindings: {
				DEEPSEEK_API_KEY: "test-key",
				DEEPSEEK_BASE_URL: "https://deepseek.test",
			},
			outboundService: async (request) => {
				titleRequestCount += 1;
				const body = (await request.json()) as {
					stream?: boolean;
					messages?: Array<{ role: string; content: string }>;
				};
				expect(new URL(request.url).origin).toBe("https://deepseek.test");
				expect(body.stream).toBe(false);
				expect(body.messages?.[0]?.content).toContain("30 characters or fewer");
				expect(body.messages?.at(-1)?.content).toContain("标题生成优化");
				return new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: `标题：\`${rawTitle}...\``,
								},
							},
						],
					}),
					{ headers: { "Content-Type": "application/json" } }
				);
			},
		});
		await titleMf.ready;
		const titleDb = await titleMf.getD1Database("wranglerdemo");
		await resetDatabase(titleDb);

		try {
			const auth = await registerTestUser(titleMf, "title-success@example.com");
			const response = await titleMf.dispatchFetch("http://example.com/api/chat/title", {
				method: "POST",
				headers: authHeaders(auth.sessionToken),
				body: JSON.stringify({ content: "这里要把 AI 聊天存笔记的标题生成优化一下" }),
			});
			const body = await readJson<{ title: string }>(response);

			expect(response.status).toBe(200);
			expect(body.title).toBe(expectedTitle);
			expect(Array.from(body.title).length).toBeGreaterThan(0);
			expect(Array.from(body.title).length).toBe(30);
			expect(body.title).not.toMatch(/\.{2,}|…/);
			expect(titleRequestCount).toBe(1);
		} finally {
			await titleMf.dispose();
		}
	});

	it("fails chat title generation when DeepSeek is not configured", async () => {
		const noKeyMf = createMiniflare({
			name: "y-title-no-key-test",
			bindings: { DEEPSEEK_API_KEY: "" },
		});
		await noKeyMf.ready;
		const noKeyDb = await noKeyMf.getD1Database("wranglerdemo");
		await resetDatabase(noKeyDb);

		try {
			const auth = await registerTestUser(noKeyMf, "title-no-key@example.com");
			const response = await noKeyMf.dispatchFetch("http://example.com/api/chat/title", {
				method: "POST",
				headers: authHeaders(auth.sessionToken),
				body: JSON.stringify({ content: "需要生成标题的内容" }),
			});
			const body = await readJson<{ message: string }>(response);

			expect(response.status).toBe(503);
			expect(body.message).toBe("DeepSeek API key is not configured");
		} finally {
			await noKeyMf.dispose();
		}
	});

	it("asks for confirmation before creating an agent note", async () => {
		let intentRequestCount = 0;
		const agentMf = createMiniflare({
			name: "y-agent-confirm-test",
			bindings: {
				DEEPSEEK_API_KEY: "test-key",
				DEEPSEEK_BASE_URL: "https://deepseek.test",
			},
			outboundService: async (request) => {
				intentRequestCount += 1;
				const body = (await request.json()) as { stream?: boolean };
				expect(new URL(request.url).origin).toBe("https://deepseek.test");
				expect(body.stream).toBe(false);
				return new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: JSON.stringify({
										action: "create_note",
										title: "今日待做",
										markdown: "# 今日待做\n\n- [ ] 买菜\n- [ ] 写日报",
										reply: "已生成笔记：今日待做",
										confidence: 0.92,
									}),
								},
							},
						],
					}),
					{ headers: { "Content-Type": "application/json" } }
				);
			},
		});
		await agentMf.ready;
		const agentDb = await agentMf.getD1Database("wranglerdemo");
		await resetDatabase(agentDb);

		try {
			const auth = await registerTestUser(agentMf, "agent-create@example.com");
			const headers = authHeaders(auth.sessionToken);
			const threadResponse = await agentMf.dispatchFetch("http://example.com/api/chat/threads", {
				method: "POST",
				headers,
				body: JSON.stringify({ title: "Agent 创建笔记" }),
			});
			const thread = await readJson<{ id: string }>(threadResponse);
			const response = await agentMf.dispatchFetch(
				`http://example.com/api/chat/threads/${thread.id}/messages`,
				{
					method: "POST",
					headers,
					body: JSON.stringify({ content: "帮我生成一篇待做笔记" }),
				}
			);
			const text = await response.text();

			expect(response.status).toBe(200);
			expect(text).toBe("需要我帮你生成一篇「今日待做」的笔记吗？");
			expect(response.headers.get("X-Floating-Notes-Action")).toBe("note_pending");
			const agentMessageId = response.headers.get("X-Floating-Notes-Message-Id");
			expect(agentMessageId).toEqual(expect.any(String));
			expect(intentRequestCount).toBe(1);

			const pendingNotesResponse = await agentMf.dispatchFetch("http://example.com/api/notes", {
				headers,
			});
			await expect(pendingNotesResponse.json()).resolves.toEqual([]);

			const pendingMessagesResponse = await agentMf.dispatchFetch(
				`http://example.com/api/chat/threads/${thread.id}/messages`,
				{ headers }
			);
			const pendingMessages = await readJson<
				Array<{ id: string; role: string; content: string; metadata: Record<string, unknown> }>
			>(pendingMessagesResponse);
			const assistant = pendingMessages.find((message) => message.role === "assistant");
			expect(assistant).toEqual(
				expect.objectContaining({
					id: agentMessageId,
					content: "需要我帮你生成一篇「今日待做」的笔记吗？",
					metadata: expect.objectContaining({
						agentAction: "pending_create_note",
						agentNoteStatus: "pending",
						title: "今日待做",
						markdown: "# 今日待做\n\n- [ ] 买菜\n- [ ] 写日报",
					}),
				})
			);

			const confirmResponse = await agentMf.dispatchFetch(
				`http://example.com/api/chat/threads/${thread.id}/messages/${agentMessageId}/agent-note`,
				{
					method: "POST",
					headers,
					body: JSON.stringify({ decision: "confirm" }),
				}
			);
			const confirmBody = await readJson<{
				status: string;
				note: { id: string; title: string; markdown: string };
			}>(confirmResponse);
			expect(confirmResponse.status).toBe(200);
			expect(confirmResponse.headers.get("X-Floating-Notes-Action")).toBe("note_created");
			expect(confirmBody).toEqual(
				expect.objectContaining({
					status: "created",
					note: expect.objectContaining({
						title: "今日待做",
						markdown: "# 今日待做\n\n- [ ] 买菜\n- [ ] 写日报",
					}),
				})
			);

			const notesResponse = await agentMf.dispatchFetch("http://example.com/api/notes", {
				headers,
			});
			const notes = await readJson<Array<{ id: string; title: string; markdown: string }>>(
				notesResponse
			);
			expect(notes).toHaveLength(1);
			expect(notes[0].id).toBe(confirmBody.note.id);

			const repeatConfirmResponse = await agentMf.dispatchFetch(
				`http://example.com/api/chat/threads/${thread.id}/messages/${agentMessageId}/agent-note`,
				{
					method: "POST",
					headers,
					body: JSON.stringify({ decision: "confirm" }),
				}
			);
			const repeatConfirmBody = await readJson<{ status: string; noteId: string }>(
				repeatConfirmResponse
			);
			expect(repeatConfirmBody).toEqual({
				status: "created",
				noteId: confirmBody.note.id,
			});

			const repeatNotesResponse = await agentMf.dispatchFetch("http://example.com/api/notes", {
				headers,
			});
			const repeatNotes = await readJson<Array<{ id: string }>>(repeatNotesResponse);
			expect(repeatNotes).toHaveLength(1);

			const resolvedMessagesResponse = await agentMf.dispatchFetch(
				`http://example.com/api/chat/threads/${thread.id}/messages`,
				{ headers }
			);
			const resolvedMessages = await readJson<
				Array<{ id: string; role: string; metadata: Record<string, unknown> }>
			>(resolvedMessagesResponse);
			const resolvedAssistant = resolvedMessages.find((message) => message.id === agentMessageId);
			expect(resolvedAssistant?.metadata).toEqual(
				expect.objectContaining({
					agentAction: "pending_create_note",
					agentNoteStatus: "created",
					noteId: confirmBody.note.id,
					noteTitle: "今日待做",
				})
			);
			expect(resolvedAssistant?.metadata.markdown).toBeUndefined();
		} finally {
			await agentMf.dispose();
		}
	});

	it("dismisses an agent note confirmation without creating a note", async () => {
		const agentMf = createMiniflare({
			name: "y-agent-dismiss-test",
			bindings: {
				DEEPSEEK_API_KEY: "test-key",
				DEEPSEEK_BASE_URL: "https://deepseek.test",
			},
			outboundService: async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: JSON.stringify({
										action: "create_note",
										title: "周计划",
										markdown: "# 周计划\n\n- 复盘\n- 排期",
										reply: "已生成笔记：周计划",
										confidence: 0.88,
									}),
								},
							},
						],
					}),
					{ headers: { "Content-Type": "application/json" } }
				),
		});
		await agentMf.ready;
		const agentDb = await agentMf.getD1Database("wranglerdemo");
		await resetDatabase(agentDb);

		try {
			const auth = await registerTestUser(agentMf, "agent-dismiss@example.com");
			const headers = authHeaders(auth.sessionToken);
			const threadResponse = await agentMf.dispatchFetch("http://example.com/api/chat/threads", {
				method: "POST",
				headers,
				body: JSON.stringify({ title: "Agent 拒绝笔记" }),
			});
			const thread = await readJson<{ id: string }>(threadResponse);
			const response = await agentMf.dispatchFetch(
				`http://example.com/api/chat/threads/${thread.id}/messages`,
				{
					method: "POST",
					headers,
					body: JSON.stringify({ content: "把这些生成一篇周计划笔记" }),
				}
			);
			await response.text();
			const agentMessageId = response.headers.get("X-Floating-Notes-Message-Id");
			expect(agentMessageId).toEqual(expect.any(String));

			const dismissResponse = await agentMf.dispatchFetch(
				`http://example.com/api/chat/threads/${thread.id}/messages/${agentMessageId}/agent-note`,
				{
					method: "POST",
					headers,
					body: JSON.stringify({ decision: "dismiss" }),
				}
			);
			await expect(dismissResponse.json()).resolves.toEqual({ status: "dismissed" });

			const notesResponse = await agentMf.dispatchFetch("http://example.com/api/notes", {
				headers,
			});
			await expect(notesResponse.json()).resolves.toEqual([]);

			const messagesResponse = await agentMf.dispatchFetch(
				`http://example.com/api/chat/threads/${thread.id}/messages`,
				{ headers }
			);
			const messages = await readJson<
				Array<{ id: string; role: string; metadata: Record<string, unknown> }>
			>(messagesResponse);
			const assistant = messages.find((message) => message.id === agentMessageId);
			expect(assistant?.metadata).toEqual(
				expect.objectContaining({
					agentAction: "pending_create_note",
					agentNoteStatus: "dismissed",
				})
			);
			expect(assistant?.metadata.markdown).toBeUndefined();
		} finally {
			await agentMf.dispose();
		}
	});

	it("does not create a keyword-matched note when the intent model is unavailable", async () => {
		const noKeyMf = createMiniflare({
			name: "y-agent-no-key-test",
			bindings: { DEEPSEEK_API_KEY: "" },
		});
		await noKeyMf.ready;
		const noKeyDb = await noKeyMf.getD1Database("wranglerdemo");
		await resetDatabase(noKeyDb);

		try {
			const auth = await registerTestUser(noKeyMf, "agent-no-key@example.com");
			const headers = authHeaders(auth.sessionToken);
			const threadResponse = await noKeyMf.dispatchFetch("http://example.com/api/chat/threads", {
				method: "POST",
				headers,
				body: JSON.stringify({ title: "无 key 测试" }),
			});
			const thread = await readJson<{ id: string }>(threadResponse);
			const response = await noKeyMf.dispatchFetch(
				`http://example.com/api/chat/threads/${thread.id}/messages`,
				{
					method: "POST",
					headers,
					body: JSON.stringify({ content: "帮我生成一篇待做笔记" }),
				}
			);
			const text = await response.text();

			expect(response.status).toBe(200);
			expect(text).toContain("DeepSeek API key is not configured");
			expect(response.headers.get("X-Floating-Notes-Action")).toBeNull();

			const notesResponse = await noKeyMf.dispatchFetch("http://example.com/api/notes", {
				headers,
			});
			await expect(notesResponse.json()).resolves.toEqual([]);
		} finally {
			await noKeyMf.dispose();
		}
	});

	itWithDeepSeek("streams a real DeepSeek response", async () => {
		const auth = await registerTestUser(mf, "deepseek@example.com");
		const headers = authHeaders(auth.sessionToken);
		const threadResponse = await mf.dispatchFetch("http://example.com/api/chat/threads", {
			method: "POST",
			headers,
			body: JSON.stringify({ title: "真实 DeepSeek 测试" }),
		});
		const thread = await readJson<{ id: string }>(threadResponse);
		const response = await mf.dispatchFetch(
			`http://example.com/api/chat/threads/${thread.id}/messages`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({
					content: "请只回复两个大写英文字母 OK，不要添加其他任何内容。",
				}),
			}
		);
		const text = await response.text();

		expect(response.status).toBe(200);
		expect(text.trim().toUpperCase()).toContain("OK");
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

function assetHeaders(
	sessionToken: string,
	options: { contentType: string; fileName: string; fileSize: number }
): Record<string, string> {
	return {
		"Content-Type": options.contentType,
		"Authorization": `Bearer ${sessionToken}`,
		"X-File-Name": options.fileName,
		"X-File-Size": String(options.fileSize),
	};
}

async function readJson<T>(response: JsonResponse): Promise<T> {
	return (await response.json()) as T;
}

function createMiniflare(options: Partial<MiniflareOptions> = {}): Miniflare {
	return new Miniflare({
		name: "y-test",
		scriptPath: "dist/y/index.js",
		modules: true,
		modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
		compatibilityDate: "2026-05-29",
		compatibilityFlags: [...compatibilityFlags],
		bindings: {
			DEEPSEEK_BASE_URL: "https://api.deepseek.com",
			DEEPSEEK_MODEL: "deepseek-v4-flash",
			DEEPSEEK_API_KEY: deepSeekApiKey,
			NOTE_ASSETS_PUBLIC_BASE_URL: "https://assets.example.test",
			...(options.bindings ?? {}),
		},
		d1Databases: ["wranglerdemo"],
		r2Buckets: ["NOTE_ASSETS"],
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
		...options,
	} satisfies MiniflareOptions);
}

async function resetDatabase(db: D1Database) {
	await db.exec("DROP TABLE IF EXISTS d1_migrations");
	await db.exec("DROP TABLE IF EXISTS auth_chat_messages");
	await db.exec("DROP TABLE IF EXISTS auth_chat_threads");
	await db.exec("DROP TABLE IF EXISTS auth_sessions");
	await db.exec("DROP TABLE IF EXISTS auth_users");
	await db.exec("DROP TABLE IF EXISTS chat_messages");
	await db.exec("DROP TABLE IF EXISTS chat_threads");
	await db.exec("DROP TABLE IF EXISTS sessions");
	await db.exec("DROP TABLE IF EXISTS users");
	await db.exec("DROP TABLE IF EXISTS note_assets");
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
