import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
	buildNoteExportBundle,
	collectReferencedAssets,
	sanitizeExportBaseName,
} from "../client/shared/exportNote";
import type { NoteAsset } from "../client/shared/types";

describe("note export bundle", () => {
	it("sanitizes note titles for zip paths", () => {
		expect(sanitizeExportBaseName(" 接口/鉴权:记录 ")).toBe("接口-鉴权-记录");
		expect(sanitizeExportBaseName("")).toBe("未命名笔记");
	});

	it("exports markdown and referenced assets with relative paths", async () => {
		const image = makeAsset({
			id: "asset-1",
			fileName: "image.png",
			publicUrl: "https://assets.notes.edmund.xin/users/u/notes/n/asset-1-image.png",
		});
		const orphan = makeAsset({
			id: "asset-2",
			fileName: "orphan.png",
			publicUrl: "https://assets.notes.edmund.xin/users/u/notes/n/asset-2-orphan.png",
		});
		const externalUrl = "https://example.com/external.png";
		const bundle = await buildNoteExportBundle({
			title: "产品方案",
			markdown: `# 正文\n\n![截图](${image.publicUrl})\n\n![外部图](${externalUrl})`,
			assets: [image, orphan],
			fetchAssetContent: async (asset) => {
				if (asset.id !== image.id) {
					throw new Error("unexpected asset fetch");
				}
				return new Uint8Array([1, 2, 3]).buffer;
			},
		});

		const files = unzipSync(new Uint8Array(await bundle.blob.arrayBuffer()));
		const markdown = strFromU8(files["产品方案.md"]);

		expect(bundle.fileName).toBe("产品方案.zip");
		expect(Object.keys(files).sort()).toEqual([
			"产品方案.assets/001-image.png",
			"产品方案.md",
		]);
		expect(markdown).toContain("![截图](产品方案.assets/001-image.png)");
		expect(markdown).toContain(`![外部图](${externalUrl})`);
		expect(markdown).not.toContain(image.publicUrl);
		expect(markdown).toMatch(/\n$/);
	});

	it("keeps asset filenames inside the assets directory", async () => {
		const image = makeAsset({
			id: "asset-1",
			fileName: "图/片:一.png",
			publicUrl: "https://assets.notes.edmund.xin/users/u/notes/n/asset-1.png",
		});
		const bundle = await buildNoteExportBundle({
			title: "接口/鉴权:记录",
			markdown: `![截图](${image.publicUrl})`,
			assets: [image],
			fetchAssetContent: async () => new Uint8Array([9]).buffer,
		});
		const files = unzipSync(new Uint8Array(await bundle.blob.arrayBuffer()));

		expect(bundle.fileName).toBe("接口-鉴权-记录.zip");
		expect(Object.keys(files).sort()).toEqual([
			"接口-鉴权-记录.assets/001-图-片-一.png",
			"接口-鉴权-记录.md",
		]);
	});

	it("collects only assets referenced by markdown", () => {
		const image = makeAsset({
			id: "asset-1",
			publicUrl: "https://assets.notes.edmund.xin/users/u/notes/n/asset-1.png",
		});
		const orphan = makeAsset({
			id: "asset-2",
			publicUrl: "https://assets.notes.edmund.xin/users/u/notes/n/asset-2.png",
		});

		const referenced = collectReferencedAssets(`![截图](${image.publicUrl})`, [image, orphan]);

		expect(referenced).toHaveLength(1);
		expect(referenced[0]?.asset.id).toBe("asset-1");
	});

	it("matches local asset proxy URLs by absolute and relative content paths", () => {
		const image = makeAsset({
			id: "asset-1",
			publicUrl: "http://127.0.0.1:5173/api/notes/note-id/assets/asset-1/content",
		});
		const referenced = collectReferencedAssets(
			"![截图](/api/notes/note-id/assets/asset-1/content)",
			[image]
		);

		expect(referenced).toHaveLength(1);
		expect(referenced[0]?.asset.id).toBe("asset-1");
	});

	it("collects uploaded media assets from html src attributes", () => {
		const video = makeAsset({
			id: "asset-1",
			fileName: "clip.mp4",
			mimeType: "video/mp4",
			assetKind: "video",
			publicUrl: "https://assets.notes.edmund.xin/users/u/notes/n/asset-1.mp4",
			markdown: `<video controls src="https://assets.notes.edmund.xin/users/u/notes/n/asset-1.mp4"></video>`,
		});
		const referenced = collectReferencedAssets(
			`<video controls src="${video.publicUrl}"></video>`,
			[video]
		);

		expect(referenced).toHaveLength(1);
		expect(referenced[0]?.asset.id).toBe("asset-1");
	});
});

function makeAsset(overrides: Partial<NoteAsset>): NoteAsset {
	const id = overrides.id || "asset-id";
	const publicUrl = overrides.publicUrl || `https://assets.notes.edmund.xin/${id}.png`;
	const fileName = overrides.fileName || `${id}.png`;
	return {
		id,
		noteId: overrides.noteId || "note-id",
		fileName,
		mimeType: overrides.mimeType || "image/png",
		byteSize: overrides.byteSize || 123,
		assetKind: overrides.assetKind || "image",
		publicUrl,
		markdown: overrides.markdown || `![${fileName}](${publicUrl})`,
		createdAt: overrides.createdAt || 1,
		updatedAt: overrides.updatedAt || 1,
	};
}
