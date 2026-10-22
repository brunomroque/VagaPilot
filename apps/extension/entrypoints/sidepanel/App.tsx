import { useCallback, useEffect, useState } from "react"

import {
  confirmApplication,
  fetchPackage,
  pairDevice,
  listQuestions,
  postQuestion,
  type PackageResponse,
} from "../../lib/api"
import { setApiBase, setDeviceToken, getApiBase } from "../../lib/storage"

type FillMessage = {
  report: {
    filled: number
    skipped: number
    linkedInSuggestionsOnly: boolean
    suggestions: { label: string; value: string }[]
    unknownQuestions: { label: string; fieldType: string }[]
  }
  confirmation: { protocolText: string | null; url: string } | null
  applicationId: string
  url: string
}

export function App() {
  const [apiBase, setBase] = useState("http://127.0.0.1:3100")
  const [code, setCode] = useState("")
  const [paired, setPaired] = useState(false)
  const [status, setStatus] = useState("Desconectado")
  const [pkg, setPkg] = useState<PackageResponse | null>(null)
  const [fill, setFill] = useState<FillMessage | null>(null)

  useEffect(() => {
    void getApiBase().then(setBase)
    const listener = (message: FillMessage & { type?: string }) => {
      if (
        message.type === "vp:fill-complete" ||
        (message as { report?: unknown }).report
      ) {
        setFill(message as FillMessage)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const handlePair = useCallback(async () => {
    await setApiBase(apiBase)
    const token = await pairDevice(code, "VagaPilot Chrome")
    await setDeviceToken(token)
    setPaired(true)
    setStatus("Pareado")
  }, [apiBase, code])

  const handleLoad = useCallback(async () => {
    const session = await chrome.storage.session.get(["vp_active_application"])
    const applicationId = session.vp_active_application as string | undefined
    if (!applicationId) {
      setStatus("Abra uma vaga com ?vp_app=")
      return
    }
    const loaded = await fetchPackage(applicationId)
    setPkg(loaded)
    setStatus(`Pacote carregado · ${loaded.payload.company}`)

    let cvBase64: string | undefined
    if (loaded.cv?.downloadUrl) {
      const file = await fetch(loaded.cv.downloadUrl)
      const buffer = await file.arrayBuffer()
      cvBase64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    await chrome.tabs.sendMessage(tab.id, {
      type: "vp:fill-form",
      payload: loaded.payload,
      cvBase64,
      cvFilename: loaded.cv?.filename,
    })
  }, [])

  const handleQuestions = useCallback(async () => {
    if (!pkg || !fill?.report.unknownQuestions.length) return
    const ids: string[] = []
    for (const question of fill.report.unknownQuestions) {
      ids.push(
        await postQuestion({
          applicationId: pkg.payload.applicationId,
          questionText: question.label,
          fieldType: question.fieldType,
        })
      )
    }
    setStatus("Aguardando respostas no chat…")
    const deadline = Date.now() + 120_000
    const pending = new Set(ids)
    while (pending.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const rows = await listQuestions(pkg.payload.applicationId)
      const answered = rows.filter(
        (row) =>
          pending.has(row.id) && row.status === "respondida" && row.answer
      )
      if (answered.length === 0) continue
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, {
          type: "vp:fill-answers",
          answers: answered.map((row) => ({
            label: row.questionText,
            value: row.answer as string,
          })),
        })
      }
      for (const row of answered) pending.delete(row.id)
      setStatus(`Respostas aplicadas (${answered.length})`)
    }
    if (pending.size > 0) {
      setStatus("Algumas perguntas seguem abertas no chat")
    }
  }, [fill, pkg])

  const handleConfirm = useCallback(async () => {
    if (!pkg) return
    const protocol =
      fill?.confirmation?.protocolText ??
      fill?.confirmation?.url ??
      window.location.href
    await confirmApplication(pkg.payload.applicationId, {
      protocolText: protocol,
      pageUrl: fill?.url ?? window.location.href,
      confirmedByUser: true,
    })
    setStatus("Marcada como enviada")
  }, [fill, pkg])

  return (
    <main style={{ fontFamily: "system-ui", padding: 16, maxWidth: 360 }}>
      <h1 style={{ fontSize: 18 }}>VagaPilot</h1>
      <p style={{ fontSize: 13, color: "#555" }}>
        Assistência de candidatura. O envio final é sempre seu — nunca clicamos
        em submit.
      </p>

      {!paired ? (
        <section style={{ display: "grid", gap: 8 }}>
          <label>
            URL do app
            <input
              value={apiBase}
              onChange={(e) => setBase(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <label>
            Código de 6 dígitos
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              style={{ width: "100%" }}
            />
          </label>
          <button type="button" onClick={() => void handlePair()}>
            Parear
          </button>
        </section>
      ) : (
        <section style={{ display: "grid", gap: 8 }}>
          <button type="button" onClick={() => void handleLoad()}>
            Carregar pacote e preencher
          </button>
          {fill?.report.linkedInSuggestionsOnly ? (
            <ul>
              {fill.report.suggestions.map((item) => (
                <li key={item.label}>
                  <strong>{item.label}:</strong> {item.value}
                </li>
              ))}
            </ul>
          ) : null}
          {fill && !fill.report.linkedInSuggestionsOnly ? (
            <p>
              Campos preenchidos: {fill.report.filled} · ignorados:{" "}
              {fill.report.skipped}
            </p>
          ) : null}
          {fill?.report.unknownQuestions.length ? (
            <button type="button" onClick={() => void handleQuestions()}>
              Perguntar no chat ({fill.report.unknownQuestions.length})
            </button>
          ) : null}
          <button type="button" onClick={() => void handleConfirm()}>
            Marquei como enviada
          </button>
        </section>
      )}

      <p style={{ fontSize: 12, marginTop: 16 }}>{status}</p>
    </main>
  )
}
