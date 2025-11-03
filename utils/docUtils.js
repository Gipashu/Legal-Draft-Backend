import JSZip from "jszip";
import { createReport } from "docx-templates";
import fs from "fs";
import path from "path";
import DOCX2PDFConverter from "docx2pdf-converter";

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
  // First try exact match
  if (Object.prototype.hasOwnProperty.call(formData, raw)) {
    return sanitizeValue(formData[raw]);
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

  for (const k of candidates) {
    if (k && Object.prototype.hasOwnProperty.call(formData, k)) {
      return sanitizeValue(formData[k]);
    }
  }
  
  console.warn(`No match found for placeholder: ${raw}`);
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
  console.log("Merged XML contains placeholders:", mergedXml.includes("{{"));
  
  zip.file("word/document.xml", mergedXml);
  const newBuf = await zip.generateAsync({ type: "nodebuffer" });
  return { buffer: newBuf, mergedXml };
}

// --- generate final report ---
export async function generateReport(templatePath, formData, format = "docx") {
  const templateBuf = fs.readFileSync(templatePath);
  const { buffer: normalizedBuf, mergedXml } = await normalizeTemplateBuffer(templateBuf);
  const placeholders = getPlaceholdersFromXml(mergedXml);

  console.log('Form data keys:', Object.keys(formData));
  console.log('Template placeholders:', placeholders);

  const mappedData = {};
  placeholders.forEach((ph) => {
    const value = getValueForPlaceholder(ph, formData);
    console.log(`Processing placeholder: ${ph} => ${value}`);
    mappedData[ph] = value;
  });
  
  console.log('Mapped data:', JSON.stringify(mappedData, null, 2));

  const reportBuffer = await createReport({
    template: new Uint8Array(normalizedBuf),
    data: mappedData,
    cmdDelimiter: ["{{", "}}"],
  });

  if (format === "pdf") {
    const tempDocx = path.resolve("./templates/temp.docx");
    const tempPdf = path.resolve("./templates/temp.pdf");
    fs.writeFileSync(tempDocx, reportBuffer);
    await DOCX2PDFConverter.convert(tempDocx, tempPdf);
    return fs.readFileSync(tempPdf);
  }

  return Buffer.from(reportBuffer);
}
