import { zipSync, strToU8 } from "fflate";
import type { NoteAsset } from "./types";

export type ExportAssetContent = {
	asset: NoteAsset;
	data: Uint8Array;
};

export type ExportNoteBundleInput = {
	title: string;
	markdown: string;
	assets: NoteAsset[];
	fetchAssetContent: (asset: NoteAsset) => Promise<ArrayBuffer>;
};

export type ExportNoteBundleResult = {
	fileName: string;
	blob: Blob;
	assetCount: number;
};

type ReferencedAsset = {
	asset: NoteAsset;
	outputName: string;
	matches: string[];
};

const UNTITLED_NOTE_NAME = "未命名笔记";
const MAX_BASE_NAME_LENGTH = 80;
const MAX_ASSET_NAME_LENGTH = 120;

export async function buildNoteExportBundle({
	title,
	markdown,
	assets,
	fetchAssetContent,
}: ExportNoteBundleInput): Promise<ExportNoteBundleResult> {
	const baseName = sanitizeExportBaseName(title);
	const referencedAssets = collectReferencedAssets(markdown, assets);
	const files: Record<string, Uint8Array> = {};
	let rewrittenMarkdown = markdown;

	for (const referencedAsset of referencedAssets) {
		const data = new Uint8Array(await fetchAssetContent(referencedAsset.asset));
		const relativePath = `${baseName}.assets/${referencedAsset.outputName}`;
		for (const match of referencedAsset.matches) {
			rewrittenMarkdown = replaceAllLiteral(rewrittenMarkdown, match, relativePath);
		}
		files[relativePath] = data;
	}

	files[`${baseName}.md`] = strToU8(ensureTrailingNewline(rewrittenMarkdown));
	const zipped = zipSync(files, { level: 6 });
	return {
		fileName: `${baseName}.zip`,
		blob: new Blob([zipped], { type: "application/zip" }),
		assetCount: referencedAssets.length,
	};
}

export function downloadBlob(blob: Blob, fileName: string) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	anchor.style.display = "none";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function sanitizeExportBaseName(value: string): string {
	return sanitizeFileSegment(value, UNTITLED_NOTE_NAME, MAX_BASE_NAME_LENGTH);
}

export function collectReferencedAssets(markdown: string, assets: NoteAsset[]): ReferencedAsset[] {
	const markdownTargets = extractMarkdownTargets(markdown);
	const usedNames = new Set<string>();
	return assets
		.map((asset) => {
			const candidates = assetUrlCandidates(asset);
			const matches = markdownTargets.filter((target) =>
				candidates.some((candidate) => assetTargetMatches(target, candidate))
			);
			return matches.length ? { asset, matches } : null;
		})
		.filter((entry): entry is Omit<ReferencedAsset, "outputName"> => Boolean(entry))
		.map((entry, index) => ({
			...entry,
			outputName: makeUniqueAssetFileName(entry.asset.fileName, index + 1, usedNames),
		}));
}

function assetUrlCandidates(asset: NoteAsset): string[] {
	const candidates = new Set<string>();
	addCandidate(candidates, asset.publicUrl);
	addCandidate(candidates, asset.markdown.match(/\(([^)]+)\)/)?.[1] ?? "");

	try {
		const url = new URL(asset.publicUrl);
		addCandidate(candidates, url.pathname);
	} catch {
		// Relative or malformed public URLs are already covered by the raw value.
	}

	return Array.from(candidates);
}

function extractMarkdownTargets(markdown: string): string[] {
	const targets = new Set<string>();
	const markdownLinkPattern = /!?\[[^\]]*]\((\S+?)(?:\s+["'][^"']*["'])?\)/g;
	const htmlSrcPattern = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;

	for (const match of markdown.matchAll(markdownLinkPattern)) {
		addCandidate(targets, match[1] ?? "");
	}

	for (const match of markdown.matchAll(htmlSrcPattern)) {
		addCandidate(targets, unescapeHtmlAttribute(match[1] ?? match[2] ?? match[3] ?? ""));
	}

	return Array.from(targets);
}

function assetTargetMatches(markdownTarget: string, assetCandidate: string): boolean {
	if (markdownTarget === assetCandidate) {
		return true;
	}

	const targetPath = urlPathname(markdownTarget);
	const candidatePath = urlPathname(assetCandidate);
	if (targetPath && assetCandidate.startsWith("/") && targetPath === assetCandidate) {
		return true;
	}
	if (candidatePath && markdownTarget.startsWith("/") && candidatePath === markdownTarget) {
		return true;
	}

	return false;
}

function urlPathname(value: string): string {
	try {
		return new URL(value).pathname;
	} catch {
		return "";
	}
}

function addCandidate(candidates: Set<string>, value: string) {
	const candidate = value.trim();
	if (candidate) {
		candidates.add(candidate);
	}
}

function unescapeHtmlAttribute(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

function makeUniqueAssetFileName(fileName: string, index: number, usedNames: Set<string>): string {
	const safeName = sanitizeAssetFileName(fileName);
	const prefix = String(index).padStart(3, "0");
	let candidate = `${prefix}-${safeName}`;
	let suffix = 2;
	while (usedNames.has(candidate)) {
		const extensionIndex = safeName.lastIndexOf(".");
		if (extensionIndex > 0) {
			candidate = `${prefix}-${safeName.slice(0, extensionIndex)}-${suffix}${safeName.slice(extensionIndex)}`;
		} else {
			candidate = `${prefix}-${safeName}-${suffix}`;
		}
		suffix += 1;
	}
	usedNames.add(candidate);
	return candidate;
}

function sanitizeAssetFileName(value: string): string {
	return sanitizeFileSegment(value, "file", MAX_ASSET_NAME_LENGTH);
}

function sanitizeFileSegment(value: string, fallback: string, maxLength: number): string {
	const withoutPath = String(value || "")
		.replace(/[\u0000-\u001f\u007f]/g, "")
		.trim()
		.replace(/\s+/g, " ")
		.replace(/[\\/<>:"|?*]+/g, "-")
		.replace(/^\.+|\.+$/g, "")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
	const chars = Array.from(withoutPath || fallback).slice(0, maxLength).join("").trim();
	return chars || fallback;
}

function replaceAllLiteral(value: string, search: string, replacement: string): string {
	return value.split(search).join(replacement);
}

function ensureTrailingNewline(value: string): string {
	return value.endsWith("\n") ? value : `${value}\n`;
}
