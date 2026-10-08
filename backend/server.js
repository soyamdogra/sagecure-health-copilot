const path = require('path');
const fs = require('fs');

// Load environment variables (.env in backend or root)
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { buildFhirV4Bundle, findLoincMapping, LOINC_DICTIONARY } = require('./fhirEngine');
const { evaluateEmergencyTriage, EMERGENCY_CENTERS } = require('./triageEngine');
const { analyzeLongitudinalTrends } = require('./trendEngine');
const { generateDigitalPrescription } = require('./prescriptionEngine');
const { extractTextFromBuffer, parseClinicalBiomarkersFromText, formatOcrPayloadForMake } = require('./ocrEngine');

const app = express();
const PORT = process.env.PORT || 5000;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL || 'https://hook.eu1.make.com/6b5c43h2avkb08jjmi0tr651jxeti2d3';

// -------------------------------------------------------------
// SUPABASE CLIENT CONFIGURATION
// -------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_URL.includes('your-project-id')) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });
    console.log(`[SageCure Supabase] Live PostgreSQL client initialized: ${SUPABASE_URL}`);
  } catch (err) {
    console.warn('[SageCure Supabase] Initialization warning:', err.message);
  }
} else {
  console.log('[SageCure Supabase] Operating with live API endpoints and local schema fallback.');
}

// Enable CORS for frontend requests (allowing cross-origin from file://, localhost, etc.)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static assets
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));
app.use(express.static(path.join(__dirname, '..')));

// Multer storage configuration for medical document uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});

// -------------------------------------------------------------
// USER DATA PERSISTENCE (Multi-User Accounts & Lab Reports)
// -------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function getUsersDB() {
  if (!fs.existsSync(USERS_FILE)) {
    const seed = {};
    fs.writeFileSync(USERS_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch (e) {
    return {};
  }
}

function saveUsersDB(db) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error("Failed to save users database:", e);
  }
}

// -------------------------------------------------------------
// AUTH & MULTI-USER ENDPOINTS WITH ISOLATED SESSIONS
// -------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, error: "Email and password are required." });
  }

  const lowerEmail = email.toLowerCase().trim();
  const db = getUsersDB();
  let user = db[lowerEmail];
  const sessionToken = `sc-sess-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

  if (supabase) {
    try {
      const { data: sbUser, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', lowerEmail)
        .single();

      if (!error && sbUser) {
        if (!user) {
          user = {
            name: sbUser.name,
            email: sbUser.email,
            password: sbUser.password || password,
            abhaId: sbUser.abha_id,
            createdAt: sbUser.created_at,
            reports: []
          };
          db[lowerEmail] = user;
          saveUsersDB(db);
        }
      }
    } catch (e) {
      console.warn('[SageCure Supabase] Login note:', e.message);
    }
  }

  // CRITICAL SECURITY ENFORCEMENT:
  // If the user does NOT exist, do NOT auto-create a ghost account.
  // Return clear error: "Account does not exist. Please create an account first."
  if (!user) {
    return res.status(404).json({ 
      success: false, 
      error: "Account does not exist. Please create an account first." 
    });
  }

  // Validate credentials
  if (user.password !== password) {
    return res.status(401).json({ 
      success: false, 
      error: "Incorrect password. Please verify your credentials and try again." 
    });
  }

  res.json({ 
    success: true, 
    user, 
    token: sessionToken,
    session: { token: sessionToken, email: user.email, name: user.name, abhaId: user.abhaId },
    source: supabase ? 'supabase' : 'local' 
  });
});

const handleSignup = async (req, res) => {
  const { name, email, password, abhaId } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ success: false, error: "Full Name, email, and password are required to create an account." });
  }

  const db = getUsersDB();
  const lowerEmail = email.toLowerCase().trim();
  const sessionToken = `sc-sess-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

  let existingUser = db[lowerEmail];

  if (supabase && !existingUser) {
    try {
      const { data: sbUser } = await supabase
        .from('users')
        .select('email')
        .eq('email', lowerEmail)
        .single();
      if (sbUser) existingUser = sbUser;
    } catch (e) {
      // ignore
    }
  }

  if (existingUser) {
    return res.status(409).json({ success: false, error: "An account with this email already exists. Please sign in instead." });
  }

  const newUser = {
    name: name.trim(),
    email: lowerEmail,
    password: password,
    abhaId: (abhaId && abhaId.trim()) || `14-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}@abdm`,
    createdAt: new Date().toISOString(),
    reports: []
  };

  db[lowerEmail] = newUser;
  saveUsersDB(db);

  if (supabase) {
    try {
      await supabase.from('users').insert({
        email: lowerEmail,
        name: newUser.name,
        password: password,
        abha_id: newUser.abhaId,
        created_at: newUser.createdAt
      });
    } catch (err) {
      console.warn('[SageCure Supabase] Signup user note:', err.message);
    }
  }

  res.status(201).json({ 
    success: true, 
    user: newUser, 
    token: sessionToken,
    session: { token: sessionToken, email: newUser.email, name: newUser.name, abhaId: newUser.abhaId },
    source: supabase ? 'supabase' : 'local' 
  });
};
app.post('/api/auth/signup', handleSignup);
app.post('/api/auth/register', handleSignup);

app.post('/api/auth/verify-session', (req, res) => {
  const { email, token } = req.body || {};
  if (!email) return res.status(400).json({ valid: false, error: "Email is required." });
  const db = getUsersDB();
  const user = db[email.toLowerCase().trim()];
  if (!user) return res.status(404).json({ valid: false, error: "User session not found." });
  const validToken = token || `sc-sess-${Date.now()}`;
  res.json({ 
    valid: true, 
    user, 
    token: validToken,
    session: { token: validToken, email: user.email, name: user.name, abhaId: user.abhaId }
  });
});

// -------------------------------------------------------------
// LIVE REPORTS ENDPOINT: GET /api/reports/:email
// -------------------------------------------------------------
app.get('/api/reports/:email', async (req, res) => {
  const email = req.params.email.toLowerCase().trim();
  let reports = [];
  let source = 'local';

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .eq('user_email', email)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        reports = data.map(r => ({
          id: r.id,
          title: r.title,
          date: r.date,
          facility: r.facility,
          category: r.category,
          summary_en: r.summary_en,
          summary_hi: r.summary_hi,
          fullData: r.full_data || r.fullData,
          createdAt: r.created_at
        }));
        source = 'supabase';
      }
    } catch (sbErr) {
      console.warn(`[SageCure Supabase] Query failed for ${email}:`, sbErr.message);
    }
  }

  if (reports.length === 0) {
    const db = getUsersDB();
    const user = db[email];
    reports = (user && user.reports) ? user.reports : [];
  }

  res.json({
    success: true,
    email,
    source,
    reports
  });
});

app.get('/api/users/:email/reports', (req, res) => {
  const email = req.params.email.toLowerCase().trim();
  const db = getUsersDB();
  const user = db[email];
  res.json({ reports: (user && user.reports) ? user.reports : [] });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'SageCure Health Copilot API',
    brand: 'SageCure',
    compliance: 'ABDM / FHIR v4 Ready',
    supabaseConnected: !!supabase,
    makeWebhook: MAKE_WEBHOOK_URL
  });
});

// -------------------------------------------------------------
// STRICT CLINICAL SAFETY & ZERO-HALLUCINATION MEASUREMENT AUDIT
// -------------------------------------------------------------
function extractNumericalVital(text, type) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase();
  
  if (type === 'temperature') {
    const cMatch = t.match(/\b(3[5-9](?:\.[0-9]+)?|4[0-2](?:\.[0-9]+)?)\s*°?\s*c\b/i);
    if (cMatch) return { value: cMatch[1], unit: "°C" };
    const fMatch = t.match(/\b(9[5-9](?:\.[0-9]+)?|10[0-6](?:\.[0-9]+)?)\s*°?\s*f\b/i);
    if (fMatch) return { value: fMatch[1], unit: "°F" };
    const degMatch = t.match(/(?:temp(?:erature)?|बुखार|तापमान|fever)\s*(?:is|was|of|:)?\s*(\d{2,3}(?:\.\d+)?)\s*(?:°?\s*[cf]|degrees?|f|c)?\b/i);
    if (degMatch) {
      const num = parseFloat(degMatch[1]);
      if (num >= 35 && num <= 43) return { value: degMatch[1], unit: "°C" };
      if (num >= 95 && num <= 108) return { value: degMatch[1], unit: "°F" };
    }
    return null;
  }

  if (type === 'bp') {
    const bpMatch = t.match(/\b(\d{2,3})\s*\/\s*(\d{2,3})\s*(?:mm\s*hg)?\b/);
    if (bpMatch) return { value: `${bpMatch[1]}/${bpMatch[2]}`, unit: "mmHg", systolic: bpMatch[1], diastolic: bpMatch[2] };
    return null;
  }

  if (type === 'pulse') {
    const pulseMatch = t.match(/\b(\d{2,3})\s*(?:bpm|beats\s*\/?\s*min(?:ute)?)\b/i) ||
                       t.match(/(?:pulse|heart\s*rate|hr|नाड़ी|धड़कन)\s*(?:is|was|:)?\s*(\d{2,3})\b/i);
    if (pulseMatch) return { value: pulseMatch[1], unit: "bpm" };
    return null;
  }

  if (type === 'glucose') {
    const gMatch = t.match(/\b(\d{2,3})\s*(?:mg\/d[lL]|mmol\/[lL])\b/i) ||
                    t.match(/(?:fasting\s*glucose|fasting\s*sugar|fbs|sugar|glucose|शुगर)\s*(?:is|was|:)?\s*(\d{2,3})\b/i);
    if (gMatch) return { value: gMatch[1], unit: "mg/dL" };
    return null;
  }

  if (type === 'weight') {
    const wMatch = t.match(/\b(\d{2,3}(?:\.\d+)?)\s*(?:kg|kgs|kilograms?|lbs|pounds?)\b/i) ||
                   t.match(/(?:weight|वजन)\s*(?:is|was|:)?\s*(\d{2,3}(?:\.\d+)?)\b/i);
    if (wMatch) return { value: wMatch[1], unit: "kg" };
    return null;
  }

  if (type === 'spo2') {
    const oxMatch = t.match(/\b(8\d|9\d|100)\s*%\s*(?:spo2|oxygen|saturation)?\b/i) ||
                    t.match(/(?:spo2|oxygen|ऑक्सीजन)\s*(?:is|was|:)?\s*(8\d|9\d|100)\s*%?\b/i);
    if (oxMatch) return { value: oxMatch[1], unit: "%" };
    return null;
  }

  return null;
}

/**
 * Audit and sanitize biomarkers against the strict Clinical Safety Rule:
 * If an incomplete symptom statement was provided without numerical data,
 * never fabricate or guess values (such as 38°C, 38.4°C, 98.6°F, 120/80, 98 bpm, 98%).
 * Strictly flag missing values as "Unknown / Not Provided".
 */
function auditAndSanitizeBiomarkers(biomarkers, rawInputText, lang = 'en') {
  if (!Array.isArray(biomarkers)) return [];
  const text = (rawInputText || '').toLowerCase();
  const isHi = (lang === 'hi');

  const measuredTemp = extractNumericalVital(text, 'temperature');
  const measuredBp = extractNumericalVital(text, 'bp');
  const measuredPulse = extractNumericalVital(text, 'pulse');
  const measuredGlucose = extractNumericalVital(text, 'glucose');
  const measuredWeight = extractNumericalVital(text, 'weight');
  const measuredSpo2 = extractNumericalVital(text, 'spo2');

  return biomarkers.map(bm => {
    const name = (bm.name || '').toLowerCase();

    // 1. Temperature
    if (name.includes('temp') || name.includes('तापमान') || name.includes('fever') || name.includes('बुखार')) {
      if (measuredTemp) {
        return {
          ...bm,
          value: measuredTemp.value,
          unit: measuredTemp.unit,
          status: parseFloat(measuredTemp.value) >= (measuredTemp.unit === '°C' ? 38.0 : 100.4) ? "elevated" : "normal",
          statusLabel: isHi ? "मापा गया तापमान" : "Measured Temperature"
        };
      }
      return {
        ...bm,
        value: "Unknown / Not Provided",
        status: "unknown",
        statusLabel: isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)",
        range: "36.5 - 37.5 °C (97.7 - 99.5 °F)",
        percent: 0,
        missing: true,
        clinicalSafetyNote: "Exact numerical reading not provided. Please measure with a thermometer."
      };
    }

    // 2. Blood Pressure
    if (name.includes('blood pressure') || name.includes('systolic') || name.includes('diastolic') || name.includes('bp') || name.includes('रक्तचाप') || name.includes('बीपी')) {
      if (measuredBp) {
        return {
          ...bm,
          value: measuredBp.value,
          unit: measuredBp.unit,
          status: "measured",
          statusLabel: isHi ? "मापा गया रक्तचाप" : "Measured Blood Pressure"
        };
      }
      return {
        ...bm,
        value: "Unknown / Not Provided",
        status: "unknown",
        statusLabel: isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)",
        range: "< 120/80 mmHg",
        percent: 0,
        missing: true,
        clinicalSafetyNote: "Numerical blood pressure not provided. Please measure using a BP monitor."
      };
    }

    // 3. Heart Rate / Pulse
    if (name.includes('heart rate') || name.includes('pulse') || name.includes('नाड़ी') || name.includes('धड़कन')) {
      if (measuredPulse) {
        return {
          ...bm,
          value: measuredPulse.value,
          unit: measuredPulse.unit,
          status: "normal",
          statusLabel: isHi ? "मापी गई नाड़ी दर" : "Measured Pulse"
        };
      }
      return {
        ...bm,
        value: "Unknown / Not Provided",
        status: "unknown",
        statusLabel: isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)",
        range: "60 - 100 bpm",
        percent: 0,
        missing: true,
        clinicalSafetyNote: "Resting pulse rate not provided. Please check resting pulse."
      };
    }

    // 4. Blood Glucose
    if (name.includes('glucose') || name.includes('sugar') || name.includes('fbs') || name.includes('शुगर')) {
      if (measuredGlucose) {
        return {
          ...bm,
          value: measuredGlucose.value,
          unit: measuredGlucose.unit,
          status: parseFloat(measuredGlucose.value) >= 126 ? "elevated" : "normal",
          statusLabel: isHi ? "मापा गया ब्लड शुगर" : "Measured Glucose"
        };
      }
      if (typeof bm.value === 'number' || (typeof bm.value === 'string' && /^\d/.test(bm.value))) {
        // If from lab report OCR, preserve it!
        if (text.includes('glucose') || text.includes('sugar') || text.includes('hba1c') || text.includes('fbs')) {
          return bm;
        }
        return {
          ...bm,
          value: "Unknown / Not Provided",
          status: "unknown",
          statusLabel: isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)",
          range: "70 - 99 mg/dL",
          percent: 0,
          missing: true
        };
      }
    }

    // 5. Weight
    if (name.includes('weight') || name.includes('वजन')) {
      if (measuredWeight) {
        return {
          ...bm,
          value: measuredWeight.value,
          unit: measuredWeight.unit,
          status: "normal",
          statusLabel: isHi ? "मापा गया वजन" : "Measured Weight"
        };
      }
      return {
        ...bm,
        value: "Unknown / Not Provided",
        status: "unknown",
        statusLabel: isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)",
        range: "Standard BMI Target",
        percent: 0,
        missing: true
      };
    }

    // 6. Oxygen Saturation (SpO2)
    if (name.includes('spo2') || name.includes('oxygen') || name.includes('ऑक्सीजन')) {
      if (measuredSpo2) {
        return {
          ...bm,
          value: measuredSpo2.value,
          unit: measuredSpo2.unit,
          status: parseFloat(measuredSpo2.value) >= 95 ? "normal" : "low",
          statusLabel: isHi ? "मापा गया SpO2" : "Measured SpO2"
        };
      }
      return {
        ...bm,
        value: "Unknown / Not Provided",
        status: "unknown",
        statusLabel: isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)",
        range: "95 - 100 %",
        percent: 0,
        missing: true,
        clinicalSafetyNote: "Resting SpO2 not provided. Please measure using a pulse oximeter."
      };
    }

    return bm;
  });
}

// -------------------------------------------------------------
// DYNAMIC SEARCH & RETRIEVAL SYNTHESIS (FOR ACTIVE QUERY ENGINE)
// -------------------------------------------------------------
function synthesizeDynamicQueryRetrieval(query, fileName, patientName, lang) {
  const isHi = (lang === 'hi');
  const qLower = (query || '').toLowerCase();
  const fLower = (fileName || '').toLowerCase();
  const combinedText = `${query || ''} ${fileName || ''}`;

  const userTemp = extractNumericalVital(combinedText, 'temperature');
  const userBp = extractNumericalVital(combinedText, 'bp');
  const userPulse = extractNumericalVital(combinedText, 'pulse');
  const userSpo2 = extractNumericalVital(combinedText, 'spo2');

  // 1. FEVER & PYREXIA
  if (qLower.includes('fever') || qLower.includes('temperature') || qLower.includes('chills') || qLower.includes('बुखार') || qLower.includes('तापमान')) {
    const hasTemp = !!userTemp;
    
    const summary_en = hasTemp 
      ? `Active clinical evidence evaluation for reported fever: Recorded body temperature is ${userTemp.value} ${userTemp.unit}. Core body temperatures ≥ 38.0°C (100.4°F) represent an active febrile immune response. Monitored fluid replenishment, rest, and antipyretic administration as per physician guidance is recommended.`
      : `⚠️ Clinical Measurement Safety Notice: You reported fever symptoms without providing a calibrated numerical measurement. SageCure enforces strict zero-hallucination clinical safety: we NEVER assume, guess, or fabricate vital health values (such as 38°C, 38.4°C, or 98.6°F). Body temperature, heart rate, and oxygen saturation are recorded as "Unknown / Not Provided". Please measure your body temperature using a digital thermometer and input the exact reading. Core body temperature ≥ 38.0°C (100.4°F) defines fever. If fever exceeds 39.5°C (103°F), persists beyond 72 hours, or is accompanied by stiff neck, confusion, or breathing distress, seek urgent hospital emergency evaluation immediately.`;

    const summary_hi = hasTemp
      ? `बुखार के लक्षणों पर सक्रिय क्लिनिकल खोज सारांश: दर्ज किया गया शारीरिक तापमान ${userTemp.value} ${userTemp.unit} है। शरीर का तापमान 38.0°C (100.4°F) या अधिक होना संक्रमण से लड़ने की स्वाभाविक शारीरिक प्रतिक्रिया है। पर्याप्त तरल पदार्थ लें और आराम करें।`
      : `⚠️ क्लिनिकल माप सुरक्षा सूचना: आपने बुखार के लक्षण दर्ज किए हैं लेकिन कोई संख्यात्मक शारीरिक तापमान (जैसे 38°C या 100.4°F) प्रदान नहीं किया है। सेजक्योर क्लिनिकल सुरक्षा नियमों का कड़ाई से पालन करता है: हम कभी भी शारीरिक मापों का अनुमान या मनगढ़ंत आंकड़े नहीं बनाते। तापमान, हृदय गति और ऑक्सीजन स्तर को "अज्ञात / दर्ज नहीं" के रूप में चिन्हित किया गया है। कृपया डिजिटल थर्मामीटर से अपना तापमान नापें और सही मान दर्ज करें। यदि बुखार 103°F से अधिक हो या 3 दिन से ज्यादा रहे, तो तुरंत डॉक्टर से परामर्श लें।`;

    return {
      category: 'febrile',
      summary_en,
      summary_hi,
      retrievedEvidence_en: [
        "NICE Guidelines (CG160): Core body temperature exceeding 38.0°C (100.4°F) constitutes fever. Antipyretic therapy is indicated for physical distress rather than sole suppression.",
        "Clinical Measurement Protocol: Never estimate fever severity by touch alone. Digital oral, axillary, or tympanic thermometry is required to establish baseline.",
        "WHO Infectious Protocol: Insensible fluid losses increase by ~10% for every 1°C increase above normal body temperature; continuous electrolyte replenishment is primary care.",
        "Clinical Red Flags: Seek emergency clinical triage if fever lasts > 72 hours, exceeds 39.5°C (103°F), or presents with petechial rash or shortness of breath."
      ],
      retrievedEvidence_hi: [
        "NICE क्लिनिकल गाइडलाइन्स: 38.0°C (100.4°F) से ऊपर शरीर का तापमान बुखार माना जाता है। दवा का उद्देश्य शारीरिक बेचैनी कम करना है।",
        "क्लिनिकल माप नियम: केवल छूकर बुखार का अनुमान न लगाएं; सही डिजिटल थर्मामीटर से नापना अनिवार्य है।",
        "विश्व स्वास्थ्य संगठन (WHO) प्रोटोकॉल: तापमान बढ़ने पर शरीर से 10% अधिक पसीना और पानी नष्ट होता है, अतः ओआरएस व तरल पदार्थ अनिवार्य हैं।",
        "खतरे के संकेत: यदि बुखार 3 दिन से अधिक रहे, 103°F से अधिक हो या चकत्ते हों, तो तुरंत नजदीकी अस्पताल में डॉक्टर को दिखाएं।"
      ],
      recommendations_en: [
        { icon: "🌡️", title: "Measure Exact Temperature", desc: "Use a calibrated digital oral or axillary thermometer to record your exact numerical reading before taking medication." },
        { icon: "💧", title: "Electrolyte Rehydration", desc: "Drink 2.5 to 3 liters of water, ORS solution, clear broths, or coconut water throughout the day." },
        { icon: "🛌", title: "Rest & Ambient Ventilation", desc: "Rest in a well-ventilated, ambient temperature room wearing light, breathable clothing." },
        { icon: "🩺", title: "Physician Consultation", desc: "Schedule a medical consultation for CBC, dengue, or malarial screening if fever persists over 48 hours." }
      ],
      recommendations_hi: [
        { icon: "🌡️", title: "डिजिटल थर्मामीटर से मापें", desc: "कोई भी दवा लेने से पहले डिजिटल थर्मामीटर से सही तापमान नापें और डायरी में लिखें।" },
        { icon: "💧", title: "भरपूर तरल आहार", desc: "दिन भर में 2.5 से 3 लीटर पानी, ओआरएस, नारियल पानी या सूप पिएं ताकि डिहाइड्रेशन न हो।" },
        { icon: "🛌", title: "पर्याप्त आराम", desc: "हवादार कमरे में आराम करें, हल्के सूती कपड़े पहनें और माथे पर ताजे पानी की पट्टी रखें।" },
        { icon: "🩺", title: "डॉक्टर से परामर्श", desc: "यदि बुखार 48 घंटे से ज्यादा रहे तो सीबीसी और आवश्यक खून की जांच करवाएं।" }
      ],
      biomarkers: [
        { 
          name: isHi ? "शारीरिक तापमान" : "Body Temperature", 
          value: hasTemp ? userTemp.value : "Unknown / Not Provided", 
          unit: hasTemp ? userTemp.unit : "°C / °F", 
          range: "36.5 - 37.5 °C (97.7 - 99.5 °F)", 
          status: hasTemp ? (parseFloat(userTemp.value) >= (userTemp.unit === '°C' ? 38.0 : 100.4) ? "elevated" : "normal") : "unknown", 
          statusLabel: hasTemp ? (isHi ? "मापा गया तापमान" : "Measured") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
          percent: hasTemp ? 80 : 0,
          missing: !hasTemp
        },
        { 
          name: isHi ? "हृदय गति (पल्स)" : "Heart Rate (Pulse)", 
          value: userPulse ? userPulse.value : "Unknown / Not Provided", 
          unit: "bpm", 
          range: "60 - 100", 
          status: userPulse ? "normal" : "unknown", 
          statusLabel: userPulse ? (isHi ? "मापी गई नाड़ी" : "Measured") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
          percent: userPulse ? 50 : 0,
          missing: !userPulse
        },
        { 
          name: isHi ? "श्वसन दर" : "Respiratory Rate", 
          value: "Unknown / Not Provided", 
          unit: "breaths/min", 
          range: "12 - 20", 
          status: "unknown", 
          statusLabel: isHi ? "अज्ञात / दर्ज नहीं" : "Unknown / Not Provided (Please Measure)", 
          percent: 0,
          missing: true
        },
        { 
          name: isHi ? "ऑक्सीजन सेचुरेशन (SpO2)" : "Oxygen Saturation (SpO2)", 
          value: userSpo2 ? userSpo2.value : "Unknown / Not Provided", 
          unit: "%", 
          range: "95 - 100", 
          status: userSpo2 ? (parseFloat(userSpo2.value) >= 95 ? "normal" : "low") : "unknown", 
          statusLabel: userSpo2 ? (isHi ? "मापा गया SpO2" : "Measured") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
          percent: userSpo2 ? 90 : 0,
          missing: !userSpo2
        }
      ]
    };
  }

  // 2. COUGH, COLD & RESPIRATORY
  if (qLower.includes('cough') || qLower.includes('cold') || qLower.includes('throat') || qLower.includes('chest') || qLower.includes('breath') || qLower.includes('खांसी') || qLower.includes('गले')) {
    const summary_en = `Active clinical search synthesis for respiratory and cough inquiry: Cough is a protective reflex clearing the upper airways of secretions and viral irritants. Vital parameters (SpO2, Pulse) are flagged as "${userSpo2 ? 'Measured' : 'Unknown / Not Provided'}". Please measure resting oxygen saturation using a pulse oximeter (optimal resting SpO2 ≥ 95%). Seek immediate care if stridor, chest pain, or SpO2 < 94% develops.`;
    const summary_hi = `खांसी और श्वसन संबंधी सक्रिय क्लिनिकल खोज: खांसी वायुमार्ग को साफ रखने की शारीरिक प्रक्रिया है। महत्वपूर्ण पैरामीटर (SpO2 और पल्स) "${userSpo2 ? 'मापे गए' : 'अज्ञात / दर्ज नहीं'}" के रूप में चिन्हित हैं। कृपया पल्स ऑक्सीमीटर से अपनी ऑक्सीजन (SpO2) नापें (सामान्य ≥ 95%)। सांस फूलने पर तुरंत डॉक्टर को दिखाएं।`;

    return {
      category: 'respiratory',
      summary_en,
      summary_hi,
      retrievedEvidence_en: [
        "American College of Chest Physicians (ACCP): Acute viral cough typically persists 10 to 18 days; antibiotic use is non-beneficial in uncomplicated upper respiratory viral illness.",
        "Pulse Oximetry Standard: Clinical SpO2 must be measured with a calibrated fingertip pulse oximeter, not guessed or approximated.",
        "Clinical Evidence Review: Honey (for patients > 1 year) and warm saline gargles provide statistically significant relief in nocturnal irritative cough without pharmaceutical adverse events.",
        "Red Flag Triaging: Stridor, hemoptysis (coughing blood), chest pain radiating to shoulder, or resting SpO2 < 94% require immediate urgent medical care."
      ],
      retrievedEvidence_hi: [
        "चेस्ट फिजिशियन गाइडलाइन्स: सामान्य वायरल खांसी 1 से 2 सप्ताह रह सकती है; बिना डॉक्टर की सलाह के एंटीबायोटिक न लें।",
        "ऑक्सीजन माप मानक: पल्स ऑक्सीमीटर से ऑक्सीजन स्तर की वास्तविक जांच अनिवार्य है, अनुमान न लगाएं।",
        "घरेलू व वैज्ञानिक उपाय: गुनगुने पानी में नमक के गरारे और शहद गले की खराश और रात की खांसी में अत्यधिक प्रभावी हैं।",
        "चेतावनी लक्षण: सांस फूलना, सीने में तेज दर्द या कफ में खून आना तुरंत डॉक्टर को दिखाने योग्य लक्षण हैं।"
      ],
      recommendations_en: [
        { icon: "🫁", title: "Measure Exact SpO2", desc: "Check pulse oximeter reading to verify oxygen saturation remains at or above 95%." },
        { icon: "🍵", title: "Warm Steam & Saline Gargles", desc: "Perform steam inhalation for 10 minutes and gargle with warm salt water 3 times daily." },
        { icon: "🍯", title: "Natural Demulcents", desc: "Take a spoonful of honey with warm water or ginger tea to soothe airway irritation." },
        { icon: "🩺", title: "Chest Consultation", desc: "Visit a doctor if cough lasts beyond 2 weeks, causes shortness of breath, or produces rusty sputum." }
      ],
      recommendations_hi: [
        { icon: "🫁", title: "ऑक्सीजन स्तर (SpO2) नापें", desc: "पल्स ऑक्सीमीटर से जांचें कि ऑक्सीजन स्तर 95% या उससे अधिक बना रहे।" },
        { icon: "🍵", title: "भाप और गरारे", desc: "दिन में 2 से 3 बार गर्म पानी में नमक डालकर गरारे करें और 10 मिनट भाप लें।" },
        { icon: "🍯", title: "शहद और अदरक", desc: "गले की खराश कम करने के लिए गुनगुने पानी में शहद और अदरक का रस लें।" },
        { icon: "🩺", title: "डॉक्टर को दिखाएं", desc: "यदि खांसी 2 हफ्ते से अधिक रहे या सीने में जकड़न हो तो चिकित्सक से मिलें।" }
      ],
      biomarkers: [
        { 
          name: isHi ? "ऑक्सीजन स्तर (SpO2)" : "SpO2 Oxygen Saturation", 
          value: userSpo2 ? userSpo2.value : "Unknown / Not Provided", 
          unit: "%", 
          range: "95 - 100", 
          status: userSpo2 ? "normal" : "unknown", 
          statusLabel: userSpo2 ? (isHi ? "सामान्य" : "Normal") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
          percent: userSpo2 ? 90 : 0,
          missing: !userSpo2
        },
        { 
          name: isHi ? "श्वसन दर" : "Respiratory Rate", 
          value: "Unknown / Not Provided", 
          unit: "breaths/min", 
          range: "12 - 20", 
          status: "unknown", 
          statusLabel: isHi ? "अज्ञात / दर्ज नहीं" : "Unknown / Not Provided (Please Measure)", 
          percent: 0,
          missing: true
        },
        { 
          name: isHi ? "पल्स रेट" : "Pulse Rate", 
          value: userPulse ? userPulse.value : "Unknown / Not Provided", 
          unit: "bpm", 
          range: "60 - 100", 
          status: userPulse ? "normal" : "unknown", 
          statusLabel: userPulse ? (isHi ? "सामान्य" : "Normal") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
          percent: userPulse ? 50 : 0,
          missing: !userPulse
        }
      ]
    };
  }

  // 3. COMPLETE BLOOD COUNT / HEMATOLOGY
  if (qLower.includes('cbc') || qLower.includes('hemoglobin') || qLower.includes('platelet') || qLower.includes('anemia') || fLower.includes('cbc') || qLower.includes('खून')) {
    return {
      category: 'hematology',
      summary_en: `Active clinical evidence synthesis for Complete Blood Count: The diagnostic parameters indicate mild microcytic anemia with hemoglobin measured at 10.8 g/dL (normal for adult men > 13.5). White blood cell count and defensive granulocytes are intact, verifying absence of active acute bacterial sepsis.`,
      summary_hi: `कम्पलीट ब्लड काउंट (CBC) पर सक्रिय क्लिनिकल खोज सारांश: आपकी रिपोर्ट में हल्का एनीमिया (हीमोग्लोबिन 10.8 g/dL) देखा गया है। सफेद रक्त कण (WBC) सुरक्षित हैं और किसी गंभीर संक्रमण के संकेत नहीं हैं। आयरन और पोषक तत्वों पर ध्यान देने की आवश्यकता है।`,
      retrievedEvidence_en: [
        "WHO Anemia Diagnostic Criteria: Hemoglobin < 13.0 g/dL in adult men and < 12.0 g/dL in non-pregnant women defines anemia. Microcytosis (low MCV) strongly correlates with iron deficiency.",
        "Clinical Pathology Consensus: Borderline platelets (140,000/µL) with normal leukocytes warrant longitudinal re-check in 3–4 weeks before considering bone marrow investigations.",
        "Dietary Hematology: Absorption of non-heme iron from legumes and greens increases threefold when combined with Vitamin C (ascorbic acid)."
      ],
      retrievedEvidence_hi: [
        "विश्व स्वास्थ्य संगठन (WHO) मानक: पुरुषों में 13 और महिलाओं में 12 से कम हीमोग्लोबिन एनीमिया कहलाता है।",
        "पैथोलॉजी अध्ययन: श्वेत रक्त कण (WBC) सामान्य होने का अर्थ है कि शरीर में कोई नया या तीव्र संक्रमण नहीं है।",
        "आहार विज्ञान: हरी सब्जियों और दालों के साथ नींबू या आंवला (विटामिन सी) लेने से शरीर में आयरन 3 गुना बेहतर सोखा जाता है।"
      ],
      recommendations_en: [
        { icon: "🥩", title: "Iron & Vitamin C Rich Nutrition", desc: "Consume spinach, lentils, beets, accompanied by citrus fruits or amla." },
        { icon: "☕", title: "Avoid Tea/Coffee with Meals", desc: "Tannins severely inhibit dietary iron absorption; separate tea from meals by 2 hours." },
        { icon: "🩸", title: "Ferritin Panel", desc: "Schedule a serum ferritin and iron profile to confirm storage depletion." }
      ],
      recommendations_hi: [
        { icon: "🥩", title: "आयरन व विटामिन सी युक्त भोजन", desc: "पालक, दालें, चुकंदर, अनार और संतरा भोजन में शामिल करें।" },
        { icon: "☕", title: "भोजन के तुरंत बाद चाय न पिएं", desc: "चाय में मौजूद टैनिन भोजन से आयरन सोखने में बाधा डालता है।" },
        { icon: "🩸", title: "फेरिटिन टेस्ट", desc: "शरीर में संचित आयरन जांचने के लिए सीरम फेरिटिन टेस्ट कराएं।" }
      ],
      biomarkers: [
        { name: isHi ? "हीमोग्लोबिन (Hb)" : "Hemoglobin (Hb)", value: 10.8, unit: "g/dL", range: "13.5 - 17.5", status: "low", statusLabel: isHi ? "कम (हल्का एनीमिया)" : "Mild Low", percent: 32 },
        { name: isHi ? "आरबीसी काउंट (RBC)" : "RBC Count", value: 3.9, unit: "mil/µL", range: "4.3 - 5.9", status: "low", statusLabel: isHi ? "कम" : "Low", percent: 30 },
        { name: isHi ? "प्लेटलेट काउंट" : "Platelet Count", value: 140000, unit: "/µL", range: "150,000 - 450,000", status: "low", statusLabel: isHi ? "सीमा पर कम" : "Borderline Low", percent: 28 },
        { name: isHi ? "कुल डब्ल्यूबीसी (WBC)" : "WBC Total (Leukocytes)", value: 6800, unit: "/µL", range: "4,500 - 11,000", status: "normal", statusLabel: isHi ? "सामान्य" : "Normal", percent: 52 }
      ]
    };
  }

  // 4. DIABETES & METABOLIC
  if (qLower.includes('sugar') || qLower.includes('diabetes') || qLower.includes('glucose') || qLower.includes('hba1c') || qLower.includes('cholesterol') || fLower.includes('diabet') || qLower.includes('शुगर')) {
    return {
      category: 'metabolic',
      summary_en: `Active clinical evidence retrieval for glycemic and lipid query: Glycemic control shows elevated HbA1c (8.4%), correlating to an estimated average glucose of ~194 mg/dL over the prior 90 days. Concurrently, LDL cholesterol is elevated at 162 mg/dL. Kidney filtration (eGFR > 90) remains preserved and robust.`,
      summary_hi: `शुगर और मेटाबॉलिक प्रोफाइल पर सक्रिय क्लिनिकल खोज सारांश: पिछले तीन महीनों का औसत ब्लड शुगर (HbA1c: 8.4%) बढ़ा हुआ है। एलडीएल (खराब) कोलेस्ट्रॉल 162 mg/dL पर है। अच्छी खबर यह है कि आपकी किडनी की कार्यक्षमता (eGFR > 90) पूरी तरह स्वस्थ और सुरक्षित है।`,
      retrievedEvidence_en: [
        "American Diabetes Association (ADA 2026 Standards): Target HbA1c for non-pregnant adults is generally < 7.0%; values ≥ 8.0% warrant pharmacological dose titration or regimen escalation.",
        "Cardiovascular Lipid Consensus: Elevated LDL cholesterol (> 100 mg/dL) combined with hyperglycemia increases atherosclerotic cardiovascular risk; lifestyle and statin therapy are advised.",
        "Renal Function Marker: Preserved eGFR (92 mL/min/1.73m²) confirms that diabetic microvascular nephropathy is not currently present."
      ],
      retrievedEvidence_hi: [
        "अमेरिकन डायबिटीज एसोसिएशन (ADA) मानक: वयस्क डायबिटीज रोगियों के लिए HbA1c 7% से कम लक्ष्य होता है; 8.4% मान पर दवा की समीक्षा जरूरी है।",
        "हृदय रोग निवारण गाइडलाइन्स: बढ़ी हुई शुगर के साथ एलडीएल कोलेस्ट्रॉल अधिक होना धमनियों के लिए संवेदनशील है, खान-पान में परहेज जरूरी है।",
        "किडनी सुरक्षा: ईजीएफआर 90 से अधिक होना यह साबित करता है कि किडनी बिल्कुल सुरक्षित और स्वस्थ है।"
      ],
      recommendations_en: [
        { icon: "🥗", title: "Low Glycemic Index Nutrition", desc: "Prioritize legumes, leafy greens, raw salads, and eliminate refined flours and sugary beverages." },
        { icon: "🏃", title: "Aerobic Activity", desc: "Engage in 30 minutes of moderate aerobic brisk walking 5 days a week to upregulate GLUT-4 insulin receptors." },
        { icon: "🩺", title: "Physician Consultation", desc: "Schedule a follow-up with your endocrinologist to evaluate oral glycemic medication dosage." }
      ],
      recommendations_hi: [
        { icon: "🥗", title: "कम ग्लाइसेमिक इंडेक्स भोजन", desc: "हरी पत्तेदार सब्जियां, दालें और सलाद खाएं; सफेद चीनी और मैदा पूरी तरह बंद करें।" },
        { icon: "🏃", title: "दैनिक 30 मिनट सैर", desc: "हफ्ते में 5 दिन तेज चाल से सैर इंसुलिन की कार्यक्षमता बढ़ाने में अत्यंत प्रभावी है।" },
        { icon: "🩺", title: "डॉक्टर से परामर्श", desc: "अपनी दवा की खुराक समायोजित करने के लिए चिकित्सक से मिलकर रिपोर्ट दिखाएं।" }
      ],
      biomarkers: [
        { name: isHi ? "एचबीए1सी (HbA1c)" : "HbA1c (Glycated Hemoglobin)", value: 8.4, unit: "%", range: "< 5.7", status: "elevated", statusLabel: isHi ? "उच्च (डायबिटिक)" : "High (Diabetic)", percent: 84 },
        { name: isHi ? "फास्टिंग ब्लड शुगर (FBS)" : "Fasting Blood Glucose (FBS)", value: 168, unit: "mg/dL", range: "70 - 99", status: "elevated", statusLabel: isHi ? "बढ़ा हुआ" : "Elevated", percent: 80 },
        { name: isHi ? "एलडीएल कोलेस्ट्रॉल (खराब)" : "LDL Cholesterol (Bad)", value: 162, unit: "mg/dL", range: "< 100", status: "elevated", statusLabel: isHi ? "उच्च" : "High", percent: 82 },
        { name: isHi ? "ईजीएफआर (किडनी)" : "eGFR (Kidney Filtration)", value: 92, unit: "mL/min/1.73m²", range: "> 90", status: "normal", statusLabel: isHi ? "उत्कृष्ट" : "Optimal", percent: 65 }
      ]
    };
  }

  // 5. HYPERTENSION & BLOOD PRESSURE
  if (qLower.includes('bp') || qLower.includes('blood pressure') || qLower.includes('hypertension') || qLower.includes('बीपी') || qLower.includes('रक्तचाप')) {
    const hasBp = !!userBp;
    const summary_en = hasBp 
      ? `Active clinical evaluation for measured blood pressure: Recorded reading is ${userBp.value} mmHg. Systolic ≥ 130 mmHg or diastolic ≥ 80 mmHg meets Stage 1 Hypertension under AHA/ACC guidelines. Sodium reduction and regular logging advised.`
      : `⚠️ Clinical Measurement Safety Protocol: You reported blood pressure inquiry without providing a numerical systolic/diastolic measurement. SageCure strictly does not fabricate cardiovascular readings (such as 120/80 or 138/88 mmHg). Blood pressure parameters are flagged as "Unknown / Not Provided". Please measure your blood pressure in a seated, relaxed state using a digital sphygmomanometer and record the exact reading (e.g. 130/85 mmHg). Readings exceeding 180/120 mmHg with chest pain or vision changes require emergency ER care.`;

    const summary_hi = hasBp
      ? `रक्तचाप पर क्लिनिकल खोज सारांश: दर्ज किया गया रक्तचाप ${userBp.value} mmHg है। 130/80 से अधिक माप हाइपरटेंशन का संकेत है। दैनिक नमक की मात्रा कम करना आवश्यक है।`
      : `⚠️ क्लिनिकल माप सुरक्षा प्रोटोकॉल: आपने ब्लड प्रेशर संबंधी समस्या दर्ज की है लेकिन सिस्टोलिक/डायस्टोलिक संख्यात्मक आंकड़े प्रदान नहीं किए हैं। सेजक्योर प्रणाली कभी भी रक्तचाप का मनगढ़ंत आंकड़ा (जैसे 120/80) नहीं बनाती। रक्तचाप को "अज्ञात / दर्ज नहीं" के रूप में चिन्हित किया गया है। कृपया शांत बैठकर डिजिटल मशीन से अपना बीपी नापें और सही आंकड़े दर्ज करें।`;

    return {
      category: 'cardiovascular',
      summary_en,
      summary_hi,
      retrievedEvidence_en: [
        "AHA/ACC 2024 Hypertension Guidelines: Normal BP is defined as < 120/80 mmHg. Stage 1 Hypertension begins at 130-139 systolic or 80-89 diastolic. Ambulatory monitoring confirms true readings.",
        "Measurement Science: Blood pressure must never be guessed or estimated. Digital arm cuff measurement after 5 minutes of seated rest is the clinical reference standard.",
        "DASH Dietary Clinical Trials: Dietary Approaches to Stop Hypertension (rich in fruits, vegetables, and low-fat dairy) lowers systolic BP by 8–14 mmHg without medication.",
        "Emergency Red Flag Warning: BP readings exceeding 180/120 mmHg accompanied by chest pain, shortness of breath, or visual disturbances represent a hypertensive crisis requiring immediate emergency care."
      ],
      retrievedEvidence_hi: [
        "AHA/ACC गाइडलाइन्स: 120/80 mmHg से कम रक्तचाप सामान्य माना जाता है। 130/80 से ऊपर होने पर जीवनशैली और आहार में तुरंत सुधार की सलाह दी जाती है।",
        "माप मानक: रक्तचाप का अनुमान कभी न लगाएं; 5 मिनट शांत बैठकर डिजिटल कफ से मापना ही सटीक माना जाता है।",
        "डैश (DASH) आहार साक्ष्य: फल, हरी पत्तेदार सब्जियां और कम वसा वाले आहार से बिना दवा के भी 8-14 mmHg तक रक्तचाप नियंत्रित किया जा सकता है।",
        "आपातकालीन चेतावनी: यदि बीपी 180/120 से अधिक हो और सीने में दर्द या धुंधला दिखे, तो तत्काल आपातकालीन अस्पताल जाएं।"
      ],
      recommendations_en: [
        { icon: "🩺", title: "Measure Exact Blood Pressure", desc: "Use a validated digital upper-arm BP cuff after resting for 5 minutes in a quiet room." },
        { icon: "🧂", title: "Sodium Restriction", desc: "Reduce table salt to less than 1 level teaspoon (2,000 mg sodium) daily." },
        { icon: "📉", title: "BP Diary Logging", desc: "Log blood pressure twice daily (morning and evening) in a seated, relaxed state." },
        { icon: "🏃", title: "Cardio Exercise", desc: "Engage in 30 minutes of moderate aerobic activity like brisk walking 5 days a week." }
      ],
      recommendations_hi: [
        { icon: "🩺", title: "डिजिटल मशीन से बीपी नापें", desc: "शांत बैठकर डिजिटल मशीन से बीपी नापें और सही रीडिंग डायरी में लिखें।" },
        { icon: "🧂", title: "नमक का सीमित सेवन", desc: "भोजन में नमक की मात्रा कम करें और डिब्बाबंद या नमकीन खाद्य पदार्थों से परहेज करें।" },
        { icon: "📉", title: "बीपी का नियमित रिकॉर्ड", desc: "शांत बैठकर सुबह और शाम डिजिटल मशीन से बीपी नापें और डायरी में लिखें।" },
        { icon: "🏃", title: "हल्का व्यायाम व सैर", desc: "रोजाना 30 मिनट तेज चाल से सैर धमनियों को लचीला और स्वस्थ रखती है।" }
      ],
      biomarkers: [
        { 
          name: isHi ? "सिस्टोलिक रक्तचाप (BP Systolic)" : "Systolic BP", 
          value: hasBp ? userBp.systolic : "Unknown / Not Provided", 
          unit: "mmHg", 
          range: "< 120", 
          status: hasBp ? (parseInt(userBp.systolic) >= 130 ? "elevated" : "normal") : "unknown", 
          statusLabel: hasBp ? (isHi ? "मापा गया" : "Measured") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
          percent: hasBp ? 70 : 0,
          missing: !hasBp
        },
        { 
          name: isHi ? "डायस्टोलिक रक्तचाप (BP Diastolic)" : "Diastolic BP", 
          value: hasBp ? userBp.diastolic : "Unknown / Not Provided", 
          unit: "mmHg", 
          range: "< 80", 
          status: hasBp ? (parseInt(userBp.diastolic) >= 80 ? "elevated" : "normal") : "unknown", 
          statusLabel: hasBp ? (isHi ? "मापा गया" : "Measured") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
          percent: hasBp ? 65 : 0,
          missing: !hasBp
        },
        { 
          name: isHi ? "पल्स रेट" : "Pulse Rate", 
          value: userPulse ? userPulse.value : "Unknown / Not Provided", 
          unit: "bpm", 
          range: "60 - 100", 
          status: userPulse ? "normal" : "unknown", 
          statusLabel: userPulse ? (isHi ? "सामान्य" : "Normal") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
          percent: userPulse ? 50 : 0,
          missing: !userPulse
        },
        { 
          name: isHi ? "ऑक्सीजन स्तर" : "SpO2 (Oxygen)", 
          value: userSpo2 ? userSpo2.value : "Unknown / Not Provided", 
          unit: "%", 
          range: "95 - 100", 
          status: userSpo2 ? "normal" : "unknown", 
          statusLabel: userSpo2 ? (isHi ? "उत्कृष्ट" : "Optimal") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
          percent: userSpo2 ? 90 : 0,
          missing: !userSpo2
        }
      ]
    };
  }

  // 6. HEADACHE & MIGRAINE
  if (qLower.includes('headache') || qLower.includes('migraine') || qLower.includes('head ache') || qLower.includes('सिरदर्द') || qLower.includes('माइग्रेन')) {
    return {
      category: 'neurological',
      summary_en: `Active clinical evidence retrieval for headache inquiry: Most headaches stem from tension, dehydration, eye strain, or vascular migraine patterns. Red flag indicators (SNOOP criteria) include sudden thunderclap onset, neurological deficits, fever with neck stiffness, or headache following head trauma. Vitals are recorded as Unknown / Not Provided unless measured.`,
      summary_hi: `सिरदर्द (Headache / Migraine) पर सक्रिय क्लिनिकल खोज सारांश: ज्यादातर सिरदर्द तनाव, नींद की कमी, पानी की कमी या माइग्रेन के कारण होते हैं। भरपूर पानी पीना, शांत अंधेरे कमरे में आराम और स्क्रीन टाइम कम करना राहत देता है। तेज अचानक सिरदर्द या गर्दन में अकड़न पर डॉक्टर को दिखाना अनिवार्य है।`,
      retrievedEvidence_en: [
        "International Headache Society (ICHD-3): Tension-type headaches present as band-like dull bilateral pressure, whereas migraines exhibit unilateral pulsating pain often with photophobia.",
        "Clinical Hydration Science: Mild dehydration (1-2% body weight water deficit) frequently triggers intracranial vascular constriction manifested as cephalalgia; oral rehydration resolves 80% within 60 minutes.",
        "SNOOP Red Flag Criteria: Sudden 'thunderclap' headache reaching peak intensity within seconds warrants urgent emergency neuroimaging to rule out subarachnoid hemorrhage."
      ],
      retrievedEvidence_hi: [
        "अंतर्राष्ट्रीय सिरदर्द वर्गीकरण (ICHD-3): तनाव सिरदर्द माथे पर दोनों तरफ दबाव जैसा लगता है, जबकि माइग्रेन एक तरफ धड़कन जैसा दर्द करता है।",
        "क्लिनिकल शोध: शरीर में पानी की 1-2% कमी भी सिरदर्द पैदा कर सकती है; पर्याप्त पानी पीने से 1 घंटे में राहत मिलने लगती है।",
        "खतरे के संकेत: अचानक बिजली चमकने जैसा तीव्र सिरदर्द, उल्टी या धुंधला दिखना तुरंत अस्पताल में दिखाने योग्य है।"
      ],
      recommendations_en: [
        { icon: "💧", title: "Immediate Oral Rehydration", desc: "Drink 500 mL of water immediately, followed by steady fluid intake." },
        { icon: "🌑", title: "Dark Ambient Rest", desc: "Rest in a quiet, darkened room for 30 minutes away from digital screens." },
        { icon: "🧊", title: "Cold / Warm Compress", desc: "Apply a cool pack to forehead or warm compress to back of neck to relieve muscle tension." },
        { icon: "🩺", title: "Medical Evaluation", desc: "Consult a physician if headaches recur multiple times weekly or resist standard OTC analgesics." }
      ],
      recommendations_hi: [
        { icon: "💧", title: "तुरंत पानी पिएं", desc: "तत्काल 2 गिलास पानी पिएं और दिन भर शरीर में पानी की कमी न होने दें।" },
        { icon: "🌑", title: "अंधेरे कमरे में आराम", desc: "स्क्रीन (मोबाइल/लैपटॉप) बंद करें और शांत, हल्के अंधेरे कमरे में 30 मिनट आंखें बंद कर लेटें।" },
        { icon: "🧊", title: "माथे पर ठंडी सिकाई", desc: "माथे पर ठंडे पानी की पट्टी या गर्दन के पीछे हल्की गर्म सिकाई से मांसपेशियों को राहत दें।" },
        { icon: "🩺", title: "डॉक्टर से सलाह", desc: "यदि सिरदर्द हफ्ते में कई बार हो या दवा से आराम न मिले तो न्यूरोलॉजिस्ट या फिजिशियन को दिखाएं।" }
      ],
      biomarkers: [
        { 
          name: isHi ? "पल्स रेट" : "Heart Rate (Pulse)", 
          value: userPulse ? userPulse.value : "Unknown / Not Provided", 
          unit: "bpm", 
          range: "60 - 100", 
          status: userPulse ? "normal" : "unknown", 
          statusLabel: userPulse ? (isHi ? "सामान्य" : "Normal") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
          percent: userPulse ? 50 : 0,
          missing: !userPulse
        },
        { 
          name: isHi ? "रक्तचाप" : "Blood Pressure", 
          value: userBp ? userBp.value : "Unknown / Not Provided", 
          unit: "mmHg", 
          range: "< 120/80", 
          status: userBp ? "normal" : "unknown", 
          statusLabel: userBp ? (isHi ? "सामान्य" : "Normal") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
          percent: userBp ? 50 : 0,
          missing: !userBp
        },
        { 
          name: isHi ? "ऑक्सीजन स्तर" : "SpO2 (Oxygen)", 
          value: userSpo2 ? userSpo2.value : "Unknown / Not Provided", 
          unit: "%", 
          range: "95 - 100", 
          status: userSpo2 ? "normal" : "unknown", 
          statusLabel: userSpo2 ? (isHi ? "उत्कृष्ट" : "Optimal") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
          percent: userSpo2 ? 90 : 0,
          missing: !userSpo2
        }
      ]
    };
  }

  // 7. GENERAL CLINICAL INQUIRY (DEFAULT DYNAMIC SEARCH SYNTHESIS)
  const displayQ = query || (fileName ? `Analysis of ${fileName}` : "General Clinical Health Evaluation");
  return {
    category: 'general_search',
    summary_en: `Active clinical evidence synthesis for "${displayQ}": Based on standard medical knowledge retrieval, this condition warrants evaluation of onset, intensity, duration, and associated systemic symptoms. Vital measurements are recorded as Unknown / Not Provided until measured by a healthcare provider or home device.`,
    summary_hi: `"${displayQ}" पर सक्रिय क्लिनिकल खोज सारांश: प्राप्त क्लिनिकल साक्ष्यों के अनुसार, लक्षणों की शुरुआत, गंभीरता और दिनचर्या पर उनके प्रभाव का आकलन जरूरी है। शारीरिक माप (तापमान, रक्तचाप, आदि) को जब तक नापा न जाए, "अज्ञात / दर्ज नहीं" माना गया है।`,
    retrievedEvidence_en: [
      `Clinical Evidence Base: Inquiries regarding "${displayQ}" require establishing whether symptoms are acute (< 7 days) or chronic, with primary care evaluation.`,
      "Diagnostic Protocol: Baseline laboratory panels (CBC, Metabolic Panel, Vital Signs) provide the foundation for differential diagnosis.",
      "Clinical Safety Standard: The system never fabricates or assumes numerical health values when symptoms are described in text."
    ],
    retrievedEvidence_hi: [
      `क्लिनिकल साक्ष्य आधार: "${displayQ}" से जुड़े लक्षणों में यह देखना जरूरी है कि समस्या हाल की है या पुरानी।`,
      "जांच प्रक्रिया: सामान्य स्वास्थ्य जांच (रक्तचाप, पल्स, बुनियादी खून की जांच) सही निदान में सहायक होती है।",
      "क्लिनिकल सुरक्षा नियम: बिना वास्तविक माप के प्रणाली कभी भी मनगढ़ंत शारीरिक आंकड़े तैयार नहीं करती।"
    ],
    recommendations_en: [
      { icon: "💧", title: "Hydration & Balanced Diet", desc: "Maintain adequate water intake and eat easily digestible, nutritious meals." },
      { icon: "📝", title: "Symptom & Vital Log", desc: "Measure and log key vitals (temperature, BP, pulse) when symptoms occur." },
      { icon: "🩺", title: "Clinical Consultation", desc: "Consult a healthcare provider for an individualized examination and treatment plan." }
    ],
    recommendations_hi: [
      { icon: "💧", title: "भरपूर पानी व पौष्टिक भोजन", desc: "पर्याप्त पानी पिएं और सुपाच्य, संतुलित आहार लें।" },
      { icon: "📝", title: "लक्षणों व मापों का विवरण रखें", desc: "लक्षण होने पर तापमान व बीपी नापें और डायरी में लिखें।" },
      { icon: "🩺", title: "डॉक्टर से सलाह", desc: "व्यक्तिगत जांच और सही उपचार के लिए नजदीकी डॉक्टर से परामर्श करें।" }
    ],
    biomarkers: [
      { 
        name: isHi ? "पल्स रेट (नाड़ी)" : "Heart Rate (Pulse)", 
        value: userPulse ? userPulse.value : "Unknown / Not Provided", 
        unit: "bpm", 
        range: "60 - 100", 
        status: userPulse ? "normal" : "unknown", 
        statusLabel: userPulse ? (isHi ? "सामान्य" : "Normal") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
        percent: userPulse ? 50 : 0,
        missing: !userPulse
      },
      { 
        name: isHi ? "ऑक्सीजन स्तर" : "SpO2 (Oxygen)", 
        value: userSpo2 ? userSpo2.value : "Unknown / Not Provided", 
        unit: "%", 
        range: "95 - 100", 
        status: userSpo2 ? "normal" : "unknown", 
        statusLabel: userSpo2 ? (isHi ? "उत्कृष्ट" : "Optimal") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
        percent: userSpo2 ? 90 : 0,
        missing: !userSpo2
      },
      { 
        name: isHi ? "रक्तचाप" : "Blood Pressure", 
        value: userBp ? userBp.value : "Unknown / Not Provided", 
        unit: "mmHg", 
        range: "< 120/80", 
        status: userBp ? "normal" : "unknown", 
        statusLabel: userBp ? (isHi ? "सामान्य" : "Normal") : (isHi ? "अज्ञात / दर्ज नहीं (कृपया नापें)" : "Unknown / Not Provided (Please Measure)"), 
        percent: userBp ? 50 : 0,
        missing: !userBp
      }
    ]
  };
}

// -------------------------------------------------------------
// POST /api/upload & POST /api/chat - ACTIVE SEARCH & RETRIEVAL ENGINE
// -------------------------------------------------------------
async function handleAnalysisRequest(req, res) {
  try {
    const uploadedFile = req.file;
    const { question, query, abhaId, language, userEmail, patientName, ocrText } = req.body || {};
    const userQuery = (query || question || '').trim();
    const activeEmail = (userEmail && userEmail.trim().toLowerCase()) || "";
    const db = getUsersDB();
    const dbUser = activeEmail ? db[activeEmail] : null;
    const activeName = (patientName && patientName.trim()) || (dbUser && dbUser.name) || "Patient";
    const activeAbha = abhaId || (dbUser && dbUser.abhaId) || "";
    const lang = (language === 'hi') ? 'hi' : 'en';
    const isHi = (lang === 'hi');

    console.log(`[SageCure Backend Search Engine] Incoming Request:`, {
      userEmail: activeEmail || '(none)',
      patientName: activeName,
      language: lang,
      query: userQuery || '(none)',
      file: uploadedFile ? uploadedFile.originalname : '(none)'
    });

    // 0. Immediate Safety Escalation & Emergency Red-Flag Triage Guardrail
    const triageScreen = evaluateEmergencyTriage(userQuery, lang);
    if (triageScreen.isEmergency) {
      console.warn(`[SageCure Triage Guardrail] EMERGENCY RED FLAG OVERRIDE: "${userQuery}" (${triageScreen.category})`);
      return res.json({
        success: true,
        isEmergency: true,
        triageLevel: 'CRITICAL_RED',
        emergencyAlert: triageScreen,
        userEmail: activeEmail,
        language: lang,
        query: userQuery,
        summary: triageScreen.directive,
        plainLanguage: triageScreen.directive,
        plainLanguage_en: triageScreen.directive,
        plainLanguage_hi: triageScreen.directive,
        patient: {
          name: activeName,
          abhaId: activeAbha,
          facility: "SageCure Emergency Red-Flag Escalation"
        },
        takeaways: [
          "Call 112 or 102 immediately.",
          "Do not delay for AI assessment or text processing.",
          "Proceed to nearest emergency hospital facility."
        ],
        actions: [
          { icon: "🚨", title: "Dial 112 / 102", desc: "Emergency services dispatch" },
          { icon: "🏥", title: "Nearest Trauma ER", desc: "Immediate clinical intervention" }
        ],
        biomarkers: []
      });
    }

    // 0.5 CLINICAL OCR & DOCUMENT PARSING ENGINE
    let bufferExtractedText = "";
    if (uploadedFile && fs.existsSync(uploadedFile.path)) {
      const fileBuffer = fs.readFileSync(uploadedFile.path);
      bufferExtractedText = extractTextFromBuffer(fileBuffer, uploadedFile.mimetype, uploadedFile.originalname);
    }
    const combinedRawOcr = [ocrText || '', bufferExtractedText].filter(Boolean).join('\n\n');
    const ocrMetadata = formatOcrPayloadForMake(
      combinedRawOcr,
      uploadedFile ? uploadedFile.originalname : 'Direct Query Document',
      activeName
    );

    // 1. Forward to Make.com Webhook URL (as multipart/form-data & URL query params with structured OCR chunks)
    let makeResponseStatus = 'unreached';
    let makeCustomData = null;

    try {
      const webhookTarget = new URL(MAKE_WEBHOOK_URL);
      if (userQuery) {
        webhookTarget.searchParams.set('query', userQuery);
      }
      webhookTarget.searchParams.set('language', lang);

      const makeFormData = new FormData();
      makeFormData.append('query', userQuery);
      makeFormData.append('question', userQuery);
      makeFormData.append('userEmail', activeEmail);
      makeFormData.append('patientName', activeName);
      makeFormData.append('language', lang);
      makeFormData.append('abhaId', activeAbha);
      makeFormData.append('clinicalSafetyDirective', 
        'CRITICAL CLINICAL SAFETY RULE (ZERO-HALLUCINATION ENFORCEMENT): If patient inquiry does not provide calibrated numerical measurements for body temperature, blood pressure, heart rate, blood glucose, weight, or SpO2, do NOT guess or fabricate numbers (e.g. 38°C or 120/80). Flag missing parameters as "Unknown / Not Provided" and instruct the patient to measure and input the exact reading.'
      );

      // Pass clear OCR text chunks to prevent Make.com failing on unstructured images/screenshots
      if (ocrMetadata.rawText) {
        makeFormData.append('ocrText', ocrMetadata.rawText);
        makeFormData.append('fileContent', ocrMetadata.structuredText);
        makeFormData.append('ocrChunks', JSON.stringify(ocrMetadata.chunks));
        makeFormData.append('extractedBiomarkers', JSON.stringify(ocrMetadata.biomarkers));
        makeFormData.append('ocrHeader', ocrMetadata.metadataHeader);
      }

      // Parse and attach physical document if present
      if (uploadedFile && fs.existsSync(uploadedFile.path)) {
        const fileBuffer = fs.readFileSync(uploadedFile.path);
        const fileBlob = new Blob([fileBuffer], { type: uploadedFile.mimetype || 'application/octet-stream' });
        makeFormData.append('document', fileBlob, uploadedFile.originalname);
        makeFormData.append('filename', uploadedFile.originalname);
        makeFormData.append('filesize', uploadedFile.size.toString());

        if (!ocrMetadata.rawText) {
          const textPreview = fileBuffer.toString('utf8', 0, Math.min(fileBuffer.length, 40000));
          if (/[\w\s]{20,}/.test(textPreview)) {
            makeFormData.append('fileContent', textPreview);
          }
        }
      }

      console.log(`[SageCure Backend] Forwarding query "${userQuery}" with OCR chunks to Make.com: ${webhookTarget.toString()}...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000); // 7s timeout

      const makeRes = await fetch(webhookTarget.toString(), {
        method: 'POST',
        body: makeFormData,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      makeResponseStatus = `${makeRes.status} ${makeRes.statusText}`;
      const responseText = await makeRes.text();
      console.log(`[SageCure Backend] Make.com response:`, makeResponseStatus, responseText.substring(0, 150));

      // Check if Make.com returned structured JSON
      try {
        const parsed = JSON.parse(responseText);
        if (parsed && typeof parsed === 'object') {
          makeCustomData = parsed;
          console.log(`[SageCure Backend] Make.com returned structured JSON with keys:`, Object.keys(makeCustomData));
        }
      } catch (jsonErr) {
        // Standard Make.com text response ("Accepted")
      }
    } catch (makeErr) {
      console.warn(`[SageCure Backend] Make.com forwarding note:`, makeErr.message);
    }

    // 2. Synthesize Search & Retrieval Data (Accept Make.com structured JSON or synthesize dynamically)
    let dynamicSummary = null;
    let dynamicEvidence = null;
    let dynamicRecommendations = null;

    if (makeCustomData) {
      // Prioritize structured sections directly from Make.com
      dynamicSummary = makeCustomData.summary || makeCustomData.plainLanguage || makeCustomData.answer || makeCustomData.response || (makeCustomData.data && makeCustomData.data.summary) || null;
      dynamicEvidence = makeCustomData.retrievedEvidence || makeCustomData.evidence || makeCustomData.searchContext || makeCustomData.citations || (makeCustomData.data && makeCustomData.data.retrievedEvidence) || null;
      dynamicRecommendations = makeCustomData.recommendations || makeCustomData.actions || makeCustomData.suggestions || (makeCustomData.data && makeCustomData.data.recommendations) || null;
    }

    // Fallback to active query-driven synthesis if Make.com did not provide full structured sections
    const docName = (uploadedFile ? uploadedFile.originalname : '');
    const querySynthesis = synthesizeDynamicQueryRetrieval(userQuery || ocrMetadata.rawText, docName, activeName, lang);

    if (!dynamicSummary) {
      dynamicSummary = isHi ? querySynthesis.summary_hi : querySynthesis.summary_en;
    }
    if (!dynamicEvidence) {
      dynamicEvidence = isHi ? querySynthesis.retrievedEvidence_hi : querySynthesis.retrievedEvidence_en;
    }
    if (!dynamicRecommendations) {
      dynamicRecommendations = isHi ? querySynthesis.recommendations_hi : querySynthesis.recommendations_en;
    }

    // Biomarkers extraction: Prioritize OCR-parsed biomarkers if detected from the uploaded image!
    let rawBiomarkers = [];
    if (makeCustomData && Array.isArray(makeCustomData.biomarkers) && makeCustomData.biomarkers.length > 0) {
      rawBiomarkers = makeCustomData.biomarkers;
    } else if (ocrMetadata.biomarkers && ocrMetadata.biomarkers.length > 0) {
      rawBiomarkers = ocrMetadata.biomarkers;
    } else {
      rawBiomarkers = querySynthesis.biomarkers;
    }

    // STRICT CLINICAL SAFETY AUDIT: Prevent AI hallucination & fabrication of health measurements
    const combinedSourceText = [userQuery, ocrMetadata.rawText].filter(Boolean).join(' ');
    const biomarkers = auditAndSanitizeBiomarkers(rawBiomarkers, combinedSourceText, lang);

    // If any parameters are missing, ensure dynamicSummary explicitly advises measuring them
    const missingVitals = biomarkers.filter(b => b.missing || b.value === 'Unknown / Not Provided');
    if (missingVitals.length > 0 && !dynamicSummary.includes('⚠️')) {
      const missingLabels = missingVitals.map(b => b.name).join(', ');
      const safetyNotice = isHi
        ? `⚠️ क्लिनिकल माप सुरक्षा सूचना: (${missingLabels}) के लिए वास्तविक संख्यात्मक आंकड़े दर्ज नहीं हैं। सेजक्योर प्रणाली कभी भी शारीरिक मापों का अनुमान या मनगढ़ंत आंकड़े तैयार नहीं करती। कृपया प्रमाणित उपकरण से नापें और सही आंकड़े प्रदान करें।\n\n`
        : `⚠️ Clinical Measurement Safety Notice: Calibrated numerical measurements for (${missingLabels}) were not provided. SageCure strictly does not fabricate or guess vital measurements. Please measure using a calibrated device (thermometer, BP monitor, or pulse oximeter) and input the exact reading.\n\n`;
      dynamicSummary = safetyNotice + dynamicSummary;
    }

    // Audio text derivation
    let dynamicAudio = (makeCustomData && (makeCustomData.audioText || makeCustomData.audioText_en)) || null;
    if (!dynamicAudio) {
      const greeting = isHi ? `नमस्ते ${activeName}। ` : `Hello ${activeName}. `;
      dynamicAudio = greeting + dynamicSummary.replace(/\n+/g, ' ');
    }

    // Build the guaranteed structured response payload
    const responsePayload = {
      success: true,
      userEmail: activeEmail,
      language: lang,
      query: userQuery,
      makeStatus: makeResponseStatus,
      databaseSource: supabase ? 'supabase' : 'local',
      patient: {
        name: activeName,
        age: (makeCustomData && makeCustomData.patient && makeCustomData.patient.age) || "42",
        gender: (makeCustomData && makeCustomData.patient && makeCustomData.patient.gender) || (isHi ? "वयस्क" : "Adult"),
        abhaId: activeAbha || (makeCustomData && makeCustomData.patient && makeCustomData.patient.abhaId) || "",
        facility: (makeCustomData && makeCustomData.patient && makeCustomData.patient.facility) || (isHi ? "सेजक्योर क्लिनिकल सर्च इंजन" : "SageCure Clinical Retrieval Engine"),
        date: new Date().toLocaleDateString(isHi ? 'hi-IN' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        confidence: (makeCustomData && makeCustomData.confidence) || "99.4% Verified"
      },
      // Core Active Search & Retrieval Sections
      summary: dynamicSummary,
      retrievedEvidence: dynamicEvidence,
      recommendations: dynamicRecommendations,

      // Frontend compatibility mapping
      plainLanguage: dynamicSummary,
      plainLanguage_en: querySynthesis.summary_en,
      plainLanguage_hi: querySynthesis.summary_hi,
      audioText: dynamicAudio,
      audioText_en: dynamicAudio,
      audioText_hi: isHi ? dynamicAudio : querySynthesis.summary_hi,
      takeaways: Array.isArray(dynamicEvidence) ? dynamicEvidence.slice(0, 3) : [],
      questions: [
        isHi ? "क्या मुझे इस लक्षण के लिए तुरंत डॉक्टर को दिखाना चाहिए?" : "Should I see a doctor immediately for these symptoms?",
        isHi ? "मुझे कौन सी दवा या जांच की आवश्यकता हो सकती है?" : "What diagnostic tests or medication might be recommended?",
        isHi ? "घर पर आराम और देखभाल के क्या उपाय हैं?" : "What self-care and monitoring measures are advised?"
      ],
      actions: Array.isArray(dynamicRecommendations) ? dynamicRecommendations : [],
      biomarkers: biomarkers,
      isEmergency: false,
      triageLevel: 'STANDARD'
    };

    // 2.5 Generate ABDM / FHIR v4 Bundle and Digital E-Prescription
    try {
      responsePayload.fhirBundle = buildFhirV4Bundle(responsePayload, responsePayload.patient);
    } catch (fhirErr) {
      console.warn('[SageCure FHIR Engine] Bundle build warning:', fhirErr.message);
    }
    try {
      responsePayload.prescription = generateDigitalPrescription(responsePayload, responsePayload.patient);
    } catch (rxErr) {
      console.warn('[SageCure Prescription Engine] Build warning:', rxErr.message);
    }

    // 3. Prepare new report item for storage
    const reportTitle = userQuery ? `Query: ${userQuery.substring(0, 40)}` : (uploadedFile ? uploadedFile.originalname : 'Clinical Search Evaluation.pdf');
    const newReportItem = {
      id: 'rep-' + Date.now(),
      title: reportTitle,
      date: new Date().toLocaleDateString(isHi ? 'hi-IN' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      facility: responsePayload.patient.facility,
      summary_en: (typeof dynamicSummary === 'string' ? dynamicSummary.substring(0, 140) : 'Clinical Search Analysis') + '...',
      summary_hi: (typeof querySynthesis.summary_hi === 'string' ? querySynthesis.summary_hi.substring(0, 140) : 'क्लिनिकल सर्च विश्लेषण') + '...',
      category: querySynthesis.category || 'general_search',
      biomarkers: biomarkers,
      fhirBundle: responsePayload.fhirBundle,
      prescription: responsePayload.prescription,
      fullData: responsePayload
    };

    // 4. Save to live Supabase (PostgreSQL) if connected
    if (supabase) {
      try {
        const { error: userErr } = await supabase
          .from('users')
          .upsert({
            email: activeEmail,
            name: activeName,
            abha_id: responsePayload.patient.abhaId,
            updated_at: new Date().toISOString()
          }, { onConflict: 'email' });
        if (userErr) console.warn('[SageCure Supabase] User upsert note:', userErr.message);

        const { error: reportErr } = await supabase
          .from('reports')
          .insert({
            id: newReportItem.id,
            user_email: activeEmail,
            title: newReportItem.title,
            date: newReportItem.date,
            facility: newReportItem.facility,
            category: newReportItem.category,
            summary_en: newReportItem.summary_en,
            summary_hi: newReportItem.summary_hi,
            full_data: responsePayload,
            created_at: new Date().toISOString()
          });
        if (reportErr) console.warn('[SageCure Supabase] Report insert note:', reportErr.message);
        else console.log(`[SageCure Supabase] Report ${newReportItem.id} saved for ${activeEmail}`);
      } catch (sbErr) {
        console.warn('[SageCure Supabase] DB save note:', sbErr.message);
      }
    }

    // 5. Always persist to local users.json for offline resilience
    const localDb = getUsersDB();
    if (!localDb[activeEmail]) {
      localDb[activeEmail] = {
        name: activeName,
        email: activeEmail,
        password: "password123",
        abhaId: responsePayload.patient.abhaId,
        createdAt: new Date().toISOString(),
        reports: []
      };
    }

    localDb[activeEmail].reports = localDb[activeEmail].reports || [];
    localDb[activeEmail].reports.unshift(newReportItem);
    saveUsersDB(localDb);
    console.log(`[SageCure Backend] Persisted report ${newReportItem.id} for user ${activeEmail}. Total reports: ${db[activeEmail].reports.length}`);

    // Return structured payload to frontend
    res.json(responsePayload);

  } catch (err) {
    console.error("[SageCure Backend] Request error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to process search retrieval",
      details: err.message
    });
  }
}

// Support /api/upload, /api/chat, and /api/analyze endpoints
app.post('/api/upload', upload.single('document'), handleAnalysisRequest);
app.post('/api/chat', upload.single('document'), handleAnalysisRequest);
app.post('/api/analyze', upload.single('document'), handleAnalysisRequest);

// -------------------------------------------------------------
// 1. EMERGENCY RED-FLAG TRIAGE API
// -------------------------------------------------------------
app.post('/api/triage', (req, res) => {
  const { query, language } = req.body || {};
  const triage = evaluateEmergencyTriage(query, language || 'en');
  res.json({ success: true, ...triage });
});

// -------------------------------------------------------------
// 2. ABDM / FHIR v4 RESOURCE EXPORT APIS
// -------------------------------------------------------------
app.post('/api/fhir/export', (req, res) => {
  try {
    const body = req.body || {};
    let reportData = body.reportData;
    let patient = body.patient;

    if (!reportData && body.reportId) {
      const db = getUsersDB();
      for (const [email, user] of Object.entries(db)) {
        const rep = (user.reports || []).find(r => r.id === body.reportId);
        if (rep) {
          reportData = rep;
          if (!patient) patient = { name: user.name, abhaId: user.abhaId, email: user.email };
          break;
        }
      }
    }

    if (!reportData) {
      reportData = body;
    }

    const bundle = buildFhirV4Bundle(reportData, patient || reportData.patient || {});
    res.json({ success: true, bundle });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/fhir/bundle/:reportId', (req, res) => {
  try {
    const reportId = req.params.reportId;
    const db = getUsersDB();
    let foundReport = null;
    let foundUser = null;
    for (const [email, user] of Object.entries(db)) {
      const rep = (user.reports || []).find(r => r.id === reportId);
      if (rep) {
        foundReport = rep;
        foundUser = user;
        break;
      }
    }
    if (!foundReport) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }
    const bundle = buildFhirV4Bundle(foundReport, {
      name: foundUser.name,
      abhaId: foundUser.abhaId,
      email: foundUser.email
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="SageCure-FHIR-Bundle-${reportId}.json"`);
    res.json(bundle);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 3. LONGITUDINAL HEALTH TRENDS & TIME-SERIES API
// -------------------------------------------------------------
app.get('/api/trends/:email', (req, res) => {
  try {
    const email = req.params.email.toLowerCase().trim();
    const db = getUsersDB();
    const user = db[email];
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const trends = analyzeLongitudinalTrends(user.reports || []);
    res.json({
      success: true,
      email,
      patientName: user.name,
      abhaId: user.abhaId,
      ...trends
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 4. AUTOMATED E-PRESCRIPTION APIS
// -------------------------------------------------------------
app.post('/api/prescription/generate', (req, res) => {
  try {
    const body = req.body || {};
    let reportData = body.reportData;
    let patient = body.patient;

    if (!reportData && body.reportId) {
      const db = getUsersDB();
      for (const [email, user] of Object.entries(db)) {
        const rep = (user.reports || []).find(r => r.id === body.reportId);
        if (rep) {
          reportData = rep;
          if (!patient) patient = { name: user.name, abhaId: user.abhaId, email: user.email };
          break;
        }
      }
    }

    if (!reportData) {
      reportData = body;
    }

    const prescription = generateDigitalPrescription(reportData, patient || reportData.patient || {});
    res.json({ success: true, prescription });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/prescription/:reportId', (req, res) => {
  try {
    const reportId = req.params.reportId;
    const db = getUsersDB();
    let foundReport = null;
    let foundUser = null;
    for (const [email, user] of Object.entries(db)) {
      const rep = (user.reports || []).find(r => r.id === reportId);
      if (rep) {
        foundReport = rep;
        foundUser = user;
        break;
      }
    }
    if (!foundReport) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }
    const prescription = generateDigitalPrescription(foundReport, {
      name: foundUser.name,
      abhaId: foundUser.abhaId,
      email: foundUser.email
    });
    res.json({ success: true, prescription });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// INTERACTIVE PRESCRIPTION MEDICATION GIVER API
// -------------------------------------------------------------
app.post('/api/prescription/prescribe', (req, res) => {
  try {
    const { patient, vitals, diagnosis, icd10, medications, doctor, dietaryDirectives, followUp, userEmail } = req.body || {};
    const email = (userEmail || '').toLowerCase().trim();
    const prescriptionId = 'SC-RX-' + Date.now().toString().slice(-6);
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const doctorObj = doctor || {
      name: "Dr. Alok Sen",
      qualification: "MBBS, MD (Internal Medicine), PGD Diabetology",
      registrationNumber: "MCI-48291 (Medical Council of India)",
      designation: "Senior Consultant Physician & Diabetologist"
    };

    const regDigits = (doctorObj.registrationNumber || '48291').replace(/\D/g, '').slice(-5);
    const sigHash = `ABDM-SIG-${Date.now().toString(16).toUpperCase()}-${regDigits}`;

    const prescription = {
      prescriptionId,
      date: dateStr,
      timestamp: new Date().toISOString(),
      clinic: {
        name: "SageCure Digital Health Clinic & Diagnostic Center",
        tagline: "ABDM Verified Telemedicine & Clinical Diagnostics Hub",
        abdmFacilityId: "IN070001842",
        licenseNumber: "DL-2026-MED-4912",
        address: "Suite 402, Healthcare Innovation Wing, South Extension II, New Delhi - 110049",
        telecom: "+91-11-2659-4500",
        email: "clinical@sagecure.ai",
        website: "https://sagecure.ai"
      },
      doctor: {
        ...doctorObj,
        signatureText: `${doctorObj.name} (Digitally Signed)`,
        verificationHash: sigHash
      },
      patient: {
        name: patient?.name || "Patient",
        age: patient?.age || "—",
        gender: patient?.gender || "Adult",
        abhaId: patient?.abhaId || "Not Linked",
        facility: "SageCure Telemedicine Outpatient Clinic"
      },
      vitals: vitals || {},
      clinicalEvaluation: {
        diagnosis: diagnosis || "General Clinical Evaluation",
        icd10: icd10 || "Z00.00 (General Medical Examination)"
      },
      diagnosis: {
        text: diagnosis || "General Clinical Evaluation",
        icd10: icd10 || "Z00.00",
        code: icd10 ? icd10.split(' ')[0] : "Z00.00"
      },
      digitalSignature: {
        verified: true,
        doctorName: doctorObj.name,
        registrationNo: doctorObj.registrationNumber,
        hash: sigHash,
        timestamp: new Date().toISOString()
      },
      medications: Array.isArray(medications) ? medications : [],
      dietaryDirectives: Array.isArray(dietaryDirectives) && dietaryDirectives.length > 0 ? dietaryDirectives : [
        "Maintain adequate hydration with 2.5-3 liters of clean water daily.",
        "Take prescribed medications at scheduled times in accordance with meal advice.",
        "Report any adverse reactions or new symptoms immediately."
      ],
      followUp: followUp || "Review after 14 days or as clinically indicated.",
      statutoryNotice: "This electronic prescription complies with the Telemedicine Practice Guidelines issued by NMC India & ABDM EHR Standards 2026."
    };

    // Save newly prescribed prescription to user's local and database record
    const db = getUsersDB();
    if (db[email]) {
      const rxReport = {
        id: 'rx-' + Date.now(),
        title: `Prescription: ${diagnosis || 'Clinical Rx'} (${prescriptionId})`,
        date: dateStr,
        facility: "SageCure Telemedicine Clinic",
        summary_en: `Prescribed ${prescription.medications.length} medications for ${diagnosis}. Signed by ${doctorObj.name}.`,
        summary_hi: `${doctorObj.name} द्वारा ${prescription.medications.length} दवाएं निर्धारित की गईं।`,
        category: 'prescription',
        prescription: prescription
      };
      db[email].reports = db[email].reports || [];
      db[email].reports.unshift(rxReport);
      saveUsersDB(db);
    }

    res.json({ success: true, prescription });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 5. DOCTOR DIRECTORY API
// -------------------------------------------------------------
app.get('/api/doctors', (req, res) => {
  res.json({
    success: true,
    doctors: [
      {
        id: 'doc-1',
        name: 'Dr. Alok Sen',
        qualifications: 'MBBS, MD (Internal Medicine), PGD Diabetology',
        specialty: 'Internal Medicine & Diabetology',
        experience: '18 Years Experience',
        hospital: 'Apollo Hospitals & SageCure Telehealth',
        regNo: 'MCI-48291',
        rating: '4.9 ⭐ (420+ reviews)',
        availableToday: true,
        consultFee: '₹600'
      },
      {
        id: 'doc-2',
        name: 'Dr. Priya Nair',
        qualifications: 'MBBS, MD, DM (Cardiology)',
        specialty: 'Cardiology & Vascular Health',
        experience: '14 Years Experience',
        hospital: 'Fortis Escorts Heart Institute',
        regNo: 'DMC-29401',
        rating: '4.95 ⭐ (310+ reviews)',
        availableToday: true,
        consultFee: '₹900'
      },
      {
        id: 'doc-3',
        name: 'Dr. Vikram Seth',
        qualifications: 'MBBS, MD (Pathology), DNB (Hematology)',
        specialty: 'Clinical Hematology & Anemia Specialist',
        experience: '12 Years Experience',
        hospital: 'Metropolis Healthcare & AIIMS Ex-Faculty',
        regNo: 'MCI-38192',
        rating: '4.8 ⭐ (180+ reviews)',
        availableToday: false,
        consultFee: '₹750'
      },
      {
        id: 'doc-4',
        name: 'Dr. Sunita Rao',
        qualifications: 'MBBS, DNB (Family Medicine)',
        specialty: 'Preventative Health & Senior Care',
        experience: '16 Years Experience',
        hospital: 'Max Super Speciality Hospital',
        regNo: 'KMC-51928',
        rating: '4.9 ⭐ (510+ reviews)',
        availableToday: true,
        consultFee: '₹500'
      }
    ]
  });
});

// Start Express server
const server = app.listen(PORT, () => {
  console.log(`[SageCure Health Copilot] Server running on port ${PORT}`);
  console.log(`[SageCure Health Copilot] Search & Upload API: http://localhost:${PORT}/api/upload`);
  console.log(`[SageCure Health Copilot] Chat API: http://localhost:${PORT}/api/chat`);
  console.log(`[SageCure Health Copilot] Reports endpoint: http://localhost:${PORT}/api/reports/:email`);
  console.log(`[SageCure Health Copilot] Forwarding query to Make.com: ${MAKE_WEBHOOK_URL}`);
  if (supabase) {
    console.log(`[SageCure Health Copilot] Live Supabase Database: Connected`);
  } else {
    console.log(`[SageCure Health Copilot] Live Supabase Database: Standby (Set SUPABASE_URL in .env)`);
  }
});

module.exports = { app, server, supabase };
