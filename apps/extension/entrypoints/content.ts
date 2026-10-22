export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    const params = new URLSearchParams(window.location.search)
    const applicationId = params.get("vp_app")
    if (!applicationId) return

    void chrome.runtime.sendMessage({
      type: "vp:application-detected",
      applicationId,
      url: window.location.href,
    })

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "vp:fill-answers") {
        const answers =
          (message as { answers?: { label: string; value: string }[] })
            .answers ?? []
        void (async () => {
          const { fillAnswersByLabel } = await import("../lib/fill-page")
          const filled = await fillAnswersByLabel(document, answers)
          chrome.runtime.sendMessage({
            type: "vp:answers-filled",
            filled,
            applicationId,
          })
        })()
        return
      }
      if (message?.type !== "vp:fill-form") return
      const { payload, cvBase64, cvFilename } = message as {
        payload: unknown
        cvBase64?: string
        cvFilename?: string
      }
      void (async () => {
        const { fillApplicationForm, detectConfirmation } =
          await import("../lib/fill-page")
        let cvFile: File | null = null
        if (cvBase64 && cvFilename) {
          const binary = atob(cvBase64)
          const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
          cvFile = new File([bytes], cvFilename, { type: "application/pdf" })
        }
        const report = await fillApplicationForm(
          document,
          payload as import("@vagapilot/core/application-package").ApplicationPackagePayload,
          cvFile
        )
        const confirmation = detectConfirmation(document)
        chrome.runtime.sendMessage({
          type: "vp:fill-complete",
          report,
          confirmation,
          applicationId,
          url: window.location.href,
        })
      })()
    })
  },
})
