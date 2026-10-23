/** Renders a legal text line by line, with **bold** clauses (CDC art. 54 §4) and no HTML parsing. */
export function LegalText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <div key={i}>
          {line.split("**").map((p, j) => (j % 2 ? <strong key={j}>{p}</strong> : <span key={j}>{p}</span>))}
        </div>
      ))}
    </>
  )
}
