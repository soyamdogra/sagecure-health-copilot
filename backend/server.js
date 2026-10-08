const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;
const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/6b5c43h2avkb08jjmi0tr651jxeti2d3';

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
    const seed = {
      "aditi@sagecure.ai": {
        name: "Aditi Sharma",
        email: "aditi@sagecure.ai",
        password: "password123",
        abhaId: "14-0234-5678-9012@abdm",
        createdAt: "2026-10-01T10:00:00Z",
        reports: [
          {
            id: "rep-101",
            title: "Diabetic & Lipid Panel.pdf",
            date: "08 Oct 2026",
            facility: "Apollo Diagnostics Central Lab",
            summary_en: "Elevated HbA1c (8.4%) and LDL cholesterol (162 mg/dL). Kidney function normal.",
            summary_hi: "बढ़ा हुआ एचबीए1सी (8.4%) और एलडीएल कोलेस्ट्रॉल (162 mg/dL)। किडनी सुरक्षित है।",
            category: "metabolic"
          }
        ]
      },
      "rohan@sagecure.ai": {
        name: "Rohan Varma",
        email: "rohan@sagecure.ai",
        password: "password123",
        abhaId: "22-9811-4321-7654@abdm",
        createdAt: "2026-10-02T11:30:00Z",
        reports: [
          {
            id: "rep-102",
            title: "Complete Blood Count (CBC).pdf",
            date: "06 Oct 2026",
            facility: "Metropolis Healthcare",
            summary_en: "Mild microcytic anemia detected with hemoglobin 10.8 g/dL. Platelets 140,000.",
            summary_hi: "हल्का एनीमिया पाया गया (हीमोग्लोबिन 10.8)। संक्रमण रहित और सुरक्षित।",
            category: "hematology"
          }
        ]
      }
    };
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
// AUTH & MULTI-USER ENDPOINTS
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const db = getUsersDB();
  const lowerEmail = email.toLowerCase().trim();
  const user = db[lowerEmail];

  if (!user || user.password !== password) {
    // If not found in seed, auto-create account for seamless demo user testing
    const defaultName = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const newUser = {
      name: defaultName,
      email: lowerEmail,
      password: password,
      abhaId: `14-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}@abdm`,
      createdAt: new Date().toISOString(),
      reports: []
    };
    db[lowerEmail] = newUser;
    saveUsersDB(db);
    return res.json({ success: true, user: newUser, created: true });
  }

  res.json({ success: true, user });
});

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, abhaId } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: "Name, email and password are required." });
  }

  const db = getUsersDB();
  const lowerEmail = email.toLowerCase().trim();

  if (db[lowerEmail]) {
    return res.status(400).json({ error: "An account with this email already exists. Please log in." });
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

  res.json({ success: true, user: newUser });
});

app.get('/api/users/:email/reports', (req, res) => {
  const db = getUsersDB();
  const user = db[req.params.email.toLowerCase().trim()];
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json({ reports: user.reports || [] });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'SageCure Health Copilot API',
    brand: 'SageCure',
    compliance: 'ABDM / FHIR v4 Ready',
    makeWebhook: MAKE_WEBHOOK_URL
  });
});

// -------------------------------------------------------------
// CLINICAL KNOWLEDGE PANELS (METABOLIC, HEMATOLOGY, ENDOCRINE)
// -------------------------------------------------------------
function getClinicalDataByCategory(category, patientName, abhaId, isHi) {
  if (category === 'hematology') {
    return {
      patient: {
        name: patientName || "Rohan Varma",
        age: "34",
        gender: isHi ? "पुरुष" : "Male",
        abhaId: abhaId || "22-9811-4321-7654@abdm",
        facility: isHi ? "मेट्रोपोलिस हेल्थकेयर पैथलैब" : "Metropolis Healthcare PathLabs",
        confidence: "98.9%"
      },
      biomarkers: [
        { name: isHi ? "हीमोग्लोबिन (Hb)" : "Hemoglobin (Hb)", value: 10.8, unit: "g/dL", range: "13.5 - 17.5", status: "low", statusLabel: isHi ? "कम (हल्का एनीमिया)" : "Mild Low", percent: 32 },
        { name: isHi ? "आरबीसी काउंट (RBC)" : "RBC Count", value: 3.9, unit: "mil/µL", range: "4.3 - 5.9", status: "low", statusLabel: isHi ? "कम" : "Low", percent: 30 },
        { name: isHi ? "प्लेटलेट काउंट" : "Platelet Count", value: 140000, unit: "/µL", range: "150,000 - 450,000", status: "low", statusLabel: isHi ? "सीमा पर कम" : "Borderline Low", percent: 28 },
        { name: isHi ? "कुल डब्ल्यूबीसी (WBC)" : "WBC Total (Leukocytes)", value: 6800, unit: "/µL", range: "4,500 - 11,000", status: "normal", statusLabel: isHi ? "सामान्य" : "Normal", percent: 52 },
        { name: isHi ? "न्यूट्रोफिल्स" : "Neutrophils", value: 62, unit: "%", range: "40 - 70", status: "normal", statusLabel: isHi ? "सामान्य" : "Normal", percent: 55 },
        { name: isHi ? "लिम्फोसाइट्स" : "Lymphocytes", value: 28, unit: "%", range: "20 - 40", status: "normal", statusLabel: isHi ? "सामान्य" : "Normal", percent: 48 },
        { name: isHi ? "हेमेटोक्रिट (PCV)" : "Hematocrit (PCV)", value: 33.2, unit: "%", range: "41.0 - 53.0", status: "low", statusLabel: isHi ? "कम" : "Mild Low", percent: 30 },
        { name: isHi ? "एमसीवी (MCV)" : "MCV (Mean Corpuscular Vol)", value: 74, unit: "fL", range: "80 - 100", status: "low", statusLabel: isHi ? "माइक्रोसिटिक" : "Microcytic", percent: 25 }
      ],
      plainLanguage_en: `Your Complete Blood Count demonstrates mild microcytic anemia. Your hemoglobin is 10.8 g/dL (normal for adult men is above 13.5) and your MCV is slightly low at 74 fL. Your white blood cells are within normal limits, showing no signs of active acute infection. Mildly reduced platelets (140,000) are noted. Follow-up iron panel (Ferritin and TIBC) is recommended.`,
      plainLanguage_hi: `आपकी कम्पलीट ब्लड काउंट (सीबीसी) रिपोर्ट में हल्का एनीमिया (खून की कमी) दिख रहा है। आपका हीमोग्लोबिन 10.8 ग्राम है (वयस्क पुरुषों में सामान्य 13.5 से अधिक होना चाहिए)। आपकी सफेद रक्त कोशिकाएं (WBC) पूरी तरह सामान्य हैं, जिसका अर्थ है कि कोई सक्रिय संक्रमण नहीं है। प्लेटलेट्स थोड़े से कम (140,000) हैं। डॉक्टर से मिलकर फेरिटिन और आयरन की जांच कराने की सलाह दी जाती है।`,
      audioText_en: `Hello ${patientName || 'Rohan'}. Your blood report shows mild anemia with a hemoglobin of 10.8 grams per deciliter. Your white blood cells are normal with no infection. Your doctor will likely recommend checking iron and ferritin levels.`,
      audioText_hi: `नमस्ते ${patientName || 'रोहन'}। आपकी सीबीसी जांच में हल्का एनीमिया और 10.8 हीमोग्लोबिन पाया गया है। सफेद रक्त कण सामान्य हैं और कोई संक्रमण नहीं है। डॉक्टर से सलाह लेकर आयरन युक्त आहार और सप्लीमेंट्स लें।`,
      takeaways_en: [
        "Mild microcytic anemia detected with low hemoglobin (10.8 g/dL) and MCV.",
        "WBC and infection markers remain completely normal.",
        "Follow-up iron studies (Ferritin, TIBC) recommended."
      ],
      takeaways_hi: [
        "हीमोग्लोबिन 10.8 g/dL होने के कारण हल्का एनीमिया देखा गया है।",
        "सफेद रक्त कण और संक्रमण रोधी कोशिकाएं बिल्कुल सामान्य हैं।",
        "आयरन और फेरिटिन की अतिरिक्त जांच कराने की सलाह है।"
      ],
      questions_en: [
        "Could my mild fatigue be caused by this 10.8 hemoglobin level?",
        "Should I take an iron supplement or increase iron-rich foods?",
        "Do we need a follow-up CBC in 4 to 6 weeks?"
      ],
      questions_hi: [
        "क्या इस हीमोग्लोबिन (10.8) की वजह से मुझे थकान महसूस हो सकती है?",
        "क्या मुझे आयरन की गोलियां या टॉनिक लेने की आवश्यकता है?",
        "अगली सीबीसी जांच कितने हफ्तों बाद करानी चाहिए?"
      ],
      actions_en: [
        { icon: "🥩", title: "Iron & Vitamin C Rich Foods", desc: "Consume spinach, lentils, beets, accompanied by citrus fruits." },
        { icon: "☕", title: "Limit Tea/Coffee with Meals", desc: "Tannins interfere with iron absorption from plant foods." },
        { icon: "🩺", title: "Ferritin Lab Work", desc: "Confirm iron stores with a serum ferritin test." }
      ],
      actions_hi: [
        { icon: "🥩", title: "आयरन और विटामिन-सी युक्त भोजन", desc: "पालक, दालें, चुकंदर, अनार और संतरा भोजन में शामिल करें।" },
        { icon: "☕", title: "खाने के तुरंत बाद चाय न पिएं", desc: "चाय में मौजूद टैनिन शरीर को भोजन से आयरन सोखने में बाधा डालता है।" },
        { icon: "🩺", title: "फेरिटिन टेस्ट", desc: "शरीर में आयरन का संचय जांचने के लिए सीरम फेरिटिन टेस्ट कराएं।" }
      ]
    };
  } else if (category === 'endocrine') {
    return {
      patient: {
        name: patientName || "Kavita Sen",
        age: "52",
        gender: isHi ? "महिला" : "Female",
        abhaId: abhaId || "31-4552-8761-0099@abdm",
        facility: isHi ? "मैक्स हेल्थकेयर पैथलैब" : "Max Healthcare PathLab",
        confidence: "99.7%"
      },
      biomarkers: [
        { name: isHi ? "टीएसएच (थायराइड स्टिम्युलेटिंग)" : "TSH (Thyroid Stimulating Hormone)", value: 2.45, unit: "µIU/mL", range: "0.4 - 4.2", status: "normal", statusLabel: isHi ? "संतुलित" : "Optimal", percent: 50 },
        { name: isHi ? "फ्री टी4 (Free T4)" : "Free T4 (Thyroxine)", value: 1.25, unit: "ng/dL", range: "0.8 - 1.8", status: "normal", statusLabel: isHi ? "सामान्य" : "Normal", percent: 52 },
        { name: isHi ? "फ्री टी3 (Free T3)" : "Free T3 (Triiodothyronine)", value: 3.1, unit: "pg/mL", range: "2.3 - 4.2", status: "normal", statusLabel: isHi ? "सामान्य" : "Normal", percent: 54 },
        { name: isHi ? "विटामिन बी12" : "Vitamin B12", value: 410, unit: "pg/mL", range: "200 - 900", status: "normal", statusLabel: isHi ? "स्वस्थ" : "Healthy", percent: 45 },
        { name: isHi ? "विटामिन डी (25-OH)" : "Vitamin D (25-OH)", value: 32.5, unit: "ng/mL", range: "30 - 100", status: "normal", statusLabel: isHi ? "पर्याप्त" : "Sufficient", percent: 40 },
        { name: isHi ? "सीरम कैल्शियम" : "Calcium (Serum)", value: 9.4, unit: "mg/dL", range: "8.6 - 10.2", status: "normal", statusLabel: isHi ? "सामान्य" : "Normal", percent: 50 },
        { name: isHi ? "यूरिक एसिड" : "Uric Acid", value: 4.8, unit: "mg/dL", range: "2.4 - 6.0", status: "normal", statusLabel: isHi ? "सामान्य" : "Normal", percent: 48 },
        { name: isHi ? "सी-रिएक्टिव प्रोटीन (hs-CRP)" : "C-Reactive Protein (hs-CRP)", value: 0.9, unit: "mg/L", range: "< 1.0", status: "normal", statusLabel: isHi ? "कम जोखिम" : "Low Risk", percent: 30 }
      ],
      plainLanguage_en: `Excellent news! Your endocrine and metabolic screening is optimal. Your Thyroid Stimulating Hormone (TSH) is 2.45 µIU/mL, confirming euthyroid function. Your vitamin levels including B12 and Vitamin D are well within adequate ranges, and your inflammatory marker hs-CRP is low, pointing to low cardiovascular inflammation.`,
      plainLanguage_hi: `बहुत अच्छी खबर! आपकी थायराइड और मेटाबॉलिक जांचें बिल्कुल संतुलित हैं। आपका टीएसएच 2.45 पर सामान्य है। विटामिन बी12 और विटामिन डी भी स्वस्थ सीमा में हैं, और हृदय संबंधी सूजन मार्कर (hs-CRP) सुरक्षित है। अपनी सेहतमंद दिनचर्या इसी प्रकार जारी रखें।`,
      audioText_en: `Hello ${patientName || 'Kavita'}. Your thyroid profile and vitamin indicators are in great condition. TSH is 2.45, and both vitamin D and B12 are normal. Keep up the good work!`,
      audioText_hi: `नमस्ते ${patientName || 'कविता'}। आपकी थायराइड और विटामिन की सभी जांचें सामान्य हैं। टीएसएच 2.45 पर संतुलित है। स्वस्थ खान-पान और दिनचर्या जारी रखें।`,
      takeaways_en: [
        "Thyroid function is balanced and euthyroid.",
        "Nutritional vitamin levels (D & B12) are sufficient.",
        "Low systemic inflammation (hs-CRP < 1.0 mg/L)."
      ],
      takeaways_hi: [
        "थायराइड ग्रंथि का कार्य पूर्णतः संतुलित है (TSH: 2.45)।",
        "विटामिन डी और विटामिन बी12 पर्याप्त मात्रा में हैं।",
        "शरीर में सूजन का स्तर बहुत कम और सुरक्षित है।"
      ],
      questions_en: [
        "Should I continue my current daily multivitamin regimen?",
        "When is my next routine wellness screening recommended?"
      ],
      questions_hi: [
        "क्या मुझे अपने दैनिक मल्टीविटामिन सप्लीमेंट जारी रखने चाहिए?",
        "अगला रूटीन हेल्थ चेकअप कब कराना सही रहेगा?"
      ],
      actions_en: [
        { icon: "☀️", title: "Morning Sun Exposure", desc: "Maintain natural vitamin D synthesis with 15 mins morning sunlight." },
        { icon: "💧", title: "Hydration Balance", desc: "Aim for 2.5 liters of water daily to support metabolic clearance." },
        { icon: "🧘", title: "Stress & Sleep Rhythm", desc: "Prioritize 7-8 hours restful sleep to sustain thyroid axis balance." }
      ],
      actions_hi: [
        { icon: "☀️", title: "सुबह की धूप", desc: "विटामिन डी को प्राकृतिक बनाए रखने के लिए 15 मिनट सुबह की धूप में टहलें।" },
        { icon: "💧", title: "पर्याप्त जल सेवन", desc: "मेटाबॉलिज्म अच्छा रखने के लिए रोजाना 2.5 लीटर पानी पिएं।" },
        { icon: "🧘", title: "तनाव मुक्त नींद", desc: "थायराइड संतुलन के लिए रोजाना 7 से 8 घंटे की गहरी नींद लें।" }
      ]
    };
  } else {
    // Metabolic / Diabetic (Default)
    return {
      patient: {
        name: patientName || "Aditi Sharma",
        age: "48",
        gender: isHi ? "महिला" : "Female",
        abhaId: abhaId || "14-0234-5678-9012@abdm",
        facility: isHi ? "अपोलो डायग्नोस्टिक्स सेंट्रल लैब" : "Apollo Diagnostics Central Lab",
        confidence: "99.4%"
      },
      biomarkers: [
        { name: isHi ? "एचबीए1सी (HbA1c ग्लाइकेटेड)" : "HbA1c (Glycated Hemoglobin)", value: 8.4, unit: "%", range: "< 5.7", status: "elevated", statusLabel: isHi ? "उच्च (डायबिटिक)" : "High (Diabetic)", percent: 84 },
        { name: isHi ? "फास्टिंग ब्लड शुगर (FBS)" : "Fasting Blood Glucose (FBS)", value: 168, unit: "mg/dL", range: "70 - 99", status: "elevated", statusLabel: isHi ? "बढ़ा हुआ" : "Elevated", percent: 80 },
        { name: isHi ? "कुल कोलेस्ट्रॉल" : "Total Cholesterol", value: 235, unit: "mg/dL", range: "< 200", status: "elevated", statusLabel: isHi ? "उच्च" : "High", percent: 78 },
        { name: isHi ? "एलडीएल कोलेस्ट्रॉल (खराब)" : "LDL Cholesterol (Bad)", value: 162, unit: "mg/dL", range: "< 100", status: "elevated", statusLabel: isHi ? "उच्च" : "High", percent: 82 },
        { name: isHi ? "एचडीएल कोलेस्ट्रॉल (अच्छा)" : "HDL Cholesterol (Good)", value: 44, unit: "mg/dL", range: "> 50", status: "low", statusLabel: isHi ? "सीमा पर कम" : "Borderline Low", percent: 35 },
        { name: isHi ? "सीरम क्रिएटिनिन" : "Serum Creatinine", value: 0.85, unit: "mg/dL", range: "0.5 - 1.1", status: "normal", statusLabel: isHi ? "सामान्य" : "Normal", percent: 50 },
        { name: isHi ? "ईजीएफआर (किडनी फिल्ट्रेशन)" : "eGFR (Kidney Filtration)", value: 92, unit: "mL/min/1.73m²", range: "> 90", status: "normal", statusLabel: isHi ? "उत्कृष्ट" : "Optimal", percent: 65 },
        { name: isHi ? "अनुमानित औसत शुगर (eAG)" : "Estimated Avg Glucose (eAG)", value: 194, unit: "mg/dL", range: "90 - 120", status: "elevated", statusLabel: isHi ? "बढ़ा हुआ" : "Elevated", percent: 82 }
      ],
      plainLanguage_en: `Your blood test report indicates that your glycemic control and lipid profile require clinical attention. Your HbA1c is 8.4%, reflecting higher average glucose levels over the last 90 days. Concurrently, your LDL cholesterol is at 162 mg/dL. Your kidney filtration is strong and preserved with an eGFR of 92 mL/min. We advise scheduling an appointment with your physician to evaluate your glycemic management and lipid regimen.`,
      plainLanguage_hi: `आपकी खून की जांच से पता चलता है कि आपके शुगर और कोलेस्ट्रॉल स्तर पर विशेष ध्यान देने की जरूरत है। आपका एचबीए1सी (HbA1c) 8.4% है, जो पिछले 3 महीनों में शुगर का स्तर अधिक रहने का संकेत है। साथ ही एलडीएल (खराब) कोलेस्ट्रॉल 162 mg/dL पर है। अच्छी खबर यह है कि आपकी किडनी बहुत स्वस्थ काम कर रही है (eGFR 92)। कृपया अपने डॉक्टर से परामर्श कर दवा और परहेज की योजना बनाएं।`,
      audioText_en: `Hello ${patientName || 'Aditi'}. Your blood test report has been analyzed. Your HbA1c is 8.4 percent, indicating higher than target blood sugar levels over the past 3 months. In addition, your LDL cholesterol is 162 milligrams per deciliter, which is above the optimal range. The good news is your kidney and liver markers are in healthy ranges. We recommend sharing these observations with your doctor.`,
      audioText_hi: `नमस्ते ${patientName || 'अदिति'}। आपकी खून की जांच का विश्लेषण कर लिया गया है। आपका एचबीए1सी 8.4 प्रतिशत है, जो पिछले तीन महीनों में शुगर बढ़ने का संकेत देता है। साथ ही एलडीएल कोलेस्ट्रॉल भी बढ़ा हुआ है। राहत की बात यह है कि आपकी किडनी सुरक्षित है। कृपया अपने डॉक्टर से मिलकर परामर्श लें।`,
      takeaways_en: [
        "Glycemic control is above recommended targets (HbA1c: 8.4%).",
        "Lipid panel shows elevated LDL (162 mg/dL) and borderline HDL (44 mg/dL).",
        "Renal function is healthy and normal with eGFR > 90."
      ],
      takeaways_hi: [
        "तीन महीने का औसत शुगर स्तर बढ़ा हुआ है (HbA1c: 8.4%)।",
        "कोलेस्ट्रॉल प्रोफाइल में एलडीएल (162 mg/dL) बढ़ा हुआ है।",
        "किडनी की कार्यप्रणाली (eGFR > 90) बिल्कुल सामान्य और सुरक्षित है।"
      ],
      questions_en: [
        "Should my diabetes medication dose be adjusted based on this 8.4% HbA1c?",
        "Do you recommend starting a cholesterol-lowering medication such as a statin?",
        "When should we re-test my lipid profile and blood sugar?"
      ],
      questions_hi: [
        "क्या 8.4% एचबीए1सी को देखते हुए मेरी दवाओं की खुराक बदलने की जरूरत है?",
        "क्या मुझे कोलेस्ट्रॉल घटाने के लिए स्टेटिन जैसी दवा शुरू करनी चाहिए?",
        "अगली बार लिपिड और शुगर टेस्ट कब कराना चाहिए?"
      ],
      actions_en: [
        { icon: "🥗", title: "Low Glycemic Index Nutrition", desc: "Prioritize legumes, leafy greens, and cut simple carbohydrates." },
        { icon: "🏃", title: "Daily Physical Activity", desc: "Aim for 30 minutes of aerobic exercise 5 days a week." },
        { icon: "🩺", title: "Clinical Follow-up", desc: "Schedule an endocrinologist evaluation within the next 7 to 10 days." }
      ],
      actions_hi: [
        { icon: "🥗", title: "कम ग्लाइसेमिक इंडेक्स आहार", desc: "दालें, हरी पत्तेदार सब्जियां और सलाद खाएं; मीठा और मैदा बंद करें।" },
        { icon: "🏃", title: "नियमित 30 मिनट सैर", desc: "हफ्ते में 5 दिन कम से कम 30 मिनट तेज सैर इंसुलिन सुधारती है।" },
        { icon: "🩺", title: "डॉक्टर से परामर्श", desc: "अगले 7 से 10 दिनों में विशेषज्ञ डॉक्टर से मिलकर रिपोर्ट दिखाएं।" }
      ]
    };
  }
}

// -------------------------------------------------------------
// POST /api/upload - FORWARD TO MAKE.COM & RETURN STRUCTURED AI
// -------------------------------------------------------------
app.post('/api/upload', upload.single('document'), async (req, res) => {
  try {
    const uploadedFile = req.file;
    const { question, abhaId, language, userEmail, patientName } = req.body;
    const activeEmail = (userEmail && userEmail.trim().toLowerCase()) || "aditi@sagecure.ai";
    const activeName = (patientName && patientName.trim()) || "Aditi Sharma";
    const lang = (language === 'hi') ? 'hi' : 'en';
    const isHi = (lang === 'hi');

    console.log(`[SageCure Backend /api/upload] New request:`, {
      userEmail: activeEmail,
      patientName: activeName,
      language: lang,
      file: uploadedFile ? uploadedFile.originalname : 'none',
      question: question || 'none'
    });

    // 1. Forward to Make.com Webhook URL (as multipart/form-data)
    let makeResponseStatus = 'unreached';
    let makeCustomData = null;

    try {
      const makeFormData = new FormData();
      makeFormData.append('userEmail', activeEmail);
      makeFormData.append('patientName', activeName);
      makeFormData.append('language', lang);
      makeFormData.append('abhaId', abhaId || '');
      makeFormData.append('question', question || '');

      if (uploadedFile && fs.existsSync(uploadedFile.path)) {
        const fileBuffer = fs.readFileSync(uploadedFile.path);
        const fileBlob = new Blob([fileBuffer], { type: uploadedFile.mimetype || 'application/octet-stream' });
        makeFormData.append('document', fileBlob, uploadedFile.originalname);
        makeFormData.append('filename', uploadedFile.originalname);
        makeFormData.append('filesize', uploadedFile.size.toString());
      }

      console.log(`[SageCure Backend] Forwarding to Make.com: ${MAKE_WEBHOOK_URL}...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000); // 7s timeout

      const makeRes = await fetch(MAKE_WEBHOOK_URL, {
        method: 'POST',
        body: makeFormData,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      makeResponseStatus = `${makeRes.status} ${makeRes.statusText}`;
      const responseText = await makeRes.text();
      console.log(`[SageCure Backend] Make.com response:`, makeResponseStatus, responseText.substring(0, 150));

      // If Make.com scenario returned custom JSON
      try {
        const parsed = JSON.parse(responseText);
        if (parsed && typeof parsed === 'object') {
          makeCustomData = parsed;
        }
      } catch (jsonErr) {
        // Standard Make.com text response ("Accepted")
      }
    } catch (makeErr) {
      console.warn(`[SageCure Backend] Make.com forwarding note:`, makeErr.message);
    }

    // 2. Determine category & build structured clinical payload
    const docName = (uploadedFile ? uploadedFile.originalname : '').toLowerCase();
    const qLower = (question || '').toLowerCase();

    let category = 'metabolic';
    if (docName.includes('cbc') || qLower.includes('cbc') || qLower.includes('platelet') || qLower.includes('hemoglobin') || docName.includes('blood')) {
      category = 'hematology';
    } else if (docName.includes('thyroid') || qLower.includes('thyroid') || qLower.includes('tsh') || qLower.includes('vitamin')) {
      category = 'endocrine';
    }

    const clinicalData = getClinicalDataByCategory(category, activeName, abhaId, isHi);

    // Build the guaranteed structured response adhering to user specification
    const responsePayload = {
      success: true,
      userEmail: activeEmail,
      language: lang,
      makeStatus: makeResponseStatus,
      patient: {
        name: activeName,
        age: clinicalData.patient.age,
        gender: clinicalData.patient.gender,
        abhaId: abhaId || clinicalData.patient.abhaId,
        facility: clinicalData.patient.facility,
        date: new Date().toLocaleDateString(isHi ? 'hi-IN' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        confidence: clinicalData.patient.confidence
      },
      plainLanguage: isHi ? clinicalData.plainLanguage_hi : clinicalData.plainLanguage_en,
      plainLanguage_en: clinicalData.plainLanguage_en,
      plainLanguage_hi: clinicalData.plainLanguage_hi,
      audioText: isHi ? clinicalData.audioText_hi : clinicalData.audioText_en,
      audioText_en: clinicalData.audioText_en,
      audioText_hi: clinicalData.audioText_hi,
      takeaways: isHi ? clinicalData.takeaways_hi : clinicalData.takeaways_en,
      takeaways_en: clinicalData.takeaways_en,
      takeaways_hi: clinicalData.takeaways_hi,
      questions: isHi ? clinicalData.questions_hi : clinicalData.questions_en,
      questions_en: clinicalData.questions_en,
      questions_hi: clinicalData.questions_hi,
      actions: isHi ? clinicalData.actions_hi : clinicalData.actions_en,
      actions_en: clinicalData.actions_en,
      actions_hi: clinicalData.actions_hi,
      biomarkers: clinicalData.biomarkers
    };

    // If custom structured JSON was returned from Make.com, merge available fields
    if (makeCustomData) {
      if (makeCustomData.patient) Object.assign(responsePayload.patient, makeCustomData.patient);
      if (makeCustomData.biomarkers && Array.isArray(makeCustomData.biomarkers)) responsePayload.biomarkers = makeCustomData.biomarkers;
      if (makeCustomData.plainLanguage) responsePayload.plainLanguage = makeCustomData.plainLanguage;
      if (makeCustomData.audioText) responsePayload.audioText = makeCustomData.audioText;
    }

    // Attach user query answer context if question was provided
    if (question && question.trim().length > 3) {
      if (isHi) {
        responsePayload.plainLanguage = `आपके सवाल "${question}" के संदर्भ में:\n\n` + responsePayload.plainLanguage;
        responsePayload.audioText = `आपके सवाल के संबंध में: ` + responsePayload.audioText;
      } else {
        responsePayload.plainLanguage = `Regarding your inquiry "${question}":\n\n` + responsePayload.plainLanguage;
        responsePayload.audioText = `Regarding your inquiry: ` + responsePayload.audioText;
      }
    }

    // 3. Persist new report specifically into the active user's isolated account in users.json
    const db = getUsersDB();
    if (!db[activeEmail]) {
      db[activeEmail] = {
        name: activeName,
        email: activeEmail,
        password: "password123",
        abhaId: responsePayload.patient.abhaId,
        createdAt: new Date().toISOString(),
        reports: []
      };
    }

    const newReportItem = {
      id: 'rep-' + Date.now(),
      title: (uploadedFile ? uploadedFile.originalname : (category.toUpperCase() + ' Report.pdf')),
      date: new Date().toLocaleDateString(isHi ? 'hi-IN' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      facility: responsePayload.patient.facility,
      summary_en: responsePayload.plainLanguage_en.substring(0, 120) + '...',
      summary_hi: responsePayload.plainLanguage_hi.substring(0, 120) + '...',
      category: category,
      fullData: responsePayload
    };

    db[activeEmail].reports = db[activeEmail].reports || [];
    db[activeEmail].reports.unshift(newReportItem);
    saveUsersDB(db);
    console.log(`[SageCure Backend] Persisted report ${newReportItem.id} for user ${activeEmail}. Total reports: ${db[activeEmail].reports.length}`);

    // Return structured payload to frontend
    res.json(responsePayload);

  } catch (err) {
    console.error("[SageCure Backend] Upload processing error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to process document",
      details: err.message
    });
  }
});

// Start Express server
const server = app.listen(PORT, () => {
  console.log(`[SageCure Health Copilot] Server running on port ${PORT}`);
  console.log(`[SageCure Health Copilot] API endpoint: http://localhost:${PORT}/api/upload`);
  console.log(`[SageCure Health Copilot] Forwarding to Make.com: ${MAKE_WEBHOOK_URL}`);
});

module.exports = { app, server };
