export default defineBackground(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {})

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "vp:application-detected") {
      chrome.storage.session.set({
        vp_active_application: message.applicationId,
        vp_active_url: message.url,
      })
      const tabId = sender.tab?.id
      if (tabId !== undefined) void chrome.sidePanel.open({ tabId })
      sendResponse({ ok: true })
      return true
    }
    if (message?.type === "vp:fill-complete") {
      chrome.storage.session.set({ vp_last_fill: message })
      sendResponse({ ok: true })
      return true
    }
    return undefined
  })
})
