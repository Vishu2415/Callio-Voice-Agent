import { PDFDocument, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createPdf() {
  const pdfDoc = await PDFDocument.create();
  // Standard letter page
  const page = pdfDoc.addPage([600, 400]);
  const { width, height } = page.getSize();

  // Draw some titles and texts
  page.drawText('Gemini Live Voice Agent - Outbound Campaign Test', {
    x: 50,
    y: height - 60,
    size: 16,
    color: rgb(0.5, 0.2, 0.8),
  });

  page.drawText('Lead Details for Broadcast Dialer Verification:', {
    x: 50,
    y: height - 120,
    size: 14,
    color: rgb(0.1, 0.1, 0.1),
  });

  page.drawText('Name: Bablu Badmash', {
    x: 50,
    y: height - 160,
    size: 12,
    color: rgb(0.2, 0.2, 0.2),
  });

  page.drawText('Phone Number: +918630301466', {
    x: 50,
    y: height - 190,
    size: 12,
    color: rgb(0.2, 0.2, 0.2),
  });

  page.drawText('Status: Test Contact (SaaS Dialling)', {
    x: 50,
    y: height - 220,
    size: 12,
    color: rgb(0.2, 0.2, 0.2),
  });

  page.drawText('Note: This PDF is created dynamically for SaaS broadcast testing.', {
    x: 50,
    y: height - 320,
    size: 10,
    color: rgb(0.5, 0.5, 0.5),
  });

  const pdfBytes = await pdfDoc.save();
  const outputPath = path.join(__dirname, 'campaign_test.pdf');
  fs.writeFileSync(outputPath, pdfBytes);
  console.log(`PDF created successfully at: ${outputPath}`);
}

createPdf().catch(console.error);
