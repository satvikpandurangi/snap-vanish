chrome.runtime.onInstalled.addListener(async () => {
  const defaults = {
    enabled: true,
    sensitivity: 5,
    dustDuration: 2200,
    dustDirection: "right",
  };
  const existing = await chrome.storage.local.get(Object.keys(defaults));
  await chrome.storage.local.set({ ...defaults, ...existing });
});
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    const request = {
      type: "SV_COMMAND",
      command: command === "capture-room" ? "capture" : "trigger",
    };
    try {
      await chrome.tabs.sendMessage(tab.id, request);
    } catch {
      chrome.runtime
        .sendMessage({
          type: "SV_STUDIO_REQUEST",
          targetTabId: tab.id,
          request,
        })
        .catch(() => {});
    }
  }
});
