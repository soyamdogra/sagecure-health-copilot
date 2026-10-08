const fs = require('fs');
const path = require('path');

function auditFile(filePath) {
  console.log(`\n======================================================`);
  console.log(`AUDITING FILE: ${filePath}`);
  console.log(`======================================================`);

  const content = fs.readFileSync(filePath, 'utf8');

  // 1. Check all onclick="..." handlers
  const onclickRegex = /onclick\s*=\s*["']([^"']+)["']/gi;
  const onclickCalls = [];
  let match;
  while ((match = onclickRegex.exec(content)) !== null) {
    onclickCalls.push(match[1].trim());
  }
  console.log(`\nFound ${onclickCalls.length} onclick handlers in HTML:`);

  // Extract function names from onclicks (e.g. "openFhirExportModal()" -> "openFhirExportModal", "window.print()" -> built-in)
  const missingFunctions = [];
  const checkedFunctions = new Set();

  onclickCalls.forEach(call => {
    const fnMatch = call.match(/^([a-zA-Z0-9_$]+)\s*\(/);
    if (fnMatch) {
      const fnName = fnMatch[1];
      if (['window', 'alert', 'console'].includes(fnName)) return;
      if (checkedFunctions.has(fnName)) return;
      checkedFunctions.add(fnName);

      // Check if function is defined in script
      const defRegex = new RegExp(`function\\s+${fnName}\\b|const\\s+${fnName}\\s*=|let\\s+${fnName}\\s*=|var\\s+${fnName}\\s*=`, 'g');
      if (!defRegex.test(content)) {
        missingFunctions.push({ call, fnName });
      }
    }
  });

  if (missingFunctions.length === 0) {
    console.log(`✅ All ${checkedFunctions.size} distinct onclick functions are properly defined in <script>!`);
  } else {
    console.error(`❌ MISSING onclick functions found:`, missingFunctions);
  }

  // 2. Check all getElementById calls
  const getByIdRegex = /document\.getElementById\s*\(\s*["']([^"']+)["']\s*\)/g;
  const referencedIds = new Set();
  while ((match = getByIdRegex.exec(content)) !== null) {
    referencedIds.add(match[1]);
  }
  console.log(`\nFound ${referencedIds.size} distinct document.getElementById calls in <script>:`);

  const missingIds = [];
  referencedIds.forEach(id => {
    // Check if id exists in HTML
    const idRegex = new RegExp(`id\\s*=\\s*["']${id}["']`, 'i');
    if (!idRegex.test(content)) {
      missingIds.push(id);
    }
  });

  if (missingIds.length === 0) {
    console.log(`✅ All ${referencedIds.size} referenced element IDs exist in the HTML DOM!`);
  } else {
    console.warn(`⚠️ The following ${missingIds.length} element IDs referenced in JS are not found in HTML:`, missingIds);
  }

  // 3. Check LOINC codes in dictionary
  console.log(`\nChecking LOINC terminology mappings:`);
  const loinc4548 = content.includes('4548-4');
  const loinc1558 = content.includes('1558-6');
  const loinc2093 = content.includes('2093-3');
  const loinc718 = content.includes('718-7');
  const loinc2160 = content.includes('2160-0');
  console.log(`- HbA1c (4548-4):`, loinc4548 ? '✅ Present' : '❌ Missing');
  console.log(`- Fasting Glucose (1558-6):`, loinc1558 ? '✅ Present' : '❌ Missing');
  console.log(`- Cholesterol (2093-3):`, loinc2093 ? '✅ Present' : '❌ Missing');
  console.log(`- Hemoglobin (718-7):`, loinc718 ? '✅ Present' : '❌ Missing');
  console.log(`- Creatinine (2160-0):`, loinc2160 ? '✅ Present' : '❌ Missing');

  // 4. Check emergency triage keywords
  console.log(`\nChecking Emergency Triage keyword coverage:`);
  const hasChestPain = /chest\s+pain/i.test(content);
  const hasBreath = /difficulty.*breath|shortness\s+of\s+breath/i.test(content);
  const hasStroke = /stroke/i.test(content);
  const has112 = content.includes('112');
  const has102 = content.includes('102');
  console.log(`- Chest Pain pattern:`, hasChestPain ? '✅ Present' : '❌ Missing');
  console.log(`- Respiratory pattern:`, hasBreath ? '✅ Present' : '❌ Missing');
  console.log(`- Stroke pattern:`, hasStroke ? '✅ Present' : '❌ Missing');
  console.log(`- National Emergency 112:`, has112 ? '✅ Present' : '❌ Missing');
  console.log(`- Ambulance 102:`, has102 ? '✅ Present' : '❌ Missing');

  return { missingFunctions, missingIds };
}

const res1 = auditFile(path.join(__dirname, 'frontend', 'index.html'));
const res2 = auditFile(path.join(__dirname, 'index.html'));

if (res1.missingFunctions.length > 0 || res2.missingFunctions.length > 0) {
  process.exit(1);
}
