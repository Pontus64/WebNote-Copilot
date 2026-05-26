(function () {
  const DEFAULT_OPTIONS = {
    apiBase: "",
    trigger: "",
    floatButton: true,
    position: "left",
    title: "笔记"
  };

  const STYLE = `
    :host {
      all: initial;
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    .float-btn {
      position: fixed;
      top: 20px;
      width: 56px;
      height: 56px;
      border: 0;
      border-radius: 50%;
      background: #111;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 2147483645;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
      user-select: none;
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
      max-height: min(70vh, 720px);
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

    .panel-header {
      height: 52px;
      padding: 0 16px;
      border-bottom: 1px solid #ececec;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #fff;
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
      width: 100%;
      max-height: calc(min(70vh, 720px) - 52px);
      display: flex;
      flex-direction: column;
      overflow: auto;
      background: #fff;
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
      overflow: hidden;
      border-bottom: 1px solid #ececec;
      background: white;
      flex: 0 0 auto;
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

    .note-item {
      position: relative;
      width: 100%;
      min-height: 72px;
      border: 0;
      background: white;
      padding: 14px 18px;
      cursor: pointer;
      transition: transform 0.25s ease;
      user-select: none;
      text-align: left;
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
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
    }

    .add-item {
      height: 52px;
      border: 0;
      background: white;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex: 0 0 auto;
    }

    .add-circle {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #f2f2f2;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      color: #777;
      transition: background 0.2s ease, color 0.2s ease;
    }

    .add-item:hover .add-circle {
      background: #111;
      color: white;
    }

    .detail-page {
      position: fixed;
      inset: 0;
      background: white;
      z-index: 2147483646;
      transform: translateX(100%);
      transition: transform 0.3s ease;
      display: flex;
      flex-direction: column;
    }

    .detail-page.show {
      transform: translateX(0);
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
      this.apiBase = this.options.apiBase.replace(/\/$/, "");
      this.notes = [];
      this.currentIndex = null;
      this.opened = false;
      this.root = null;
      this.host = null;
      this.abortController = new AbortController();
    }

    mount() {
      if (this.host) {
        return this;
      }

      this.host = document.createElement("floating-notes-widget");
      this.root = this.host.attachShadow({ mode: "open" });
      document.body.appendChild(this.host);
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

      this.root.innerHTML = `
        <style>${STYLE}</style>
        <button class="float-btn ${position}${floatClass}" type="button">${this.escapeHtml(this.options.title)}</button>
        <div class="overlay"></div>
        <section class="panel ${position}" aria-label="${this.escapeHtml(this.options.title)}">
          <header class="panel-header">
            <div class="panel-title">${this.escapeHtml(this.options.title)}</div>
            <button class="close-btn" type="button" aria-label="关闭">×</button>
          </header>
          <div class="note-list"></div>
        </section>
        <section class="detail-page" aria-label="编辑笔记">
          <header class="detail-header">
            <button class="back-btn" type="button" aria-label="返回">←</button>
            <input class="detail-title" placeholder="输入标题" />
            <button class="save-btn" type="button">保存</button>
          </header>
          <textarea class="detail-content" placeholder="输入内容..."></textarea>
        </section>
      `;

      this.floatButton = this.root.querySelector(".float-btn");
      this.overlay = this.root.querySelector(".overlay");
      this.panel = this.root.querySelector(".panel");
      this.noteList = this.root.querySelector(".note-list");
      this.detailPage = this.root.querySelector(".detail-page");
      this.detailTitle = this.root.querySelector(".detail-title");
      this.detailContent = this.root.querySelector(".detail-content");

      this.floatButton.addEventListener("click", () => this.toggle());
      this.overlay.addEventListener("click", () => this.close());
      this.root.querySelector(".close-btn").addEventListener("click", () => this.close());
      this.root.querySelector(".back-btn").addEventListener("click", () => this.closeDetail());
      this.root.querySelector(".save-btn").addEventListener("click", () => this.saveNote());
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
            this.open();
          }, { signal });
        });
      });
    }

    async request(path, options) {
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
        this.notes = await this.request("/notes");
        this.renderNotes();
      } catch (error) {
        this.renderState("笔记加载失败，请确认后端服务已启动");
        console.error(error);
      }
    }

    renderState(message) {
      this.noteList.innerHTML = "";
      const state = document.createElement("div");
      state.className = "state";
      state.textContent = message;
      this.noteList.appendChild(state);
    }

    renderNotes() {
      this.noteList.innerHTML = "";

      if (!this.notes.length) {
        this.renderState("暂无笔记");
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
        this.noteList.appendChild(item);

        noteItem.addEventListener("click", () => this.openDetail(index));
        deleteButton.addEventListener("click", () => this.deleteNote(index));
        copyButton.addEventListener("click", () => this.copyNote(index));
        this.addSwipe(noteItem);
      });

      const add = document.createElement("button");
      add.className = "add-item";
      add.type = "button";
      add.innerHTML = '<div class="add-circle">+</div>';
      add.addEventListener("click", () => this.createNote());
      this.noteList.appendChild(add);
    }

    addSwipe(note) {
      let startX = 0;
      let currentX = 0;
      let isSwiping = false;
      const threshold = 15;

      note.addEventListener("touchstart", (event) => {
        startX = event.touches[0].clientX;
        currentX = startX;
        isSwiping = false;
      });

      note.addEventListener("touchmove", (event) => {
        currentX = event.touches[0].clientX;
        let diff = currentX - startX;

        if (Math.abs(diff) > threshold) {
          isSwiping = true;
        }

        if (!isSwiping) {
          return;
        }

        if (diff < 0) {
          if (diff < -144) {
            diff = -144;
          }

          note.style.transform = `translateX(${diff}px)`;
        }
      });

      note.addEventListener("touchend", () => {
        if (!isSwiping) {
          return;
        }

        const moved = currentX - startX;
        note.style.transform = moved < -60 ? "translateX(-144px)" : "translateX(0px)";
      });
    }

    openDetail(index) {
      this.currentIndex = index;
      this.detailTitle.value = this.notes[index].title || "";
      this.detailContent.value = this.notes[index].content || "";
      this.detailPage.classList.add("show");
      this.detailTitle.focus();
    }

    createNote() {
      this.currentIndex = null;
      this.detailTitle.value = "";
      this.detailContent.value = "";
      this.detailPage.classList.add("show");
      this.detailTitle.focus();
    }

    closeDetail() {
      this.detailPage.classList.remove("show");
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
          await this.request("/notes", {
            method: "POST",
            body: JSON.stringify({ title, content })
          });
        } else {
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

    async deleteNote(index) {
      const note = this.notes[index];

      try {
        await this.request(`/notes/${note.id}`, {
          method: "DELETE"
        });
        await this.fetchNotes();
      } catch (error) {
        window.alert("删除失败，请稍后重试");
        console.error(error);
      }
    }

    async copyNote(index) {
      const oldNote = this.notes[index];

      try {
        await this.request("/notes", {
          method: "POST",
          body: JSON.stringify({
            title: `${oldNote.title || "未命名"} 副本`,
            content: oldNote.content || ""
          })
        });
        await this.fetchNotes();
      } catch (error) {
        window.alert("复制失败，请稍后重试");
        console.error(error);
      }
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
    init,
    Widget: FloatingNotesWidget
  };

  if (scriptOptions.autoInit) {
    window.FloatingNotes.instance = init(scriptOptions);
  }
})();
