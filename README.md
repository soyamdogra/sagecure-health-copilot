# 🏥 SageCure | Next-Gen AI Health Copilot

> **Empowering Patients with Accessible Clinical Document Intelligence & Bilingual Voice AI**  
> *ABDM / FHIR v4 Compliant • HIPAA Ready • Multi-User Isolated Health Records • Instant Plain-Language Clinical Synthesis*

---

## 🌟 Overview
**SageCure** transforms complex medical lab reports, discharge summaries, and clinical diagnostic panels into crystal-clear plain-language insights in both **English** and **Hindi**. It bridges the communication gap between clinicians and patients using native browser voice technologies (Web Speech Recognition & Synthesis) with zero heavy external UI dependencies, complete multi-user isolation, and persistent account health records.

---

## ✨ Key Features & Architecture

### 1. 🛡️ SageCure Rebranding & Custom Logo
- Clean, trustworthy medical-grade visual identity featuring the custom **SageCure Logo** (`logo.png`).
- Fully compliant with **ABDM / FHIR v4** and **HIPAA Ready** privacy standards.
- Senior-friendly, accessible interface with instant font scaling (**A / A+** toggle) and generous touch targets (≥ 48px).

### 2. 🔐 Email & Password Authentication with Multi-User Persistence
- **Sign In & Sign Up Portal**: Secure email and password authentication screen.
- **Isolated User Health Records**: Each user email (e.g., `aditi@sagecure.ai` vs. `rohan@sagecure.ai`) maintains strictly isolated lab report history, accessible via the collapsible **"Saved Health Records"** drawer.
- **Dual Persistence Architecture**: Backed by `backend/data/users.json` via Express REST API and synced with client `localStorage` for offline resilience.
- **1-Click Demo Profiles**: Quick switches for evaluator testing between demo patient accounts.

### 3. 🌐 Seamless Bilingual Engine (English & हिंदी)
- **Active Language Toggle**: Switch between **English** and **हिंदी** instantly in the navigation bar.
- **Dynamic Localization**: All UI titles, upload guidance, step-by-step instructions, biomarker status labels, and lifestyle action plans adapt smoothly.
- **Bilingual Webhook Integration**: `POST /api/upload` passes the active language preference (`'en'` or `'hi'`).
- **Natural Hindi Medical Summaries**: Generates culturally natural, easy-to-understand Hindi clinical explanations (e.g., एचबीए1सी, ब्लड शुगर, कोलेस्ट्रॉल).
- **Native Speech Synthesis in Matching Language**: Audio explanations automatically play back using matching voices (`hi-IN` for Hindi and `en-IN` for English).

### 4. 📂 Interactive Upload Hub
- **Drag-and-Drop Zone**: Supports all standard medical images (`image/*`) and clinical PDFs (`application/pdf`) with laser-line scanning animation.
- **Dynamic File Preview**: Thumbnail rendering, file size metrics, and instant file replacement.
- **ABHA ID Integration**: Seamless Ayushman Bharat Health Account linking.
- **1-Click Presets**: Pre-configured clinical panels (*Diabetic & Lipid Panel*, *Comprehensive CBC*, *Thyroid & Vitamin Profile*) for immediate testing.

### 5. 🎙️ Voice & Text Question Engine
- **Native Speech-to-Text**: Employs `window.SpeechRecognition` / `webkitSpeechRecognition` to transcribe spoken clinical queries in English and Hindi in real time.
- **Microphone Soundwave Animation**: Real-time animated audio visualizer waves during listening mode.
- **Quick Clinical Prompts**: Fast chips for *"Explain my HbA1c"*, *"Any critical flags?"*, and *"Diet recommendations"*.

### 6. 📊 Rich Analytics & Biomarker Dashboard
- **Patient Demographics Grid**: Patient name, age, gender, ABHA ID, lab facility, and extraction confidence score.
- **Color-Coded Biomarkers Table**:
  - 🟢 **Optimal / Normal**: Green badges.
  - 🔴 **High / Diabetic / Critical**: Soft Red badges.
  - 🟡 **Low / Borderline**: Amber badges.
  - Visual biomarker progress gauges showing value position relative to standard reference intervals.
  - Interactive status filters (*All*, *Flags*, *Normal*).
- **Plain-Language Medical Breakdown**: Jargon-free explanation, clinical takeaways, and recommended questions for doctor consultations.
- **Action Plan**: Actionable nutrition, aerobic fitness, and follow-up lab dates.

### 7. 🔊 Autonomous Text-to-Speech Companion
- Automatically converts the extracted diagnosis answer into natural speech using native `window.speechSynthesis`.
- Controls for **Replay Voice**, **Pause / Resume**, and **Stop**, accompanied by an active waveform audio visualizer.

### 8. ⚖️ Statutory Medical Disclaimer
- Permanent statutory notice footer: *"AI-generated health assistant for informational purposes only. Consult a certified physician."*

---

## ⚡ Quick Start

### Option A: Run Full Stack (Frontend + Live Webhook Server)

1. Start the backend server:
   ```bash
   cd backend
   node index.js
   ```
2. The server starts at `http://localhost:5000`.
3. Open your browser and navigate to:
   ```
   http://localhost:5000
   ```
   Both the frontend and the webhook endpoints will be live!

### Option B: Run Standalone Frontend
You can also open `frontend/index.html` directly in any modern browser (Chrome, Edge, Safari, Firefox).  
If the backend is not running, the application gracefully activates its built-in simulated clinical AI engine so demonstrations never fail!

---

## 🔑 Test Credentials & Demo Accounts

| Name | Email | Password | ABHA ID |
| :--- | :--- | :--- | :--- |
| **Aditi Sharma** | `aditi@sagecure.ai` | `password123` | `14-0234-5678-9012@abdm` |
| **Rohan Varma** | `rohan@sagecure.ai` | `password123` | `22-9811-4321-7654@abdm` |

*New users can also create their own accounts via the **Create Account** tab with instant persistence.*

---

## 🔌 API Endpoints

### 1. `POST /api/auth/login`
- **Body**: `{ "email": "aditi@sagecure.ai", "password": "password123" }`
- **Response**: `{ "success": true, "user": { ... } }`

### 2. `POST /api/auth/signup`
- **Body**: `{ "name": "...", "email": "...", "password": "...", "abhaId": "..." }`
- **Response**: `{ "success": true, "user": { ... } }`

### 3. `POST /api/upload`
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `document` (File, optional): Uploaded medical PDF or image.
  - `question` (String): Spoken or typed patient question.
  - `language` (String): Active language (`'en'` or `'hi'`).
  - `userEmail` (String): Authenticated user's email for report persistence.
  - `patientName` (String): Patient full name.
  - `abhaId` (String): ABDM ABHA identifier.
