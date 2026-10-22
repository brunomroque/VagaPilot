import { Document, Packer, Paragraph } from "docx"
import { PDFDocument, StandardFonts } from "pdf-lib"

/** Renders plain text as a one-page-per-50-lines PDF (FICTITIOUS content only). */
export async function textToPdf(text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const lines = text.split("\n")
  for (let start = 0; start < lines.length; start += 50) {
    const page = pdf.addPage([595, 842])
    lines.slice(start, start + 50).forEach((line, index) => {
      page.drawText(line, { x: 40, y: 800 - index * 15, size: 10, font })
    })
  }
  return pdf.save()
}

export async function textToDocx(text: string): Promise<Uint8Array> {
  const document = new Document({
    sections: [
      { children: text.split("\n").map((line) => new Paragraph(line)) },
    ],
  })
  return new Uint8Array(await Packer.toBuffer(document))
}
