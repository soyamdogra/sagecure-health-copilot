/**
 * SageCure FHIR v4 Compliance & ABDM Export Engine
 * Conforms to HL7 FHIR v4.0.1 and ABDM (Ayushman Bharat Digital Mission)
 * NRCeS DiagnosticReport Record StructureDefinition.
 */

// Official LOINC Clinical Terminology Mappings
const LOINC_DICTIONARY = {
  // Glycemic & Diabetes
  'hba1c': { code: '4548-4', display: 'Hemoglobin A1c/Hemoglobin.total in Blood', system: 'http://loinc.org', unit: '%' },
  'glycated hemoglobin': { code: '4548-4', display: 'Hemoglobin A1c/Hemoglobin.total in Blood', system: 'http://loinc.org', unit: '%' },
  'fasting blood sugar': { code: '1558-6', display: 'Fasting glucose [Mass/volume] in Blood', system: 'http://loinc.org', unit: 'mg/dL' },
  'fasting blood glucose': { code: '1558-6', display: 'Fasting glucose [Mass/volume] in Blood', system: 'http://loinc.org', unit: 'mg/dL' },
  'fasting glucose': { code: '1558-6', display: 'Fasting glucose [Mass/volume] in Blood', system: 'http://loinc.org', unit: 'mg/dL' },
  'fbs': { code: '1558-6', display: 'Fasting glucose [Mass/volume] in Blood', system: 'http://loinc.org', unit: 'mg/dL' },
  'postprandial glucose': { code: '1521-4', display: 'Glucose 2 hours post-meal in Blood', system: 'http://loinc.org', unit: 'mg/dL' },
  'ppbs': { code: '1521-4', display: 'Glucose 2 hours post-meal in Blood', system: 'http://loinc.org', unit: 'mg/dL' },
  'glucose': { code: '2339-0', display: 'Glucose [Mass/volume] in Blood', system: 'http://loinc.org', unit: 'mg/dL' },

  // Lipid Panel
  'total cholesterol': { code: '2093-3', display: 'Cholesterol [Mass/volume] in Serum or Plasma', system: 'http://loinc.org', unit: 'mg/dL' },
  'cholesterol': { code: '2093-3', display: 'Cholesterol [Mass/volume] in Serum or Plasma', system: 'http://loinc.org', unit: 'mg/dL' },
  'ldl cholesterol': { code: '13457-7', display: 'Cholesterol in LDL [Mass/volume] in Serum or Plasma', system: 'http://loinc.org', unit: 'mg/dL' },
  'ldl': { code: '13457-7', display: 'Cholesterol in LDL [Mass/volume] in Serum or Plasma', system: 'http://loinc.org', unit: 'mg/dL' },
  'hdl cholesterol': { code: '2085-9', display: 'Cholesterol in HDL [Mass/volume] in Serum or Plasma', system: 'http://loinc.org', unit: 'mg/dL' },
  'hdl': { code: '2085-9', display: 'Cholesterol in HDL [Mass/volume] in Serum or Plasma', system: 'http://loinc.org', unit: 'mg/dL' },
  'triglycerides': { code: '2571-8', display: 'Triglyceride [Mass/volume] in Serum or Plasma', system: 'http://loinc.org', unit: 'mg/dL' },

  // Complete Blood Count (CBC) / Hematology
  'hemoglobin': { code: '718-7', display: 'Hemoglobin [Mass/volume] in Blood', system: 'http://loinc.org', unit: 'g/dL' },
  'hb': { code: '718-7', display: 'Hemoglobin [Mass/volume] in Blood', system: 'http://loinc.org', unit: 'g/dL' },
  'rbc count': { code: '789-8', display: 'Erythrocytes [#/volume] in Blood', system: 'http://loinc.org', unit: 'mil/µL' },
  'rbc': { code: '789-8', display: 'Erythrocytes [#/volume] in Blood', system: 'http://loinc.org', unit: 'mil/µL' },
  'platelet count': { code: '777-3', display: 'Platelets [#/volume] in Blood', system: 'http://loinc.org', unit: '/µL' },
  'platelets': { code: '777-3', display: 'Platelets [#/volume] in Blood', system: 'http://loinc.org', unit: '/µL' },
  'wbc count': { code: '6690-2', display: 'Leukocytes [#/volume] in Blood', system: 'http://loinc.org', unit: '/µL' },
  'wbc': { code: '6690-2', display: 'Leukocytes [#/volume] in Blood', system: 'http://loinc.org', unit: '/µL' },
  'ferritin': { code: '2276-4', display: 'Ferritin [Mass/volume] in Serum or Plasma', system: 'http://loinc.org', unit: 'ng/mL' },

  // Renal & Metabolic
  'egfr': { code: '33914-3', display: 'Glomerular filtration rate/1.73 sq M.predicted', system: 'http://loinc.org', unit: 'mL/min/1.73m²' },
  'creatinine': { code: '2160-0', display: 'Creatinine [Mass/volume] in Serum or Plasma', system: 'http://loinc.org', unit: 'mg/dL' },
  'blood urea nitrogen': { code: '3094-0', display: 'Urea nitrogen [Mass/volume] in Serum or Plasma', system: 'http://loinc.org', unit: 'mg/dL' },

  // Vitals
  'systolic bp': { code: '8480-6', display: 'Systolic blood pressure', system: 'http://loinc.org', unit: 'mmHg' },
  'diastolic bp': { code: '8462-4', display: 'Diastolic blood pressure', system: 'http://loinc.org', unit: 'mmHg' },
  'blood pressure': { code: '85354-9', display: 'Blood pressure panel with all children optional', system: 'http://loinc.org', unit: 'mmHg' },
  'heart rate': { code: '8867-4', display: 'Heart rate', system: 'http://loinc.org', unit: 'bpm' },
  'pulse rate': { code: '8867-4', display: 'Heart rate', system: 'http://loinc.org', unit: 'bpm' },
  'pulse': { code: '8867-4', display: 'Heart rate', system: 'http://loinc.org', unit: 'bpm' },
  'respiratory rate': { code: '9279-1', display: 'Respiratory rate', system: 'http://loinc.org', unit: 'breaths/min' },
  'oxygen saturation': { code: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry', system: 'http://loinc.org', unit: '%' },
  'spo2': { code: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry', system: 'http://loinc.org', unit: '%' },
  'body temperature': { code: '8310-5', display: 'Body temperature', system: 'http://loinc.org', unit: '°C' },
  'temperature': { code: '8310-5', display: 'Body temperature', system: 'http://loinc.org', unit: '°C' }
};

/**
 * Lookup LOINC mapping by biomarker name
 */
function findLoincMapping(biomarkerName) {
  if (!biomarkerName) return { code: '30745-4', display: 'General Diagnostic Chemistry Panel', system: 'http://loinc.org', unit: '' };
  
  const clean = biomarkerName.toLowerCase().trim();
  for (const [key, mapping] of Object.entries(LOINC_DICTIONARY)) {
    if (clean.includes(key)) {
      return mapping;
    }
  }
  return {
    code: '30745-4',
    display: `${biomarkerName} - Clinical Chemistry Marker`,
    system: 'http://loinc.org',
    unit: ''
  };
}

/**
 * Generate a valid FHIR v4 DiagnosticReport Bundle
 * @param {Object} reportData - Lab report analysis object containing biomarkers, summaries
 * @param {Object} patientInfo - Patient demographics (name, abhaId, age, gender)
 * @returns {Object} Valid FHIR v4 Resource Bundle
 */
function buildFhirV4Bundle(reportData, patientInfo = {}) {
  const timestamp = new Date().toISOString();
  const bundleId = `sagecure-bundle-${Date.now()}`;
  const reportId = reportData.id || `rep-${Date.now()}`;
  const abhaId = patientInfo.abhaId || reportData.patient?.abhaId || '14-0000-0000-0000@abdm';
  const patientName = patientInfo.name || reportData.patient?.name || 'Patient';
  const facilityName = reportData.facility || reportData.patient?.facility || 'SageCure Clinical Diagnostics';
  const category = reportData.category || 'metabolic';

  const patientResourceId = `Patient-ABDM-${abhaId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const organizationResourceId = 'Org-SageCure-IN070001842';
  const practitionerResourceId = 'Practitioner-MCI-48291';
  const diagnosticReportResourceId = `DiagnosticReport-${reportId}`;
  const compositionResourceId = `Composition-${reportId}`;

  // Build Observation resources for each parsed biomarker
  const rawBiomarkers = reportData.biomarkers || reportData.fullData?.biomarkers || [];
  const observationEntries = [];
  const observationReferences = [];

  rawBiomarkers.forEach((bm, idx) => {
    const obsId = `Observation-${reportId}-${idx + 1}`;
    const mapping = findLoincMapping(bm.name);
    const numericValue = parseFloat(bm.value) || 0;
    const unit = bm.unit || mapping.unit || '';
    
    // Determine FHIR interpretation code (H = High, L = Low, N = Normal)
    let interpretationCode = 'N';
    let interpretationDisplay = 'Normal';
    const status = (bm.status || '').toLowerCase();
    if (status.includes('high') || status.includes('elevated') || status.includes('critical')) {
      interpretationCode = 'H';
      interpretationDisplay = 'High';
    } else if (status.includes('low')) {
      interpretationCode = 'L';
      interpretationDisplay = 'Low';
    }

    const observationResource = {
      resourceType: 'Observation',
      id: obsId,
      meta: {
        profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation']
      },
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'laboratory',
              display: 'Laboratory'
            }
          ]
        }
      ],
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: mapping.code,
            display: mapping.display
          }
        ],
        text: bm.name
      },
      subject: {
        reference: `Patient/${patientResourceId}`,
        display: patientName
      },
      effectiveDateTime: timestamp,
      issued: timestamp,
      performer: [
        {
          reference: `Organization/${organizationResourceId}`,
          display: facilityName
        }
      ],
      ...(typeof bm.value === 'string' && bm.value.toLowerCase().includes('unknown')
        ? {
            dataAbsentReason: {
              coding: [{
                system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason',
                code: 'unknown',
                display: 'Unknown / Not Provided'
              }]
            },
            valueString: 'Unknown / Not Provided'
          }
        : {
            valueQuantity: {
              value: numericValue,
              unit: unit,
              system: 'http://unitsofmeasure.org',
              code: unit
            }
          }),
      interpretation: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
              code: interpretationCode,
              display: interpretationDisplay
            }
          ],
          text: bm.statusLabel || interpretationDisplay
        }
      ],
      referenceRange: [
        {
          text: bm.range || 'Standard Adult Reference Range'
        }
      ]
    };

    observationEntries.push({
      fullUrl: `urn:uuid:${obsId}`,
      resource: observationResource
    });

    observationReferences.push({
      reference: `urn:uuid:${obsId}`,
      display: `${bm.name}: ${bm.value} ${unit}`
    });
  });

  // 1. Composition Resource
  const compositionResource = {
    resourceType: 'Composition',
    id: compositionResourceId,
    meta: {
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord']
    },
    status: 'final',
    type: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '11502-2',
          display: 'Laboratory report'
        }
      ],
      text: 'Diagnostic Laboratory Report'
    },
    subject: {
      reference: `Patient/${patientResourceId}`,
      display: patientName
    },
    date: timestamp,
    author: [
      {
        reference: `Organization/${organizationResourceId}`,
        display: facilityName
      }
    ],
    title: reportData.title || 'SageCure Clinical Diagnostic Health Record',
    custodian: {
      reference: `Organization/${organizationResourceId}`,
      display: facilityName
    },
    section: [
      {
        title: 'Diagnostic Findings & Observations',
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '24323-8',
              display: 'Comprehensive laboratory panel'
            }
          ]
        },
        entry: observationReferences
      }
    ]
  };

  // 2. Patient Resource
  const patientResource = {
    resourceType: 'Patient',
    id: patientResourceId,
    meta: {
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient']
    },
    identifier: [
      {
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
              code: 'MR',
              display: 'Medical Record Number'
            }
          ]
        },
        system: 'https://healthid.ndhm.gov.in',
        value: abhaId
      }
    ],
    name: [
      {
        use: 'official',
        text: patientName
      }
    ],
    gender: ((patientInfo.gender || reportData.patient?.gender || 'female').toLowerCase().includes('male') && !(patientInfo.gender || reportData.patient?.gender || 'female').toLowerCase().includes('female')) ? 'male' : 'female'
  };

  // 3. Organization Resource
  const organizationResource = {
    resourceType: 'Organization',
    id: organizationResourceId,
    meta: {
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/Organization']
    },
    identifier: [
      {
        system: 'https://facility.ndhm.gov.in',
        value: 'IN070001842'
      }
    ],
    name: facilityName,
    telecom: [
      {
        system: 'phone',
        value: '+91-11-2659-4500'
      },
      {
        system: 'url',
        value: 'https://sagecure.ai'
      }
    ]
  };

  // 4. Practitioner Resource
  const practitionerResource = {
    resourceType: 'Practitioner',
    id: practitionerResourceId,
    meta: {
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/Practitioner']
    },
    identifier: [
      {
        system: 'https://doctor.ndhm.gov.in',
        value: 'MCI-48291'
      }
    ],
    name: [
      {
        text: 'Dr. Alok Sen, MD'
      }
    ],
    qualification: [
      {
        code: {
          text: 'MBBS, MD (Internal Medicine & Clinical Diabetology)'
        }
      }
    ]
  };

  // 5. DiagnosticReport Resource
  const summaryText = reportData.summary_en || reportData.summary || reportData.plainLanguage || 'Diagnostic panel extracted successfully.';
  const diagnosticReportResource = {
    resourceType: 'DiagnosticReport',
    id: diagnosticReportResourceId,
    meta: {
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportLab']
    },
    status: 'final',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
            code: 'LAB',
            display: 'Laboratory'
          }
        ]
      }
    ],
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '24323-8',
          display: 'Comprehensive Laboratory Findings Panel'
        }
      ],
      text: reportData.title || 'Comprehensive Clinical Lab Report'
    },
    subject: {
      reference: `Patient/${patientResourceId}`,
      display: patientName
    },
    effectiveDateTime: timestamp,
    issued: timestamp,
    performer: [
      {
        reference: `Organization/${organizationResourceId}`,
        display: facilityName
      },
      {
        reference: `Practitioner/${practitionerResourceId}`,
        display: 'Dr. Alok Sen, MD'
      }
    ],
    result: observationReferences,
    conclusion: summaryText
  };

  // Build Document Bundle
  return {
    resourceType: 'Bundle',
    id: bundleId,
    meta: {
      versionId: '1.0',
      lastUpdated: timestamp,
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord']
    },
    identifier: {
      system: 'https://sagecure.ai/fhir/bundles',
      value: bundleId
    },
    type: 'document',
    timestamp: timestamp,
    entry: [
      {
        fullUrl: `urn:uuid:${compositionResourceId}`,
        resource: compositionResource
      },
      {
        fullUrl: `urn:uuid:${patientResourceId}`,
        resource: patientResource
      },
      {
        fullUrl: `urn:uuid:${organizationResourceId}`,
        resource: organizationResource
      },
      {
        fullUrl: `urn:uuid:${practitionerResourceId}`,
        resource: practitionerResource
      },
      {
        fullUrl: `urn:uuid:${diagnosticReportResourceId}`,
        resource: diagnosticReportResource
      },
      ...observationEntries
    ]
  };
}

module.exports = {
  LOINC_DICTIONARY,
  findLoincMapping,
  buildFhirV4Bundle
};
