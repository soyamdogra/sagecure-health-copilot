/**
 * SageCure Clinical Emergency Red-Flag Triage & Safety Escalation Engine
 * Evaluates real-time patient inputs for critical life-threatening conditions
 * and instantly triggers emergency protocols (112 / 102).
 */

const EMERGENCY_RED_FLAG_PATTERNS = [
  // 1. Cardiovascular / Myocardial Infarction / Angina
  {
    category: 'cardiac',
    regex: /(chest\s*pain|crushing\s*chest|radiating\s*to\s*(arm|jaw|back)|heart\s*attack|cardiac\s*arrest|severe\s*palpitations\s*with\s*dizziness|pressure\s*in\s*chest|सीने\s*में\s*(तेज\s*)?दर्द|छाती\s*में\s*दर्द|दिल\s*का\s*दौरा|ਛਾਤੀ\s*ਵਿੱਚ\s*ਦਰਦ|ਦਿਲ\s*ਦਾ\s*ਦੌਰਾ)/i,
    severity: 'CRITICAL_RED',
    primarySymptom_en: 'Severe Chest Pain / Suspected Cardiac Event',
    primarySymptom_hi: 'सीने में तीव्र दर्द / संभावित हृदय आघात (हार्ट अटैक)',
    primarySymptom_pa: 'ਛਾਤੀ ਵਿੱਚ ਗੰਭੀਰ ਦਰਦ / ਦਿਲ ਦੇ ਦੌਰੇ ਦਾ ਖਦਸ਼ਾ'
  },
  // 2. Respiratory Distress / Hypoxia / Asphyxia
  {
    category: 'respiratory_crisis',
    regex: /(difficulty\s*breathing|severe\s*shortness\s*of\s*breath|can't\s*breathe|cannot\s*breathe|gasping\s*for\s*air|suffocating|choking|stridor|bluish\s*lips|cyanosis|सांस\s*लेने\s*में\s*(अत्यधिक\s*)?तकलीफ|सांस\s*फूलना|दम\s*घुटना|ਸਾਹ\s*ਲੈਣ\s*ਵਿੱਚ\s*ਤਕਲੀਫ਼|ਸਾਹ\s*ਘੁੱਟਣਾ)/i,
    severity: 'CRITICAL_RED',
    primarySymptom_en: 'Acute Respiratory Distress / Severe Breathlessness',
    primarySymptom_hi: 'सांस लेने में गंभीर कठिनाई / ऑक्सीजन संकट',
    primarySymptom_pa: 'ਗੰਭੀਰ ਸਾਹ ਦੀ ਤਕਲੀਫ਼ / ਆਕਸੀਜਨ ਦੀ ਕਮੀ'
  },
  // 3. Neurological / Acute Cerebrovascular Stroke (FAST)
  {
    category: 'stroke',
    regex: /(stroke|facial\s*droop|arm\s*weakness|slurred\s*speech|sudden\s*numbness|loss\s*of\s*speech|sudden\s*vision\s*loss|thunderclap\s*headache|लकवा|पैरालिसिस|मुंह\s*टेढ़ा|आवाज\s*लड़खड़ाना|ਅਧਰੰਗ|ਬੋਲਣ\s*ਵਿੱਚ\s*ਲੜਖੜਾਹਟ)/i,
    severity: 'CRITICAL_RED',
    primarySymptom_en: 'Acute Stroke Symptoms (FAST Protocol Alert)',
    primarySymptom_hi: 'तीव्र स्ट्रोक / लकवे के आपातकालीन संकेत',
    primarySymptom_pa: 'ਗੰਭੀਰ ਬ੍ਰੇਨ ਸਟ੍ਰੋਕ / ਅਧਰੰਗ ਦੇ ਲੱਛਣ'
  },
  // 4. Loss of Consciousness / Syncope / Unresponsiveness
  {
    category: 'altered_consciousness',
    regex: /(unconscious|passed\s*out|fainting|loss\s*of\s*consciousness|unresponsive|syncope|collapsed|comatose|बेहोश|अचेत|गिर\s*पड़ना|ਚੇਤਨਾ\s*ਗੁਆਉਣਾ|ਬੇਹੋਸ਼)/i,
    severity: 'CRITICAL_RED',
    primarySymptom_en: 'Loss of Consciousness / Unresponsiveness',
    primarySymptom_hi: 'अचेत अवस्था / बेहोशी',
    primarySymptom_pa: 'ਬੇਹੋਸ਼ ਹੋਣਾ / ਚੇਤਨਾਹੀਨਤਾ'
  },
  // 5. Severe Hemorrhage / Hemoptysis / Hematemesis
  {
    category: 'hemorrhage',
    regex: /(coughing\s*(up\s*)?blood|vomiting\s*blood|hemoptysis|hematemesis|severe\s*uncontrolled\s*bleeding|massive\s*blood|खून\s*की\s*उल्टी|कफ\s*में\s*खून|अत्यधिक\s*रक्तस्राव|ਖੂਨ\s*ਦੀ\s*ਉਲਟੀ|ਖੰਘ\s*ਵਿੱਚ\s*ਖੂਨ)/i,
    severity: 'CRITICAL_RED',
    primarySymptom_en: 'Severe Internal Bleeding / Hemoptysis',
    primarySymptom_hi: 'कफ या उल्टी में खून / गंभीर रक्तस्राव',
    primarySymptom_pa: 'ਖੂਨ ਦੀ ਉਲਟੀ ਜਾਂ ਖੰਘ / ਗੰਭੀਰ ਖੂਨ ਵਹਿਣਾ'
  },
  // 6. Anaphylaxis / Severe Systemic Allergic Reaction
  {
    category: 'anaphylaxis',
    regex: /(anaphylaxis|throat\s*swelling|tongue\s*swelling|unable\s*to\s*swallow|allergic\s*shock|गले\s*में\s*सूजन|गंभीर\s*एलर्जी\s*शॉक|ਗਲੇ\s*ਦੀ\s*ਸੋਜ|ਐਨਾਫਾਈਲੈਕਸਿਸ)/i,
    severity: 'CRITICAL_RED',
    primarySymptom_en: 'Severe Anaphylactic Allergic Shock',
    primarySymptom_hi: 'गंभीर एनाफिलेक्टिक एलर्जी शॉक',
    primarySymptom_pa: 'ਗੰਭੀਰ ਐਲਰਜੀ ਸ਼ਾਕ'
  }
];

// Verified 24x7 Emergency Facilities Directory (Pan-India / Delhi NCR baseline)
const EMERGENCY_CENTERS = [
  {
    name: 'AIIMS Apex Trauma & Emergency Care',
    city: 'New Delhi',
    phone: '011-2659-4405',
    emergencyHotline: '112',
    address: 'Ring Road, Ansari Nagar, New Delhi - 110029',
    type: 'National Apex Tertiary Trauma Center',
    mapsUrl: 'https://maps.google.com/?q=AIIMS+Trauma+Centre+New+Delhi'
  },
  {
    name: 'Fortis Escorts Heart & Emergency ER',
    city: 'New Delhi / NCR',
    phone: '105010',
    emergencyHotline: '105010',
    address: 'Okhla Road, New Friends Colony, New Delhi',
    type: '24x7 Acute Cardiac & Trauma Resuscitation',
    mapsUrl: 'https://maps.google.com/?q=Fortis+Escorts+Heart+Institute+New+Delhi'
  },
  {
    name: 'Max Super Speciality Hospital 24/7 ER',
    city: 'Delhi NCR',
    phone: '011-4055-4055',
    emergencyHotline: '112',
    address: '1, 2, Press Enclave Road, Saket, New Delhi',
    type: 'Level 1 Critical Care & Neuro Trauma ER',
    mapsUrl: 'https://maps.google.com/?q=Max+Super+Speciality+Hospital+Saket'
  },
  {
    name: 'Apollo Hospital 24x7 Emergency Services',
    city: 'Pan-India',
    phone: '1066',
    emergencyHotline: '1066',
    address: 'Sarita Vihar, Delhi-Mathura Road, New Delhi',
    type: 'Emergency Medical & Stroke Code Response',
    mapsUrl: 'https://maps.google.com/?q=Indraprastha+Apollo+Hospital+New+Delhi'
  }
];

/**
 * Screen user query text and parameters for high-risk red-flag symptoms
 * @param {string} text - User query or symptom statement
 * @param {string} lang - 'en', 'hi', or 'pa'
 * @returns {Object} Triage evaluation report
 */
function evaluateEmergencyTriage(text, lang = 'en') {
  if (!text || typeof text !== 'string') {
    return { isEmergency: false, triageLevel: 'STANDARD' };
  }

  const cleanText = text.trim();
  const matchedPatterns = [];

  for (const pattern of EMERGENCY_RED_FLAG_PATTERNS) {
    if (pattern.regex.test(cleanText)) {
      matchedPatterns.push(pattern);
    }
  }

  if (matchedPatterns.length === 0) {
    return { isEmergency: false, triageLevel: 'STANDARD' };
  }

  const primaryMatch = matchedPatterns[0];
  const detectedSymptom = lang === 'hi' 
    ? primaryMatch.primarySymptom_hi 
    : (lang === 'pa' ? primaryMatch.primarySymptom_pa : primaryMatch.primarySymptom_en);

  const headline_en = '🚨 EMERGENCY MEDICAL ALERT: CRITICAL RED-FLAG DETECTED';
  const headline_hi = '🚨 आपातकालीन चेतावनी: गंभीर चिकित्सीय जोखिम पाया गया';
  const headline_pa = '🚨 ਐਮਰਜੈਂਸੀ ਮੈਡੀਕਲ ਚੇਤਾਵਨੀ: ਗੰਭੀਰ ਖ਼ਤਰਾ ਪਾਇਆ ਗਿਆ';

  const directive_en = `Your reported symptom (${detectedSymptom}) warrants IMMEDIATE emergency medical intervention. Do not rely on AI assessment. Call emergency services right now or proceed to the nearest hospital emergency room.`;
  const directive_hi = `आपके द्वारा दर्ज किया गया लक्षण (${detectedSymptom}) तत्काल आपातकालीन चिकित्सा सहायता की मांग करता है। कृपया समय न गंवाएं। तत्काल एम्बुलेंस (102/112) को कॉल करें या निकटतम अस्पताल जाएं।`;
  const directive_pa = `ਤੁਹਾਡੇ ਦੁਆਰਾ ਦੱਸਿਆ ਗਿਆ ਲੱਛਣ (${detectedSymptom}) ਤੁਰੰਤ ਡਾਕਟਰੀ ਸਹਾਇਤਾ ਦੀ ਮੰਗ ਕਰਦਾ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਤੁਰੰਤ 112 ਜਾਂ 102 'ਤੇ ਕਾਲ ਕਰੋ ਜਾਂ ਨਜ਼ਦੀਕੀ ਹਸਪਤਾਲ ਪਹੁੰਚੋ।`;

  return {
    isEmergency: true,
    triageLevel: 'CRITICAL_RED',
    category: primaryMatch.category,
    symptomName: detectedSymptom,
    headline: lang === 'hi' ? headline_hi : (lang === 'pa' ? headline_pa : headline_en),
    directive: lang === 'hi' ? directive_hi : (lang === 'pa' ? directive_pa : directive_en),
    emergencyNumbers: [
      { name: 'National Emergency Helpline (All India)', number: '112', tel: 'tel:112' },
      { name: 'National Ambulance Service', number: '102', tel: 'tel:102' },
      { name: 'Direct Cardiac Emergency (Apollo ER)', number: '1066', tel: 'tel:1066' }
    ],
    recommendedEmergencyCenters: EMERGENCY_CENTERS
  };
}

module.exports = {
  EMERGENCY_RED_FLAG_PATTERNS,
  EMERGENCY_CENTERS,
  evaluateEmergencyTriage
};
