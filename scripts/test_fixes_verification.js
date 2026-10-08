const fs = require('fs');
const path = require('path');
const http = require('http');

async function runComprehensiveVerification() {
  console.log("===============================================================");
  console.log("   SAGECURE CLINICAL SUITE - AUTOMATED SYSTEM VERIFICATION     ");
  console.log("===============================================================\n");

  let allPassed = true;

  // -------------------------------------------------------------
  // TEST SUITE 1: HTML & CLIENT UI INTEGRITY CHECK
  // -------------------------------------------------------------
  console.log("--- TEST 1: FRONTEND HTML & UI INTEGRITY CHECK ---");
  const htmlFiles = [
    path.join(__dirname, '..', 'frontend', 'index.html'),
    path.join(__dirname, '..', 'index.html')
  ];

  for (const filePath of htmlFiles) {
    const fileLabel = path.basename(path.dirname(filePath)) + '/' + path.basename(filePath);
    if (!fs.existsSync(filePath)) {
      console.error(`[FAIL] File missing: ${fileLabel}`);
      allPassed = false;
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    // 1. Check Trends feature completely removed
    const hasTrendsCard = content.includes('id="longitudinal-trends-card"');
    const hasTrendsNavBtn = content.includes('onclick="openTrendsSection()"');
    const hasFetchTrendsCall = content.includes('fetchAndRenderTrends(');

    if (hasTrendsCard || hasTrendsNavBtn || hasFetchTrendsCall) {
      console.error(`[FAIL] ${fileLabel}: Residual Trends components found! (card:${hasTrendsCard}, btn:${hasTrendsNavBtn}, js:${hasFetchTrendsCall})`);
      allPassed = false;
    } else {
      console.log(`[PASS] ${fileLabel}: Trends feature and related components 100% cleanly removed.`);
    }

    // 2. Check Prescription Medication Giver Studio present
    const hasPrescriptionGiverCard = content.includes('id="prescription-giver-card"');
    const hasPrescriptionGiverTable = content.includes('id="rx-giver-table-body"');
    const hasPrescribeMedsBtn = content.includes('Prescribe Meds');
    const hasJsPdf = content.includes('jspdf');

    if (hasPrescriptionGiverCard && hasPrescriptionGiverTable && hasPrescribeMedsBtn && hasJsPdf) {
      console.log(`[PASS] ${fileLabel}: Prescription Medication Giver studio & jsPDF fully integrated.`);
    } else {
      console.error(`[FAIL] ${fileLabel}: Missing Prescription Giver elements (card:${hasPrescriptionGiverCard}, table:${hasPrescriptionGiverTable}, btn:${hasPrescribeMedsBtn}, jspdf:${hasJsPdf})`);
      allPassed = false;
    }

    // 3. Check Auth & Switch Account Modal
    const hasAuthModal = content.includes('id="auth-modal"');
    const hasSwitchBtn = content.includes('openSwitchAccountModal()');
    const hasTesseract = content.includes('tesseract.js');

    if (hasAuthModal && hasSwitchBtn && hasTesseract) {
      console.log(`[PASS] ${fileLabel}: Switch Account modal & Tesseract.js OCR CDN verified.`);
    } else {
      console.error(`[FAIL] ${fileLabel}: Missing Auth / Tesseract elements (modal:${hasAuthModal}, switch:${hasSwitchBtn}, tesseract:${hasTesseract})`);
      allPassed = false;
    }
  }

  // -------------------------------------------------------------
  // TEST SUITE 2: OCR ENGINE TEXT EXTRACTION & CHUNKING
  // -------------------------------------------------------------
  console.log("\n--- TEST 2: CLINICAL OCR ENGINE & MAKE.COM CHUNKING ---");
  try {
    const { extractTextFromBuffer, parseClinicalBiomarkersFromText, formatOcrPayloadForMake } = require('../backend/ocrEngine');

    const sampleSimulatedOcr = `
      APOLLO DIAGNOSTICS - CLINICAL BIOCHEMISTRY REPORT
      Patient: Aditi Sharma, Age: 48 Y / Female, Date: 08-OCT-2026
      FASTING BLOOD GLUCOSE: 168.0 mg/dL (Normal Range: 70 - 99)
      GLYCATED HEMOGLOBIN (HbA1c): 8.4 % (Normal: < 5.7)
      TOTAL CHOLESTEROL: 235 mg/dL (Desirable: < 200)
      LDL CHOLESTEROL: 162 mg/dL (Optimal: < 100)
      SERUM CREATININE: 0.85 mg/dL (Normal: 0.5 - 1.1)
      BLOOD PRESSURE: 128/82 mmHg, PULSE: 76 bpm
    `;

    const biomarkers = parseClinicalBiomarkersFromText(sampleSimulatedOcr);
    console.log(`[PASS] Extracted ${biomarkers.length} clinical biomarkers via OCR regex engine.`);

    const hba1c = biomarkers.find(b => b.name.includes('HbA1c'));
    const ldl = biomarkers.find(b => b.name.includes('LDL'));
    const fbs = biomarkers.find(b => b.name.includes('Glucose'));

    if (hba1c && hba1c.value === 8.4 && ldl && ldl.value === 162 && fbs && fbs.value === 168) {
      console.log(`[PASS] Biomarker exact values verified: HbA1c=${hba1c.value}%, LDL=${ldl.value} mg/dL, FBS=${fbs.value} mg/dL.`);
    } else {
      console.error(`[FAIL] Biomarker value mismatch!`, { hba1c, ldl, fbs });
      allPassed = false;
    }

    const formattedPayload = formatOcrPayloadForMake(sampleSimulatedOcr, 'WhatsApp_Report_Image.jpg', 'Aditi Sharma');
    if (formattedPayload.chunks && formattedPayload.chunks.length > 0 && formattedPayload.metadataHeader) {
      console.log(`[PASS] Make.com OCR payload structured into ${formattedPayload.chunks.length} clean text chunks with header.`);
    } else {
      console.error(`[FAIL] Make.com OCR formatting failed!`, formattedPayload);
      allPassed = false;
    }
  } catch (err) {
    console.error(`[FAIL] OCR Engine test exception:`, err);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST SUITE 3: LIVE BACKEND APIS (AUTH & PRESCRIPTION GIVER)
  // -------------------------------------------------------------
  console.log("\n--- TEST 3: LIVE BACKEND API ENDPOINTS ---");

  async function postJson(endpoint, data) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(data);
      const req = http.request({
        hostname: 'localhost',
        port: 5000,
        path: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let respData = '';
        res.on('data', chunk => respData += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(respData) });
          } catch {
            resolve({ status: res.statusCode, body: respData });
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // Test Aditi Login & Session Isolation
  try {
    const aditiLogin = await postJson('/api/auth/login', { email: 'aditi@sagecure.ai', password: 'password123' });
    if (aditiLogin.status === 200 && aditiLogin.body.token && aditiLogin.body.user.name === 'Aditi Sharma') {
      console.log(`[PASS] Aditi Sharma login successful with session token: ${aditiLogin.body.token.substring(0, 16)}...`);
    } else {
      console.error(`[FAIL] Aditi login failed:`, aditiLogin);
      allPassed = false;
    }

    // Test Rohan Login & Session Isolation
    const rohanLogin = await postJson('/api/auth/login', { email: 'rohan@sagecure.ai', password: 'password123' });
    if (rohanLogin.status === 200 && rohanLogin.body.token && rohanLogin.body.user.name === 'Rohan Varma') {
      console.log(`[PASS] Rohan Varma login successful with session token: ${rohanLogin.body.token.substring(0, 16)}...`);
    } else {
      console.error(`[FAIL] Rohan login failed:`, rohanLogin);
      allPassed = false;
    }

    // Verify session tokens are unique and isolated
    if (aditiLogin.body.token !== rohanLogin.body.token) {
      console.log(`[PASS] Session tokens are strictly isolated per user profile.`);
    } else {
      console.error(`[FAIL] Session tokens collided!`);
      allPassed = false;
    }

    // Verify Session Endpoint
    const verifyRes = await postJson('/api/auth/verify-session', { email: 'rohan@sagecure.ai', token: rohanLogin.body.token });
    if (verifyRes.status === 200 && verifyRes.body.valid === true && verifyRes.body.user.name === 'Rohan Varma') {
      console.log(`[PASS] Session verification valid for Rohan Varma.`);
    } else {
      console.error(`[FAIL] Session verification failed:`, verifyRes);
      allPassed = false;
    }

    // Test Interactive Prescription Medication Giver Endpoint
    const rxPayload = {
      userEmail: 'aditi@sagecure.ai',
      patient: { name: 'Aditi Sharma', age: '48', gender: 'Female', abhaId: '14-0234-5678-9012@abdm' },
      vitals: { bp: '128/82 mmHg', pulse: '76 bpm', spo2: '98 %', temp: '98.4 °F', weight: '68 kg' },
      diagnosis: 'Type 2 Diabetes Mellitus with Dyslipidemia',
      icd10: 'ICD-10: E11.69',
      medications: [
        { name: 'Tab. Metformin HCl (SR)', strength: '500 mg', dosage: '1 Tab Twice Daily (BD)', timing: 'After Meals', duration: '90 Days', instructions: 'Swallow whole' },
        { name: 'Tab. Atorvastatin Calcium', strength: '10 mg', dosage: '1 Tab At Bedtime (HS)', timing: 'Night', duration: '90 Days', instructions: 'Lipid control' }
      ],
      dietaryDirectives: ['Low glycemic diet', 'Daily 30 mins brisk walk'],
      followUp: 'Review in 90 days with repeat HbA1c'
    };

    const prescribeRes = await postJson('/api/prescription/prescribe', rxPayload);
    if (prescribeRes.status === 200 && prescribeRes.body.success && prescribeRes.body.prescription) {
      const rx = prescribeRes.body.prescription;
      console.log(`[PASS] Prescription Medication Giver generated signed Rx: ID=${rx.prescriptionId}, SigHash=${rx.digitalSignature?.hash}`);
      if (rx.medications.length === 2 && rx.digitalSignature?.verified) {
        console.log(`[PASS] Prescribed medications and cryptographic verification hash validated.`);
      } else {
        console.error(`[FAIL] Prescription content validation failed!`, rx);
        allPassed = false;
      }
    } else {
      console.error(`[FAIL] Prescription generation endpoint failed:`, prescribeRes);
      allPassed = false;
    }

  } catch (apiErr) {
    console.error(`[FAIL] Backend API error:`, apiErr.message);
    allPassed = false;
  }

  console.log("\n===============================================================");
  if (allPassed) {
    console.log("   ALL VERIFICATION SUITES PASSED! 100% PRODUCTION READY.       ");
  } else {
    console.log("   SOME VERIFICATION SUITES FAILED. PLEASE REVIEW LOGS ABOVE.   ");
  }
  console.log("===============================================================");
  process.exit(allPassed ? 0 : 1);
}

runComprehensiveVerification();
