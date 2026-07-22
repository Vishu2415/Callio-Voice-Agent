# 📋 Calling Agent — Updated Features

> **Last Updated:** July 2, 2026
> **Version:** v2.x

---

## ✅ Recently Completed

### 1. First Name Only Greeting
**Problem:** Agent full name leke greet kar raha tha (e.g., "Hello Vishnu Verma") — unnatural lagta tha.
**Fix:** Backend ab automatically full name mein se sirf first name extract karta hai. Agent ab sirf "Hello Vishnu" bolta hai.

- Mr., Mrs., Dr., Prof. jaise salutations bhi filter ho jaate hain

---

### 2. No Name = No Awkward Greeting
**Problem:** Jab lead ka naam CRM mein nahi hota tha, agent "Hello SaaS" ya "Hello 917411567513" bol deta tha.
**Fix:** Backend ab name validate karta hai pehle:
- Naam blank hai → generic greeting (no name injection)
- Naam sirf phone number hai → generic greeting
- Naam "SaaS Lead", "Customer" jaisa generic hai → generic greeting
- Sirf real human names pe naam-wali greeting inject hoti hai

---

### 3. Single Contact Add (Frontend)
**Feature:** Users ab calling agent ke frontend se manually ek-ek contact add kar sakte hain.
- Name + Phone number se quick add
- Contact save hote hi calls mein recognized hota hai

---

### 4. Contact Name Recognition on Calls
**Feature:** Jab koi saved contact call kare (incoming), agent automatically unka naam jaanta hai.
- Phone number se contact lookup hota hai
- Agent greet karta hai naam se (e.g., "Hello Aachal")

---

### 5. Outbound Call Direction Fix
**Problem:** Outbound calls bhi incoming history mein dikh rahi thi.
**Fix:** Call direction properly track hoti hai — incoming alag, outgoing alag.

---

## 🔄 Upcoming — Callback Scheduling ("Call Me Back Later")

### Overview
Jab call pe user bole "2 ghante baad call karo" ya "kal call karna":
1. Callback schedule ho jaata hai
2. Time aane par **automatically outbound call** hoti hai
3. **DigiNext CRM mein Follow-Up** create hoti hai (visual reminder)

---

### Calling Agent Side (Hamara Kaam)

| Feature | Detail |
|--------|--------|
| Gemini Tool: scheduleCallback | AI khud detect karega jab user callback maange |
| System Prompt Rule | Agent time confirm karega, tool call karega, goodbye karega |
| callbacks_db.json | Naya database — pending callbacks store karega |
| Auto-Scheduler (every 60s) | Har minute check karega — koi callback due hai kya |
| Auto-Dial | Scheduler time aane par automatically call trigger karega |
| CRM Notification | DigiNext ko notify karega (visual follow-up ke liye) |
| New Endpoints | GET /api/callbacks, DELETE /api/callbacks/:id, PATCH /api/callbacks/:id |

**New fields jo CRM callback payload mein jaayenge:**
```json
{
  "phone": "+919876543210",
  "name": "Aachal",
  "scheduleCallback": {
    "requestedTime": "2 ghante baad",
    "isoTime": "2026-07-02T20:00:00Z",
    "notes": "User meeting mein tha"
  }
}
```

---

### DigiNext CRM Side (Unka Kaam)

**1. Naya Endpoint banana hai:**
```
POST /api/crm/calling-agent/schedule-callback
```

Payload jo hum bhejenge:
```json
{
  "leadId": 123,
  "phone": "+919876543210",
  "name": "Aachal",
  "scheduledAt": "2026-07-02T20:00:00Z",
  "requestedTime": "2 ghante baad",
  "notes": "User meeting mein tha"
}
```

Logic jo unhe implement karni hai:
- leadId present hai → us lead pe Follow-Up activity add karo (Type: Call, Time: scheduledAt)
- leadId null hai (unknown caller):
  - Phone se lead search karo
  - Lead mili → Follow-Up add karo
  - Lead nahi mili → Nayi lead banao (name + phone) → Follow-Up add karo

**2. Existing endpoint mein ek field handle karni hai:**
```
POST /api/crm/calling-agent/callback   (already exists)
```
- Optional field scheduleCallback handle karni hai
- Jab scheduleCallback null nahi ho → Follow-Up create karo

> NOTE: Auto-dial calling agent khud karega. DigiNext ko koi scheduler nahi banana — sirf visual reminder dikhana hai CRM mein.

---

### Callback Cases

| Scenario | Kya hoga |
|----------|----------|
| Known lead + callback | Lead pe follow-up, auto-call at time |
| Unknown caller + callback | Nayi lead create, follow-up, auto-call |
| No callback requested | scheduleCallback = null — kuch nahi |
| Callback dial fail ho | Retry (max 3 attempts, 5 min gap) |

---

## 🗺️ Future Roadmap

| Feature | Priority |
|---------|----------|
| Callback reschedule from UI | Medium |
| WhatsApp reminder before callback | Medium |
| Callback analytics dashboard | Low |

---

## 🔗 Related Files

| File | Purpose |
|------|---------|
| server.js | Main backend |
| callbacks_db.json | New — pending callbacks |
| calls_db.json | Call history |
| contacts_db.json | Saved contacts |
