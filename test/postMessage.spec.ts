import { describe, expect, it } from "vitest";
import { resolvePostMessageTargetOrigin } from "../client/shared/postMessage";

describe("postMessage target origin", () => {
	it("keeps normal origins strict", () => {
		expect(resolvePostMessageTargetOrigin("https://notes.edmund.xin")).toBe(
			"https://notes.edmund.xin"
		);
	});

	it("falls back for opaque origins such as file pages", () => {
		expect(resolvePostMessageTargetOrigin("null")).toBe("*");
		expect(resolvePostMessageTargetOrigin("")).toBe("*");
	});
});
