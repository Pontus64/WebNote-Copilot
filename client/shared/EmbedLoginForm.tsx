import { type FormEvent, useState } from "react";

export type EmbedLoginMode = "login" | "register";

type EmbedLoginFormProps = {
	// onSubmit 成功即代表已登录（由宿主负责种 cookie / 注入 token）；失败请抛错，这里会展示。
	onSubmit: (mode: EmbedLoginMode, email: string, password: string) => Promise<void>;
};

// widget 端(宿主)使用的轻量登录/注册表单，仅依赖 React，挂在抽屉内的统一登录浮层里。
// 不复用 ChatApp 的 AuthScreen，避免把 assistant-ui 等巨依赖打进 widget 包。
export function EmbedLoginForm({ onSubmit }: EmbedLoginFormProps) {
	const [mode, setMode] = useState<EmbedLoginMode>("login");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) {
			return;
		}
		setBusy(true);
		setError("");
		try {
			await onSubmit(mode, email.trim(), password);
		} catch (err) {
			setError(err instanceof Error ? err.message : "登录失败");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="dst-login-overlay">
			<form className="dst-login-form" onSubmit={submit}>
				<div className="dst-login-title">登录后即可在所有网站同步你的笔记</div>
				<div className="dst-login-tabs">
					<button
						type="button"
						className={mode === "login" ? "active" : ""}
						onClick={() => setMode("login")}
					>
						登录
					</button>
					<button
						type="button"
						className={mode === "register" ? "active" : ""}
						onClick={() => setMode("register")}
					>
						注册
					</button>
				</div>
				<input
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					type="email"
					autoComplete="email"
					placeholder="邮箱"
					required
				/>
				<input
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					type="password"
					autoComplete={mode === "login" ? "current-password" : "new-password"}
					placeholder="密码"
					minLength={8}
					required
				/>
				{error ? <div className="dst-login-error">{error}</div> : null}
				<button type="submit" className="dst-login-submit" disabled={busy}>
					{busy ? "请稍候…" : mode === "login" ? "登录" : "注册"}
				</button>
			</form>
		</div>
	);
}
