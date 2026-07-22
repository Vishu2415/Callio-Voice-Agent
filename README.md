# Gemini Live Calling Agent (Twilio + WebSockets)

Bhai, ye ek premium real-time voice Calling Agent hai jo **Gemini Live WebSockets API (`gemini-3.1-flash-live-preview`)** aur **Twilio Voice Streams** ko integrate karta hai. 

Isme ek high-fidelity Glassmorphic Web UI hai jisse aap browser mic ke throw test kar sakte hain aur direct target phone number par outbound call dial kar sakte hain.

---

## Features
1. **Bidirectional Voice Stream**: Twilio ki Mu-law (8kHz) audio stream ko resample karke Gemini ke Linear PCM (16kHz/24kHz) format me map kiya gaya hai.
2. **Interactive Outbound Dialler**: Web dashboard se direct call schedule karke target phone ringing state aur live logs dekh sakte hain.
3. **Save Settings Locally**: System Prompt, API Key aur voice configurations seedhe browser local storage me save hoti hain taaki page refresh par reset na ho.
4. **Hindi/Hinglish Gender Inflections**: Voice gender ke basis par system prompt auto-extend hota hai (jaise female voice ke liye *"kar rahi hoon"* aur male ke liye *"kar raha hoon"*) taaki verbal conversation real aur natural feel ho.
5. **30 Prebuilt Gemini Voices**: Dropdown select box me Gemini API ke sabhi 30 voices support kiye gaye hain.

---

## Prerequisites (Zaroori Cheezein)
* **Node.js** (v18 ya usse upar)
* **ngrok** (Local server ko public URL dene ke liye)
* **Twilio Account** (Sid, Auth Token, aur ek Twilio Phone Number)
* **Gemini API Key** (Google AI Studio se)

---

## Project Structure
* `server.js` - Express back-end aur WebSocket handler (Twilio/Gemini integration).
* `audio-helper.js` - Resampling aur transcoding algorithms (Mu-law $\rightleftharpoons$ PCM).
* `index.html` & `style.css` - Glassmorphic dynamic configuration dashboard.
* `app.js` - Browser WebSocket flow, local storage management, aur mic/speaker buffers.
* `.env` - Environment variable parameters.

---

## Setup aur Installation

### Step 1: Clone or Open Project Directory
Project ke folder me terminal open karein:
```bash
cd calling_agent
```

### Step 2: Install Dependencies
Zaroori packages install karein:
```bash
npm install
```

### Step 3: Setup `.env` File
Apne project folder me `.env` file check karein. Agar nahi hai toh ek new `.env` file banayein aur usme niche diye gaye variables fill karein:
```env
GEMINI_API_KEY=your_gemini_api_key_here
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
PORT=5050
```
> **Note**: Twilio Phone Number international format me hona chahiye (e.g., `+15054614549`).

---

## Project Run Karne Ka Tarika

### Step 1: Start Backend Server
Apne terminal me run karein:
```bash
   npm run start
```
Server start hote hi message aayega:
`🚀 Telephony Calling Agent Backend running on port 5050`

### Step 2: Expose to Public Internet using ngrok
Twilio webhook ko local server se connect karne ke liye new terminal tab me ngrok run karein:
```bash
ngrok http 5050
```
Isse aapko ek public forward link milega, jaise:
`https://xxxx-xxxx-xxxx.ngrok-free.app`

### Step 3: Configure Twilio Incoming Webhook
1. Apne [Twilio Console](https://console.twilio.com/) me login karein.
2. **Phone Numbers -> Manage -> Active Numbers** par jayein.
3. Apne Twilio number par click karein aur scroll karke **Voice & Fax** settings me jayein.
4. **A CALL COMES IN** section me select karein **Webhook**.
5. URL field me apna ngrok URL enter karein aur piche `/incoming-call` append karein:
   `https://xxxx-xxxx-xxxx.ngrok-free.app/incoming-call`
6. HTTP method ko **HTTP POST** select karke save karein.

---

## Testing Methods

### Method 1: Web Interface Se Test Karna (WebRTC Live Call)
1. Browser me open karein: [http://localhost:5050/](http://localhost:5050/)
2. Dashboard par apna **Gemini API Key** fill karein.
3. Dropdown se **Voice** select karein aur system instruction box me prompt likhein.
4. **"Start Call"** button par click karein.
5. Mic access allow karein. Visualizer me waves banne lagengi aur aap real-time me Gemini Live se baat kar sakenge.

### Method 2: Telephony Outbound Call (Call from Agent to your Phone)

#### Option A: Twilio (Original)
1. Web interface ([http://localhost:5050/](http://localhost:5050/)) open karein.
2. **Provider** dropdown me `Twilio` select karein.
3. **Public ngrok URL** input me apna current active ngrok URL fill karein (e.g., `https://xxxx.ngrok-free.dev`).
4. **Destination Phone Number** me apna phone number enter karein (e.g., `+918273xxxxxx`).
5. Click **Place Phone Call** button. Aapka phone ring hoga!

#### Option B: Exotel (India Local - Ultra Cheap)
1. Web interface ([http://localhost:5050/](http://localhost:5050/)) open karein.
2. **Provider** dropdown me `Exotel (India local)` select karein.
3. Exotel configurations box open hoga. Usme apna:
   - **API Key**
   - **API Token**
   - **Account SID**
   - **Subdomain** (`api.exotel.com`)
   - **Virtual Number (ExoPhone)** (Aapka Exotel registered business virtual number)
   *Note: Dashboard ne aapki default credentials ko automatic fill kar diya hai!*
4. **Public ngrok URL** me active ngrok address fill karein.
5. **Destination Phone Number** enter karein.
6. **"Save Prompt"** click karein taaki Exotel credentials browser me save ho jayein.
7. Click **"Place Phone Call"**. Exotel call initiate karega!

---

## Troubleshooting
* **Voice change save nahi ho rahi?** - Make sure aapne settings change karne ke baad **"Save Prompt"** button par click kiya hai.
* **Grammar mismatch?** - System check karta hai ki voice gender female hai ya male, aur uske according instructions append karta hai. Make sure dropdown me select kiye voice ke sath gender match kar raha ho.
* **Audio lagging or terminating?** - Apne `.env` me API keys check karein aur ensure karein ki ngrok tunnel active hai aur valid forwarding kar raha hai.
