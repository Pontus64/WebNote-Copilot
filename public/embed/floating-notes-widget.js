(function () {
  const DEFAULT_OPTIONS = {
    apiBase: "",
    trigger: "",
    floatButton: true,
    position: "left",
    title: "笔记"
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
      console.error(
        "Floating notes widget could not create a Trusted Types policy. This page CSP blocks dynamic widget HTML.",
        error
      );
      return null;
    }
  }

  const TRUSTED_TYPES_POLICY = createTrustedTypesPolicy();

  function trustedHtml(html) {
    return TRUSTED_TYPES_POLICY ? TRUSTED_TYPES_POLICY.createHTML(html) : html;
  }

  const STYLE = `
    :host {
      all: initial;
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    }

    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    button,
    input,
    textarea,
    [role="button"] {
      outline: none;
      -webkit-tap-highlight-color: transparent;
    }

    button:focus,
    input:focus,
    textarea:focus,
    [role="button"]:focus {
      outline: none;
    }

    .float-btn {
      position: fixed;
      top: 20px;
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: #666;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 2147483645;
      font-size: 14px;
      font-weight: 600;
      box-shadow: none;
      padding: 0;
      user-select: none;
    }

    .float-btn:hover .float-icon {
      opacity: 0.78;
    }

    .float-icon {
      width: 30px;
      height: 30px;
      display: block;
      transition: opacity 0.2s ease;
    }

    .float-btn.left,
    .panel.left {
      left: 20px;
    }

    .float-btn.right,
    .panel.right {
      right: 20px;
    }

    .float-btn.hidden {
      display: none;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(4px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
      z-index: 2147483643;
    }

    .overlay.show {
      opacity: 1;
      pointer-events: auto;
    }

    .panel {
      position: fixed;
      top: 90px;
      width: min(520px, calc(100vw - 40px));
      height: 50vh;
      background: rgba(255, 255, 255, 0.96);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
      transform: translateY(-20px);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.25s ease, opacity 0.25s ease;
      z-index: 2147483644;
    }

    .panel.show {
      transform: translateY(0);
      opacity: 1;
      pointer-events: auto;
    }

    .panel.detail-open .note-list {
      pointer-events: none;
      transform: translateX(-28%);
      opacity: 0.82;
    }

    .panel.detail-open .detail-page {
      pointer-events: auto;
      transform: translateX(0);
    }

    .panel-header {
      height: 52px;
      padding: 0 16px;
      border-bottom: 1px solid #ececec;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: white;
    }

    .panel-title {
      font-size: 16px;
      font-weight: 700;
      color: #111;
    }

    .close-btn {
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 10px;
      background: #f3f3f3;
      color: #111;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }

    .note-list {
      position: absolute;
      left: 0;
      right: 0;
      top: 52px;
      bottom: 0;
      width: 100%;
      height: calc(50vh - 52px);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      overflow-x: hidden;
      overscroll-behavior: contain;
      touch-action: pan-y;
      background: #f5f5f5;
      transform: translateX(0);
      transition: transform 0.3s ease, opacity 0.3s ease;
      will-change: transform, opacity;
    }

    .state {
      padding: 22px 18px;
      color: #777;
      font-size: 14px;
      line-height: 1.5;
      text-align: center;
    }

    .swipe-item {
      position: relative;
      width: 100%;
      height: 72px;
      overflow: hidden;
      border-bottom: 1px solid #ececec;
      background: #f5f5f5;
      flex: 0 0 72px;
      touch-action: pan-y;
    }

    .actions {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      display: flex;
    }

    .copy-btn,
    .delete-btn {
      width: 72px;
      border: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
    }

    .copy-btn {
      background: #34c759;
    }

    .delete-btn {
      background: #ff3b30;
    }

    .copy-btn:active,
    .delete-btn:active {
      filter: brightness(0.92);
    }

    .note-item {
      position: relative;
      width: 100%;
      height: 72px;
      border: 0;
      background: white;
      padding: 14px 18px;
      cursor: pointer;
      transition: transform 0.25s ease;
      user-select: none;
      text-align: left;
    }

    .note-item.returning {
      transition: transform 0.3s ease;
    }

    .toast {
      position: fixed;
      left: 50%;
      top: 28px;
      transform: translate(-50%, -10px);
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(17, 17, 17, 0.88);
      color: white;
      font-size: 13px;
      font-weight: 600;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
      z-index: 2147483647;
    }

    .toast.show {
      opacity: 1;
      transform: translate(-50%, 0);
    }

    .note-title {
      font-size: 18px;
      font-weight: 700;
      color: #111;
      margin-bottom: 6px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .note-desc {
      font-size: 13px;
      color: #888;
      line-height: 1.5;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .add-item {
      height: 72px;
      border: 0;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex: 0 0 72px;
    }

    .add-circle {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s ease;
    }

    .add-icon {
      width: 28px;
      height: 28px;
      display: block;
    }

    .add-item:hover .add-circle {
      opacity: 0.78;
    }

    .detail-page {
      position: absolute;
      left: 0;
      right: 0;
      top: 52px;
      bottom: 0;
      height: calc(50vh - 52px);
      background: white;
      display: flex;
      flex-direction: column;
      pointer-events: none;
      transform: translateX(100%);
      transition: transform 0.3s ease, opacity 0.3s ease;
      will-change: transform, opacity;
    }

    .detail-header {
      height: 64px;
      border-bottom: 1px solid #ececec;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 16px;
      flex: 0 0 auto;
    }

    .back-btn {
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 10px;
      background: #f3f3f3;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #111;
      font-size: 18px;
    }

    .detail-title {
      flex: 1;
      min-width: 0;
      border: none;
      outline: none;
      font: inherit;
      font-size: 20px;
      font-weight: 700;
      color: #111;
    }

    .save-btn {
      height: 36px;
      padding: 0 14px;
      border: 0;
      border-radius: 10px;
      background: #111;
      color: white;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
    }

    .detail-content {
      flex: 1;
      width: 100%;
      border: none;
      outline: none;
      resize: none;
      padding: 20px;
      font: inherit;
      font-size: 16px;
      line-height: 1.8;
      color: #111;
    }

    @media (max-width: 768px) {
      .float-btn.left,
      .panel.left {
        left: 20px;
      }

      .float-btn.right,
      .panel.right {
        right: 20px;
      }

      .panel {
        width: calc(100vw - 40px);
      }
    }
  `;

  class FloatingNotesWidget {
    constructor(options) {
      this.options = {
        ...DEFAULT_OPTIONS,
        ...options
      };
      // apiBase 指向笔记服务域名，例如 https://notes.edmund.xin。
      // 所有读写都会走 `${apiBase}/notes`。
      this.apiBase = this.options.apiBase.replace(/\/$/, "");
      // assetBase 用来加载图标资源，避免嵌入到别的网站后误从宿主网站找 SVG。
      this.assetBase = new URL(this.apiBase || window.location.origin, window.location.href).origin;
      this.notes = [];
      this.currentIndex = null;
      this.opened = false;
      this.root = null;
      this.host = null;
      this.toastTimer = null;
      this.abortController = new AbortController();
    }

    mount() {
      if (this.host) {
        return this;
      }

      // 使用自定义元素名 + Shadow DOM，把样式和 DOM 封装起来。
      // 这样宿主网页自己的 CSS 不容易污染笔记本，笔记本样式也不容易影响宿主网页。
      this.host = document.createElement("floating-notes-widget");
      this.root = this.host.attachShadow({ mode: "open" });
      document.body.appendChild(this.host);
      // 先渲染外壳，再绑定宿主页面触发器，最后拉取后端笔记数据。
      this.renderShell();
      this.bindTriggers();
      this.fetchNotes();
      return this;
    }

    destroy() {
      this.abortController.abort();
      if (this.host) {
        this.host.remove();
      }
      this.host = null;
      this.root = null;
    }

    open() {
      this.opened = true;
      this.panel.classList.add("show");
      this.overlay.classList.add("show");
      this.fetchNotes();
    }

    close() {
      this.opened = false;
      this.panel.classList.remove("show");
      this.closeDetail();
      this.overlay.classList.remove("show");
    }

    toggle() {
      if (this.opened) {
        this.close();
      } else {
        this.open();
      }
    }

    renderShell() {
      const position = this.options.position === "right" ? "right" : "left";
      const floatClass = this.options.floatButton ? "" : " hidden";

      // 这里生成的是嵌入版的完整 UI：悬浮图标、遮罩、toast、列表页、编辑页。
      // 注意这不是打开 index.html，而是直接把这一套 DOM 插到当前网页里。
      this.root.innerHTML = trustedHtml(`
        <style>${STYLE}</style>
        <button class="float-btn ${position}${floatClass}" type="button" aria-label="${this.escapeHtml(this.options.title)}">
          <img class="float-icon" src="${this.assetBase}/edit_light.svg" alt="" aria-hidden="true">
        </button>
        <div class="overlay"></div>
        <div class="toast"></div>
        <section class="panel ${position}" aria-label="${this.escapeHtml(this.options.title)}">
          <header class="panel-header">
            <div class="panel-title">${this.escapeHtml(this.options.title)}</div>
            <button class="close-btn" type="button" aria-label="关闭">×</button>
          </header>
          <div class="note-list"></div>
          <section class="detail-page" aria-label="编辑笔记">
            <header class="detail-header">
              <button class="back-btn" type="button" aria-label="返回">←</button>
              <input class="detail-title" placeholder="输入标题" />
              <button class="save-btn" type="button">保存</button>
            </header>
            <textarea class="detail-content" placeholder="输入内容..."></textarea>
          </section>
        </section>
      `);

      this.floatButton = this.root.querySelector(".float-btn");
      this.overlay = this.root.querySelector(".overlay");
      this.panel = this.root.querySelector(".panel");
      this.noteList = this.root.querySelector(".note-list");
      this.detailPage = this.root.querySelector(".detail-page");
      this.detailTitle = this.root.querySelector(".detail-title");
      this.detailContent = this.root.querySelector(".detail-content");
      this.toast = this.root.querySelector(".toast");

      // 这些事件只绑定在 Shadow DOM 内部，控制当前 widget 的打开、关闭、返回和保存。
      this.floatButton.addEventListener("click", () => this.toggle());
      this.overlay.addEventListener("click", () => this.close());
      this.root.querySelector(".close-btn").addEventListener("click", () => this.close());
      this.root.querySelector(".back-btn").addEventListener("click", () => this.closeDetail());
      this.root.querySelector(".save-btn").addEventListener("click", () => this.saveNote());
    }

    bindTriggers() {
      // 除了默认悬浮按钮，宿主网页也可以提供自己的入口：
      // 1. 初始化时传 trigger: "#openNotes"
      // 2. 给任意元素加 data-floating-notes-trigger
      const signal = this.abortController.signal;
      const triggerSelectors = [
        this.options.trigger,
        "[data-floating-notes-trigger]"
      ].filter(Boolean);

      triggerSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((element) => {
          element.addEventListener("click", (event) => {
            event.preventDefault();
            this.open();
          }, { signal });
        });
      });
    }

    async request(path, options) {
      // 所有 API 请求都从这里统一发出。
      // 例如 this.request("/notes") 实际请求 https://notes.edmund.xin/notes。
      const response = await fetch(`${this.apiBase}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options && options.headers ? options.headers : {})
        }
      });

      if (!response.ok) {
        throw new Error(`Floating notes request failed: ${response.status}`);
      }

      return response.json();
    }

    async fetchNotes() {
      try {
        this.renderState("加载中...");
        // GET /notes：从 Worker + D1 拉取笔记列表。
        this.notes = await this.request("/notes");
        this.renderNotes();
      } catch (error) {
        this.renderState("笔记加载失败，请确认后端服务已启动");
        console.error(error);
      }
    }

    renderState(message) {
      this.noteList.replaceChildren();
      const state = document.createElement("div");
      state.className = "state";
      state.textContent = message;
      this.noteList.appendChild(state);
    }

    renderNotes() {
      this.noteList.replaceChildren();

      if (!this.notes.length) {
        this.renderState("暂无笔记");
      }

      this.notes.forEach((note, index) => {
        // 列表项用真实 DOM API 创建，而不是拼字符串，避免用户输入内容破坏 HTML。
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
        this.noteList.appendChild(item);

        noteItem.addEventListener("click", () => {
          if (this.isSwipedOpen(noteItem)) {
            this.resetSwipeNow(noteItem);
            return;
          }

          this.openDetail(index);
        });
        deleteButton.addEventListener("click", () => this.deleteNote(index, noteItem));
        copyButton.addEventListener("click", () => this.copyNote(index, noteItem));
        this.addSwipe(noteItem);
      });

      const add = document.createElement("div");
      add.className = "add-item";
      const addCircle = document.createElement("div");
      addCircle.className = "add-circle";
      const addIcon = document.createElement("img");
      addIcon.className = "add-icon";
      addIcon.src = `${this.assetBase}/roundaddlight.svg`;
      addIcon.alt = "";
      addIcon.setAttribute("aria-hidden", "true");
      addCircle.appendChild(addIcon);
      add.appendChild(addCircle);
      addCircle.addEventListener("click", () => this.createNote());
      this.noteList.appendChild(add);
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
        note.style.transform = `translateX(${translateX}px)`;
      }, { passive: false });

      note.addEventListener("touchend", () => {
        if (!isSwiping) {
          return;
        }

        translateX = translateX < -60 ? -144 : 0;
        note.style.transform = `translateX(${translateX}px)`;
      });
    }

    showDetailPage() {
      this.detailPage.classList.add("show");

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.panel.classList.add("detail-open");
        });
      });
    }

    openDetail(index) {
      this.currentIndex = index;
      this.detailTitle.value = this.notes[index].title || "";
      this.detailContent.value = this.notes[index].content || "";
      this.showDetailPage();
    }

    createNote() {
      this.currentIndex = null;
      this.detailTitle.value = "";
      this.detailContent.value = "";
      this.showDetailPage();
    }

    closeDetail() {
      this.detailPage.classList.remove("show");
      this.panel.classList.remove("detail-open");
    }

    async saveNote() {
      const title = this.detailTitle.value.trim();
      const content = this.detailContent.value.trim();

      if (!title) {
        window.alert("请输入标题");
        return;
      }

      try {
        if (this.currentIndex === null) {
          // 新建笔记：POST /notes。
          await this.request("/notes", {
            method: "POST",
            body: JSON.stringify({ title, content })
          });
        } else {
          // 修改已有笔记：PUT /notes/:id。
          const note = this.notes[this.currentIndex];
          await this.request(`/notes/${note.id}`, {
            method: "PUT",
            body: JSON.stringify({ title, content })
          });
        }

        await this.fetchNotes();
        this.closeDetail();
      } catch (error) {
        window.alert("保存失败，请稍后重试");
        console.error(error);
      }
    }

    async deleteNote(index, noteItem) {
      const note = this.notes[index];

      try {
        // 删除笔记：DELETE /notes/:id。
        await this.request(`/notes/${note.id}`, {
          method: "DELETE"
        });
        this.showToast("✅ 删除成功");
        await this.fetchNotes();
      } catch (error) {
        window.alert("删除失败，请稍后重试");
        console.error(error);
      }
    }

    async copyNote(index, noteItem) {
      const note = this.notes[index];

      try {
        await this.writeClipboard(note.content || "");
        this.showToast("✅ 复制成功");
        await this.resetSwipeNow(noteItem);
      } catch (error) {
        window.alert("复制失败，请稍后重试");
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

    showToast(message) {
      this.toast.textContent = message;
      this.toast.classList.add("show");

      if (this.toastTimer) {
        window.clearTimeout(this.toastTimer);
      }

      this.toastTimer = window.setTimeout(() => {
        this.toast.classList.remove("show");
      }, 1400);
    }

    async writeClipboard(text) {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
      }

      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "-1000px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
  }

  function resolveScriptOptions() {
    const script = document.currentScript;

    if (!script) {
      return {};
    }

    // 当 widget 被 script 标签直接加载时，可以从 data-* 读取初始化配置。
    // 当它被 inject-floating-notes.js 加载时，inject 会设置 data-auto-init="false"，
    // 避免 widget 自己先初始化一次。
    return {
      apiBase: script.dataset.apiBase || new URL(script.src).origin,
      trigger: script.dataset.trigger || "",
      floatButton: script.dataset.floatButton !== "false",
      position: script.dataset.position || "left",
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
    // 对外暴露 init，给 inject 脚本和油猴脚本调用。
    init,
    Widget: FloatingNotesWidget
  };

  if (scriptOptions.autoInit) {
    // 如果直接用 <script src="/embed/floating-notes-widget.js"> 加载，
    // 默认会自动初始化；inject 和油猴则会自己控制初始化。
    window.FloatingNotes.instance = init(scriptOptions);
  }
})();
