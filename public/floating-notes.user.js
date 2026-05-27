// ==UserScript==
// @name         Floating Notes
// @namespace    https://notes.edmund.xin/
// @version      1.0.1
// @description  Add the floating notes widget to every normal web page.
// @author       Edmund
// @match        http://*/*
// @match        https://*/*
// @exclude      https://notes.edmund.xin/*
// @updateURL    https://notes.edmund.xin/floating-notes.user.js
// @downloadURL  https://notes.edmund.xin/floating-notes.user.js
// @require      https://notes.edmund.xin/embed/floating-notes-widget.js?v=1.0.1
// @connect      notes.edmund.xin
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const API_BASE = "https://notes.edmund.xin";

  function initFloatingNotes() {
    if (!window.FloatingNotes || typeof window.FloatingNotes.init !== "function") {
      console.error("Floating Notes userscript: widget script did not load.");
      return;
    }

    if (window.FloatingNotes.instance) {
      return;
    }

    window.FloatingNotes.instance = window.FloatingNotes.init({
      apiBase: API_BASE,
      floatButton: true,
      position: "left",
      title: "笔记"
    });
  }

  if (document.body) {
    initFloatingNotes();
  } else {
    document.addEventListener("DOMContentLoaded", initFloatingNotes, { once: true });
  }
})();
