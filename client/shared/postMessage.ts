export function resolvePostMessageTargetOrigin(origin: string) {
	return origin && origin !== "null" ? origin : "*";
}
