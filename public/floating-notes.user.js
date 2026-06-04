// ==UserScript==
// @name         Floating Notes
// @namespace    https://notes.edmund.xin/
// @version      1.0.29
// @description  Add the floating notes widget to every normal web page.
// @author       Edmund
// @match        http://*/*
// @match        https://*/*
// @exclude      https://notes.edmund.xin/*
// @exclude      http://localhost/*
// @exclude      http://localhost:*/*
// @exclude      http://127.0.0.1/*
// @exclude      http://127.0.0.1:*/*
// @updateURL    https://notes.edmund.xin/floating-notes.user.js
// @downloadURL  https://notes.edmund.xin/floating-notes.user.js
// @require      https://notes.edmund.xin/embed/floating-notes-widget.js?v=1.0.29
// @connect      notes.edmund.xin
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // 油猴脚本运行在任意被 @match 命中的网页上。
  // @require 会先把 floating-notes-widget.js 下载并执行，所以这里可以直接用 window.FloatingNotes。
  const API_BASE = "https://notes.edmund.xin";

  function initFloatingNotes() {
    if (!window.FloatingNotes || typeof window.FloatingNotes.init !== "function") {
      console.error("Floating Notes userscript: widget script did not load.");
      return;
    }

    if (window.FloatingNotes.instance) {
      return;
    }

    // 油猴入口不需要 inject-floating-notes.js，因为 @require 已经帮它加载了 widget。
    // 这里直接初始化 widget，把悬浮按钮、抽屉和划词工具栏插入当前网页。
    window.FloatingNotes.instance = window.FloatingNotes.init({
      apiBase: API_BASE,
      floatButton: true,
      title: "笔记"
    });
  }

  if (document.body) {
    initFloatingNotes();
  } else {
    document.addEventListener("DOMContentLoaded", initFloatingNotes, { once: true });
  }
})();
