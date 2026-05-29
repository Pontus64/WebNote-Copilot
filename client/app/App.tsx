import { ChatApp } from "./ChatApp";

export function App() {
	const params = new URLSearchParams(window.location.search);
	const embed = params.get("embed") === "1";

	return <ChatApp embed={embed} />;
}
