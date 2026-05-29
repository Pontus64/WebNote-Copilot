import { useRef } from "react";
import {
	FloatingNotesCore,
	type FloatingNotesCoreHandle,
} from "../shared/FloatingNotesCore";

export function App() {
	const notesRef = useRef<FloatingNotesCoreHandle | null>(null);

	return (
		<div className="app-shell dark">
			<main className="demo-main">
				<section className="surface">
					<h1>Floating Notes</h1>
					<p>这是普通页面形态，右下角悬浮按钮会打开抽屉。PC 端从右侧滑入，移动端从底部上滑。</p>
					<p>选中下面任意文字，文字下方会出现工具条，可直接问 AI、复制，或保存到当前 Worker 后端的笔记。</p>

					<div className="demo-text">
						<p>划词笔记适合把网页中的片段快速沉淀下来。选中文字后，工具条会贴近选区下方出现；点击“笔记”会触发参考脚本里的虫洞动效并写入后端。</p>
						<p>AI 页保留参考脚本的双页抽屉机制，回答内容可以通过“存为笔记”进入笔记页。笔记页的数据仍然来自当前 y 工程的 /notes API。</p>
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
