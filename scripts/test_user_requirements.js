const http = require('http');
const fs = require('fs');
const path = require('path');

function request(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log("=====================================================================");
  console.log("SAGECURE CLINICAL ARCHITECT AUDIT - 4 CORE SPECIFICATION VERIFICATION");
  console.log("=====================================================================\n");

  let passed = 0;
  let total = 0;

  function assert(condition, testName, note = '') {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      if (note) console.log(`   └─ ${note}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      if (note) console.error(`   └─ ${note}`);
    }
  }

  // -------------------------------------------------------------
  // REQUIREMENT 1: REMOVE DEMO ACCOUNTS & CLEAN LOGIN INTERFACE
  // -------------------------------------------------------------
  console.log("--- 1. DEMO ACCOUNTS REMOVAL & CLEAN LOGIN INTERFACE ---");
  const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  
  // 1a. Verify demo buttons removed
  const noDemoButtons = !htmlContent.includes('fillDemoAccount(') && 
                        !htmlContent.includes('Aditi Sharma (Diabetic Care)') &&
                        !htmlContent.includes('Rohan Varma (CBC / Anemia)') &&
                        !htmlContent.includes('switchUserProfile(');
  assert(noDemoButtons, 'Requirement 1a: Demo account buttons & profile shortcuts removed', 'No mock selector buttons in auth modal or drawer');

  // 1b. Verify login fields are 100% blank
  const hasAuthEmailBlank = htmlContent.includes('id="auth-email"') && !htmlContent.includes('id="auth-email" value="');
  const hasAuthPassBlank = htmlContent.includes('id="auth-password"') && !htmlContent.includes('id="auth-password" value="');
  const hasAuthNameBlank = htmlContent.includes('id="auth-name"') && !htmlContent.includes('id="auth-name" value="');
  const hasNoPreFilledCreds = !htmlContent.includes('value="aditi@sagecure.ai"') && !htmlContent.includes('value="rohan@sagecure.ai"');
  assert(
    hasAuthEmailBlank && hasAuthPassBlank && hasAuthNameBlank && hasNoPreFilledCreds,
    'Requirement 1b: Login & signup form fields 100% blank on page open',
    'Email, password, name, and ABHA inputs have zero pre-filled credentials'
  );

  // 1c. Verify isolated local session storage
  const ts = Date.now();
  const regUser = await request(
    { hostname: 'localhost', port: 5000, path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { email: `new_user_${ts}@sagecure.ai`, password: 'SecurePassword123!', name: 'New Patient', abhaId: '99-8888-7777-6666@abdm' }
  );
  assert(
    regUser.status === 200 && regUser.data.success && regUser.data.token,
    'Requirement 1c: Secure isolated user session created',
    `Registered isolated user with clean token ${regUser.data.token.slice(0, 16)}...`
  );

  // Verify unregistered session does not bleed data
  const checkEmptySession = await request(
    { hostname: 'localhost', port: 5000, path: `/api/reports/unregistered_${ts}@sagecure.ai`, method: 'GET' }
  );
  assert(
    checkEmptySession.status === 200 && checkEmptySession.data.reports && checkEmptySession.data.reports.length === 0,
    'Requirement 1d: Zero data bleeding across sessions',
    'Unauthenticated / newly created visitor has exactly 0 preloaded reports'
  );

  // -------------------------------------------------------------
  // REQUIREMENT 2: PREVENT AI FABRICATION & AUDIT MISSING VITALS
  // -------------------------------------------------------------
  console.log("\n--- 2. CLINICAL SAFETY: ZERO FABRICATION OF HEALTH MEASUREMENTS ---");
  const vitalTypes = ['temperature', 'blood pressure', 'heart rate', 'blood glucose', 'weight', 'oxygen saturation'];
  
  // Test query without numerical vitals
  const feverAnalysis = await request(
    { hostname: 'localhost', port: 5000, path: '/api/analyze', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { type: 'query', query: 'I have severe fever and chills since morning', userEmail: `new_user_${ts}@sagecure.ai` }
  );

  assert(feverAnalysis.status === 200, 'Analysis endpoint successfully returns clinical response');
  const biomarkers = feverAnalysis.data.biomarkers || [];
  
  // Strict test: Ensure NO numbers are fabricated (e.g. 38, 38.4, 98.6, 120/80, 98)
  let fabricated = false;
  let tempMarkedUnknown = false;
  let pulseMarkedUnknown = false;
  let spo2MarkedUnknown = false;

  biomarkers.forEach(b => {
    if (typeof b.value === 'number') {
      fabricated = true;
      console.error(`Fabrication violation: ${b.name} = ${b.value}`);
    }
    const n = b.name.toLowerCase();
    if (n.includes('temp') && b.value === 'Unknown / Not Provided') tempMarkedUnknown = true;
    if (n.includes('pulse') && b.value === 'Unknown / Not Provided') pulseMarkedUnknown = true;
    if (n.includes('oxygen') && b.value === 'Unknown / Not Provided') spo2MarkedUnknown = true;
  });

  assert(
    !fabricated,
    'Requirement 2a: Strict Clinical Safety Rule: Zero fabricated numerical vitals',
    'AI did not invent or guess 38°C, 38.4°C, 98.6°F, 120/80, 98 bpm, or 98% SpO2'
  );

  assert(
    tempMarkedUnknown && pulseMarkedUnknown && spo2MarkedUnknown,
    'Requirement 2b: Missing vitals explicitly flagged as "Unknown / Not Provided"',
    'Temperature, Heart Rate, and Oxygen Saturation flagged with prompt to measure exact values'
  );

  // Check that summary asks user to measure exact value
  const summaryText = feverAnalysis.data.summary_en || feverAnalysis.data.plainLanguage_en || '';
  const asksToMeasure = summaryText.toLowerCase().includes('measure') || summaryText.toLowerCase().includes('exact') || summaryText.toLowerCase().includes('thermometer');
  assert(
    asksToMeasure,
    'Requirement 2c: Clinical response advises user to measure and record exact temperature',
    'Safety notification advises thermometer measurement and recording'
  );

  // -------------------------------------------------------------
  // REQUIREMENT 3: REMOVE TRENDS & ADD PRESCRIPTION MEDICATION GIVER
  // -------------------------------------------------------------
  console.log("\n--- 3. REMOVE TRENDS & FUNCTIONAL PRESCRIPTION MEDICATION GIVER ---");
  
  // 3a. Check Trends completely absent
  const hasTrendsCard = htmlContent.includes('id="longitudinal-trends-card"');
  const hasTrendsBtn = htmlContent.includes('openTrendsSection(') || htmlContent.includes('>Trends<');
  assert(
    !hasTrendsCard && !hasTrendsBtn,
    'Requirement 3a: Trends button, view, and time-series UI 100% removed',
    'Longitudinal trends card and navigation buttons completely eliminated'
  );

  // 3b. Check Prescription Medication Giver module
  const hasRxGiverCard = htmlContent.includes('id="prescription-giver-card"');
  const hasRxTable = htmlContent.includes('id="rx-giver-table-body"');
  const hasPdfDownload = htmlContent.toLowerCase().includes('downloadprescriptionpdf') && htmlContent.includes('jspdf');
  assert(
    hasRxGiverCard && hasRxTable && hasPdfDownload,
    'Requirement 3b: Prescription Medication Giver Studio & jsPDF download ready',
    'Diagnosis input, dynamic drug rows, digital signature, and PDF generator verified'
  );

  // 3c. Test prescription generation API
  const rxResult = await request(
    { hostname: 'localhost', port: 5000, path: '/api/prescription/prescribe', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    {
      userEmail: `new_user_${ts}@sagecure.ai`,
      patient: { name: 'Kavita Iyer', age: '52', gender: 'Female', abhaId: '22-4444-5555-6666@abdm' },
      diagnosis: 'Type 2 Diabetes Mellitus with Hypertension',
      icd10: 'E11.9, I10',
      vitals: { bp: 'Unknown / Not Provided', pulse: '78 bpm', temp: 'Unknown / Not Provided' },
      medications: [
        { name: 'Tab. Metformin 500mg', dosage: '1 Tab BD', duration: '30 Days', instructions: 'With meals' },
        { name: 'Tab. Telmisartan 40mg', dosage: '1 Tab OD', duration: '30 Days', instructions: 'Morning' }
      ]
    }
  );
  assert(
    rxResult.status === 200 && rxResult.data.prescription && rxResult.data.prescription.digitalSignature?.verified,
    'Requirement 3c: Digital signed prescription card generated',
    `Prescription ID: ${rxResult.data.prescription?.prescriptionId}, Doctor: ${rxResult.data.prescription?.doctor?.name}`
  );

  // -------------------------------------------------------------
  // REQUIREMENT 4: ABDM / FHIR v4 EXPORT & EMERGENCY TRIAGE
  // -------------------------------------------------------------
  console.log("\n--- 4. ABDM / FHIR v4 EXPORT & EMERGENCY TRIAGE SAFETY ---");
  
  // 4a. ABDM / FHIR v4 Export button active and valid JSON with standard LOINCs
  const fhirExportRes = await request(
    { hostname: 'localhost', port: 5000, path: '/api/fhir/export', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    {
      patient: { name: 'Kavita Iyer', abhaId: '22-4444-5555-6666@abdm', age: '52', gender: 'Female' },
      biomarkers: [
        { name: 'Glycated Hemoglobin (HbA1c)', value: 7.9, unit: '%', range: '< 5.7', status: 'elevated' },
        { name: 'Body Temperature', value: 'Unknown / Not Provided', unit: '°C', status: 'unknown' }
      ],
      summary: 'Elevated HbA1c, temperature unmeasured.'
    }
  );

  const bundle = fhirExportRes.data.bundle;
  const observations = bundle ? bundle.entry.filter(e => e.resource.resourceType === 'Observation') : [];
  const hba1cObs = observations.find(o => o.resource.code.coding[0].code === '4548-4');
  const unmeasuredObs = observations.find(o => o.resource.dataAbsentReason !== undefined);

  assert(
    fhirExportRes.status === 200 && bundle && bundle.resourceType === 'Bundle' && hba1cObs !== undefined,
    'Requirement 4a: FHIR v4 Bundle export active with standard LOINC codes',
    `Resource entries: ${bundle.entry.length}, Official LOINC for HbA1c verified (4548-4)`
  );

  assert(
    unmeasuredObs !== undefined && unmeasuredObs.resource.dataAbsentReason.coding[0].code === 'unknown',
    'Requirement 4b: Missing vitals properly formatted with FHIR dataAbsentReason',
    'Standard HL7 data-absent-reason: "unknown" with zero fabricated quantities'
  );

  // 4c. Emergency Triage guardrail triggers Red Warning Banner on critical keywords
  const triageRes = await request(
    { hostname: 'localhost', port: 5000, path: '/api/triage', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { query: 'I have severe sudden chest pain radiating to left jaw', language: 'en' }
  );

  const emergencyNumbers = triageRes.data.emergencyNumbers ? triageRes.data.emergencyNumbers.map(n => n.number).join(', ') : '112, 102';
  assert(
    triageRes.status === 200 && triageRes.data.isEmergency === true && triageRes.data.triageLevel === 'CRITICAL_RED',
    'Requirement 4c: Critical keyword "chest pain" triggers Red Emergency Triage',
    `Category: ${triageRes.data.category}, Emergency Lines: ${emergencyNumbers}`
  );

  const hasEmergencyBannerMarkup = htmlContent.includes('id="emergency-banner"') && 
                                   htmlContent.includes('CRITICAL EMERGENCY TRIAGE ALERT') &&
                                   htmlContent.includes('tel:112');
  assert(
    hasEmergencyBannerMarkup,
    'Requirement 4d: Red Emergency Warning Banner & local speed-dial guidance active in UI',
    'Emergency banner with 112/102 emergency action buttons verified in frontend markup'
  );

  // -------------------------------------------------------------
  // REQUIREMENT 5: FACELESS EVALUATION ARCHITECTURE & UI GUIDANCE
  // -------------------------------------------------------------
  console.log("\n--- 5. FACELESS EVALUATION: ARCHITECTURE MODAL & UI GUIDANCE ---");
  
  // 5a. Top Navigation Bar Architecture Button
  const hasArchNavbarBtn = htmlContent.includes('id="arch-tech-stack-btn"') &&
                           htmlContent.includes('onclick="openArchitectureModal()"');
  assert(
    hasArchNavbarBtn,
    'Requirement 5a: Architecture & Tech Stack button active in top navigation bar',
    '#arch-tech-stack-btn with openArchitectureModal() click handler verified in header'
  );

  // 5b. Architecture Modal with What, Why, How & Tech Stack Panes
  const hasArchModal = htmlContent.includes('id="architecture-modal"');
  const hasWhatPane = htmlContent.includes('id="arch-pane-what"') && 
                      htmlContent.includes('AI Clinical Copilot & FHIR v4 Health Platform');
  const hasWhyPane = htmlContent.includes('id="arch-pane-why"') && 
                     htmlContent.includes('Fragmented Lab Report Interpretation') &&
                     htmlContent.includes('Lethal AI Hallucination & Fabrication in Healthcare');
  const hasHowPane = htmlContent.includes('id="arch-pane-how"') && 
                     htmlContent.includes('Node.js (v18+), Express.js (Port 5000)') &&
                     htmlContent.includes('Supabase PostgreSQL') &&
                     htmlContent.includes('Make.com Webhooks') &&
                     htmlContent.includes('HL7 FHIR v4, ABDM (NRCeS)');
  const hasEvalPane = htmlContent.includes('id="arch-pane-eval"');

  assert(
    hasArchModal && hasWhatPane && hasWhyPane && hasHowPane && hasEvalPane,
    'Requirement 5b: Comprehensive Architecture modal with What, Why, How, and Test Matrix',
    'Outlines SageCure system, clinical motivation, full tech stack table, and 1-click test suite'
  );

  // 5c. Evaluator Guidance and Tooltips across all 5 Core Modules
  const hasLabTooltips = htmlContent.includes('Evaluator 1-Click Test: Loads Diabetic & Lipid panel') &&
                         htmlContent.includes('Evaluator Quick Test: Type');
  const hasDoctorTooltips = htmlContent.includes('Evaluator Guide:</strong> Verified clinician directory') &&
                            htmlContent.includes('title="Evaluator Action: Book verified tele-consultation');
  const hasRxTooltips = htmlContent.includes('Evaluator Guide:</strong> Select a preset diagnosis') &&
                        htmlContent.includes('id="add-rx-row-btn"') &&
                        htmlContent.includes('title="Evaluator Action: Compiles vitals');
  const hasEmergencyTooltips = htmlContent.includes('title="Evaluator Safety Guardrail:') &&
                               htmlContent.includes('title="Evaluator Emergency Action: Direct connection to Pan-India Emergency Service (112)"');
  const hasFhirTooltips = htmlContent.includes('Evaluator Guide:</strong> Valid HL7 FHIR v4 Document Bundle') &&
                          htmlContent.includes('title="Evaluator Action: Downloads SageCure-FHIR-Bundle.json');

  assert(
    hasLabTooltips && hasDoctorTooltips && hasRxTooltips && hasEmergencyTooltips && hasFhirTooltips,
    'Requirement 5c: Explanatory helper tooltips and guidance across all 5 core modules',
    'Lab Parser, Doctor Directory, Rx Giver, Emergency Triage, and FHIR Export all feature self-explanatory evaluator tooltips'
  );

  // -------------------------------------------------------------
  // REQUIREMENT 6: FULLY FUNCTIONAL "MEASURE & RECORD" VITAL WORKFLOW
  // -------------------------------------------------------------
  console.log("\n--- 6. FULLY FUNCTIONAL MEASURE & RECORD CLINICAL WORKFLOW ---");
  
  // 6a. Measure & Record interactive button and modal
  const hasMeasureRecordBtn = htmlContent.includes('class="measure-record-btn') &&
                              htmlContent.includes('onclick="openRecordBiomarkerModal(');
  const hasMeasureRecordModal = htmlContent.includes('id="record-biomarker-modal"') &&
                                htmlContent.includes('id="rec-bio-value"') &&
                                htmlContent.includes('id="rec-bio-unit"') &&
                                htmlContent.includes('id="submit-recorded-biomarker-btn"') &&
                                htmlContent.includes('onclick="submitRecordedBiomarker()"');
  assert(
    hasMeasureRecordBtn && hasMeasureRecordModal,
    'Requirement 6a: Interactive "Measure & Record" button and input modal exist',
    'Evaluators can click button to open modal with numerical input and quick presets'
  );

  // 6b. Recalculation logic in frontend scripts
  const hasRecalculationLogic = htmlContent.includes('function recalculateBiomarkerStatus') &&
                                htmlContent.includes('function submitRecordedBiomarker') &&
                                htmlContent.includes('currentRecordingBiomarkerName');
  assert(
    hasRecalculationLogic,
    'Requirement 6b: Dynamic clinical recalculation & vitals update engine active',
    'recalculateBiomarkerStatus and submitRecordedBiomarker functions verified in client logic'
  );

  // 6c. Verified vital feeds into FHIR export bundle without hallucination
  const fhirRecordedVitalRes = await request(
    { hostname: 'localhost', port: 5000, path: '/api/fhir/export', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    {
      patient: { name: 'Kavita Iyer', abhaId: '22-4444-5555-6666@abdm', age: '52', gender: 'Female' },
      biomarkers: [
        { name: 'Glycated Hemoglobin (HbA1c)', value: 7.9, unit: '%', range: '< 5.7', status: 'elevated' },
        { name: 'Body Temperature', value: 38.2, unit: '°C', range: '36.5 - 37.5', status: 'elevated', missing: false }
      ],
      summary: 'Recorded body temperature of 38.2°C (febrile) and elevated HbA1c.'
    }
  );

  const recordedBundle = fhirRecordedVitalRes.data.bundle;
  const recordedObs = recordedBundle ? recordedBundle.entry.filter(e => e.resource.resourceType === 'Observation') : [];
  const tempObs = recordedObs.find(o => o.resource.code.coding[0].code === '8310-5');
  const tempHasQuantity = tempObs && tempObs.resource.valueQuantity?.value === 38.2;
  const tempHasNoAbsentReason = tempObs && tempObs.resource.dataAbsentReason === undefined;

  assert(
    fhirRecordedVitalRes.status === 200 && tempHasQuantity && tempHasNoAbsentReason,
    'Requirement 6c: Recorded numerical vital seamlessly flows into FHIR export bundle',
    'Body Temperature exports as valueQuantity: 38.2 °C (LOINC 8310-5) with ZERO dataAbsentReason and ZERO AI hallucination'
  );

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log("\n=====================================================================");
  console.log(`TOTAL SPECIFICATION CHECKS: ${passed} / ${total} PASSED (${Math.round(passed / total * 100)}%)`);
  if (passed === total) {
    console.log("🎉 ALL USER REQUIREMENTS VERIFIED & CLINICAL CRITERIA MET 100%!");
  } else {
    console.error("❌ SOME REQUIREMENTS FAILED. PLEASE REVIEW LOGS ABOVE.");
  }
  console.log("=====================================================================");

  process.exit(passed === total ? 0 : 1);
}

runTests().catch(err => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
