# 悬浮笔记 · 浏览器扩展(MV3)

在任意网页右下角注入「悬浮笔记 + AI 聊天」面板。相比油猴脚本版,本扩展额外用
`declarativeNetRequest` **去除宿主站点的 CSP**,让 `notes.edmund.xin` 的 iframe 在
GitHub 等设置了严格 `frame-src` / `X-Frame-Options` 的站点上也能正常嵌入。

> 油猴脚本 `public/floating-notes.user.js` 仍然保留,给装了 Tampermonkey 的用户使用;
> 本扩展是面向「只想装一个东西、开箱即用」的用户的独立替代品。

## 目录结构

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | MV3 清单。版本号与 `client/widget/entry.tsx` 的 `WIDGET_VERSION` 同步 |
| `rules.json` | 静态 DNR 规则:对所有 `main_frame` / `sub_frame` 移除 `Content-Security-Policy`、`Content-Security-Policy-Report-Only`、`X-Frame-Options` |
| `background.js` | Service worker:读 `storage.sync` 黑名单,为每个黑名单域写 `allow`(优先级 2)动态规则,覆盖去 CSP,从而对这些站点保留原 CSP |
| `content-init.js` | 内容脚本,在 widget 包之后运行,调用 `window.FloatingNotes.init(...)` 注入 UI |
| `popup.html` / `popup.js` | 工具栏弹窗:显示当前站点状态,一键把当前域加入/移出黑名单 |
| `icons/` | 工具栏与商店图标(由 `scripts/build-icons.mjs` 生成) |
| `floating-notes-widget.js` | widget 大包,**构建产物**,由 `build:extension` 从 `public/embed/` 拷入(已 gitignore) |

## 构建

```bash
npm run build:widget      # 产出 public/embed/floating-notes-widget.js
npm run build:extension   # 拷贝 widget 包到 extension/ 并同步 manifest 版本
npm run build:icons       # (可选)重新生成图标 PNG
```

`npm run build` 会自动串起 `build:widget → build:extension`。

## 本地加载调试

1. 完成上面的构建(确保 `extension/floating-notes-widget.js` 存在)。
2. Chrome → `chrome://extensions` → 打开右上角「开发者模式」。
3. 「加载已解压的扩展程序」→ 选择本 `extension/` 目录。

## 打包分发

```bash
npm run pack:extension
```

会在 `dist/floating-notes-extension-<version>.zip` 生成可上传 Chrome 网上应用店的压缩包。

## 黑名单(豁免去 CSP)

默认对**所有站点**去除 CSP 以保证笔记面板可嵌入。若某站点(如网银)需保留其原有安全
策略,在该站点点击扩展图标 → 「加入黑名单」即可;该域名会被写入 `storage.sync`,
`background.js` 随即为其下发 `allow` 规则,对其不再改动响应头。

## 权限说明

- `host_permissions: <all_urls>` + 移除 CSP 属于**重权限**,会削弱所有访问站点的 XSS /
  点击劫持防护。上架商店时需在描述中明确用途,并引导用户对敏感站点使用黑名单。
- 内容脚本运行在隔离世界(isolated world),不受页面 `script-src` 限制,因此注入不会被
  宿主页 CSP 的脚本策略拦截。
