import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	publicDir: false,
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
	build: {
		emptyOutDir: false,
		lib: {
			entry: "client/widget/entry.tsx",
			formats: ["iife"],
			name: "FloatingNotesWidgetBundle",
			fileName: () => "floating-notes-widget.js",
		},
		outDir: "dist/widget",
		rollupOptions: {
			output: {
				inlineDynamicImports: true,
			},
		},
	},
});
