import { useRef } from "react";
import {
	FloatingNotesCore,
	type FloatingNotesCoreHandle,
} from "../shared/FloatingNotesCore";
import { ChatApp } from "./ChatApp";

export function App() {
	const params = new URLSearchParams(window.location.search);
	const embed = params.get("embed") === "1";
	const notesRef = useRef<FloatingNotesCoreHandle | null>(null);

	if (embed) {
		return <ChatApp embed />;
	}

	return (
		<div className="app-shell dark">
			<main className="demo-main">
				<section className="surface">
					<h1>Floating Notes</h1>
					<p>
						这是普通页面形态，右下角悬浮按钮会打开抽屉。PC 端从右侧滑入，移动端从底部上滑。
					</p>
					<p>
						选中下面任意文字，文字下方会出现工具条，可直接问 AI、复制，或保存到当前 Worker 后端的笔记。
					</p>

					<div className="demo-text">
						<p>
							划词笔记适合把网页中的片段快速沉淀下来。选中文字后，工具条会贴近选区下方出现；点击“笔记”会触发虫洞动效并写入后端。
						</p>
						<p>
							抽屉仍然保留原来的双页结构：笔记页、选词工具栏和笔记/聊天切换不变，只有聊天页内容换成 assistant-ui 登录和聊天体验。
						</p>
					</div>

					<div className="demo-actions">
						<button
							className="primary"
							type="button"
							onClick={() => notesRef.current?.open("notes")}
						>
							打开笔记抽屉
						</button>
					</div>
				</section>
			</main>

			<FloatingNotesCore ref={notesRef} title="笔记" />
		</div>
	);
}
