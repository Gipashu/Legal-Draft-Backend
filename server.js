// // server.js
// import express from "express";
// import bodyParser from "body-parser";
// import fs from "fs";
// import path from "path";
// import {createReport} from "docx-templates";
// import cors from "cors";
// import JSZip from "jszip";
// import DOCX2PDFConverter from "docx2pdf-converter";
// const app = express();
// app.use(cors());
// app.use(bodyParser.json({ limit: "5mb" }));
// const PORT = 4000; // parse JSON body


// function mergeRunsContainingPlaceholders(xml) {
//   // Merge consecutive <w:t> runs when a placeholder "{{" begins in one run and "}}" closes later.
//   // This is a heuristic to fix Word-run splitting that breaks templating.
//   const runRegex = /<w:t([^>]*)>([\s\S]*?)<\/w:t>/g;
//   let out = "";
//   let lastIndex = 0;
//   let m;

//   while ((m = runRegex.exec(xml))) {
//     const runStart = m.index;
//     // append everything between lastIndex and this run (keeps other tags)
//     out += xml.slice(lastIndex, runStart);

//     const attrs = m[1];    // attributes inside <w:t ...>
//     const text = m[2];     // inner text of this run

//     // if the run starts a placeholder but doesn't close it, gather subsequent runs
//     if (text.includes("{{") && !text.includes("}}")) {
//       let combinedText = text;
//       let endIndex = runRegex.lastIndex;
//       let innerMatch;
//       // collect following runs until we find one that has '}}'
//       while ((innerMatch = runRegex.exec(xml))) {
//         combinedText += innerMatch[2];
//         endIndex = runRegex.lastIndex;
//         if (innerMatch[2].includes("}}")) break;
//       }
//       // produce a single run using first run's attributes
//       out += `<w:t${attrs}>${combinedText}</w:t>`;
//       lastIndex = endIndex;
//       continue;
//     }

//     // normal: re-append original run exactly as it was
//     out += m[0];
//     lastIndex = runRegex.lastIndex;
//   }

//   // append remaining tail
//   out += xml.slice(lastIndex);
//   return out;
// }

// // // ------------------ extract placeholders from document.xml (after merging) ------------------
// function getPlaceholdersFromXml(xml) {
//   // strip xml tags -> plain text -> find {{ ... }} occurrences
//   const plain = xml.replace(/<[^>]+>/g, "");
//   const regex = /{{\s*([^}]+?)\s*}}/g;
//   const placeholders = [];
//   let mm;
//   while ((mm = regex.exec(plain))) {
//     placeholders.push(mm[1].trim());
//   }
//   // de-duplicate while preserving order
//   return [...new Set(placeholders)];
// }

// // ------------------ heuristic to find form value for placeholder ------------------
// function toCamelCase(s) {
//   return s
//     .replace(/[^a-zA-Z0-9 ]+/g, " ")
//     .split(" ")
//     .map((w, i) =>
//       i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
//     )
//     .join("");
// }

// function sanitizeValue(val) {
//   if (val === undefined || val === null) return "";
//   let v = String(val);
//   // remove stray template braces inside values (they confuse the parser)
//   v = v.replace(/{{/g, "").replace(/}}/g, "");
//   // collapse newlines to single space (docx templates usually want inline text)
//   v = v.replace(/[\r\n]+/g, " ").trim();
//   return v;
// }

// function getValueForPlaceholder(name, formData) {
//   const raw = name.trim();
//   const candidates = [
//     raw,
//     raw.replace(/\s+/g, ""),
//     raw.replace(/\s+/g, "_"),
//     raw.toLowerCase(),
//     toCamelCase(raw),
//     raw.replace(/[^a-zA-Z0-9_]/g, ""),
//   ];

//   for (const k of candidates) {
//     if (Object.prototype.hasOwnProperty.call(formData, k)) {
//       return sanitizeValue(formData[k]);
//     }
//   }
//   // not found => empty string (safer than leaving undefined)
//   return "";
// }

// // ------------------ normalize template buffer (zip -> document.xml -> merge -> rezip) ------------------
// async function normalizeTemplateBuffer(buffer) {
//   const zip = await JSZip.loadAsync(buffer);
//   const docFile = zip.file("word/document.xml");
//   if (!docFile) return buffer; // nothing to do
//   const docXml = await docFile.async("string");
//   const mergedXml = mergeRunsContainingPlaceholders(docXml);
//   zip.file("word/document.xml", mergedXml);
//   const newBuf = await zip.generateAsync({ type: "nodebuffer" });
//   return { buffer: newBuf, mergedXml };
// }

// // POST endpoint to save form data
// app.post("/api/forms", (req, res) => {
//   const formData = req.body; // { name, email, age }
// //   console.log("Received form data:", formData);

//   // TODO: save to DB here
//   res.status(201).json({ message: "Form saved successfully", data: formData });
// });
// // your helper functions: mergeRunsContainingPlaceholders, getPlaceholdersFromXml, getValueForPlaceholder, normalizeTemplateBuffer
// app.post("/api/generate-doc", async (req, res) => {
//   try {
//     const formData = req.body || {};
//     const format = req.query.format || "docx"; // default DOCX

//     // Template file
//     const templatePath = path.resolve("./templates/LeaseTemplate.docx");
//     if (!fs.existsSync(templatePath)) {
//       return res.status(500).json({ error: "Template file not found on server." });
//     }
//     const templateBuf = fs.readFileSync(templatePath);

//     // Normalize / merge runs
//     const { buffer: normalizedBuf, mergedXml } = await normalizeTemplateBuffer(templateBuf);

//     // Extract placeholders and map data
//     const placeholders = getPlaceholdersFromXml(mergedXml);
//     const mappedData = {};
//     placeholders.forEach((ph) => {
//       mappedData[ph] = getValueForPlaceholder(ph, formData);
//     });

//     // Optional: log missing placeholders
//     const missing = placeholders.filter((ph) => mappedData[ph] === "");
//     if (missing.length) {
//       console.log("Missing placeholders mapped to empty string:", missing);
//     }

//     // Generate DOCX buffer
//     const reportBuffer = await createReport({
//       template: new Uint8Array(normalizedBuf),
//       data: mappedData,
//       cmdDelimiter: ["{{", "}}"],
//     });

//     if (format === "pdf") {
//       // Ensure temp folder exists
//       const tempDir = path.resolve("./templates");
//       if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

//       // Save temporary DOCX file
//       const tempDocxPath = path.join(tempDir, "temp.docx");
//       fs.writeFileSync(tempDocxPath, reportBuffer);

//       // Convert DOCX → PDF
//       const tempPdfPath = path.join(tempDir, "temp.pdf");
//       await DOCX2PDFConverter.convert(tempDocxPath, tempPdfPath);

//       // Read PDF buffer
//       const pdfBuffer = fs.readFileSync(tempPdfPath);

//       // Send PDF
//       res.setHeader("Content-Type", "application/pdf");
//       res.setHeader("Content-Disposition", "attachment; filename=final.pdf");
//       return res.end(pdfBuffer); // ✅ return stops execution here
//     }

//     // Default: send DOCX
//     res.setHeader(
//       "Content-Type",
//       "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
//     );
//     res.setHeader("Content-Disposition", "attachment; filename=final.docx");
//     return res.end(Buffer.from(reportBuffer));

//   } catch (err) {
//     console.error("Error generating document:", err);
//     res.status(500).json({ error: "Failed to generate document", details: err.message || err });
//   }
// });




// // optional: endpoint to inspect template placeholders (helpful for debugging)
// // app.get("/api/template-placeholders", async (req, res) => {
// //   try {
// //     const templatePath = path.resolve("./templates/Leasetemplate.docx");
// //     const templateBuf = fs.readFileSync(templatePath);
// //     const { mergedXml } = await normalizeTemplateBuffer(templateBuf);
// //     const placeholders = getPlaceholdersFromXml(mergedXml);
// //     res.json({ placeholders });
// //   } catch (err) {
// //     res.status(500).json({ error: err.message || String(err) });
// //   }
// // });

// app.listen(PORT, () => {
//   console.log(`Server listening on http://localhost:${PORT}`);
// });

// // app.listen(4000, () => console.log("Server running on http://localhost:4000"));
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";
import fs from "fs";
import AuthRouter from "./auth/routes/AuthRouter.js";

import { generateReport } from "./utils/docUtils.js";
import { getSavePath } from "./utils/fileUtils.js";

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: "5mb" }));
app.use("/api/auth", AuthRouter);


const PORT = 4000;
// server.js (or where your routes are)
const TYPE_MAP = {
  flat: "residential",
  apartment: "residential",
  house: "residential",
  rent: "rent",
  commercial: "commercial",
  industrial: "industrial",
  land: "land",
  deed: "deed",
  // add other synonyms
};

// server (e.g. index.js/server.js)
app.post("/api/forms", (req, res) => {
  try {
    const type = req.query.type || "unknown";
    const formData = req.body || {};
    const format = req.query.format || "docx";
    const destDir = path.resolve(`./saved_forms/${type}`);
    // console.log("[generate-doc] type:", type, "query.format:", format);

    fs.mkdirSync(destDir, { recursive: true });
    const filename = `form_${Date.now()}.json`;
    const savePath = path.join(destDir, filename);
    fs.writeFileSync(savePath, JSON.stringify(formData, null, 2), "utf-8");
    // console.log("Saved form:", savePath);
    return res.json({ ok: true, path: savePath });
  } catch (err) {
    console.error("Save form error:", err);
    return res.status(500).json({ error: "Failed to save form", details: err.message });
  }
});

app.post("/api/generate-doc/:type", async (req, res) => {
  try {
    const requestedType = req.params.type;
    const formData = req.body || {};
    const type = TYPE_MAP[requestedType?.toLowerCase()] || requestedType;
    const format = req.query.format || "docx";

    // console.log("[generate-doc] requestedType:", requestedType, "resolved type:", type);

    const templatePath = path.resolve(`./templates/${type}/Lease${type}Template.docx`);
    // console.log("[generate-doc] checking templatePath:", templatePath, "exists:", fs.existsSync(templatePath));

    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({
        error: `Template not found for type ${requestedType}`,
        checkedPath: templatePath,
        availableTemplates: fs.existsSync(path.resolve("./templates")) ? fs.readdirSync(path.resolve("./templates")) : []
      });
    }

    // Generate buffer
    const buffer = await generateReport(templatePath, formData, format);

    // Save with counter
    const savePath = getSavePath(type, format);
    fs.writeFileSync(savePath, buffer);

    // Send response
    res.setHeader("Content-Type", format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename=${path.basename(savePath)}`);
    return res.end(buffer);

  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Failed to generate document", details: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
