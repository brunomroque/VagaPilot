import { FICTITIOUS_CV_PT } from "@vagapilot/ai/fixtures"
import { PDFDocument, StandardFonts } from "pdf-lib"

/** The FICTITIOUS CV (3 experiences) rendered as a one-page PDF for upload tests. */
export async function fictitiousCvPdf(
  text: string = FICTITIOUS_CV_PT
): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([595, 842])
  text.split("\n").forEach((line, index) => {
    page.drawText(line, { x: 40, y: 800 - index * 15, size: 10, font })
  })
  return Buffer.from(await pdf.save())
}
