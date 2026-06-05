// Service worker:维护“黑名单豁免”。
//
// 背景:rules.json 里有一条静态规则(id=1, priority=1),对所有 main_frame / sub_frame
// 移除 Content-Security-Policy 等响应头,让 notes.edmund.xin 的 iframe 能在任意站点嵌入。
//
// 黑名单里的域名需要“保留原 CSP”。做法是为每个黑名单域写一条 action=allow、priority=2 的
// 动态规则。DNR 中更高优先级的 allow 规则会覆盖 modifyHeaders,从而对这些站点不动 CSP。

const STORAGE_KEY = "blacklist";
// 动态规则 id 从这里起编,避开静态规则 id=1。
const DYNAMIC_RULE_BASE_ID = 1000;

function readBlacklist() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ [STORAGE_KEY]: [] }, (data) => {
      const list = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      resolve(list);
    });
  });
}

function buildAllowRule(domain, index) {
  return {
    id: DYNAMIC_RULE_BASE_ID + index,
    priority: 2,
    action: { type: "allow" },
    condition: {
      requestDomains: [domain],
      resourceTypes: ["main_frame", "sub_frame"],
    },
  };
}

// 用黑名单重建全部动态规则:先删掉旧的动态规则,再按当前黑名单添加。
async function rebuildDynamicRules() {
  const blacklist = await readBlacklist();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);
  const addRules = blacklist.map((domain, index) => buildAllowRule(domain, index));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  rebuildDynamicRules();
});

chrome.runtime.onStartup.addListener(() => {
  rebuildDynamicRules();
});

// popup 改动黑名单后写 storage,这里监听变化并同步规则。
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[STORAGE_KEY]) {
    rebuildDynamicRules();
  }
});
