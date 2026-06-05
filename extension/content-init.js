// 内容脚本初始化入口。
//
// manifest 里本文件排在 floating-notes-widget.js 之后,同一扩展的多个内容脚本共享同一
// isolated world,所以这里能直接读到 widget 暴露的 window.FloatingNotes。
// widget 包通过 document.currentScript 判断是否自动初始化;作为内容脚本注入时没有
// currentScript,不会自动初始化,因此这里手动调用 init(逻辑与油猴脚本一致)。

(function () {
  "use strict";

  const API_BASE = "https://notes.edmund.xin";

  function initFloatingNotes() {
    if (!window.FloatingNotes || typeof window.FloatingNotes.init !== "function") {
      console.error("Floating Notes extension: widget script did not load.");
      return;
    }

    if (window.FloatingNotes.instance) {
      return;
    }

    window.FloatingNotes.instance = window.FloatingNotes.init({
      apiBase: API_BASE,
      floatButton: true,
      title: "笔记",
    });
  }

  if (document.body) {
    initFloatingNotes();
  } else {
    document.addEventListener("DOMContentLoaded", initFloatingNotes, { once: true });
  }
})();
