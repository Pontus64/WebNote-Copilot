(function () {
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
    const target = document.head || document.body || document.documentElement;

    if (target) {
      target.appendChild(script);
      return;
    }

    document.addEventListener("DOMContentLoaded", () => appendScript(script), { once: true });
  }

  function mountWidget(options, shouldOpen) {
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
      apiBase,
      trigger: readString(config.trigger, ""),
      floatButton: readBoolean(config.floatButton, true),
      position: readString(config.position, "left") === "right" ? "right" : "left",
      title: readString(config.title, DEFAULT_TITLE)
    };
    const shouldOpen = readBoolean(config.open ?? config.autoOpen, false);

    if (window.FloatingNotes && typeof window.FloatingNotes.init === "function") {
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
  injectFloatingNotes();
})();
