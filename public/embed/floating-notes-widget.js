(function () {
  "use strict";

  const DEFAULT_OPTIONS = {
    apiBase: "",
    trigger: "",
    floatButton: true,
    title: "笔记",
    autoInit: true
  };

  function createTrustedTypesPolicy() {
    if (!window.trustedTypes || typeof window.trustedTypes.createPolicy !== "function") {
      return null;
    }

    try {
      return window.trustedTypes.createPolicy("floating-notes-widget", {
        createHTML(value) {
          return value;
        }
      });
    } catch (error) {
      console.error("Floating Notes could not create a Trusted Types policy.", error);
      return null;
    }
  }

  const TRUSTED_TYPES_POLICY = createTrustedTypesPolicy();

  function trustedHtml(html) {
    return TRUSTED_TYPES_POLICY ? TRUSTED_TYPES_POLICY.createHTML(html) : html;
  }

  class FloatingNotesWidget {
    constructor(options) {
      this.options = {
        ...DEFAULT_OPTIONS,
        ...options
      };
      this.apiBase = String(this.options.apiBase || window.location.origin).replace(/\/$/, "");
      this.notes = [];
      this.currentIndex = null;
      this.currentNoteId = null;
      this.lastSelectedText = "";
      this.selectionNoteText = "";
      this.selectionTimer = 0;
      this.toastTimer = 0;
      this.isDark = true;
      this.particles = [];
      this.particleRaf = 0;
      this.lastToolbarAction = "";
      this.lastToolbarActionAt = 0;
      this.host = null;
      this.root = null;
      this.abortController = new AbortController();
    }

    mount() {
      if (this.host) {
        return this;
      }

      const mountParent = document.body || document.documentElement;
      this.host = document.createElement("floating-notes-widget");
      this.host.setAttribute("data-theme", "dark");
      mountParent.appendChild(this.host);
      this.root = this.host.attachShadow({ mode: "open" });
      this.root.innerHTML = trustedHtml(this.shellHtml());

      this.bindDom();
      this.setupCanvas();
      this.renderInitialCards();
      this.bindEvents();
      this.bindTriggers();
      this.fetchNotes();
      return this;
    }

    destroy() {
      this.abortController.abort();
      window.clearTimeout(this.selectionTimer);
      window.clearTimeout(this.toastTimer);
      if (this.particleRaf) {
        cancelAnimationFrame(this.particleRaf);
      }
      if (this.host) {
        this.host.remove();
      }
      this.host = null;
      this.root = null;
    }

    shellHtml() {
      const floatClass = this.options.floatButton ? "" : " hidden";
      return "" +
        "<style>" +
        ":host{--dst-bg:#0f0f11;--dst-bg-2:#18181b;--dst-bg-3:#27272a;--dst-border:rgba(255,255,255,.09);--dst-border-strong:rgba(255,255,255,.16);--dst-text:#f4f4f5;--dst-text-2:#a1a1aa;--dst-text-3:#71717a;--dst-accent:#6366f1;--dst-accent-2:#8b5cf6;--dst-cyan:#22d3ee;--dst-green:#34d399;--dst-card:#18181b;--dst-header:rgba(15,15,17,.92);--dst-shadow:0 20px 64px rgba(0,0,0,.56);--dst-radius:14px;--dst-font:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif;color-scheme:dark}" +
        ":host([data-theme=\"light\"]){--dst-bg:#f4f4f5;--dst-bg-2:#fff;--dst-bg-3:#e4e4e7;--dst-border:rgba(24,24,27,.09);--dst-border-strong:rgba(24,24,27,.15);--dst-text:#18181b;--dst-text-2:#52525b;--dst-text-3:#8a8a93;--dst-card:#fff;--dst-header:rgba(255,255,255,.92);--dst-shadow:0 18px 48px rgba(24,24,27,.14);color-scheme:light}" +
        "*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}button,textarea,input{font:inherit}button{padding:0}svg{display:block}.hidden,.dst-hidden{display:none!important}" +
        "#dst-float{position:fixed;right:20px;bottom:20px;z-index:2147483645;width:46px;height:46px;border:1px solid var(--dst-border-strong);border-radius:15px;background:var(--dst-bg-2);color:var(--dst-text);box-shadow:var(--dst-shadow);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .16s,background .16s,color .16s,border-color .16s}" +
        "#dst-float:hover{transform:translateY(-2px);border-color:rgba(99,102,241,.45);color:var(--dst-cyan)}#dst-float:active{transform:scale(.94)}#dst-float svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}" +
        "#dst-toolbar{position:fixed;z-index:2147483647;display:none;align-items:center;gap:1px;max-width:calc(100vw - 16px);padding:3px;border:1px solid var(--dst-border-strong);border-radius:8px;background:var(--dst-bg-2);box-shadow:none;transform:translateX(-50%);animation:dstToolPop .16s cubic-bezier(.34,1.56,.64,1);pointer-events:auto;font-family:var(--dst-font)}" +
        "#dst-toolbar.visible{display:flex}#dst-toolbar button{height:21px;display:inline-flex;align-items:center;justify-content:center;gap:3px;padding:0 8px;border:none;border-radius:5px;background:transparent;color:var(--dst-text);cursor:pointer;white-space:nowrap;font-size:8.5px;font-weight:650;line-height:1;transition:background .14s,color .14s,transform .1s,opacity .14s}" +
        "#dst-toolbar button:hover{background:rgba(255,255,255,.08)}:host([data-theme=\"light\"]) #dst-toolbar button:hover{background:rgba(24,24,27,.07)}#dst-toolbar button:active{transform:scale(.96)}#dst-toolbar .dst-primary{background:linear-gradient(135deg,var(--dst-accent),var(--dst-accent-2));color:#fff}#dst-toolbar .dst-primary:hover{opacity:.9;background:linear-gradient(135deg,var(--dst-accent),var(--dst-accent-2))}#dst-toolbar .dst-save{color:var(--dst-cyan)}#dst-toolbar svg{width:9px;height:9px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}.dst-divider{width:1px;height:11px;flex:0 0 auto;background:var(--dst-border-strong)}" +
        "@keyframes dstToolPop{from{opacity:0;transform:translateX(-50%) scale(.86)}to{opacity:1;transform:translateX(-50%) scale(1)}}" +
        "#dst-overlay{position:fixed;inset:0;z-index:2147483644;background:rgba(0,0,0,.34);opacity:0;pointer-events:none;transition:opacity .26s ease}#dst-overlay.show{opacity:1;pointer-events:auto}" +
        "#dst-drawer{position:fixed;top:0;right:0;z-index:2147483645;width:25vw;height:100vh;min-width:0;background:var(--dst-bg);border-left:1px solid var(--dst-border-strong);box-shadow:none;transform:translateX(100%);transition:transform .38s cubic-bezier(.16,1,.3,1);overflow:hidden;font-family:var(--dst-font)}#dst-drawer.open{transform:translateX(0)}.dst-mobile-handle{display:none}" +
        "#dst-canvas{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646}#dst-bottom-wormhole{position:fixed;left:0;right:0;bottom:0;height:4px;opacity:0;pointer-events:none;z-index:2147483646;background:linear-gradient(90deg,transparent,var(--dst-cyan),var(--dst-accent),var(--dst-accent-2),var(--dst-cyan),transparent);box-shadow:none;transition:opacity .18s,height .18s}#dst-bottom-wormhole.glow{height:6px;opacity:1;box-shadow:0 -6px 22px rgba(34,211,238,.8),0 0 42px rgba(99,102,241,.75);animation:dstBottomPulse .42s infinite alternate}@keyframes dstBottomPulse{from{box-shadow:0 -4px 16px rgba(34,211,238,.65),0 0 28px rgba(99,102,241,.55)}to{box-shadow:0 -8px 30px rgba(139,92,246,.78),0 0 48px rgba(34,211,238,.72)}}" +
        "#dst-right-wormhole{position:fixed;top:0;right:0;width:4px;height:100vh;opacity:0;pointer-events:none;z-index:2147483646;background:linear-gradient(180deg,transparent,var(--dst-cyan),var(--dst-accent),var(--dst-accent-2),transparent);box-shadow:none;transition:opacity .18s,width .18s}#dst-right-wormhole.glow{width:6px;opacity:1;box-shadow:0 0 18px rgba(34,211,238,.85),0 0 36px rgba(99,102,241,.78);animation:dstRightPulse .42s infinite alternate}" +
        ".dst-viewport{width:200%;height:100%;display:flex;background:var(--dst-bg);transition:transform .45s cubic-bezier(.16,1,.3,1)}.dst-viewport.show-notes{transform:translateX(-50%)}.dst-page{position:relative;width:50%;height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--dst-bg)}.notes-page{background:var(--dst-bg-3)}" +
        ".dst-header{height:56px;flex:0 0 56px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 14px;border-bottom:1px solid var(--dst-border);background:var(--dst-header);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}.dst-title{min-width:0;display:flex;align-items:center;gap:8px;color:var(--dst-text);font-size:15px;font-weight:760;line-height:1.2}.dst-title span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dst-dot{width:8px;height:8px;flex:0 0 auto;border-radius:50%;background:linear-gradient(135deg,var(--dst-accent),var(--dst-accent-2));box-shadow:0 0 8px rgba(99,102,241,.7)}.dst-dot.cyan{background:linear-gradient(135deg,var(--dst-cyan),var(--dst-accent));box-shadow:0 0 8px rgba(34,211,238,.62)}.dst-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto}" +
        ".dst-icon-btn,.dst-send-btn{border:none;cursor:pointer;color:var(--dst-text-2);transition:background .14s,color .14s,transform .1s,opacity .14s}.dst-icon-btn{position:relative;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border-radius:9px;background:var(--dst-bg-3)}.dst-icon-btn:hover{color:var(--dst-text);background:rgba(255,255,255,.1)}:host([data-theme=\"light\"]) .dst-icon-btn:hover{background:rgba(24,24,27,.08)}.dst-icon-btn:active,.dst-send-btn:active{transform:scale(.92)}.dst-icon-btn svg,.dst-send-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}" +
        "#dst-note-badge{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;display:none;align-items:center;justify-content:center;padding:0 5px;border-radius:9px;border:1.5px solid var(--dst-bg);background:linear-gradient(135deg,#ef4444,#f97316);color:#fff;font-size:10px;font-weight:800;line-height:17px}#dst-note-badge.pulse{display:inline-flex;animation:dstBadgePulse .34s cubic-bezier(.34,1.56,.64,1)}@keyframes dstBadgePulse{from{transform:scale(.25)}to{transform:scale(1)}}" +
        ".dst-chat-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:16px 13px;display:flex;flex-direction:column;gap:12px}.dst-chat-scroll::-webkit-scrollbar,#dst-notes-list::-webkit-scrollbar{width:4px}.dst-chat-scroll::-webkit-scrollbar-thumb,#dst-notes-list::-webkit-scrollbar-thumb{background:var(--dst-bg-3);border-radius:3px}.dst-chat-card{position:relative;overflow:hidden;background:var(--dst-card);border:1px solid var(--dst-border);border-radius:var(--dst-radius);box-shadow:0 10px 30px rgba(0,0,0,.22)}:host([data-theme=\"light\"]) .dst-chat-card{box-shadow:0 9px 22px rgba(24,24,27,.08)}#dst-notes-list{position:absolute;inset:56px 0 0;width:100%;background:var(--dst-bg-3);display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-y;transform:translateX(0);transition:transform .3s ease,opacity .3s ease;will-change:transform,opacity}.notes-page.detail-open #dst-notes-list{pointer-events:none;transform:translateX(-28%);opacity:.82}.state,.dst-notes-empty{margin:auto;padding:34px 18px;color:var(--dst-text-3);text-align:center;font-size:13px;line-height:1.7}" +
        ".dst-chat-card{padding:14px;border-left:3px solid var(--dst-accent)}.dst-chat-card.user{align-self:flex-end;border-left-color:var(--dst-cyan)}.dst-chat-card:before{content:\"\";position:absolute;inset:0;background:linear-gradient(135deg,rgba(99,102,241,.05),transparent 58%);pointer-events:none}.dst-card-label{position:relative;z-index:1;display:flex;align-items:center;gap:6px;margin-bottom:8px;color:var(--dst-accent);font-size:11px;font-weight:760;letter-spacing:.06em;text-transform:uppercase}.dst-card-label.cyan{color:var(--dst-cyan)}.dst-ai-dot{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 6px currentColor;animation:dstBlink 2s infinite}@keyframes dstBlink{0%,100%{opacity:1}50%{opacity:.34}}.dst-card-body{position:relative;z-index:1;margin:0;color:var(--dst-text);font-size:13.5px;line-height:1.62;white-space:pre-wrap;word-break:break-word}" +
        ".dst-save-note-btn{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;margin-top:12px;padding:0 11px;border-radius:8px;border:1px solid rgba(99,102,241,.3);background:rgba(99,102,241,.12);color:var(--dst-accent);cursor:pointer;font-size:12px;font-weight:720;transition:background .14s,border-color .14s,transform .1s}.dst-save-note-btn:hover{background:rgba(99,102,241,.2);border-color:rgba(99,102,241,.54)}.dst-save-note-btn:active{transform:scale(.96)}.dst-save-note-btn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}" +
        "#dst-wormhole-edge{position:absolute;top:0;right:0;width:4px;height:100%;opacity:0;pointer-events:none;z-index:4;background:linear-gradient(180deg,transparent,var(--dst-cyan),var(--dst-accent),var(--dst-accent-2),transparent);box-shadow:none;transition:opacity .18s,width .18s}#dst-wormhole-edge.glow{width:6px;opacity:1;box-shadow:0 0 18px rgba(34,211,238,.85),0 0 36px rgba(99,102,241,.78);animation:dstRightPulse .42s infinite alternate}@keyframes dstRightPulse{from{box-shadow:0 0 12px rgba(34,211,238,.68),0 0 24px rgba(99,102,241,.58)}to{box-shadow:0 0 24px rgba(34,211,238,.84),0 0 48px rgba(139,92,246,.78)}}" +
        ".dst-chat-input-bar{flex:0 0 auto;display:flex;align-items:flex-end;gap:9px;padding:12px 13px 16px;border-top:1px solid var(--dst-border);background:var(--dst-header);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}#dst-chat-input{flex:1 1 auto;min-width:0;min-height:40px;max-height:112px;height:40px;resize:none;outline:none;border:1px solid var(--dst-border-strong);border-radius:12px;background:var(--dst-bg-3);color:var(--dst-text);padding:9px 12px;font-size:13px;line-height:1.55;transition:border-color .14s,background .14s}#dst-chat-input:focus{border-color:rgba(99,102,241,.56)}#dst-chat-input::placeholder{color:var(--dst-text-3)}#dst-chat-input.flash{animation:dstInputFlash .42s ease-out}@keyframes dstInputFlash{0%{background:rgba(99,102,241,.18)}100%{background:var(--dst-bg-3)}}.dst-send-btn{width:40px;height:40px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;border-radius:12px;background:linear-gradient(135deg,var(--dst-accent),var(--dst-accent-2));color:#fff;box-shadow:0 6px 16px rgba(99,102,241,.34)}" +
        ".swipe-item{position:relative;width:100%;height:72px;flex:0 0 72px;overflow:hidden;border-bottom:1px solid var(--dst-border);background:var(--dst-bg-3);touch-action:pan-y}.actions{position:absolute;right:0;top:0;bottom:0;display:flex}.copy-btn,.delete-btn{width:72px;display:flex;align-items:center;justify-content:center;border:0;color:#fff;font-size:14px;font-weight:600;cursor:pointer;user-select:none}.copy-btn{background:var(--dst-green)}.delete-btn{background:#ef4444}.copy-btn:active,.delete-btn:active{filter:brightness(.92)}.note-item{position:relative;width:100%;height:72px;border:0;background:var(--dst-bg-2);padding:14px 18px;cursor:pointer;transition:transform .25s ease;user-select:none;text-align:left;display:block}.note-item.returning{transition:transform .3s ease}.note-title{font-size:18px;font-weight:700;color:var(--dst-text);margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.note-desc{font-size:13px;color:var(--dst-text-2);line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.add-item{height:72px;flex:0 0 72px;background:var(--dst-bg-3);display:flex;align-items:center;justify-content:center;cursor:pointer}.add-circle{width:28px;height:28px;display:flex;align-items:center;justify-content:center;transition:.2s;color:var(--dst-text-2)}.add-circle:hover{opacity:.78}.add-circle svg{width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}" +
        "#dst-note-detail{position:absolute;inset:56px 0 0;z-index:6;background:var(--dst-bg-2);display:flex;flex-direction:column;pointer-events:none;transform:translateX(100%);transition:transform .3s ease,opacity .3s ease;will-change:transform,opacity}.notes-page.detail-open #dst-note-detail{pointer-events:auto;transform:translateX(0)}.detail-header{height:64px;flex:0 0 64px;border-bottom:1px solid var(--dst-border);display:flex;align-items:center;gap:12px;padding:0 16px;background:var(--dst-header);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}.back-btn{width:34px;height:34px;border:0;border-radius:10px;background:var(--dst-bg-3);color:var(--dst-text-2);display:flex;align-items:center;justify-content:center;cursor:pointer}.back-btn:hover{color:var(--dst-text)}.detail-title{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dst-text);font-size:20px;font-weight:700}.detail-title::placeholder{color:var(--dst-text-3)}.save-btn{height:34px;padding:0 14px;border:0;border-radius:10px;background:var(--dst-text);color:var(--dst-bg);cursor:pointer;font-size:13px;font-weight:760}.detail-content{flex:1;min-height:0;border:0;outline:0;resize:none;padding:20px;background:var(--dst-bg-2);color:var(--dst-text);font-size:16px;line-height:1.8}.detail-content::placeholder{color:var(--dst-text-3)}" +
        ".dst-flying-paper{position:fixed;z-index:2147483646;display:flex;align-items:center;justify-content:center;gap:7px;padding:8px 12px;pointer-events:none;border:1.5px solid var(--dst-cyan);border-radius:10px;background:var(--dst-card);color:var(--dst-text-2);box-shadow:0 10px 26px rgba(34,211,238,.26);font-family:var(--dst-font);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transform-origin:center}.dst-paper-icon{width:12px;height:14px;flex:0 0 auto;border:1.5px solid var(--dst-cyan);border-radius:2px;position:relative}.dst-paper-icon:after{content:\"\";position:absolute;top:3px;left:2px;right:2px;height:1px;background:var(--dst-cyan);box-shadow:0 4px 0 rgba(34,211,238,.8)}#dst-toast{position:fixed;left:50%;top:50%;z-index:2147483647;display:none;transform:translate(-50%,-50%);padding:10px 18px;border:1px solid rgba(34,211,238,.35);border-radius:12px;background:rgba(15,15,17,.9);color:var(--dst-cyan);box-shadow:0 14px 40px rgba(0,0,0,.34);font-family:var(--dst-font);font-size:13px;font-weight:760;pointer-events:none}#dst-toast.show{display:block;animation:dstToast .82s ease forwards}@keyframes dstToast{0%{opacity:0;transform:translate(-50%,-56%) scale(.88)}18%{opacity:1;transform:translate(-50%,-50%) scale(1)}74%{opacity:1}100%{opacity:0;transform:translate(-50%,-44%) scale(.96)}}" +
        "@media (max-width:1024px){#dst-drawer{width:34vw}}@media (max-width:767px),(pointer:coarse){#dst-float{right:16px;bottom:16px;width:46px;height:46px}#dst-drawer{top:auto;right:0;bottom:0;left:0;width:100vw;height:66.666vh;border-left:none;border-top:1px solid var(--dst-border-strong);border-radius:20px 20px 0 0;transform:translateY(100%)}#dst-drawer.open{transform:translateY(0)}.dst-mobile-handle{display:block;width:38px;height:4px;flex:0 0 auto;margin:10px auto 2px;border-radius:4px;background:var(--dst-bg-3)}.dst-header{height:50px;flex-basis:50px;padding:0 16px}.dst-chat-scroll{padding:14px}.dst-chat-input-bar{padding:10px 14px max(14px,env(safe-area-inset-bottom))}#dst-toolbar button{padding:0 8px}}" +
        "</style>" +
        "<button type=\"button\" id=\"dst-float\" class=\"" + floatClass + "\" aria-label=\"打开笔记\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z\"/></svg></button>" +
        "<canvas id=\"dst-canvas\"></canvas><div id=\"dst-bottom-wormhole\"></div><div id=\"dst-right-wormhole\"></div><div id=\"dst-overlay\"></div>" +
        "<div id=\"dst-toolbar\" aria-label=\"选中文字工具条\"><button type=\"button\" class=\"dst-primary\" id=\"dst-toolbar-ask\" title=\"问 AI\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\"/></svg>问AI</button><span class=\"dst-divider\" aria-hidden=\"true\"></span><button type=\"button\" id=\"dst-toolbar-copy\" title=\"复制\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"9\" y=\"9\" width=\"13\" height=\"13\" rx=\"2\"/><path d=\"M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1\"/></svg>复制</button><span class=\"dst-divider\" aria-hidden=\"true\"></span><button type=\"button\" class=\"dst-save\" id=\"dst-toolbar-save\" title=\"存笔记\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z\"/><polyline points=\"17 21 17 13 7 13 7 21\"/><polyline points=\"7 3 7 8 15 8\"/></svg>笔记</button></div>" +
        "<aside id=\"dst-drawer\" aria-label=\"DeepSeek Typora 抽屉\"><div class=\"dst-mobile-handle\"></div><div class=\"dst-viewport\" id=\"dst-viewport\"><section class=\"dst-page\" aria-label=\"DeepSeek 智聊\"><header class=\"dst-header\"><div class=\"dst-title\"><span class=\"dst-dot\"></span><span>DeepSeek 智聊</span></div><div class=\"dst-actions\"><button type=\"button\" class=\"dst-icon-btn\" id=\"dst-theme-chat\" title=\"切换主题\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z\"/></svg></button><button type=\"button\" class=\"dst-icon-btn\" id=\"dst-open-notes\" title=\"笔记\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"14 2 14 8 20 8\"/><line x1=\"16\" y1=\"13\" x2=\"8\" y2=\"13\"/><line x1=\"16\" y1=\"17\" x2=\"8\" y2=\"17\"/></svg><span id=\"dst-note-badge\">0</span></button><button type=\"button\" class=\"dst-icon-btn\" id=\"dst-close-chat\" title=\"关闭\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg></button></div></header><div class=\"dst-chat-scroll\" id=\"dst-chat-scroll\"><div id=\"dst-wormhole-edge\"></div></div><div class=\"dst-chat-input-bar\"><textarea id=\"dst-chat-input\" rows=\"1\" placeholder=\"选中文字点「问AI」，内容会放到这里，可继续补充问题\"></textarea><button type=\"button\" class=\"dst-send-btn\" id=\"dst-send\" title=\"发送\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><line x1=\"22\" y1=\"2\" x2=\"11\" y2=\"13\"/><polygon points=\"22 2 15 22 11 13 2 9 22 2\"/></svg></button></div></section>" +
        "<section class=\"dst-page notes-page\" id=\"dst-notes-page\" aria-label=\"笔记\"><header class=\"dst-header\"><div class=\"dst-title\"><span class=\"dst-dot cyan\"></span><span>笔记</span></div><div class=\"dst-actions\"><button type=\"button\" class=\"dst-icon-btn\" id=\"dst-theme-notes\" title=\"切换主题\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z\"/></svg></button><button type=\"button\" class=\"dst-icon-btn\" id=\"dst-back-chat\" title=\"回到 AI\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\"/></svg></button><button type=\"button\" class=\"dst-icon-btn\" id=\"dst-close-notes\" title=\"关闭\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg></button></div></header><div id=\"dst-notes-list\"></div><section class=\"detail-page\" id=\"dst-note-detail\" aria-label=\"编辑笔记\"><div class=\"detail-header\"><button type=\"button\" class=\"back-btn\" id=\"dst-note-back\" aria-label=\"返回\">←</button><input class=\"detail-title\" id=\"dst-note-title-input\" placeholder=\"输入标题\"><button type=\"button\" class=\"save-btn\" id=\"dst-note-save\">保存</button></div><textarea class=\"detail-content\" id=\"dst-note-content-input\" placeholder=\"输入内容...\"></textarea></section></section></div></aside><div id=\"dst-toast\" role=\"status\" aria-live=\"polite\"></div>";
    }

    bindDom() {
      const $ = (id) => this.root.getElementById(id);
      this.floatButton = $("dst-float");
      this.toolbar = $("dst-toolbar");
      this.askButton = $("dst-toolbar-ask");
      this.copyButton = $("dst-toolbar-copy");
      this.saveButton = $("dst-toolbar-save");
      this.overlay = $("dst-overlay");
      this.drawer = $("dst-drawer");
      this.viewport = $("dst-viewport");
      this.notesPage = $("dst-notes-page");
      this.chatScroll = $("dst-chat-scroll");
      this.notesList = $("dst-notes-list");
      this.chatInput = $("dst-chat-input");
      this.sendButton = $("dst-send");
      this.badge = $("dst-note-badge");
      this.canvas = $("dst-canvas");
      this.ctx = this.canvas.getContext("2d");
      this.toast = $("dst-toast");
      this.bottomWormhole = $("dst-bottom-wormhole");
      this.globalRightWormhole = $("dst-right-wormhole");
      this.rightWormhole = $("dst-wormhole-edge");
      this.detailPage = $("dst-note-detail");
      this.detailTitle = $("dst-note-title-input");
      this.detailContent = $("dst-note-content-input");
      this.detailBackButton = $("dst-note-back");
      this.detailSaveButton = $("dst-note-save");
    }

    bindEvents() {
      const signal = this.abortController.signal;
      document.addEventListener("selectionchange", () => this.handleSelectionChange(), { signal });
      document.addEventListener("mousedown", (event) => this.handleOutsidePointerDown(event), { capture: true, signal });
      document.addEventListener("touchstart", (event) => this.handleOutsidePointerDown(event), { capture: true, passive: true, signal });
      window.addEventListener("resize", () => {
        this.setupCanvas();
        this.hideToolbar();
      }, { signal });

      this.floatButton.addEventListener("click", () => this.open("notes"));
      this.bindToolbarActions();

      this.overlay.addEventListener("click", () => this.close());
      this.root.getElementById("dst-close-chat").addEventListener("click", () => this.close());
      this.root.getElementById("dst-open-notes").addEventListener("click", () => {
        this.switchPage("notes");
        this.fetchNotes();
      });
      this.root.getElementById("dst-theme-chat").addEventListener("click", () => this.toggleTheme());
      this.root.getElementById("dst-close-notes").addEventListener("click", () => this.close());
      this.root.getElementById("dst-back-chat").addEventListener("click", () => {
        this.closeDetail();
        this.switchPage("chat");
      });
      this.root.getElementById("dst-theme-notes").addEventListener("click", () => this.toggleTheme());
      this.detailBackButton.addEventListener("click", () => this.closeDetail());
      this.detailSaveButton.addEventListener("click", () => this.saveDetailNote());
      this.sendButton.addEventListener("click", () => this.sendMessage());
      this.chatInput.addEventListener("input", () => this.autoResize(this.chatInput));
      this.chatInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          this.sendMessage();
        }
      });
      this.chatScroll.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const button = target ? target.closest("[data-save-chat-note]") : null;
        if (!button) {
          return;
        }
        const card = button.closest(".dst-chat-card");
        if (!card) {
          return;
        }
        const body = card.querySelector(".dst-card-body")?.textContent.trim() || "";
        const title = button.dataset.title || this.makeTitle(body);
        this.animateChatSave(card, title, body);
      });
    }

    bindTriggers() {
      const signal = this.abortController.signal;
      const triggerSelectors = [
        this.options.trigger,
        "[data-floating-notes-trigger]"
      ].filter(Boolean);

      triggerSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((element) => {
          element.addEventListener("click", (event) => {
            event.preventDefault();
            this.open("notes");
          }, { signal });
        });
      });
    }

    get initialCards() {
      return [
        {
          label: "AI",
          body: "这是一个划词抽屉笔记界面。选中网页文字后，问AI 会打开响应式抽屉，笔记 会沿当前端侧方向触发闪光并保存到后端笔记。",
          title: "划词笔记抽屉交互"
        },
        {
          label: "AI",
          body: "AI 页面里的「存为笔记」会跟随抽屉方向沉淀到笔记页：PC 走右侧虫洞，移动端走底部虫洞。",
          title: "响应式存笔记动效"
        },
        {
          label: "AI",
          body: "移动端抽屉从屏幕底部向上出现，宽度占满屏幕，高度为屏幕的三分之二；PC 端抽屉从右侧滑入，高度占满屏幕，宽度为屏幕四分之一。",
          title: "PC 与移动端抽屉规则"
        }
      ];
    }

    async request(path, options = {}) {
      const response = await fetch(this.apiBase + path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });

      if (!response.ok) {
        throw new Error("Floating Notes request failed: " + response.status);
      }

      return response.json();
    }

    async fetchNotes() {
      try {
        this.renderNotesState("加载中...");
        this.notes = await this.request("/notes");
        this.renderNotes();
        this.updateBadge(false);
      } catch (error) {
        this.renderNotesState("笔记加载失败，请确认后端服务已启动");
        console.error(error);
      }
    }

    renderInitialCards() {
      this.initialCards.forEach((item) => this.appendChatCard({
        label: item.label,
        body: item.body,
        title: item.title,
        save: true
      }));
    }

    handleSelectionChange() {
      window.clearTimeout(this.selectionTimer);
      this.selectionTimer = window.setTimeout(() => {
        const selection = window.getSelection();
        const text = selection ? selection.toString().trim() : "";

        if (!selection || !selection.rangeCount || !text) {
          this.hideToolbar();
          return;
        }

        if (this.isWidgetNode(selection.anchorNode) || this.isWidgetNode(selection.focusNode)) {
          this.hideToolbar();
          return;
        }

        const rect = this.getSelectionRect(selection);
        if (!rect) {
          this.hideToolbar();
          return;
        }

        this.lastSelectedText = text;
        this.selectionNoteText = text;
        this.showToolbar(rect);
      }, 110);
    }

    handleOutsidePointerDown(event) {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (path.includes(this.toolbar) || path.includes(this.drawer) || path.includes(this.floatButton)) {
        return;
      }
      this.hideToolbar();
    }

    showToolbar(rect) {
      const widthGuess = 155;
      const left = this.clamp(rect.left + rect.width / 2, 8 + widthGuess / 2, window.innerWidth - 8 - widthGuess / 2);
      const toolbarHeight = 29;
      const top = rect.bottom + 8;
      this.toolbar.style.left = left + "px";
      this.toolbar.style.top = this.clamp(top, 8, window.innerHeight - 8 - toolbarHeight) + "px";
      this.toolbar.classList.add("visible");
    }

    hideToolbar() {
      this.toolbar.classList.remove("visible");
    }

    clearToolbarState() {
      this.hideToolbar();
      this.lastSelectedText = "";
      this.selectionNoteText = "";
    }

    getToolbarSelectedText() {
      const selection = window.getSelection();
      const selectedText = selection ? selection.toString().trim() : "";
      return selectedText || this.lastSelectedText;
    }

    bindToolbarActions() {
      const bind = (type, options) => {
        this.toolbar.addEventListener(type, (event) => this.handleToolbarAction(event), options);
      };

      bind("pointerdown", { capture: true });
      bind("mousedown", { capture: true });
      bind("touchstart", { capture: true, passive: false });
      bind("click", { capture: true });
    }

    handleToolbarAction(event) {
      const action = this.getToolbarAction(event);
      if (!action) {
        return;
      }

      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }

      const now = Date.now();
      if (this.lastToolbarAction === action && now - this.lastToolbarActionAt < 600) {
        return;
      }
      this.lastToolbarAction = action;
      this.lastToolbarActionAt = now;

      const text = action === "save" ? this.selectionNoteText : this.getToolbarSelectedText();
      if (!text) {
        this.showToast("未获取到选中文字");
        return;
      }

      if (action === "ask") {
        this.openDrawerWithText(text);
        this.clearToolbarState();
        return;
      }

      if (action === "copy") {
        this.copyText(text).then(() => this.showToast("已复制")).catch(() => this.showToast("复制失败"));
        this.clearToolbarState();
        return;
      }

      this.hideToolbar();
      this.saveSelectionNote(text).finally(() => {
        if (this.selectionNoteText === text) {
          this.selectionNoteText = "";
        }
        if (this.lastSelectedText === text) {
          this.lastSelectedText = "";
        }
      });
    }

    getToolbarAction(event) {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (path.includes(this.askButton)) {
        return "ask";
      }
      if (path.includes(this.copyButton)) {
        return "copy";
      }
      if (path.includes(this.saveButton)) {
        return "save";
      }

      const target = event.target instanceof Element ? event.target : null;
      const button = target ? target.closest("button") : null;
      if (button === this.askButton) {
        return "ask";
      }
      if (button === this.copyButton) {
        return "copy";
      }
      return button === this.saveButton ? "save" : "";
    }

    open(page = "notes") {
      this.switchPage(page);
      this.drawer.classList.add("open");
      this.overlay.classList.add("show");
      if (page === "notes") {
        this.fetchNotes();
      }
    }

    close() {
      this.drawer.classList.remove("open");
      this.overlay.classList.remove("show");
      this.closeDetail();
    }

    toggle() {
      if (this.drawer.classList.contains("open")) {
        this.close();
      } else {
        this.open("notes");
      }
    }

    openDrawerWithText(text) {
      this.open("chat");
      const prefix = "【选中内容】" + text + "\n\n";
      this.chatInput.value = prefix + this.chatInput.value;
      this.autoResize(this.chatInput);
      this.flashInput();
      window.setTimeout(() => {
        this.chatInput.focus({ preventScroll: true });
        this.chatInput.setSelectionRange(this.chatInput.value.length, this.chatInput.value.length);
      }, 260);
    }

    switchPage(target) {
      this.viewport.classList.toggle("show-notes", target === "notes");
    }

    toggleTheme() {
      this.isDark = !this.isDark;
      this.host.setAttribute("data-theme", this.isDark ? "dark" : "light");
    }

    sendMessage() {
      const text = this.chatInput.value.trim();
      if (!text) {
        return;
      }

      this.appendChatCard({
        label: "You",
        body: text,
        user: true,
        save: false
      });
      this.chatInput.value = "";
      this.autoResize(this.chatInput);
      this.scrollChatToBottom();

      window.setTimeout(() => {
        const answer = this.buildDemoAnswer(text);
        this.appendChatCard({
          label: "AI",
          body: answer,
          title: this.makeTitle(answer),
          save: true
        });
        this.scrollChatToBottom();
      }, 260);
    }

    buildDemoAnswer(text) {
      const compact = text.replace(/\s+/g, " ").slice(0, 80);
      return "我已读取这段内容：「" + compact + (text.length > 80 ? "..." : "") + "」。\n\n可以先沉淀成三类笔记：核心结论、可执行动作、后续追问。点击下方「存为笔记」会跟随当前抽屉方向写入笔记。";
    }

    appendChatCard({ label, body, title, save, user }) {
      const card = document.createElement("article");
      card.className = "dst-chat-card" + (user ? " user" : "");

      const labelEl = document.createElement("div");
      labelEl.className = "dst-card-label" + (user ? " cyan" : "");
      if (!user) {
        const dot = document.createElement("span");
        dot.className = "dst-ai-dot";
        labelEl.appendChild(dot);
      }
      labelEl.appendChild(document.createTextNode(label));

      const bodyEl = document.createElement("p");
      bodyEl.className = "dst-card-body";
      bodyEl.textContent = body;

      card.append(labelEl, bodyEl);

      if (save) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dst-save-note-btn";
        button.dataset.saveChatNote = "1";
        button.dataset.title = title || this.makeTitle(body);
        button.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z\"/><polyline points=\"17 21 17 13 7 13 7 21\"/><polyline points=\"7 3 7 8 15 8\"/></svg>存为笔记";
        card.appendChild(button);
      }

      this.chatScroll.appendChild(card);
      return card;
    }

    animateChatSave(card, title, body) {
      const edge = this.getSaveEdge();
      const rect = card.getBoundingClientRect();
      const paper = document.createElement("div");
      paper.className = "dst-flying-paper";
      paper.innerHTML = "<span class=\"dst-paper-icon\" aria-hidden=\"true\"></span><span></span>";
      paper.lastElementChild.textContent = title;
      paper.style.left = rect.left + "px";
      paper.style.top = rect.top + "px";
      paper.style.width = Math.max(120, Math.min(rect.width, 280)) + "px";
      paper.style.height = Math.min(rect.height, 50) + "px";
      this.root.appendChild(paper);

      const wormhole = edge === "right" ? this.rightWormhole : this.bottomWormhole;
      wormhole.classList.add("glow");
      const drawerRect = this.drawer.getBoundingClientRect();
      const targetX = edge === "right" ? drawerRect.right - 8 : window.innerWidth / 2;
      const targetY = edge === "right" ? drawerRect.top + drawerRect.height / 2 : window.innerHeight - 8;

      requestAnimationFrame(() => {
        paper.style.transition = "all .42s cubic-bezier(.25,1,.5,1)";
        paper.style.left = targetX + "px";
        paper.style.top = targetY + "px";
        paper.style.opacity = "0";
        paper.style.transform = "rotateX(70deg) rotateY(16deg) scale(.05)";
      });

      window.setTimeout(() => this.spawnParticles(targetX, targetY, 30, edge), 180);
      window.setTimeout(async () => {
        paper.remove();
        wormhole.classList.remove("glow");
        try {
          await this.createBackendNote(title, body);
          this.showToast("已存入笔记");
        } catch (error) {
          this.showToast("保存失败");
          console.error(error);
        }
      }, 460);
    }

    async saveSelectionNote(text) {
      const content = String(text || "").trim();
      if (!content) {
        return;
      }

      const edge = this.getSaveEdge();
      const wormhole = edge === "right" ? this.globalRightWormhole : this.bottomWormhole;
      const targetX = edge === "right" ? window.innerWidth - 8 : window.innerWidth / 2;
      const targetY = edge === "right" ? window.innerHeight / 2 : window.innerHeight - 8;
      wormhole.classList.add("glow");
      this.spawnParticles(targetX, targetY, 28, edge);

      window.setTimeout(async () => {
        wormhole.classList.remove("glow");
        try {
          await this.createBackendNote(this.makeSelectionTitle(content), content);
          this.showToast("已存入笔记");
        } catch (error) {
          this.showToast("保存失败");
          console.error(error);
        }
      }, 430);
    }

    async createBackendNote(title, content) {
      const note = await this.request("/notes", {
        method: "POST",
        body: JSON.stringify({ title, content })
      });
      await this.fetchNotes();
      this.updateBadge(true);
      return note;
    }

    renderNotesState(message) {
      this.notesList.replaceChildren();
      const state = document.createElement("div");
      state.className = "state dst-notes-empty";
      state.textContent = message;
      this.notesList.appendChild(state);
    }

    renderNotes() {
      this.notesList.replaceChildren();
      if (!this.notes.length) {
        this.renderNotesState("暂无笔记");
        return;
      }

      this.notes.forEach((note, index) => {
        const item = document.createElement("div");
        item.className = "swipe-item";

        const actions = document.createElement("div");
        actions.className = "actions";

        const copyButton = document.createElement("button");
        copyButton.className = "copy-btn";
        copyButton.type = "button";
        copyButton.textContent = "复制";

        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-btn";
        deleteButton.type = "button";
        deleteButton.textContent = "删除";

        const noteItem = document.createElement("button");
        noteItem.className = "note-item";
        noteItem.type = "button";

        const title = document.createElement("div");
        title.className = "note-title";
        title.textContent = note.title || "未命名";

        const desc = document.createElement("div");
        desc.className = "note-desc";
        desc.textContent = note.content || "";

        actions.append(copyButton, deleteButton);
        noteItem.append(title, desc);
        item.append(actions, noteItem);
        this.notesList.appendChild(item);

        noteItem.addEventListener("click", () => {
          if (this.isSwipedOpen(noteItem)) {
            this.resetSwipeNow(noteItem);
            return;
          }

          this.openDetail(index);
        });
        copyButton.addEventListener("click", async (event) => {
          event.stopPropagation();
          try {
            await this.copyText(note.content || "");
            this.showToast("✅ 复制成功");
            await this.resetSwipeNow(noteItem);
          } catch (error) {
            this.showToast("复制失败");
          }
        });
        deleteButton.addEventListener("click", async (event) => {
          event.stopPropagation();
          await this.deleteNote(index);
        });

        this.addSwipe(noteItem);
      });

      const add = document.createElement("div");
      add.className = "add-item";
      const addCircle = document.createElement("button");
      addCircle.className = "add-circle";
      addCircle.type = "button";
      addCircle.setAttribute("aria-label", "新增笔记");
      addCircle.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><line x1=\"12\" y1=\"8\" x2=\"12\" y2=\"16\"/><line x1=\"8\" y1=\"12\" x2=\"16\" y2=\"12\"/></svg>";
      addCircle.addEventListener("click", () => this.createNote());
      add.appendChild(addCircle);
      this.notesList.appendChild(add);
    }

    getTranslateX(noteItem) {
      const match = noteItem.style.transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
      return match ? Number(match[1]) : 0;
    }

    isSwipedOpen(noteItem) {
      return this.getTranslateX(noteItem) < 0;
    }

    addSwipe(note) {
      let startX = 0;
      let startY = 0;
      let currentX = 0;
      let startTranslateX = 0;
      let translateX = 0;
      let isSwiping = false;
      let isVerticalScroll = false;
      const threshold = 15;

      note.addEventListener("touchstart", (event) => {
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
        currentX = startX;
        startTranslateX = this.getTranslateX(note);
        translateX = startTranslateX;
        isSwiping = false;
        isVerticalScroll = false;
      }, { passive: true });

      note.addEventListener("touchmove", (event) => {
        currentX = event.touches[0].clientX;
        const diff = currentX - startX;
        const diffY = event.touches[0].clientY - startY;
        let nextTranslateX = startTranslateX + diff;

        if (isVerticalScroll) {
          return;
        }

        if (!isSwiping && Math.abs(diffY) > threshold && Math.abs(diffY) > Math.abs(diff)) {
          isVerticalScroll = true;
          return;
        }

        if (!isSwiping && Math.abs(diff) > threshold && Math.abs(diff) > Math.abs(diffY)) {
          isSwiping = true;
        }

        if (!isSwiping) {
          return;
        }

        event.preventDefault();

        if (nextTranslateX > 0) {
          nextTranslateX = 0;
        }

        if (nextTranslateX < -144) {
          nextTranslateX = -144;
        }

        translateX = nextTranslateX;
        note.style.transform = "translateX(" + translateX + "px)";
      }, { passive: false });

      note.addEventListener("touchend", () => {
        if (!isSwiping) {
          return;
        }

        translateX = translateX < -60 ? -144 : 0;
        note.style.transform = "translateX(" + translateX + "px)";
      });
    }

    createNote() {
      this.currentIndex = null;
      this.currentNoteId = null;
      this.detailTitle.value = "";
      this.detailContent.value = "";
      this.showDetailPage();
    }

    openDetail(index) {
      this.switchPage("notes");
      this.currentIndex = index;
      const note = this.notes[index];
      this.currentNoteId = note ? note.id : null;
      this.detailTitle.value = note.title || "";
      this.detailContent.value = note.content || "";
      this.showDetailPage();
    }

    showDetailPage() {
      this.detailPage.classList.add("show");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.notesPage.classList.add("detail-open");
        });
      });
    }

    closeDetail() {
      this.detailPage.classList.remove("show");
      this.notesPage.classList.remove("detail-open");
    }

    async saveDetailNote() {
      const title = this.detailTitle.value.trim();
      const content = this.detailContent.value.trim();

      if (!title) {
        window.alert("请输入标题");
        return;
      }

      try {
        if (this.currentIndex === null) {
          await this.request("/notes", {
            method: "POST",
            body: JSON.stringify({ title, content })
          });
        } else {
          const note = this.notes[this.currentIndex];
          await this.request("/notes/" + encodeURIComponent(note.id), {
            method: "PUT",
            body: JSON.stringify({ title, content })
          });
        }

        await this.fetchNotes();
        this.closeDetail();
        this.showToast("已保存");
      } catch (error) {
        this.showToast("保存失败");
        console.error(error);
      }
    }

    async deleteNote(index) {
      const note = this.notes[index];

      try {
        await this.request("/notes/" + encodeURIComponent(note.id), { method: "DELETE" });
        this.showToast("✅ 删除成功");
        await this.fetchNotes();
      } catch (error) {
        this.showToast("删除失败");
        console.error(error);
      }
    }

    resetSwipeNow(noteItem) {
      return new Promise((resolve) => {
        noteItem.classList.add("returning");
        noteItem.style.transform = "translateX(0px)";

        window.setTimeout(() => {
          noteItem.classList.remove("returning");
          resolve();
        }, 300);
      });
    }

    updateBadge(animate) {
      if (!this.notes.length) {
        this.badge.style.display = "none";
        this.badge.textContent = "0";
        return;
      }
      this.badge.textContent = String(this.notes.length > 99 ? "99+" : this.notes.length);
      this.badge.style.display = "inline-flex";
      if (animate) {
        this.badge.classList.remove("pulse");
        void this.badge.offsetWidth;
        this.badge.classList.add("pulse");
      }
    }

    getSaveEdge() {
      return this.isMobile() ? "bottom" : "right";
    }

    setupCanvas() {
      const ratio = window.devicePixelRatio || 1;
      this.canvas.width = Math.floor(window.innerWidth * ratio);
      this.canvas.height = Math.floor(window.innerHeight * ratio);
      this.canvas.style.width = window.innerWidth + "px";
      this.canvas.style.height = window.innerHeight + "px";
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    spawnParticles(x, y, count, edge) {
      for (let i = 0; i < count; i += 1) {
        const speed = 2.5 + Math.random() * 5.2;
        const angle = edge === "right" ? (Math.random() * Math.PI * 0.68) - Math.PI * 0.34 : (Math.random() * Math.PI * 0.72) + Math.PI * 0.14;
        const hue = Math.random() > 0.48 ? 245 : 186;
        this.particles.push({
          x,
          y,
          vx: edge === "right" ? Math.cos(angle) * speed : (Math.random() - 0.5) * speed,
          vy: edge === "bottom" ? Math.abs(Math.sin(angle) * speed) + 1.5 : Math.sin(angle) * speed,
          life: 1,
          decay: 0.02 + Math.random() * 0.022,
          size: 2 + Math.random() * 3,
          hue
        });
      }
      if (!this.particleRaf) {
        this.particleRaf = requestAnimationFrame(() => this.drawParticles());
      }
    }

    drawParticles() {
      this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      this.particles = this.particles.filter((particle) => particle.life > 0);
      this.particles.forEach((particle) => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.962;
        particle.vy *= 0.962;
        particle.life -= particle.decay;
        const radius = Math.max(0.01, particle.size * Math.max(0, particle.life));
        this.ctx.save();
        this.ctx.globalAlpha = Math.max(0, particle.life);
        this.ctx.fillStyle = "hsl(" + particle.hue + ", 90%, 70%)";
        this.ctx.shadowColor = "hsl(" + particle.hue + ", 90%, 70%)";
        this.ctx.shadowBlur = 7;
        this.ctx.beginPath();
        this.ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
      });
      if (this.particles.length) {
        this.particleRaf = requestAnimationFrame(() => this.drawParticles());
      } else {
        this.particleRaf = 0;
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    }

    copyText(text) {
      if (typeof window.GM_setClipboard === "function") {
        window.GM_setClipboard(text, "text");
        return Promise.resolve();
      }
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        return navigator.clipboard.writeText(text).catch(() => this.fallbackCopy(text));
      }
      return this.fallbackCopy(text);
    }

    fallbackCopy(text) {
      return new Promise((resolve, reject) => {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "readonly");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.select();
        try {
          const ok = document.execCommand("copy");
          textarea.remove();
          ok ? resolve() : reject(new Error("copy failed"));
        } catch (error) {
          textarea.remove();
          reject(error);
        }
      });
    }

    showToast(message) {
      window.clearTimeout(this.toastTimer);
      this.toast.textContent = message;
      this.toast.classList.remove("show");
      void this.toast.offsetWidth;
      this.toast.classList.add("show");
      this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), 840);
    }

    flashInput() {
      this.chatInput.classList.remove("flash");
      void this.chatInput.offsetWidth;
      this.chatInput.classList.add("flash");
    }

    autoResize(element) {
      element.style.height = "40px";
      element.style.height = Math.min(element.scrollHeight, 112) + "px";
    }

    scrollChatToBottom() {
      this.chatScroll.scrollTop = this.chatScroll.scrollHeight;
    }

    getSelectionRect(selection) {
      try {
        const range = selection.getRangeAt(0);
        const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
        const rect = rects[0] || range.getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) {
          return null;
        }
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
      } catch (error) {
        return null;
      }
    }

    isWidgetNode(node) {
      if (!node) {
        return false;
      }
      const root = typeof node.getRootNode === "function" ? node.getRootNode() : null;
      return root === this.root || node === this.host || this.host.contains(node);
    }

    isMobile() {
      return window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
    }

    makeTitle(text) {
      const firstLine = String(text || "").trim().split(/\n+/)[0] || "新笔记";
      return firstLine.length > 30 ? firstLine.slice(0, 30) + "..." : firstLine;
    }

    makeSelectionTitle(text) {
      const normalized = String(text || "").trim().replace(/\s+/g, " ");
      const prefix = Array.from(normalized).slice(0, 10).join("") || "新笔记";
      return prefix + "...";
    }

    formatTime(value) {
      const date = value ? new Date(value) : new Date();
      if (Number.isNaN(date.getTime())) {
        return "刚刚";
      }
      return date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }
  }

  function resolveScriptOptions() {
    const script = document.currentScript;
    if (!script) {
      return {};
    }
    return {
      apiBase: script.dataset.apiBase || new URL(script.src).origin,
      trigger: script.dataset.trigger || "",
      floatButton: script.dataset.floatButton !== "false",
      title: script.dataset.title || "笔记",
      autoInit: script.dataset.autoInit !== "false"
    };
  }

  function init(options) {
    const widget = new FloatingNotesWidget(options || {});
    if (document.body) {
      widget.mount();
    } else {
      document.addEventListener("DOMContentLoaded", () => widget.mount(), { once: true });
    }
    return widget;
  }

  const scriptOptions = resolveScriptOptions();
  window.FloatingNotes = {
    init,
    Widget: FloatingNotesWidget
  };

  if (scriptOptions.autoInit) {
    window.FloatingNotes.instance = init(scriptOptions);
  }
})();
