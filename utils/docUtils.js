import puppeteer from "puppeteer";
import mammoth from "mammoth";
import JSZip from "jszip";
import { createReport } from "docx-templates";
import fs from "fs";
import path from "path";

const LOG_FILE = path.resolve("./backend_debug.log");

function logToFile(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(msg);
}

// --- merge runs containing placeholders ---
export function mergeRunsContainingPlaceholders(xml) {
  const runRegex = /<w:t([^>]*)>([\s\S]*?)<\/w:t>/g;
  let out = "", lastIndex = 0, m;

  while ((m = runRegex.exec(xml))) {
    const runStart = m.index;
    out += xml.slice(lastIndex, runStart);

    const attrs = m[1];
    const text = m[2];

    if (text.includes("{{") && !text.includes("}}")) {
      let combinedText = text, endIndex = runRegex.lastIndex, innerMatch;
      while ((innerMatch = runRegex.exec(xml))) {
        combinedText += innerMatch[2];
        endIndex = runRegex.lastIndex;
        if (innerMatch[2].includes("}}")) break;
      }
      out += `<w:t${attrs}>${combinedText}</w:t>`;
      lastIndex = endIndex;
      continue;
    }

    out += m[0];
    lastIndex = runRegex.lastIndex;
  }

  out += xml.slice(lastIndex);
  return out;
}

export function getPlaceholdersFromXml(xml) {
  const plain = xml.replace(/<[^>]+>/g, "");
  const regex = /{{\s*([^}]+?)\s*}}/g;
  const placeholders = [];
  let mm;
  while ((mm = regex.exec(plain))) placeholders.push(mm[1].trim());
  return [...new Set(placeholders)];
}

function toCamelCase(s) {
  return s.replace(/[^a-zA-Z0-9 ]+/g, " ")
    .split(" ")
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
}

function sanitizeValue(val) {
  if (val === undefined || val === null) return "";
  return String(val)
    .replace(/{{/g, "")
    .replace(/}}/g, "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

export function getValueForPlaceholder(name, formData) {
  const raw = name.trim();
  
  // Debug logging for counterpartClause24
  if (raw.toLowerCase().includes('counterpartclause24')) {
    console.log('Processing counterpartClause24 - Raw form data:', JSON.stringify(formData, null, 2));
    console.log('Form data keys:', Object.keys(formData).join(', '));
  }

  // First try exact match
  if (Object.prototype.hasOwnProperty.call(formData, raw)) {
    const value = sanitizeValue(formData[raw]);
    if (raw.toLowerCase().includes('counterpartclause24')) {
      console.log(`Found exact match for ${raw}:`, value);
    }
    return value;
  }

  // Try different variations
  const candidates = [
    raw.toLowerCase(),
    raw.replace(/[^a-zA-Z0-9]/g, ""),
    raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase(),
    toCamelCase(raw),
    raw.replace(/\s+/g, ""),
    raw.replace(/\s+/g, "_"),
    raw.replace(/[^a-zA-Z0-9_]/g, ""),
  ];

  if (raw.toLowerCase().includes('counterpartclause24')) {
    console.log('Trying variations for counterpartClause24:', candidates);
  }

  for (const k of candidates) {
    if (k && Object.prototype.hasOwnProperty.call(formData, k)) {
      const value = sanitizeValue(formData[k]);
      if (raw.toLowerCase().includes('counterpartclause24')) {
        console.log(`Found match for variation '${k}':`, value);
      }
      return value;
    }
  }
  
  console.warn(`No match found for placeholder: ${raw}`);
  console.warn('Available form data keys:', Object.keys(formData).join(', '));
  return "";
}

export async function normalizeTemplateBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    console.error("No document.xml found in the template");
    return { buffer, mergedXml: "" };
  }
  
  const docXml = await docFile.async("string");
  console.log("First 500 chars of document.xml:", docXml.substring(0, 500));
  
  const mergedXml = mergeRunsContainingPlaceholders(docXml);
    logToFile("Merged XML contains placeholders: " + mergedXml.includes("{{"));
  
  zip.file("word/document.xml", mergedXml);
  const newBuf = await zip.generateAsync({ type: "nodebuffer" });
  return { buffer: newBuf, mergedXml };
}

// --- generate final report ---
export async function generateReport(templatePath, formData, format = "docx") {
    logToFile(`[generateReport] Starting for template: ${templatePath}, format: ${format}`);
  const templateBuf = fs.readFileSync(templatePath);
  const { buffer: normalizedBuf, mergedXml } = await normalizeTemplateBuffer(templateBuf);
    logToFile(`[generateReport] Template normalized, mergedXml length: ${mergedXml?.length || 0}`);
  
  const placeholders = getPlaceholdersFromXml(mergedXml);
    logToFile(`[generateReport] Found ${placeholders.length} placeholders in template`);

  console.log('Form data keys:', Object.keys(formData));
  console.log('Template placeholders:', placeholders);

  const mappedData = {};
  placeholders.forEach((ph) => {
    const value = getValueForPlaceholder(ph, formData);
    console.log(`Processing placeholder: ${ph} => ${value}`);
    mappedData[ph] = value;
  });
  
    logToFile('[generateReport] Mapped data prepared, calling createReport');
  
  let reportBuffer;
  try {
    reportBuffer = await createReport({
      template: new Uint8Array(normalizedBuf),
      data: mappedData,
      cmdDelimiter: ["{{", "}}"],
    });
        logToFile(`[generateReport] createReport successful, buffer size: ${reportBuffer.length}`);
  } catch (createErr) {
        logToFile('[generateReport] Error in createReport: ' + createErr.message);
    throw new Error(`docx-templates failed: ${createErr.message}`);
  }

  if (format === "pdf") {
        logToFile('[generateReport] Starting PDF conversion');
    // 1) Convert DOCX buffer to HTML using mammoth
    let html;
    try {
      const result = await mammoth.convertToHtml({ buffer: Buffer.from(reportBuffer) });
      html = result.value;
      logToFile(`[generateReport] Mammoth conversion to HTML successful, HTML length: ${html?.length || 0}`);
    } catch (mammothErr) {
      logToFile('[generateReport] Mammoth error: ' + mammothErr.message);
      throw new Error(`Mammoth failed: ${mammothErr.message}`);
    }

    // 2) Wrap HTML with styles for printing
    const fullHtml = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <style>
            body { font-family: "Times New Roman", serif; font-size: 12pt; margin: 20mm; color: #111; }
            p { margin: 0 0 8px; line-height: 1.45; }
            table { border-collapse: collapse; width: 100%; }
            table td, table th { border: 1px solid #ccc; padding: 6px; }
            img { max-width: 100%; height: auto; }
          </style>
        </head>
        <body>${html}</body>
      </html>
    `;

    // 3) Use puppeteer to render HTML -> PDF
    logToFile('[generateReport] Launching Puppeteer');
    let browser;
    try {
      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new"
      });
      logToFile('[generateReport] Puppeteer launched');

      const page = await browser.newPage();
      logToFile('[generateReport] New page created in Puppeteer');
      await page.setContent(fullHtml, { waitUntil: "networkidle0" });
      logToFile('[generateReport] HTML content set in Puppeteer');
      
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "18mm", bottom: "18mm", left: "15mm", right: "15mm" }
      });
      logToFile(`[generateReport] PDF generated, buffer size: ${pdfBuffer.length}`);
      return Buffer.from(pdfBuffer);
    } catch (puppeteerErr) {
      logToFile('[generateReport] Puppeteer error: ' + puppeteerErr.message);
      throw new Error(`Puppeteer failed: ${puppeteerErr.message}`);
    } finally {
      if (browser) {
        await browser.close();
        logToFile('[generateReport] Puppeteer browser closed');
      }
    }
  }

  return Buffer.from(reportBuffer);
}
