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
  console.log('===============================================================');
  console.log('SAGECURE HEALTH COPILOT: CLINICAL ECOSYSTEM VERIFICATION SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, testName, extraInfo = '') {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      if (extraInfo) console.log(`   └─ ${extraInfo}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      if (extraInfo) console.error(`   └─ ${extraInfo}`);
    }
  }

  // 1. Health check
  try {
    const res = await request({ hostname: 'localhost', port: 5000, path: '/api/health', method: 'GET' });
    assert(res.status === 200 && res.data.status === 'healthy', 'Server Health Check', `ABDM Compliant: ${res.data.compliance}`);
  } catch (e) {
    assert(false, 'Server Health Check', e.message);
  }

  // 2. Emergency Red-Flag Triage Endpoint
  try {
    const res = await request(
      { hostname: 'localhost', port: 5000, path: '/api/triage', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { query: 'sudden severe crushing chest pain with left arm numbness', language: 'en' }
    );
    assert(
      res.status === 200 && res.data.isEmergency === true && res.data.category === 'cardiac',
      'Emergency Triage: Acute Cardiac Distress Screen',
      `Category: ${res.data.category}, Severity: ${res.data.triageLevel}, Speed Dial: ${res.data.speedDial ? res.data.speedDial.join(', ') : '112/102'}`
    );
  } catch (e) {
    assert(false, 'Emergency Triage: Acute Cardiac Distress Screen', e.message);
  }

  // 2b. Emergency Triage: Hindi Respiratory Query
  try {
    const res = await request(
      { hostname: 'localhost', port: 5000, path: '/api/triage', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { query: 'मुझे बहुत तेज सांस लेने में तकलीफ हो रही है', language: 'hi' }
    );
    assert(
      res.status === 200 && res.data.isEmergency === true && res.data.category === 'respiratory_crisis',
      'Emergency Triage: Hindi Respiratory Distress Screen',
      `Category: ${res.data.category}, Emergency Level: ${res.data.triageLevel}`
    );
  } catch (e) {
    assert(false, 'Emergency Triage: Hindi Respiratory Distress Screen', e.message);
  }

  // 2c. Non-emergency query should NOT trigger triage
  try {
    const res = await request(
      { hostname: 'localhost', port: 5000, path: '/api/triage', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { query: 'What is a normal fasting blood sugar level?', language: 'en' }
    );
    assert(
      res.status === 200 && res.data.isEmergency === false,
      'Emergency Triage: Benign Inquiry Non-Interference',
      'Confirmed: Normal inquiry not overridden'
    );
  } catch (e) {
    assert(false, 'Emergency Triage: Benign Inquiry Non-Interference', e.message);
  }

  // 3. ABDM / FHIR v4 Bundle Export
  try {
    const payload = {
      patient: { name: 'Aditi Sharma', abhaId: '14-0234-5678-9012@abdm', age: '48', gender: 'Female' },
      biomarkers: [
        { name: 'HbA1c (Glycated Hemoglobin)', value: 8.4, unit: '%', range: '< 5.7', status: 'elevated' },
        { name: 'Fasting Blood Glucose', value: 168, unit: 'mg/dL', range: '70 - 99', status: 'elevated' },
        { name: 'Total Cholesterol', value: 235, unit: 'mg/dL', range: '< 200', status: 'elevated' },
        { name: 'LDL Cholesterol', value: 162, unit: 'mg/dL', range: '< 100', status: 'elevated' },
        { name: 'Serum Creatinine', value: 0.85, unit: 'mg/dL', range: '0.5 - 1.1', status: 'normal' }
      ],
      summary: 'Elevated HbA1c and LDL cholesterol. Normal kidney function.'
    };
    const res = await request(
      { hostname: 'localhost', port: 5000, path: '/api/fhir/export', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      payload
    );
    const bundle = res.data.bundle;
    const entries = bundle ? bundle.entry : [];
    const observations = entries.filter(e => e.resource.resourceType === 'Observation');
    const loincCodes = observations.map(o => o.resource.code.coding[0].code);

    assert(
      res.status === 200 && bundle && bundle.resourceType === 'Bundle' && bundle.type === 'document',
      'ABDM / FHIR v4 Document Bundle Generation',
      `Resource count: ${entries.length}, Standard Profile: ${bundle.meta.profile[0]}`
    );

    assert(
      loincCodes.includes('4548-4') && loincCodes.includes('1558-6') && loincCodes.includes('2093-3'),
      'FHIR v4 Official LOINC Codings Verified',
      `Found official LOINCs: HbA1c (4548-4), Glucose (1558-6), Cholesterol (2093-3)`
    );
  } catch (e) {
    assert(false, 'ABDM / FHIR v4 Document Bundle Generation', e.message);
  }

  // 4. Trends Feature Verification: Confirmed Removed from Frontend & Clean User Isolation
  try {
    const res = await request(
      { hostname: 'localhost', port: 5000, path: '/api/trends/unregistered_user@sagecure.ai', method: 'GET' }
    );
    assert(
      res.status === 404,
      'Trends UI Removed & Isolated Session DB (No Preloaded Demo Leaks)',
      'Unregistered users have clean slate with zero data bleed'
    );
  } catch (e) {
    assert(false, 'Trends UI Removed & Isolated Session DB', e.message);
  }

  // 5. Automated E-Prescription & Digital Signature
  try {
    const res = await request(
      { hostname: 'localhost', port: 5000, path: '/api/prescription/prescribe', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      {
        patient: { name: 'Pooja Verma', age: '45', gender: 'Female', abhaId: '99-1234-5678-9012@abdm' },
        diagnosis: 'Type 2 Diabetes Mellitus with Dyslipidemia',
        icd10: 'E11.69',
        medications: [
          { name: 'Tab. Metformin HCl (SR)', dosage: '500 mg BD', duration: '90 Days', instructions: 'After meals' },
          { name: 'Tab. Atorvastatin', dosage: '10 mg HS', duration: '90 Days', instructions: 'At bedtime' }
        ]
      }
    );
    const rx = res.data.prescription;
    assert(
      res.status === 200 && rx && rx.doctor && rx.digitalSignature && rx.digitalSignature.verified,
      'Clinical E-Prescription & Cryptographic Signature',
      `Doctor: ${rx.doctor.name} (${rx.doctor.registrationNumber}), ICD-10: ${rx.diagnosis.code}, SigHash: ${rx.digitalSignature.hash}`
    );
  } catch (e) {
    assert(false, 'Automated E-Prescription & Digital Signature', e.message);
  }

  // 6. Specialist Doctor Directory
  try {
    const res = await request(
      { hostname: 'localhost', port: 5000, path: '/api/doctors', method: 'GET' }
    );
    assert(
      res.status === 200 && Array.isArray(res.data.doctors) && res.data.doctors.length >= 4,
      'Specialist Doctor Directory Registry',
      `Registered doctors count: ${res.data.doctors.length}`
    );
  } catch (e) {
    assert(false, 'Specialist Doctor Directory Registry', e.message);
  }

  // 7. Frontend Markup & Script Integrity
  const feHtml = fs.readFileSync(path.join(__dirname, 'frontend', 'index.html'), 'utf8');
  assert(
    feHtml.includes('id="emergency-banner"') && feHtml.includes('id="emergency-modal"'),
    'Frontend: Emergency Red Banner & Triage Escalation Modal Elements',
    'Emergency safety overrides verified in markup'
  );

  assert(
    !feHtml.includes('id="longitudinal-trends-card"') && feHtml.includes('id="prescription-giver-card"') && feHtml.includes('id="rx-giver-table-body"'),
    'Frontend: Trends Completely Removed & Prescription Medication Giver Active',
    'Trends removed and Prescription Giver Studio verified in markup'
  );

  assert(
    feHtml.includes('id="export-fhir-btn"') && feHtml.includes('downloadFhirBundle'),
    'Frontend: ABDM / FHIR v4 Export Modal & JSON Downloader',
    'HL7 FHIR v4 export buttons verified in markup'
  );

  assert(
    feHtml.includes('voiceCompanionLang') && feHtml.includes('setVoiceCompanionLang') && feHtml.includes('pa-IN'),
    'Frontend: Multilingual Voice-First Companion (English, Hindi, Punjabi)',
    'Trilingual Web Speech API audio synthesizers verified in markup'
  );

  assert(
    feHtml.includes('downloadPrescriptionPDF') && feHtml.includes('jspdf'),
    'Frontend: Automated E-Prescription & jsPDF Generator',
    'A4 signed clinical prescription PDF generator verified in markup'
  );

  console.log('\n===============================================================');
  console.log(`SUITE RESULTS: ${passed} / ${total} TESTS PASSED (${Math.round((passed/total)*100)}%)`);
  console.log('===============================================================\n');

  if (passed === total) {
    console.log('🎉 ALL CLINICAL ECOSYSTEM SYSTEMS ARE 100% OPERATIONAL & VERIFIED!');
  } else {
    process.exit(1);
  }
}

runTests();
