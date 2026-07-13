import PDFDocument from "pdfkit";
import type { ReportData } from "./reports";

const day = (d: Date) => d.toISOString().slice(0, 10);
const minute = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16);

// Render a report as an A4 PDF using only the built-in Helvetica fonts.
// pdfkit is a stream — collect chunks and hand callers a plain Buffer they
// can attach to an email.
export function buildPdf(data: ReportData, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(18).text(title);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#555555")
      .text(`${day(data.period.from)} — ${day(data.period.to)}`);
    doc.moveDown();

    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(13).text("KPIs");
    doc.font("Helvetica").fontSize(10);
    if (data.kpis.length === 0) doc.text("No KPI widgets.");
    for (const k of data.kpis) {
      const delta =
        k.delta24h === null ? "" : `  (24h ${k.delta24h >= 0 ? "+" : ""}${k.delta24h})`;
      doc.text(`${k.label}: ${k.value ?? "—"}${delta}`);
    }
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(13).text("Sheets");
    doc.font("Helvetica").fontSize(10);
    if (data.sheets.length === 0) doc.text("No changes in this period.");
    for (const s of data.sheets) {
      doc.text(`${s.label} — ${s.changeCount} change${s.changeCount !== 1 ? "s" : ""}`);
    }
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(13).text("Recent changes");
    doc.font("Helvetica").fontSize(10);
    if (data.recentChanges.length === 0) doc.text("None.");
    for (const c of data.recentChanges.slice(0, 30)) {
      doc.text(`${minute(c.createdAt)} · ${c.sheetLabel} · ${c.summary}`);
    }

    doc.end();
  });
}
