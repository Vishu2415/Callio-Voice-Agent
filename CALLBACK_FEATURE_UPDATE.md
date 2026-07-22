# 📞 Callback Scheduling Feature — Calling Agent Update

> **Date:** 2026-07-03  
> **Changed File:** `server.js`  
> **Feature:** Jab user call pe kahe "2 ghante baad call karo / call me back later" — AI agent automatically callback schedule kar leta hai aur sahi time pe auto-dial karta hai.

---

## 🆕 Kya-kya Add Hua `server.js` Mein

### 1. `callbacks_db.json` — Persistent Callback Storage

```js
const CALLBACKS_DB_FILE = './callbacks_db.json';
const callbacksDb = new Map();

function loadCallbacks() { loadDatabase(CALLBACKS_DB_FILE, callbacksDb); }
function saveCallbacks() { saveDatabase(CALLBACKS_DB_FILE, callbacksDb); }

// Server start pe load hota hai
loadCallbacks();
```

- Har pending callback `callbacks_db.json` mein persist hota hai
- Server restart ke baad bhi callbacks yaad rehte hain

---

### 2. `scheduleCallback` — Gemini Tool Declaration

Gemini ke tools array mein `hangupCall` ke saath ek naya tool add hua:

```js
{
  name: 'scheduleCallback',
  description: 'Schedules a callback for later when the user says they are busy...',
  parameters: {
    type: 'OBJECT',
    properties: {
      requestedTime: { type: 'STRING', description: 'e.g. "2 ghante baad", "kal subah"' },
      isoTime:       { type: 'STRING', description: 'ISO-8601 UTC format, e.g. "2026-07-03T14:30:00Z"' },
      notes:         { type: 'STRING', description: 'Context notes, e.g. "User was in a meeting"' }
    },
    required: ['requestedTime', 'isoTime']
  }
}
```

- AI agent automatically detect karta hai jab user callback maange
- `isoTime` Gemini khud calculate karta hai current time + user ke requested offset se

---

### 3. `scheduleCallback` Tool Handler (Inside Gemini Message Loop)

Jab Gemini `scheduleCallback` call kare:

1. **DB mein save karta hai** — `callbacksDb` mein record store + `callbacks_db.json` mein persist
2. **DigiNext CRM ko notify karta hai** (fire-and-forget):
   ```
   POST {saasApiUrl}/crm/calling-agent/schedule-callback
   ```
   Payload:
   ```json
   {
     "leadId": 123,
     "phone": "+919876543210",
     "name": "Aachal",
     "scheduledAt": "2026-07-03T16:00:00Z",
     "requestedTime": "2 ghante baad",
     "notes": "User meeting mein tha"
   }
   ```
3. **Gemini ko confirmation bhejta hai** (tool response) — agent confirmation audio play karta hai
4. **3 seconds baad graceful hangup** — exactly jaise `hangupCall` karta hai

Callback record ka structure:
```json
{
  "id": "cb_1751234567890_abc12",
  "callSid": "CA...",
  "phone": "+919876543210",
  "name": "Aachal",
  "requestedTime": "2 ghante baad",
  "isoTime": "2026-07-03T16:00:00Z",
  "scheduledAt": "2026-07-03T16:00:00Z",
  "notes": "User meeting mein tha",
  "status": "pending",
  "leadId": 123,
  "saasApiUrl": "https://yoursaas.com/api",
  "agentId": "agent_xyz",
  "provider": "vobiz",
  "createdAt": "2026-07-03T13:45:00Z"
}
```

`status` lifecycle: `pending` → `dialing` → `dialed` / `failed`

---

### 4. Auto-Dialer Scheduler (`setInterval` — 60 seconds)

Server start hote hi ek background scheduler chalta hai jo **har 60 seconds** mein check karta hai:

```
[Callback Scheduler] Auto-dialer scheduler started (60s interval).
```

**Logic:**
- `callbacksDb` mein `status: 'pending'` callbacks scan karta hai
- Jinka `scheduledAt` time aa gaya ho → `/make-call` API call karta hai
- Call place hone ke baad `status: 'dialed'` update karta hai
- Failure pe `status: 'failed'` + error note

**Special:** Callback call ki system instruction mein ye context automatically inject hota hai:
```
[CALLBACK CONTEXT] This is a scheduled callback call. The user Aachal had previously
requested to be called back at "2 ghante baad". Note: User was in a meeting.
Greet them warmly, remind them of the callback request, and continue the conversation.
```

---

### 5. New REST API Endpoints

#### `GET /api/callbacks`
Sare callbacks list karo (optional filter by status)
```
GET /api/callbacks?status=pending
```

#### `DELETE /api/callbacks/:id`
Callback cancel/delete karo

#### `PATCH /api/callbacks/:id`
Callback reschedule ya update karo
```json
{
  "scheduledAt": "2026-07-03T18:00:00Z",
  "notes": "Rescheduled by user"
}
```
> Note: `scheduledAt` update karne pe status automatically `pending` reset ho jata hai

---

## ⚠️ Important Notes

1. **`saasApiUrl` aur `leadId`** — ye dono `/make-call` request mein pass hone chahiye (DigiNext CRM se trigger hone pe automatically aata hai). Tabhi CRM ko properly notify kiya ja sakta hai.

2. **`agentId`** — agar `callSettingsMap` mein stored hai to same agent callback call pe bhi use hoga. Otherwise `defaultCallConfig` se system instruction use hogi.

3. **`callbacks_db.json`** — file automatically create ho jati hai pehle callback pe. Manually create karne ki zarurat nahi.

4. **60s interval** — exact time pe call nahi hogi, ±60 seconds ka deviation possible hai. Production ke liye acceptable hai.

---

## 🔁 Complete Flow

```
User:      "Bhai 2 ghante baad call karo"
              ↓
Gemini:    scheduleCallback({ requestedTime: "2 ghante baad", isoTime: "2026-07-03T16:00:00Z" })
              ↓
server.js: CB record save (callbacks_db.json)
           → CRM POST /schedule-callback (fire-and-forget)
           → Gemini tool response (confirmation audio)
           → 3s baad graceful hangup
              ↓
[2 ghante baad — Scheduler fires at ~16:00]
              ↓
server.js: /make-call → Vobiz/Exotel dials user
           → Agent greets with "[CALLBACK CONTEXT]" injected
              ↓
CRM:       Call end pe /callback → Notes + Activity update
```

---

## 📁 Files Changed

| File | Change |
|------|--------|
| `server.js` | All changes listed above |
| `callbacks_db.json` | Auto-created by server on first callback |

**No other files changed in the calling agent project.**
