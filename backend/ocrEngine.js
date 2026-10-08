/**
 * SageCure Health Copilot - Clinical OCR & Document Parsing Engine
 * Extracts, chunks, and structures clinical metadata from unstructured lab reports,
 * PDFs, and image screenshots (e.g. WhatsApp screenshots, camera photos).
 */

const fs = require('fs');
const path = require('path');

// Common clinical biomarker dictionary with regex matchers, standard units, and normal reference ranges
const CLINICAL_BIOMARKER_PATTERNS = [
  {
    name: "HbA1c (Glycated Hemoglobin)",
    key: "hba1c",
    regex: /(?:hba1c|glycated\s*h[ae]moglobin|a1c)(?:\s*\([^)]*\))?[\s:\-=]*([0-9]+(?:\.[0-9]+)?)\s*(%?)/i,
    unit: "%",
    normalRange: "< 5.7",
    evaluate: (val) => val >= 6.5 ? { status: "elevated", statusLabel: "High (Diabetic)", percent: 85 } : (val >= 5.7 ? { status: "elevated", statusLabel: "Prediabetic", percent: 65 } : { status: "normal", statusLabel: "Normal", percent: 45 })
  },
  {
    name: "Fasting Blood Glucose",
    key: "fasting_glucose",
    regex: /(?:fasting\s*(?:blood\s*)?(?:sugar|glucose)|fbs)(?:\s*\([^)]*\))?[\s:\-=]*([0-9]+(?:\.[0-9]+)?)\s*(mg\/d[lL]|mmol\/[lL])?/i,
    unit: "mg/dL",
    normalRange: "70 - 99",
    evaluate: (val) => val >= 126 ? { status: "elevated", statusLabel: "High (Diabetic)", percent: 85 } : (val >= 100 ? { status: "elevated", statusLabel: "Impaired Fasting", percent: 68 } : { status: "normal", statusLabel: "Normal", percent: 50 })
  },
  {
    name: "Postprandial Blood Glucose",
    key: "pp_glucose",
    regex: /(?:post[\s-]*prandial|ppbs|pp\s*glucose)(?:\s*\([^)]*\))?[\s:\-=]*([0-9]+(?:\.[0-9]+)?)\s*(mg\/d[lL])?/i,
    unit: "mg/dL",
    normalRange: "< 140",
    evaluate: (val) => val >= 200 ? { status: "elevated", statusLabel: "High (Diabetic)", percent: 90 } : (val >= 140 ? { status: "elevated", statusLabel: "Elevated", percent: 70 } : { status: "normal", statusLabel: "Normal", percent: 45 })
  },
  {
    name: "Total Cholesterol",
    key: "total_cholesterol",
    regex: /(?:total\s*cholesterol|serum\s*cholesterol)(?:\s*\([^)]*\))?[\s:\-=]*([0-9]+(?:\.[0-9]+)?)\s*(mg\/d[lL])?/i,
    unit: "mg/dL",
    normalRange: "< 200",
    evaluate: (val) => val >= 240 ? { status: "elevated", statusLabel: "High Risk", percent: 85 } : (val >= 200 ? { status: "elevated", statusLabel: "Borderline High", percent: 70 } : { status: "normal", statusLabel: "Desirable", percent: 45 })
  },
  {
    name: "LDL Cholesterol",
    key: "ldl",
    regex: /(?:ldl(?:\s*cholesterol)?|low\s*density\s*lipoprotein)(?:\s*\([^)]*\))?[\s:\-=]*([0-9]+(?:\.[0-9]+)?)\s*(mg\/d[lL])?/i,
    unit: "mg/dL",
    normalRange: "< 100",
    evaluate: (val) => val >= 160 ? { status: "elevated", statusLabel: "High", percent: 85 } : (val >= 130 ? { status: "elevated", statusLabel: "Borderline", percent: 65 } : { status: "normal", statusLabel: "Optimal", percent: 40 })
  },
  {
    name: "HDL Cholesterol",
    key: "hdl",
    regex: /(?:hdl(?:\s*cholesterol)?|high\s*density\s*lipoprotein)(?:\s*\([^)]*\))?[\s:\-=]*([0-9]+(?:\.[0-9]+)?)\s*(mg\/d[lL])?/i,
    unit: "mg/dL",
    normalRange: "> 40",
    evaluate: (val) => val < 40 ? { status: "low", statusLabel: "Low (Suboptimal)", percent: 35 } : { status: "normal", statusLabel: "Protective", percent: 75 }
  },
  {
    name: "Serum Triglycerides",
    key: "triglycerides",
    regex: /(?:triglycerides|tg)(?:\s*\([^)]*\))?[\s:\-=]*([0-9]+(?:\.[0-9]+)?)\s*(mg\/d[lL])?/i,
    unit: "mg/dL",
    normalRange: "< 150",
    evaluate: (val) => val >= 200 ? { status: "elevated", statusLabel: "High", percent: 85 } : (val >= 150 ? { status: "elevated", statusLabel: "Borderline", percent: 65 } : { status: "normal", statusLabel: "Normal", percent: 45 })
  },
  {
    name: "Hemoglobin (Hb)",
    key: "hemoglobin",
    regex: /(?:h[ae]moglobin|hb)(?:\s*\([^)]*\))?[\s:\-=]*([0-9]+(?:\.[0-9]+)?)\s*(g\/d[lL]|gm%)?/i,
    unit: "g/dL",
    normalRange: "13.0 - 17.5",
    evaluate: (val) => val < 11.5 ? { status: "low", statusLabel: "Low (Anemia)", percent: 30 } : (val < 13.0 ? { status: "low", statusLabel: "Mild Low", percent: 42 } : { status: "normal", statusLabel: "Normal", percent: 60 })
  },
  {
    name: "Platelet Count",
    key: "platelets",
    regex: /(?:platelet(?:s)?(?:\s*count)?|thrombocyte(?:s)?)(?:\s*\([^)]*\))?[\s:\-=]*([0-9]+(?:,[0-9]+)?(?:\.[0-9]+)?)\s*(?:\/µ[lL]|\/cumm|lakhs?|k)?/i,
    unit: "/µL",
    normalRange: "150,000 - 450,000",
    evaluate: (val) => {
      let num = typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : val;
      if (num < 100) num = num * 100000; // if given in lakhs e.g. 1.4
      return num < 150000 ? { status: "low", statusLabel: "Thrombocytopenia", percent: 30 } : { status: "normal", statusLabel: "Normal", percent: 60 };
    }
  },
  {
    name: "Total Leukocyte Count (WBC)",
    key: "wbc",
    regex: /(?:wbc(?:\s*count)?|total\s*leukocyte|tlc)(?:\s*\([^)]*\))?[\s:\-=]*([0-9]+(?:,[0-9]+)?(?:\.[0-9]+)?)\s*(?:\/µ[lL]|\/cumm)?/i,
    unit: "/µL",
    normalRange: "4,500 - 11,000",
    evaluate: (val) => {
      let num = typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : val;
      return num > 11000 ? { status: "elevated", statusLabel: "Elevated (Infection)", percent: 80 } : (num < 4500 ? { status: "low", statusLabel: "Leukopenia", percent: 30 } : { status: "normal", statusLabel: "Normal", percent: 55 });
    }
  },
  {
    name: "Serum Creatinine",
    key: "creatinine",
    regex: /(?:creatinine|serum\s*creat)(?:\s*\([^)]*\))?[\s:\-=]*([0-9]+(?:\.[0-9]+)?)\s*(mg\/d[lL])?/i,
    unit: "mg/dL",
    normalRange: "0.7 - 1.3",
    evaluate: (val) => val > 1.3 ? { status: "elevated", statusLabel: "Elevated (Renal Strain)", percent: 80 } : { status: "normal", statusLabel: "Normal", percent: 50 }
  },
  {
    name: "Thyroid Stimulating Hormone (TSH)",
    key: "tsh",
    regex: /(?:tsh|thyroid\s*stimulating\s*hormone)(?:\s*\([^)]*\))?[\s:\-=]*([0-9]+(?:\.[0-9]+)?)\s*(µIU\/m[lL]|uIU\/m[lL])?/i,
    unit: "µIU/mL",
    normalRange: "0.4 - 4.5",
    evaluate: (val) => val > 4.5 ? { status: "elevated", statusLabel: "High (Hypothyroidism)", percent: 85 } : (val < 0.4 ? { status: "low", statusLabel: "Low (Hyperthyroidism)", percent: 30 } : { status: "normal", statusLabel: "Normal (Euthyroid)", percent: 50 })
  }
];

/**
 * Extract text streams and legible ASCII from uploaded document buffers
 */
function extractTextFromBuffer(buffer, mimetype, filename) {
  if (!buffer || buffer.length === 0) return "";

  // 1. Plain text or json
  if (mimetype && (mimetype.includes('text') || mimetype.includes('json'))) {
    return buffer.toString('utf8');
  }

  // 2. PDF Document text stream extraction
  if (filename && filename.toLowerCase().endsWith('.pdf')) {
    const rawStr = buffer.toString('binary');
    const textPieces = [];
    
    // Match PDF text operators BT ... ET and Tj / TJ commands
    const textObjRegex = /BT[\s\S]*?ET/g;
    let match;
    while ((match = textObjRegex.exec(rawStr)) !== null) {
      const block = match[0];
      // Match literal strings in parens: (Hello World) Tj
      const strRegex = /\(([^)]+)\)\s*(?:Tj|'|")/g;
      let strMatch;
      while ((strMatch = strRegex.exec(block)) !== null) {
        textPieces.push(strMatch[1]);
      }
      // Match array of strings: [(Hello) 10 (World)] TJ
      const arrayRegex = /\[([^\]]+)\]\s*TJ/g;
      let arrMatch;
      while ((arrMatch = arrayRegex.exec(block)) !== null) {
        const inner = arrMatch[1].replace(/\(([^)]+)\)/g, '$1 ');
        textPieces.push(inner);
      }
    }

    if (textPieces.length > 5) {
      return textPieces.join(' ').replace(/\s+/g, ' ').trim();
    }
  }

  // 3. Fallback: Extract all printable ASCII sequences (min length 4)
  const asciiMatches = buffer.toString('latin1').match(/[A-Za-z0-9,.:;%()/\-+=<>\n\r\t ]{4,}/g);
  if (asciiMatches && asciiMatches.length > 0) {
    const cleanLines = asciiMatches
      .map(s => s.trim())
      .filter(s => s.length > 4 && /[A-Za-z]{3,}/.test(s));
    if (cleanLines.length > 3) {
      return cleanLines.join('\n');
    }
  }

  return "";
}

/**
 * Scan raw or OCR-extracted text and extract structured clinical biomarkers
 */
function parseClinicalBiomarkersFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const results = [];
  const foundKeys = new Set();

  for (const item of CLINICAL_BIOMARKER_PATTERNS) {
    const match = item.regex.exec(text);
    if (match && !foundKeys.has(item.key)) {
      foundKeys.add(item.key);
      const valStr = match[1].replace(/,/g, '');
      const numVal = parseFloat(valStr);
      if (!isNaN(numVal)) {
        const evalResult = item.evaluate(numVal);
        results.push({
          name: item.name,
          value: numVal,
          unit: item.unit,
          range: item.normalRange,
          status: evalResult.status,
          statusLabel: evalResult.statusLabel,
          percent: evalResult.percent
        });
      }
    }
  }

  return results;
}

/**
 * Detect patient demographic information from unstructured text
 */
function parseDemographicsFromText(text) {
  if (!text) return null;
  const patient = {};

  const nameMatch = text.match(/(?:patient(?:\s*name)?|name)[\s:]+([A-Za-z\s.]{3,30})(?:\r|\n|,|age|gender|$)/i);
  if (nameMatch && nameMatch[1]) {
    patient.name = nameMatch[1].trim();
  }

  const ageMatch = text.match(/(?:age|yrs|years)[\s:]*([0-9]{1,3})/i);
  if (ageMatch && ageMatch[1]) {
    patient.age = ageMatch[1];
  }

  const genderMatch = text.match(/(?:gender|sex)[\s:]*(male|female|m|f|transgender)/i);
  if (genderMatch && genderMatch[1]) {
    const g = genderMatch[1].toLowerCase();
    patient.gender = (g === 'm' || g === 'male') ? 'Male' : ((g === 'f' || g === 'female') ? 'Female' : 'Adult');
  }

  const facilityMatch = text.match(/(?:apollo|metropolis|lal\s*path|max|fortis|aiims|dr\s*dang|pathology|diagnostic)/i);
  if (facilityMatch) {
    patient.facility = `${facilityMatch[0]} Laboratory & Diagnostics`;
  }

  return Object.keys(patient).length > 0 ? patient : null;
}

/**
 * Chunk unstructured OCR text into clean, structured clinical payload blocks
 * specifically designed to guarantee Make.com and clinical LLMs parse without error.
 */
function formatOcrPayloadForMake(rawOcrText, filename, patientName, clientOcrChunks) {
  const cleanText = (rawOcrText || '').trim();
  const biomarkers = parseClinicalBiomarkersFromText(cleanText);
  const demographics = parseDemographicsFromText(cleanText) || {};

  // Split into readable paragraphs/chunks of ~300 words
  const words = cleanText.split(/\s+/);
  const chunks = [];
  const chunkSize = 250;
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
  }

  // Synthesize structured clinical metadata header
  const metadataHeader = [
    `=== SAGECURE CLINICAL OCR METADATA EXTRACTION ===`,
    `Source Document: ${filename || 'Medical_Image_Report'}`,
    `Patient Context: ${demographics.name || patientName || 'Patient'}`,
    `Extracted Biomarkers Count: ${biomarkers.length}`,
    biomarkers.length > 0 
      ? `Detected Analytes:\n` + biomarkers.map(b => `  - ${b.name}: ${b.value} ${b.unit} [${b.statusLabel}] (Ref: ${b.range})`).join('\n')
      : `No standard numeric biomarkers detected in immediate regex; raw text provided below.`
  ].join('\n');

  const combinedFullText = [
    metadataHeader,
    `\n=== UNSTRUCTURED CLINICAL TEXT CHUNKS ===`,
    chunks.length > 0 ? chunks.map((c, i) => `[Chunk ${i + 1}]\n${c}`).join('\n\n') : cleanText
  ].join('\n');

  return {
    rawText: cleanText,
    structuredText: combinedFullText,
    biomarkers,
    demographics,
    chunks: chunks.length > 0 ? chunks : [cleanText],
    metadataHeader
  };
}

module.exports = {
  extractTextFromBuffer,
  parseClinicalBiomarkersFromText,
  parseDemographicsFromText,
  formatOcrPayloadForMake,
  CLINICAL_BIOMARKER_PATTERNS
};
