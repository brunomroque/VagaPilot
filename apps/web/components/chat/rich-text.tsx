import { Fragment, type ReactNode } from "react"

/** Inline `**bold**` / `*italic*` / `` `code` `` (QA: asterisks showed literally). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\*([^*\s][^*\n]*)\*/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const key = match.index
    if (match[1] ?? match[2])
      out.push(<strong key={key}>{match[1] ?? match[2]}</strong>)
    else if (match[3])
      out.push(
        <code key={key} className="rounded bg-muted px-1">
          {match[3]}
        </code>
      )
    else out.push(<em key={key}>{match[4]}</em>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Minimal, safe markdown for assistant text: paragraphs, bullet/numbered lists, headings. No HTML. */
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={blocks.length} className="whitespace-pre-wrap">
          {para.map((line, i) => (
            <Fragment key={i}>
              {i > 0 ? "\n" : null}
              {inline(line)}
            </Fragment>
          ))}
        </p>
      )
      para = []
    }
  }
  const flushList = () => {
    if (list) {
      const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>)
      blocks.push(
        list.ordered ? (
          <ol key={blocks.length} className="list-decimal pl-5">
            {items}
          </ol>
        ) : (
          <ul key={blocks.length} className="list-disc pl-5">
            {items}
          </ul>
        )
      )
      list = null
    }
  }
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flushPara()
      const ordered = !bullet
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1]!)
    } else if (heading) {
      flushPara()
      flushList()
      blocks.push(
        <p key={blocks.length} className="font-semibold">
          {inline(heading[1]!)}
        </p>
      )
    } else if (!line.trim()) {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return <div className="flex flex-col gap-2 text-sm break-words">{blocks}</div>
}
