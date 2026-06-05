// 弹窗逻辑:展示当前站点的“去 CSP”状态,并允许把当前域加入/移出黑名单。
// 黑名单存 chrome.storage.sync;background.js 监听 storage 变化并同步 DNR 动态规则。

const STORAGE_KEY = "blacklist";

const domainEl = document.getElementById("domain");
const statusEl = document.getElementById("status");
const toggleBtn = document.getElementById("toggle");

let currentDomain = "";

function readBlacklist() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ [STORAGE_KEY]: [] }, (data) => {
      resolve(Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : []);
    });
  });
}

function writeBlacklist(list) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: list }, resolve);
  });
}

function getActiveTabDomain() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs && tabs[0] && tabs[0].url;
      if (!url) {
        resolve("");
        return;
      }
      try {
        resolve(new URL(url).hostname);
      } catch {
        resolve("");
      }
    });
  });
}

function render(isBlacklisted) {
  if (isBlacklisted) {
    statusEl.textContent = "已加入黑名单 · 保留原 CSP(笔记面板可能无法嵌入)";
    statusEl.className = "status off";
    toggleBtn.textContent = "移出黑名单";
    toggleBtn.className = "disable";
  } else {
    statusEl.textContent = "已启用去 CSP · 笔记面板可正常嵌入";
    statusEl.className = "status on";
    toggleBtn.textContent = "加入黑名单";
    toggleBtn.className = "enable";
  }
  toggleBtn.disabled = false;
}

async function init() {
  currentDomain = await getActiveTabDomain();
  if (!currentDomain) {
    domainEl.textContent = "(不支持的页面)";
    statusEl.textContent = "此页面无法操作";
    statusEl.className = "status";
    return;
  }

  domainEl.textContent = currentDomain;
  const blacklist = await readBlacklist();
  render(blacklist.includes(currentDomain));

  toggleBtn.addEventListener("click", async () => {
    toggleBtn.disabled = true;
    const list = await readBlacklist();
    const isBlacklisted = list.includes(currentDomain);
    const next = isBlacklisted
      ? list.filter((d) => d !== currentDomain)
      : [...list, currentDomain];
    await writeBlacklist(next);
    render(!isBlacklisted);
  });
}

init();
