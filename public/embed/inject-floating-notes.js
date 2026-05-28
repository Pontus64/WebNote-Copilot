(function () {
  // 这个文件是给普通网页用的一行嵌入入口：
  // <script src="https://notes.edmund.xin/embed/inject-floating-notes.js"></script>
  // 它本身不画笔记 UI，只负责读取配置、加载真正的 widget 脚本，然后初始化 widget。
  const GLOBAL_CONFIG_NAME = "FloatingNotesInjectConfig";
  const WIDGET_SCRIPT_ID = "floating-notes-widget-script";
  const DEFAULT_TITLE = "笔记";

  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function normalizeBase(value) {
    return String(value || "").replace(/\/$/, "");
  }

  function scriptOrigin(script) {
    if (!script || !script.src) {
      return "";
    }

    try {
      // 如果脚本来自 https://notes.edmund.xin/embed/inject-floating-notes.js，
      // 这里会得到 https://notes.edmund.xin，后面用它拼 API 和 widget 地址。
      return new URL(script.src, window.location.href).origin;
    } catch {
      return "";
    }
  }

  function readBoolean(value, fallback) {
    if (typeof value === "boolean") {
      return value;
    }

    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    return String(value).toLowerCase() !== "false";
  }

  function readString(value, fallback) {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    return String(value);
  }

  function createTrustedScriptUrl(url) {
    // 有些网页开启了 Trusted Types CSP，直接给 script.src 赋值会被拦截。
    // 这里创建一个允许当前脚本注入 widget URL 的策略，兼容更严格的网页安全配置。
    if (!window.trustedTypes || typeof window.trustedTypes.createPolicy !== "function") {
      return url;
    }

    const policyName = "floating-notes-injector";

    try {
      const policy = window.trustedTypes.createPolicy(policyName, {
        createScriptURL(value) {
          return value;
        }
      });

      return policy.createScriptURL(url);
    } catch (error) {
      console.error(
        "Floating notes injector could not create a Trusted Types policy. This page CSP blocks dynamic script injection.",
        error
      );
      return null;
    }
  }

  function setScriptSrc(script, url) {
    const trustedUrl = createTrustedScriptUrl(url);

    if (!trustedUrl) {
      return false;
    }

    script.src = trustedUrl;
    return true;
  }

  function appendScript(script) {
    // 把真正的 widget 脚本插入到宿主网页中。插入后浏览器会下载并执行它。
    const target = document.head || document.body || document.documentElement;

    if (target) {
      target.appendChild(script);
      return;
    }

    document.addEventListener("DOMContentLoaded", () => appendScript(script), { once: true });
  }

  function mountWidget(options, shouldOpen) {
    // floating-notes-widget.js 加载完成后，会在 window 上暴露 FloatingNotes.init。
    // 这里调用 init，才真正把悬浮按钮和面板挂到当前网页里。
    if (!window.FloatingNotes || typeof window.FloatingNotes.init !== "function") {
      console.error("Floating notes widget did not load.");
      return null;
    }

    if (!window.FloatingNotes.instance) {
      window.FloatingNotes.instance = window.FloatingNotes.init(options);
    }

    if (shouldOpen && typeof window.FloatingNotes.instance.open === "function") {
      window.FloatingNotes.instance.open();
    }

    return window.FloatingNotes.instance;
  }

  function injectFloatingNotes(overrides) {
    // 配置来源按优先级合并：
    // 1. window.FloatingNotesInjectConfig 全局配置
    // 2. script 标签上的 data-*，例如 data-position="right"
    // 3. JS 主动调用 injectFloatingNotes({...}) 传进来的 overrides
    const currentScript = document.currentScript;
    const globalConfig = isPlainObject(window[GLOBAL_CONFIG_NAME])
      ? window[GLOBAL_CONFIG_NAME]
      : {};
    const config = {
      ...globalConfig,
      ...(currentScript ? currentScript.dataset : {}),
      ...(isPlainObject(overrides) ? overrides : {})
    };
    const apiBase = normalizeBase(config.apiBase || scriptOrigin(currentScript));
    const widgetSrc = readString(
      config.widgetSrc,
      apiBase ? `${apiBase}/embed/floating-notes-widget.js` : ""
    );

    if (!apiBase || !widgetSrc) {
      console.error(
        "Floating notes injector needs an API origin. Load this file from the notes service or set data-api-base."
      );
      return null;
    }

    const options = {
      // apiBase 是后端服务地址。widget 后续会请求 `${apiBase}/notes` 读写笔记。
      apiBase,
      // trigger 可以绑定宿主网页上的某个按钮，例如 data-trigger="#openNotes"。
      trigger: readString(config.trigger, ""),
      // floatButton 控制是否显示默认右下角悬浮图标。
      floatButton: readBoolean(config.floatButton, true),
      position: readString(config.position, "right") === "left" ? "left" : "right",
      title: readString(config.title, DEFAULT_TITLE)
    };
    const shouldOpen = readBoolean(config.open ?? config.autoOpen, false);

    if (window.FloatingNotes && typeof window.FloatingNotes.init === "function") {
      // 如果 widget 已经被别的入口加载过，就不重复插 script，直接初始化或复用实例。
      return mountWidget(options, shouldOpen);
    }

    let widgetScript = document.getElementById(WIDGET_SCRIPT_ID);

    if (widgetScript) {
      widgetScript.addEventListener("load", () => mountWidget(options, shouldOpen), { once: true });
      return null;
    }

    widgetScript = document.createElement("script");
    widgetScript.id = WIDGET_SCRIPT_ID;
    if (!setScriptSrc(widgetScript, widgetSrc)) {
      return null;
    }

    widgetScript.async = true;
    // autoInit=false 表示 widget 脚本只负责注册 window.FloatingNotes，
    // 初始化时机交给当前 inject 脚本控制，这样可以把上面整理好的 options 传进去。
    widgetScript.dataset.autoInit = "false";
    widgetScript.dataset.apiBase = apiBase;
    widgetScript.addEventListener("load", () => mountWidget(options, shouldOpen), { once: true });
    widgetScript.addEventListener("error", () => {
      console.error(`Floating notes widget failed to load: ${widgetSrc}`);
    }, { once: true });

    appendScript(widgetScript);
    return null;
  }

  window.injectFloatingNotes = injectFloatingNotes;
  // script 标签被加载后自动执行一次，所以普通网页只需要引入这个文件即可。
  injectFloatingNotes();
})();
