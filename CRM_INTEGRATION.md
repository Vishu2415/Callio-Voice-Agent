# CRM Webhook Integration Guide

Bhai, is document me CRM/SaaS platforms aur Calling Agent ke integration ki poori detail hai. Agar aapko koi bhi CRM is Calling Agent se connect karna hai, to aap is guide ko refer kar sakte hain.

---

## 1. Webhook Endpoint
Calling Agent me CRM integration ke liye ek generic endpoint set hai:
- **URL**: `https://<your-ngrok-or-server-domain>/api/webhooks/crm-lead-stage-change`
- **Method**: `POST`
- **Content-Type**: `application/json`

---

## 2. Supported Payload Formats

Humara webhooks endpoint dono types ke JSON format ko support karta hai:

### Option A: Flat Format (Simulator / Direct API)
Aap is simple flat format me data bhej sakte hain (jaise humare dashboard simulator se jata hai):
```json
{
  "leadName": "Vaibhav Gupta",
  "leadPhone": "+918384828654",
  "previousStage": "new",
  "currentStage": "qualified"
}
```

### Option B: CRM Nested Format (Real-time Integration)
SaaS platform (jaise Growlio/Diginext360) aamtaur par structured nested JSON bhejte hain. Humne is format ka native support backend me add kiya hai:
```json
{
  "event": "lead_stage_changed",
  "timestamp": 178224523000,
  "data": {
    "id": 101,
    "name": "Vaibhav Gupta",
    "source": "Facebook Ads",
    "status": "Qualified",
    "previous_stage": "New",
    "current_stage": "Qualified",
    "contact": {
      "id": 501,
      "first_name": "Vaibhav",
      "last_name": "Gupta",
      "email": "vaibhav@example.com",
      "phone": "+918384828654"
    }
  }
}
```
*Note: Agar `data.name` khali hoga, to Calling Agent contact ke `first_name` aur `last_name` ko join karke full name automatic create kar lega.*

---

## 3. Webhook Automation Logic (`server.js`)
Jab endpoint par request aati hai, to background me ye steps trigger hote hain:
1. **Rule Matching**: `crm_rules_db.json` me set rules check hote hain (Jaise: `fromStage: "new"` and `toStage: "qualified"`). Agar details match hoti hain aur automation enabled hai, to call process hoti hai. otherwise skip ho jati hai.
2. **Agent Loading**: Rule me set `agentId` ke system instruction aur config settings fetch kiye jate hain.
3. **Outbound Call Dialing**: `/make-call` API call trigger hoti hai. System selected provider (Twilio, Exotel, ya Vobiz) ke through lead ke mobile number par real-time audio stream call connect karta hai.
4. **CRM Logs Database**: Har activity `crm_logs_db.json` me details ke sath log hoti hai (timestamp, transition, agent name, call status, aur Twilio/Exotel Call SID).

---

## 4. Setup Steps for Connecting Any CRM
1. **Start Calling Agent**: Run `npm start` (Default port `5050` par run hoga).
2. **Start Ngrok**: Run `ngrok http 5050` to get your public tunnel link (e.g., `https://xxxx.ngrok-free.app`).
3. **Configure Rule in Calling Agent Dashboard**:
   - Go to **CRM Integration** tab in the dashboard (`http://localhost:5050/`).
   - Rule configure karein (e.g., From: `new`, To: `qualified`).
   - Agent aur Telephony Provider select karke **Save Automation Rule** click karein.
4. **Configure CRM Webhook Settings**:
   - Apne CRM portal ke Developer / API Settings dashboard par jayein.
   - Outbound Webhook URL me apna ngrok webhook URL dalein: `https://xxxx.ngrok-free.app/api/webhooks/crm-lead-stage-change`.
   - Webhook toggle ko `Active/Enabled` karein aur settings save karein.
5. **Test the Integration**:
   - CRM me lead create karein ya lead ki stage update karein.
   - Calling Agent ke log table me check karein, call request automatically initiate ho jayegi aur phone ring hoga!
