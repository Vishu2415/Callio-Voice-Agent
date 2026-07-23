import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { twilioToGemini, geminiToTwilio, pcm8ToPcm16, pcm24ToPcm8, pcm24ToPcm16, swapBytes16 } from './audio-helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment configurations
dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ CRITICAL ERROR: GEMINI_API_KEY is not defined in the environment.");
  console.error("Please create a '.env' file containing: GEMINI_API_KEY=your_key_here");
  process.exit(1);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 5050;
const CONFIG_FILE = './config.json';
const CALLS_DB_FILE = './calls_db.json';
const AGENTS_DB_FILE = './agents_db.json';
const CONTACTS_DB_FILE = './contacts_db.json';
const GROUPS_DB_FILE = './groups_db.json';
const CRM_RULES_DB_FILE = './crm_rules_db.json';
const CRM_LOGS_DB_FILE = './crm_logs_db.json';
const CLIENTS_DB_FILE = './clients_db.json';
const CALLBACKS_DB_FILE = './callbacks_db.json';
const PLANS_DB_FILE = './plans_db.json';
const TRIAL_LIMITS_FILE = './trial_limits_db.json';

const trialLimits = new Map();

function loadTrialLimits() {
  try {
    if (fs.existsSync(TRIAL_LIMITS_FILE)) {
      const raw = fs.readFileSync(TRIAL_LIMITS_FILE, 'utf8');
      const data = JSON.parse(raw);
      for (const [k, v] of Object.entries(data)) {
        trialLimits.set(k, v);
      }
    }
  } catch (err) {
    console.error('[Startup] Failed to load trial limits:', err.message);
  }
}

function saveTrialLimits() {
  try {
    const data = Object.fromEntries(trialLimits.entries());
    fs.writeFileSync(TRIAL_LIMITS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Database] Failed to save trial limits:', err.message);
  }
}

const TRIAL_LEADS_FILE = './trial_leads_db.json';
let trialLeads = [];

function loadTrialLeads() {
  try {
    if (fs.existsSync(TRIAL_LEADS_FILE)) {
      const raw = fs.readFileSync(TRIAL_LEADS_FILE, 'utf8');
      trialLeads = JSON.parse(raw);
    } else {
      trialLeads = [];
    }
  } catch (err) {
    console.error('[Startup] Failed to load trial leads:', err.message);
  }
}

function saveTrialLeads() {
  try {
    fs.writeFileSync(TRIAL_LEADS_FILE, JSON.stringify(trialLeads, null, 2), 'utf8');
  } catch (err) {
    console.error('[Database] Failed to save trial leads:', err.message);
  }
}

const callSettingsMap = new Map();
const activeCalls = new Map();
const agentsDb = new Map();
const contactsDb = new Map();
const groupsDb = new Map();
const crmRulesDb = new Map();
const crmLogsDb = new Map();
const clientsDb = new Map();
const callbacksDb = new Map();
const plansDb = new Map();

const BRANDING_DB_FILE = './branding_db.json';
const brandingDb = new Map();

function loadBranding() {
  loadDatabase(BRANDING_DB_FILE, brandingDb);
  if (brandingDb.size === 0) {
    const defaults = {
      default: {
        id: "default",
        customDomain: "localhost",
        subdomain: "default.localhost",
        appName: "Callio",
        logoUrl: "logo_new.png",
        faviconUrl: "favicon.ico",
        primaryColor: "#FF6B4A",
        secondaryColor: "#ae3115",
        supportEmail: "support@callio.com",
        supportPhone: "+91XXXXXXXXXX",
        copyrightText: "© 2026 Callio. All rights reserved."
      },
      partner1: {
        id: "partner1",
        customDomain: "partner.local",
        subdomain: "partner.localhost",
        appName: "Partner AI",
        logoUrl: "https://raw.githubusercontent.com/google/material-design-icons/master/png/action/settings/ios/production_res/1x/ic_settings_36pt.png",
        faviconUrl: "https://raw.githubusercontent.com/google/material-design-icons/master/png/action/settings/ios/production_res/1x/ic_settings_36pt.png",
        primaryColor: "#10B981",
        secondaryColor: "#059669",
        supportEmail: "support@partner.com",
        supportPhone: "+911234567890",
        copyrightText: "© 2026 Partner AI. All rights reserved."
      }
    };
    for (const [k, v] of Object.entries(defaults)) {
      brandingDb.set(k, v);
    }
    saveBranding();
  }
}

function saveBranding() {
  saveDatabase(BRANDING_DB_FILE, brandingDb);
}

function getResellerFromHost(host) {
  if (!host) return null;
  // Clean host: strip protocol, path, port
  let cleanHost = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
  const domainWithoutWww = cleanHost.startsWith('www.') ? cleanHost.substring(4) : cleanHost;

  for (const reseller of resellersDb.values()) {
    if (reseller.status === 'suspended') continue;

    if (reseller.domain) {
      let rDomain = reseller.domain.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
      if (rDomain.startsWith('www.')) rDomain = rDomain.substring(4);
      if (rDomain === domainWithoutWww || rDomain === cleanHost) {
        return reseller;
      }
    }

    if (reseller.subdomain) {
      let rSub = reseller.subdomain.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
      if (rSub.startsWith('www.')) rSub = rSub.substring(4);
      if (rSub === domainWithoutWww || cleanHost === rSub || cleanHost.startsWith(rSub + '.')) {
        return reseller;
      }
    }
  }
  return null;
}

function resolveBranding(host) {
  if (!host) return brandingDb.get('default');
  let cleanHost = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();

  // 1. Check if host matches a Reseller
  const reseller = getResellerFromHost(host);
  if (reseller) {
    const b = reseller.branding || {};
    const appName = b.appName || reseller.name || 'AI Voice Agent';
    return {
      id: reseller.id,
      customDomain: reseller.domain || '',
      subdomain: reseller.subdomain || '',
      appName: appName,
      logoUrl: b.logoUrl || 'logo_new.png',
      faviconUrl: b.faviconUrl || 'favicon.ico',
      primaryColor: b.primaryColor || '#FF6B4A',
      secondaryColor: b.secondaryColor || '#ae3115',
      supportEmail: b.supportEmail || reseller.email || '',
      supportPhone: b.supportPhone || '',
      copyrightText: b.copyrightText || `© ${new Date().getFullYear()} ${appName}. All rights reserved.`
    };
  }

  // 2. Check brandingDb for custom tenant records
  for (const branding of brandingDb.values()) {
    if (branding.customDomain && branding.customDomain.toLowerCase() === cleanHost) {
      return branding;
    }
    if (branding.subdomain && branding.subdomain.toLowerCase() === cleanHost) {
      return branding;
    }
    if (cleanHost.endsWith('.' + branding.subdomain) || cleanHost === branding.subdomain) {
      return branding;
    }
    if (branding.id !== 'default' && (cleanHost.startsWith(branding.id + '.') || cleanHost === branding.id)) {
      return branding;
    }
  }

  // 3. Fallback to default Callio branding
  return brandingDb.get('default');
}


function loadDatabase(file, mapObj) {
  try {
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(data);
      for (const [key, val] of Object.entries(parsed)) {
        mapObj.set(key, val);
      }
      console.log(`[DB] Loaded ${mapObj.size} records from ${file}.`);
    }
  } catch (e) {
    console.error(`[DB Error] Failed to load ${file}:`, e.message);
  }
}

function saveDatabase(file, mapObj) {
  try {
    const obj = Object.fromEntries(mapObj);
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error(`[DB Error] Failed to save to ${file}:`, e.message);
  }
}

function loadCalls() { 
  loadDatabase(CALLS_DB_FILE, activeCalls); 
  let dirty = false;
  for (const [key, call] of activeCalls.entries()) {
    if (call.status === 'active' || call.status === 'in-progress' || call.status === 'ringing' || call.status === 'calling') {
      console.log(`[Startup Sanitization] Resetting stuck call ${key} status from ${call.status} to failed.`);
      call.status = 'failed';
      call.endedAt = call.endedAt || new Date().toISOString();
      call.updatedAt = new Date().toISOString();
      dirty = true;
    }
  }
  if (dirty) {
    saveCalls();
  }
}
function saveCalls() { saveDatabase(CALLS_DB_FILE, activeCalls); }

function loadAgents() { loadDatabase(AGENTS_DB_FILE, agentsDb); }
function saveAgents() { saveDatabase(AGENTS_DB_FILE, agentsDb); }

function loadContacts() { loadDatabase(CONTACTS_DB_FILE, contactsDb); }
function saveContacts() { saveDatabase(CONTACTS_DB_FILE, contactsDb); }

function loadGroups() { loadDatabase(GROUPS_DB_FILE, groupsDb); }
function saveGroups() { saveDatabase(GROUPS_DB_FILE, groupsDb); }

function loadCrmRules() { loadDatabase(CRM_RULES_DB_FILE, crmRulesDb); }
function saveCrmRules() { saveDatabase(CRM_RULES_DB_FILE, crmRulesDb); }

function loadCrmLogs() { loadDatabase(CRM_LOGS_DB_FILE, crmLogsDb); }
function saveCrmLogs() { saveDatabase(CRM_LOGS_DB_FILE, crmLogsDb); }

function loadClients() { 
  loadDatabase(CLIENTS_DB_FILE, clientsDb); 
  let dirty = false;
  for (const [key, client] of clientsDb.entries()) {
    if (client.balance === undefined) {
      client.balance = 500.00; // default ₹500.00 trial balance
      dirty = true;
    }
    if (!client.pricing) {
      client.pricing = {
        rate_per_minute: 2.00,
        rate_recording_per_minute: 1.00,
        rate_per_session: 0.00
      };
      dirty = true;
    }
    if (!client.billing_history) {
      client.billing_history = [];
      dirty = true;
    }
  }
  if (dirty) {
    saveClients();
  }
}
function saveClients() { saveDatabase(CLIENTS_DB_FILE, clientsDb); }

function loadCallbacks() { loadDatabase(CALLBACKS_DB_FILE, callbacksDb); }
function saveCallbacks() { saveDatabase(CALLBACKS_DB_FILE, callbacksDb); }

function loadPlans() {
  loadDatabase(PLANS_DB_FILE, plansDb);
  if (plansDb.size === 0) {
    const defaults = {
      basic: {
        id: "basic",
        name: "Basic Plan",
        price_per_month: 499,
        max_minutes: 100,
        max_agents: 2,
        rate_per_minute: 5,
        crm_integration: false,
        api_sharing: false,
        description: "Perfect for small startup experiments & testing voice workflows"
      },
      pro: {
        id: "pro",
        name: "Pro Plan",
        price_per_month: 1499,
        max_minutes: 350,
        max_agents: 10,
        rate_per_minute: 4,
        crm_integration: true,
        api_sharing: true,
        description: "Excellent for growing agencies and sales automations"
      },
      custom: {
        id: "custom",
        name: "Custom Plan",
        price_per_month: 4999,
        max_minutes: 99999,
        max_agents: 99999,
        rate_per_minute: 2,
        crm_integration: true,
        api_sharing: true,
        description: "Unlimited enterprise scale control, custom LLMs & high-priority support"
      }
    };
    for (const [k, v] of Object.entries(defaults)) {
      plansDb.set(k, v);
    }
    savePlans();
  }
}
function savePlans() { saveDatabase(PLANS_DB_FILE, plansDb); }

let saveTimer = null;
function scheduleSaveCalls() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCalls, 1500);
}

loadCalls();
loadAgents();
loadContacts();
loadGroups();
loadCrmRules();
loadCrmLogs();
loadClients();
loadCallbacks();
loadPlans();
loadTrialLimits();
loadTrialLeads();
loadBranding();

function cleanAndComparePhone(p1, p2) {
  if (!p1 || !p2) return false;
  const d1 = p1.replace(/\D/g, '');
  const d2 = p2.replace(/\D/g, '');
  if (d1.length >= 10 && d2.length >= 10) {
    return d1.slice(-10) === d2.slice(-10);
  }
  return d1 === d2;
}

function findContactByPhone(phone) {
  if (!phone) return null;
  for (const contact of contactsDb.values()) {
    if (cleanAndComparePhone(contact.phone, phone)) {
      return contact;
    }
  }
  return null;
}

function getFirstName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return '';
  let first = parts[0];
  const salutations = ['mr', 'mr.', 'ms', 'ms.', 'mrs', 'mrs.', 'dr', 'dr.', 'prof', 'prof.'];
  if (salutations.includes(first.toLowerCase()) && parts.length > 1) {
    first = parts[1];
  }
  return first;
}



function getOrCreateCallState(callSid, details = {}) {
  if (!callSid) return null;
  if (!activeCalls.has(callSid)) {
    activeCalls.set(callSid, {
      callSid: callSid,
      provider: details.provider || 'twilio',
      to: details.to || '',
      direction: details.direction || null,
      name: details.name || '',
      status: details.status || 'calling',
      transcript: [],
      summary: '',
      recordingUrl: '',
      recordingStatus: 'none',
      recordCall: details.recordCall || false,
      createdAt: new Date().toISOString(),
      startedAt: null,
      clientId: details.clientId || null
    });
  } else {
    const state = activeCalls.get(callSid);
    if (details.status) state.status = details.status;
    if (details.provider) state.provider = details.provider;
    if (details.direction && !state.direction) state.direction = details.direction;
    // Don't overwrite state.to if it already contains a phone number and details.to is just the callSid or a UUID
    if (details.to) {
      const isCallSidOrUuid = details.to === callSid || details.to.includes('-');
      if (!state.to || !isCallSidOrUuid) {
        state.to = details.to;
      }
    }
    if (details.name) state.name = details.name;
    // Only update recordCall if explicitly passed as true — never overwrite true with false
    if (details.recordCall === true) state.recordCall = true;
    if (details.clientId) state.clientId = details.clientId;
    // Set startedAt when call becomes active
    if (details.status === 'active' && !state.startedAt) {
      state.startedAt = new Date().toISOString();
    }
  }
  scheduleSaveCalls();
  return activeCalls.get(callSid);
}

async function startVobizCallRecording(callSid, callConfig) {
  const vobizAuthId = callConfig.vobizAuthId || defaultCallConfig.vobizAuthId;
  const vobizAuthToken = callConfig.vobizAuthToken || defaultCallConfig.vobizAuthToken;
  if (!vobizAuthId || !vobizAuthToken) {
    console.error(`[Vobiz Recording] Missing Auth ID or Auth Token for call: ${callSid}`);
    return;
  }
  const url = `https://api.vobiz.ai/api/v1/Account/${vobizAuthId.trim()}/Call/${callSid.trim()}/Record/`;
  try {
    console.log(`[Vobiz Recording] Starting recording for call: ${callSid}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Auth-ID': vobizAuthId.trim(),
        'X-Auth-Token': vobizAuthToken.trim(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ time_limit: 3600, file_format: 'mp3' })
    });
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch(e) { data = { raw: text }; }
    console.log(`[Vobiz Recording] Record API response for call ${callSid}:`, data);
    if (data.error) {
      console.error(`[Vobiz Recording] API returned error: ${data.error}`);
    } else {
      const callState = activeCalls.get(callSid);
      if (callState) {
        callState.recordingStatus = 'recording';
        // ✅ Vobiz returns the final recording URL immediately in the start response!
        const immediateUrl = data.url || data.recording_url || data.media_url;
        if (immediateUrl) {
          callState.recordingUrl = immediateUrl;
          callState.recordingId = data.recording_id || '';
          console.log(`[Vobiz Recording] ✅ Recording URL captured immediately: ${immediateUrl}`);
          scheduleSaveCalls();
        }
      }
    }
  } catch (err) {
    console.error(`[Vobiz Recording Error] Failed to start recording for call ${callSid}:`, err.message);
  }
}

async function downloadAndCacheRecording(callSid) {
  const callState = activeCalls.get(callSid);
  if (!callState || !callState.recordingUrl) return false;

  const dir = path.join(__dirname, 'recordings');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const localPath = path.join(dir, `${callSid}.mp3`);

  if (fs.existsSync(localPath)) {
    callState.recordingLocalPath = localPath;
    return true;
  }

  const config = callSettingsMap.get(callSid);
  const headers = {};

  if (callState.provider === 'vobiz') {
    const vobizAuthId = (config && config.vobizAuthId) || defaultCallConfig.vobizAuthId;
    const vobizAuthToken = (config && config.vobizAuthToken) || defaultCallConfig.vobizAuthToken;
    if (vobizAuthId && vobizAuthToken) {
      headers['X-Auth-ID'] = vobizAuthId.trim();
      headers['X-Auth-Token'] = vobizAuthToken.trim();
    }
  } else if (callState.provider === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (accountSid && authToken) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    }
  }

  try {
    console.log(`[Recording Downloader] Downloading recording from ${callState.recordingUrl}...`);
    const res = await fetch(callState.recordingUrl, { headers });
    if (!res.ok) {
      console.error(`[Recording Downloader] Failed to fetch recording from upstream: ${res.status}`);
      return false;
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > 0) {
      fs.writeFileSync(localPath, buffer);
      callState.recordingLocalPath = localPath;
      console.log(`[Recording Downloader] ✅ Successfully cached recording locally to ${localPath} (${buffer.length} bytes)`);
      return true;
    }
  } catch (err) {
    console.error(`[Recording Downloader Exception]`, err.message);
  }
  return false;
}

async function finalizeVobizRecording(callSid) {
  const callState = activeCalls.get(callSid);
  if (!callState || !callState.recordingUrl) return;

  console.log(`[Vobiz Recording Finalize] Starting stabilization loop for call ${callSid}...`);
  callState.recordingStatus = 'fetching';
  scheduleSaveCalls();

  const config = callSettingsMap.get(callSid);
  const vobizAuthId = (config && config.vobizAuthId) || defaultCallConfig.vobizAuthId;
  const vobizAuthToken = (config && config.vobizAuthToken) || defaultCallConfig.vobizAuthToken;
  const headers = {};
  if (vobizAuthId && vobizAuthToken) {
    headers['X-Auth-ID'] = vobizAuthId.trim();
    headers['X-Auth-Token'] = vobizAuthToken.trim();
  }

  await new Promise(resolve => setTimeout(resolve, 3000));

  let lastSize = 0;
  let stableCount = 0;
  const maxAttempts = 10;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(callState.recordingUrl, { method: 'HEAD', headers });
      if (res.ok) {
        const sizeHeader = res.headers.get('content-length');
        const size = sizeHeader ? parseInt(sizeHeader, 10) : 0;
        console.log(`[Vobiz Recording Finalize] HEAD check attempt ${attempt}: size=${size} (previous=${lastSize})`);
        if (size > 0) {
          if (size === lastSize) {
            stableCount++;
            if (stableCount >= 2) {
              console.log(`[Vobiz Recording Finalize] Recording size is stable at ${size} bytes.`);
              break;
            }
          } else {
            stableCount = 0;
            lastSize = size;
          }
        }
      } else {
        console.log(`[Vobiz Recording Finalize] HEAD check attempt ${attempt} returned status: ${res.status}`);
      }
    } catch (err) {
      console.error(`[Vobiz Recording Finalize] HEAD exception on attempt ${attempt}:`, err.message);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  const success = await downloadAndCacheRecording(callSid);
  if (success) {
    callState.recordingStatus = 'ready';
    console.log(`[Vobiz Recording Finalize] ✅ Finalized and marked ready: ${callSid}`);
  } else {
    callState.recordingStatus = 'failed';
    console.log(`[Vobiz Recording Finalize] ❌ Failed to download recording: ${callSid}`);
  }
  scheduleSaveCalls();
}

async function fetchTwilioRecording(callSid) {
  const callState = activeCalls.get(callSid);
  if (!callState) return;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    console.error("[Twilio Recording] Missing accountSid/authToken env variables");
    callState.recordingStatus = 'failed';
    return;
  }

  const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings.json?CallSid=${callSid}`;

  callState.recordingStatus = 'fetching';

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      console.log(`[Twilio Recording] Checking recordings for call ${callSid} (Attempt ${attempt}/5)...`);
      const response = await fetch(url, {
        headers: {
          'Authorization': `Basic ${authHeader}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.recordings && data.recordings.length > 0) {
          const recording = data.recordings[0];
          const mp3Url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recording.sid}.mp3`;
          callState.recordingUrl = mp3Url;
          console.log(`[Twilio Recording] Found recording for call ${callSid}: ${mp3Url}. Caching locally...`);
          const success = await downloadAndCacheRecording(callSid);
          if (success) {
            callState.recordingStatus = 'ready';
          } else {
            console.error(`[Twilio Recording] Local cache failed. Falling back to ready via URL.`);
            callState.recordingStatus = 'ready';
          }
          scheduleSaveCalls();
          return;
        }
      } else {
        console.error(`[Twilio Recording Error] Status ${response.status}: ${await response.text()}`);
      }
    } catch (err) {
      console.error(`[Twilio Recording Exception]`, err.message);
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  callState.recordingStatus = 'failed';
  console.log(`[Twilio Recording] No recording found for call ${callSid} after retries.`);
}

async function fetchVobizRecording(callSid) {
  const callState = activeCalls.get(callSid);
  if (!callState) return;

  const cachedConfig = callSettingsMap.get(callSid);
  const vobizAuthId = (cachedConfig && cachedConfig.vobizAuthId) || defaultCallConfig.vobizAuthId;
  const vobizAuthToken = (cachedConfig && cachedConfig.vobizAuthToken) || defaultCallConfig.vobizAuthToken;
  if (!vobizAuthId || !vobizAuthToken) {
    callState.recordingStatus = 'failed';
    return;
  }

  callState.recordingStatus = 'fetching';

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      console.log(`[Vobiz Recording] Attempt ${attempt}/5 for call ${callSid}...`);
      
      // Try the Recordings list endpoint filtered by call_uuid
      const recordingsUrl = `https://api.vobiz.ai/api/v1/Account/${vobizAuthId.trim()}/Recording/?call_uuid=${callSid.trim()}`;
      const recResponse = await fetch(recordingsUrl, {
        method: 'GET',
        headers: {
          'X-Auth-ID': vobizAuthId.trim(),
          'X-Auth-Token': vobizAuthToken.trim()
        }
      });

      if (recResponse.ok) {
        const recData = await recResponse.json();
        console.log(`[Vobiz Recording] Recordings API response for ${callSid}:`, JSON.stringify(recData).substring(0, 300));
        
        // Try objects array
        const recordings = recData.objects || recData.recordings || recData.results || [];
        if (Array.isArray(recordings) && recordings.length > 0) {
          const rec = recordings[0];
          const recUrl = rec.recording_url || rec.url || rec.media_url || rec.record_url || rec.file_url || rec.mp3_url;
          if (recUrl) {
            callState.recordingUrl = recUrl;
            console.log(`[Vobiz Recording] ✅ Found recording for call ${callSid}: ${recUrl}. Starting finalization...`);
            finalizeVobizRecording(callSid).catch(err => console.error(`[fetchVobizRecording Finalize Error]`, err.message));
            return;
          }
        }
        
        // Also check if recData itself has a recording url (single object)
        const directUrl = recData.recording_url || recData.url || recData.media_url;
        if (directUrl) {
          callState.recordingUrl = directUrl;
          console.log(`[Vobiz Recording] ✅ Found recording (direct) for call ${callSid}: ${directUrl}. Starting finalization...`);
          finalizeVobizRecording(callSid).catch(err => console.error(`[fetchVobizRecording Finalize Error]`, err.message));
          return;
        }

        console.log(`[Vobiz Recording] No recording URL found in response (attempt ${attempt}). Keys: ${Object.keys(recData).join(', ')}`);
      } else {
        const errText = await recResponse.text();
        console.error(`[Vobiz Recording Error] Recordings API status ${recResponse.status}: ${errText.substring(0, 200)}`);
      }
    } catch (err) {
      console.error(`[Vobiz Recording Exception]`, err.message);
    }
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 5000));
  }

  callState.recordingStatus = 'failed';
  console.log(`[Vobiz Recording] ❌ No recording found for call ${callSid} after all retries.`);
}

async function generateCallSummaryBackend(callSid) {
  const callState = activeCalls.get(callSid);
  if (!callState) return;

  if (callState.transcript.length === 0) {
    callState.summary = "No conversation occurred during the call.";
    return;
  }

  const formattedTranscript = callState.transcript
    .map(turn => `${turn.role === 'user' ? 'User' : 'Agent'}: ${turn.text}`)
    .join('\n');

  const prompt = `You are a call analyst. Read this sales call transcript and give a CRISP, DIRECT summary in this EXACT format:

**VERDICT:** [INTERESTED / NOT INTERESTED / UNDECIDED]

**Key Points:**
- [1-line point]
- [1-line point]
- [1-line point max]

**Next Action:** [What should the agent do next - 1 sentence]

Rules:
- Be brutally direct. No fluff. No rephrasing what both parties said.
- VERDICT must be the very first thing.
- Max 4 bullet points total. Each bullet max 10 words.
- If user said "not interested" or "cut the call" → VERDICT: NOT INTERESTED
- If user asked for more info, price, dates → VERDICT: INTERESTED
- If user said "will think" or "will call back" → VERDICT: UNDECIDED

Transcript:
${formattedTranscript}`;


  console.log(`[Summary Engine] Generating summary for call ${callSid} using gemini-2.5-flash...`);
  
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    if (response.ok) {
      const data = await response.json();
      const summaryText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (summaryText) {
        callState.summary = summaryText.trim();
        console.log(`[Summary Engine] Summary generated successfully for call ${callSid}.`);
        scheduleSaveCalls();
      } else {
        callState.summary = "Failed to parse summary response from Gemini.";
      }
    } else {
      const errorText = await response.text();
      callState.summary = "Failed to generate summary due to API error.";
      console.error(`[Summary Engine Error] Gemini API status ${response.status}: ${errorText}`);
      scheduleSaveCalls();
    }
  } catch (err) {
    callState.summary = "Failed to generate summary due to system exception.";
    console.error(`[Summary Engine Exception] for call ${callSid}:`, err.message);
    scheduleSaveCalls();
  }
}

function handleCallEnd(callSid, finalStatus = 'completed') {
  if (!callSid) return;
  const callState = activeCalls.get(callSid);
  if (!callState) return;

  if (callState.status === 'completed' || callState.status === 'failed' || callState.status === 'voicemail') {
    return;
  }

  console.log(`[Call Lifecycle] Call ${callSid} ended. Setting status to: ${finalStatus}`);
  callState.status = finalStatus;
  callState.endedAt = new Date().toISOString();
  callState.updatedAt = new Date().toISOString();
  scheduleSaveCalls();

  // SaaS Billing Calculation
  try {
    const clientId = callState.clientId;
    if (clientId && clientsDb.has(clientId)) {
      const client = clientsDb.get(clientId);
      const start = callState.startedAt ? new Date(callState.startedAt) : null;
      const end = new Date(callState.endedAt);
      const durationSec = start ? Math.max(0, Math.round((end - start) / 1000)) : 0;
      // Ceiling billing: 1 second = 1 full minute (same as Vobiz)
      // e.g. 4s → 1 min billed, 65s → 2 mins billed
      const billedMinutes = durationSec > 0 ? Math.ceil(durationSec / 60) : 0;
      const durationMin = billedMinutes; // whole minutes only

      const totalCharge = durationMin; // charge represents whole minutes deducted
      
      client.balance = Number((client.balance - totalCharge).toFixed(2));
      client.used_minutes = Number(((client.used_minutes || 0) + durationMin).toFixed(2));
      client.billing_history = client.billing_history || [];
      client.billing_history.unshift({
        id: `txn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        type: 'call_charge',
        callSid: callSid,
        phone: callState.to || '',
        duration: durationSec,
        callCost: 0,
        recordingCost: 0,
        sessionCost: 0,
        totalCharge,
        description: `Call to ${callState.to || 'Unknown'} (${durationSec}s → billed ${durationMin} min) ${callState.recordCall ? 'with recording' : 'no recording'}`
      });

      console.log(`[SaaS Billing] Charged Client: ${client.name} (ID: ${clientId}) total: ${totalCharge} min for CallSid: ${callSid}. New balance: ${client.balance} mins`);
      saveClients();

      // Reseller billing: if client belongs to a reseller, charge reseller quota at wholesale rate
      if (typeof global.chargeResellerForCall === 'function' && durationMin > 0) {
        global.chargeResellerForCall(clientId, durationMin);
      }
    }
  } catch (billingErr) {
    console.error(`[SaaS Billing Error] Billing calculation failed:`, billingErr);
  }

  (async () => {
    await generateCallSummaryBackend(callSid);
    
    // CRM note and activity sync callback
    const settings = callSettingsMap.get(callSid);
    if (settings && settings.leadId && settings.saasApiUrl) {
      const { leadId, saasApiUrl } = settings;
      console.log(`[CRM Callback] Dispatching call end data to SaaS: ${saasApiUrl}/crm/calling-agent/callback for Lead: ${leadId}`);
      try {
        const callbackResponse = await fetch(`${saasApiUrl}/crm/calling-agent/callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            leadId: leadId,
            status: finalStatus,
            summary: callState.summary,
            transcript: callState.transcript
          })
        });
        if (callbackResponse.ok) {
          console.log(`[CRM Callback] Callback successfully delivered to SaaS platform.`);
        } else {
          console.error(`[CRM Callback Error] SaaS platform returned status ${callbackResponse.status}`);
        }
      } catch (callbackErr) {
        console.error(`[CRM Callback Exception] Failed to send callback to SaaS:`, callbackErr.message);
      }
    }

    if (callState.recordCall) {
      if (callState.provider === 'twilio') {
        await fetchTwilioRecording(callSid);
      } else if (callState.provider === 'vobiz') {
        if (callState.recordingUrl) {
          await finalizeVobizRecording(callSid);
        } else {
          await fetchVobizRecording(callSid);
        }
      } else {
        callState.recordingStatus = 'failed';
      }
    }
  })();
}

const defaultCallConfig = {
  voice: 'Aoede',
  systemInstruction: "You are a helpful, extremely polite, and friendly voice assistant. Speak naturally, keep your answers relatively concise, and feel free to converse in Hinglish or English depending on how the user greets you. [CRITICAL]: If the user asks to hang up, end the call, cut the call, or says goodbye to terminate, you must say goodbye politely first in Hinglish, and then call the 'hangupCall' tool. [VOICEMAIL]: If you hear a voicemail, answering machine, 'leave a message', or 'record your message', YOU MUST IMMEDIATELY CALL 'hangupCall' without saying anything.",
  trialLimitEnabled: false  // Admin can toggle this ON to enforce 2-call/IP limit on live demo
};

// Load saved config on startup if it exists
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    Object.assign(defaultCallConfig, parsed);
    console.log(`[Config Startup] Loaded persistent config from ${CONFIG_FILE}. Voice: ${defaultCallConfig.voice}, Instruction: ${defaultCallConfig.systemInstruction ? defaultCallConfig.systemInstruction.substring(0, 40) : 'None'}...`);
  }
} catch (err) {
  console.error('[Config Startup Error] Failed to load config.json:', err.message);
}

function getIncomingCallConfig(query = {}, fromNum = '') {
  const recordCall = defaultCallConfig.gemini_record_call === 'true' || defaultCallConfig.recordCall || false;

  // ─── TAG-BASED ROUTING ──────────────────────────────────────────────────────
  // If we have the caller's number, look them up in contacts and match their tag
  // to an agent. This takes priority over the default incoming agent.
  if (fromNum) {
    const callerContact = findContactByPhone(fromNum);
    if (callerContact && callerContact.tag) {
      const contactTag = callerContact.tag.toLowerCase().trim();
      console.log(`[Incoming Routing] Caller ${fromNum} has tag: "${contactTag}" — searching for matching agent…`);

      // 1. Check explicit tagRules from config (UI-managed)
      let taggedAgent = null;
      const tagRules = defaultCallConfig.tagRules || [];
      const matchedRule = tagRules.find(r => r.tag && r.tag.toLowerCase() === contactTag);
      if (matchedRule && matchedRule.agentId) {
        taggedAgent = agentsDb.get(matchedRule.agentId) || null;
        if (taggedAgent) console.log(`[Incoming Routing] Matched via tagRules config: agentId ${matchedRule.agentId}`);
      }

      // 2. Fallback: match by agent name (case-insensitive)
      if (!taggedAgent) {
        for (const agent of agentsDb.values()) {
          if (agent.name && agent.name.toLowerCase().trim() === contactTag) {
            taggedAgent = agent;
            break;
          }
        }
      }

      if (taggedAgent) {
        console.log(`[Incoming Routing] Tag "${contactTag}" matched agent: ${taggedAgent.name} (${taggedAgent.id})`);
        let systemInstruction = taggedAgent.systemInstruction || '';
        if (taggedAgent.name) {
          systemInstruction = `[IDENTITY DIRECTIVE: Your name is "${taggedAgent.name}". You must introduce yourself as "${taggedAgent.name}" and identify as "${taggedAgent.name}" if asked for your name. In Hindi/Hinglish, you can say "Mera naam ${taggedAgent.name} hai".]\n\n` + systemInstruction;
        }
        if (taggedAgent.mood && taggedAgent.mood !== 'Professional') {
          systemInstruction = `[MOOD DIRECTIVE: You must act and speak in a ${taggedAgent.mood.toUpperCase()} mood at all times.]\n\n` + systemInstruction;
        }
        return {
          voice: taggedAgent.voice || defaultCallConfig.voice || 'Aoede',
          systemInstruction: systemInstruction || defaultCallConfig.systemInstruction,
          model: taggedAgent.model || defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
          name: callerContact.name || '',
          recordCall: recordCall,
          vobizAuthId: defaultCallConfig.vobizAuthId,
          vobizAuthToken: defaultCallConfig.vobizAuthToken,
          vobizCallerId: defaultCallConfig.vobizCallerId
        };
      } else {
        console.log(`[Incoming Routing] Tag "${contactTag}" found no matching agent — falling back to default incoming agent.`);
      }
    } else if (callerContact) {
      console.log(`[Incoming Routing] Caller ${fromNum} found ("${callerContact.name}") but has no tag — using default incoming agent.`);
    } else {
      console.log(`[Incoming Routing] Caller ${fromNum} not found in contacts — using default incoming agent.`);
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  if (defaultCallConfig.incomingAgentId) {
    const agent = agentsDb.get(defaultCallConfig.incomingAgentId);
    if (agent) {
      console.log(`[Incoming Routing] Dynamically routing call to agent: ${agent.name} (ID: ${agent.id})`);
      let systemInstruction = agent.systemInstruction || '';
      if (agent.name) {
        systemInstruction = `[IDENTITY DIRECTIVE: Your name is "${agent.name}". You must introduce yourself as "${agent.name}" and identify as "${agent.name}" if asked for your name. In Hindi/Hinglish, you can say "Mera naam ${agent.name} hai".]\n\n` + systemInstruction;
      }
      if (agent.mood && agent.mood !== 'Professional') {
        systemInstruction = `[MOOD DIRECTIVE: You must act and speak in a ${agent.mood.toUpperCase()} mood at all times.]\n\n` + systemInstruction;
      }
      return {
        voice: agent.voice || defaultCallConfig.voice || 'Aoede',
        systemInstruction: systemInstruction || defaultCallConfig.systemInstruction,
        model: agent.model || defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
        name: '',
        recordCall: recordCall,
        vobizAuthId: defaultCallConfig.vobizAuthId,
        vobizAuthToken: defaultCallConfig.vobizAuthToken,
        vobizCallerId: defaultCallConfig.vobizCallerId
      };
    } else {
      console.warn(`[Incoming Routing] Warning: Default Incoming Agent ID ${defaultCallConfig.incomingAgentId} not found in agentsDb. Falling back to default settings.`);
    }
  }
  return {
    voice: query.voice || defaultCallConfig.voice || 'Aoede',
    systemInstruction: query.systemInstruction || defaultCallConfig.systemInstruction,
    model: defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
    name: '',
    recordCall: recordCall,
    vobizAuthId: defaultCallConfig.vobizAuthId,
    vobizAuthToken: defaultCallConfig.vobizAuthToken,
    vobizCallerId: defaultCallConfig.vobizCallerId
  };
}


const app = express();
app.use(express.urlencoded({ limit: '25mb', extended: true }));
app.use(express.json({ limit: '25mb' }));


// CORS Middleware to allow requests from the SaaS platform
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, ngrok-skip-browser-warning');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Authentication Middleware for external SaaS Platform requests
const authMiddleware = (dataType) => (req, res, next) => {
  // If no API key is configured on the server, bypass check and allow all
  if (!defaultCallConfig.apiKey) {
    return next();
  }

  // Check if request originates from the web app dashboard UI
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  const referer = (req.headers.referer || '').toLowerCase();
  const origin = (req.headers.origin || '').toLowerCase();

  const isDashboard = (
    (host && referer.includes(host)) ||
    (host && origin.includes(host)) ||
    referer.includes('localhost') ||
    origin.includes('localhost') ||
    referer.includes('127.0.0.1') ||
    origin.includes('127.0.0.1')
  );

  if (isDashboard && !req.headers.authorization) {
    // Allow web app dashboard requests to proceed without requiring bearer API Key
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Missing API Key' });
  }

  const key = authHeader.split(' ')[1].trim();
  if (key !== defaultCallConfig.apiKey.trim()) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid API Key' });
  }

  // Check data sharing permissions
  if (dataType === 'agents' && defaultCallConfig.shareAgents === false) {
    return res.status(403).json({ success: false, error: 'Forbidden: Agent data sharing is disabled' });
  }
  if (dataType === 'contacts' && defaultCallConfig.shareContacts === false) {
    return res.status(403).json({ success: false, error: 'Forbidden: Contact data sharing is disabled' });
  }
  if (dataType === 'calls' && defaultCallConfig.shareCalls === false) {
    return res.status(403).json({ success: false, error: 'Forbidden: Call data sharing is disabled' });
  }

  next();
};

// Endpoint to retrieve sharing settings and API key status for local dashboard
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    apiKey: defaultCallConfig.apiKey || '',
    shareAgents: defaultCallConfig.shareAgents !== false, // default to true
    shareContacts: defaultCallConfig.shareContacts !== false, // default to true
    shareCalls: defaultCallConfig.shareCalls !== false // default to true
  });
});

// Endpoint to dynamically synchronize backend config defaults for incoming calls and webhook dialer credentials
app.post('/save-config', (req, res) => {
  Object.assign(defaultCallConfig, req.body);
  
  console.log(`[Config Sync] Updated backend configurations: Voice: ${defaultCallConfig.voice}, Provider: ${defaultCallConfig.telephonyProvider}`);
  
  // Save to file persistently
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultCallConfig, null, 2), 'utf-8');
    console.log(`[Config Sync] Persistent config saved to ${CONFIG_FILE}`);
  } catch (err) {
    console.error(`[Config Sync Error] Failed to save to ${CONFIG_FILE}:`, err.message);
  }
  
  res.json({ success: true });
});


// --- Tenant Branding API Endpoints ---
app.get('/api/public/branding', (req, res) => {
  const domain = req.query.domain || req.headers['x-forwarded-host'] || req.headers.host || '';
  const branding = resolveBranding(domain);
  res.json(branding);
});

app.post('/api/admin/branding', (req, res) => {
  const { id, customDomain, subdomain, appName, logoUrl, faviconUrl, primaryColor, secondaryColor, supportEmail, supportPhone, copyrightText } = req.body;
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const currentReseller = getResellerFromHost(host);

  if (currentReseller) {
    // If request is made from a reseller portal (e.g. growvo.in), ONLY update this reseller's branding
    currentReseller.branding = {
      appName: appName || currentReseller.branding.appName,
      logoUrl: logoUrl !== undefined ? logoUrl : currentReseller.branding.logoUrl,
      faviconUrl: faviconUrl !== undefined ? faviconUrl : currentReseller.branding.faviconUrl,
      primaryColor: primaryColor || currentReseller.branding.primaryColor,
      secondaryColor: secondaryColor || currentReseller.branding.secondaryColor,
      supportEmail: supportEmail !== undefined ? supportEmail : currentReseller.branding.supportEmail,
      copyrightText: copyrightText !== undefined ? copyrightText : currentReseller.branding.copyrightText
    };
    resellersDb.set(currentReseller.id, currentReseller);
    saveResellers();
    return res.json({ success: true, branding: currentReseller.branding });
  }

  // Super Admin updating default Callio portal branding
  const brandingData = {
    id: 'default',
    customDomain: customDomain || '',
    subdomain: subdomain || '',
    appName: appName || 'Callio',
    logoUrl: logoUrl || 'logo_new.png',
    faviconUrl: faviconUrl || 'favicon.ico',
    primaryColor: primaryColor || '#FF6B4A',
    secondaryColor: secondaryColor || '#ae3115',
    supportEmail: supportEmail || '',
    supportPhone: supportPhone || '',
    copyrightText: copyrightText || '© 2026 Callio. All rights reserved.'
  };

  brandingDb.set('default', brandingData);
  saveBranding();

  res.json({ success: true, branding: brandingData });
});



app.post('/api/upload-branding-asset', (req, res) => {
  const { fileName, fileData } = req.body;
  if (!fileName || !fileData) {
    return res.status(400).json({ success: false, error: 'File name and data are required.' });
  }

  const uploadsDir = './uploads';
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
  }

  const fileBuffer = Buffer.from(fileData, 'base64');
  const safeName = `${Date.now()}_${path.basename(fileName)}`;
  const filePath = path.join(uploadsDir, safeName);
  
  fs.writeFileSync(filePath, fileBuffer);
  
  res.json({ success: true, url: `/uploads/${safeName}` });
});

app.use('/uploads', express.static('./uploads'));

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});

app.get('/reseller', (req, res) => {
  res.sendFile(path.join(__dirname, 'reseller.html'));
});

// Serving the static front-end files for fallback UI
app.use(express.static('./'));

// ─── Routing Config API ───────────────────────────────────────────────────────
// GET: return current incomingAgentId + tagRules from defaultCallConfig
app.get('/api/routing-config', (req, res) => {
  res.json({
    success: true,
    incomingAgentId: defaultCallConfig.incomingAgentId || '',
    tagRules: defaultCallConfig.tagRules || []
  });
});

// POST: update incomingAgentId and/or tagRules, persist to config.json
app.post('/api/routing-config', express.json(), (req, res) => {
  const { incomingAgentId, tagRules } = req.body;
  if (incomingAgentId !== undefined) defaultCallConfig.incomingAgentId = incomingAgentId;
  if (tagRules !== undefined) defaultCallConfig.tagRules = tagRules;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultCallConfig, null, 2), 'utf-8');
    console.log(`[Routing Config] Saved — incomingAgentId: ${defaultCallConfig.incomingAgentId}, tagRules: ${JSON.stringify(defaultCallConfig.tagRules)}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[Routing Config] Failed to save:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save config' });
  }
});

// Helper to call Gemini API with fallback retry support
async function callGeminiGenerateContent(modelName, promptText) {
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptText }] }] })
    });
    const json = await resp.json();
    if (json.error) {
      console.warn(`[Gemini Fallback] Model ${modelName} returned error:`, JSON.stringify(json.error));
      return null;
    }
    return json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (err) {
    console.warn(`[Gemini Fallback] Model ${modelName} request failed:`, err.message);
    return null;
  }
}

// POST: generate a summary from a trial call transcript (client-collected)
app.post('/api/trial-summary', express.json(), async (req, res) => {
  const { phone, messages } = req.body;
  if (!messages || messages.length === 0) {
    return res.json({ summary: 'Conversation completed.', leadQuality: 'Cold Lead', actionToTake: 'No action needed.' });
  }
  const transcript = messages.map(m => `${m.role}: ${m.text}`).join('\n');
  const prompt = `You are an expert conversational analyst. Below is a transcript from a live demo call between a user and "Callio AI".
Analyze the conversation and return a JSON object with the following fields:
1. "summary": exactly 4 concise bullet points in Hindlish or natural English summarizing key moments of the conversation. Use "*" as the bullet point marker. Separated by newlines.
2. "leadQuality": one of "Hot Lead" (if highly interested/ready to buy), "Warm Lead" (if interested but has questions/needs follow-up), or "Cold Lead" (if not interested, voicemail, or wrong number).
3. "actionToTake": a short, direct action recommendation (max 6 words), e.g., "Schedule callback immediately", "Send product catalog", "No action needed".

Transcript:
${transcript}

Output JSON format:`;

  try {
    let rawText = null;
    const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'];
    
    for (const model of models) {
      console.log(`[Trial Summary] Attempting summary generation with model: ${model}`);
      rawText = await callGeminiGenerateContent(model, prompt);
      if (rawText) {
        console.log(`[Trial Summary] Summary successfully generated using model: ${model}`);
        break;
      }
    }

    if (!rawText) {
      console.warn('[Trial Summary] All Gemini fallback models failed.');
      return res.json({ summary: 'Conversation completed.', leadQuality: 'Cold Lead', actionToTake: 'No action needed.' });
    }

    // Strip markdown code block wrappers if present
    let jsonText = rawText.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.substring(7);
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.substring(3);
    }
    if (jsonText.endsWith('```')) {
      jsonText = jsonText.substring(0, jsonText.length - 3);
    }
    jsonText = jsonText.trim();

    let parsed = { summary: 'Conversation completed.', leadQuality: 'Cold Lead', actionToTake: 'No action needed.' };
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      console.warn('[Trial Summary] JSON parsing failed, trying raw text extraction:', jsonText);
      // Fallback if model returned plain bullet points
      if (jsonText.includes('*')) {
        parsed.summary = jsonText;
      }
    }

    // Convert newlines to HTML line breaks for rendering in the innerHTML container
    if (parsed.summary) {
      parsed.summary = parsed.summary.replace(/\n/g, '<br>');
    }

    // Link summary, quality and action back to the corresponding lead
    if (phone) {
      const leadIndex = trialLeads.findIndex(l => cleanAndComparePhone(l.phone, phone));
      if (leadIndex !== -1) {
        trialLeads[leadIndex].summary = parsed.summary;
        trialLeads[leadIndex].leadQuality = parsed.leadQuality || 'Cold Lead';
        trialLeads[leadIndex].actionToTake = parsed.actionToTake || 'No action needed.';
        if (!trialLeads[leadIndex].recordingUrl) {
          trialLeads[leadIndex].recordingUrl = '/recordings/demo_trial_call.mp3';
        }
        saveTrialLeads();
        console.log(`[Trial Summary] Lead updated with summary, quality and action for phone: ${phone}`);
      } else {
        console.warn(`[Trial Summary] Lead not found for phone: ${phone}`);
      }
    }

    res.json(parsed);
  } catch (e) {
    console.error('[Trial Summary] Error:', e.message);
    res.json({ summary: 'Your conversation with Callio AI has ended.', leadQuality: 'Cold Lead', actionToTake: 'No action needed.' });
  }
});

// POST: upload a recording for a trial call lead
app.post('/api/upload-trial-recording', express.raw({ type: 'audio/webm', limit: '20mb' }), (req, res) => {
  const phone = req.query.phone;
  if (!phone) {
    return res.status(400).json({ error: 'Phone query parameter is required.' });
  }
  const buffer = req.body;
  if (!buffer || buffer.length === 0) {
    return res.status(400).json({ error: 'Empty audio buffer received.' });
  }

  const dir = path.join(__dirname, 'recordings');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const safePhone = phone.replace(/\D/g, '');
  const filename = `trial-${safePhone}.webm`;
  const localPath = path.join(dir, filename);

  try {
    fs.writeFileSync(localPath, buffer);
    
    const leadIndex = trialLeads.findIndex(l => cleanAndComparePhone(l.phone, phone));
    if (leadIndex !== -1) {
      trialLeads[leadIndex].recordingUrl = `/recordings/${filename}`;
      saveTrialLeads();
      console.log(`[Trial Recording] Recording saved to: ${localPath}`);
    }
    
    res.json({ success: true, url: `/recordings/${filename}` });
  } catch (err) {
    console.error('[Trial Recording] Write failed:', err.message);
    res.status(500).json({ error: 'Failed to write recording file.' });
  }
});

// POST: submit a trial call lead (saves to trial_leads_db.json)
app.post('/api/trial-lead', express.json(), (req, res) => {
  const { name, phone, voice, prompt } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and Phone Number are required.' });
  }
  const newLead = {
    name,
    phone,
    voice: voice || 'Aoede',
    prompt: prompt || '',
    timestamp: new Date().toISOString()
  };
  trialLeads.push(newLead);
  saveTrialLeads();
  res.json({ success: true });
});

// GET: retrieve all trial leads sorted by timestamp desc (for admin view)
app.get('/api/admin/trial-leads', (req, res) => {
  const sorted = [...trialLeads].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json({ success: true, leads: sorted });
});

// POST: trigger a live outbound trial call (max 2 per IP)
app.post('/api/trial-call', express.json(), async (req, res) => {
  let { name, phone, prompt } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number is required.' });
  }

  // Determine IP
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const callCount = trialLimits.get(ip) || 0;

  // Enforce IP trial limit only if admin has enabled it
  if (defaultCallConfig.trialLimitEnabled && callCount >= 2) {
    console.warn(`[Trial Call Blocked] IP ${ip} has already reached the maximum of 2 calls.`);
    return res.status(429).json({ success: false, error: 'You have reached the maximum of 2 trial calls for this IP.' });
  }

  // Active configs
  const activeVoice = defaultCallConfig.voice || 'Aoede';
  const activeInstruction = prompt && prompt.trim().length > 0 
    ? prompt 
    : (defaultCallConfig.systemInstruction || 'Namaste! Main Callio AI Voice Assistant bol rahi hoon.');

  try {
    const publicUrl = req.headers.host ? `http://${req.headers.host}` : `http://localhost:${PORT}`;
    
    const payload = {
      provider: defaultCallConfig.provider || 'vobiz',
      to: phone,
      publicUrl: publicUrl,
      voice: activeVoice,
      systemInstruction: activeInstruction,
      name: name || 'Trial User',
      recordCall: true
    };

    console.log(`[Trial Call] Forwarding outbound call trigger to /make-call for IP: ${ip}. Payload:`, payload);

    // Call make-call logic locally
    const makeCallUrl = `http://localhost:${PORT}/make-call`;
    const response = await fetch(makeCallUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (response.ok && result.success) {
      // Increment IP limit counter
      trialLimits.set(ip, callCount + 1);
      saveTrialLimits();
      console.log(`[Trial Call] Successfully initiated trial call. IP ${ip} count incremented to: ${callCount + 1}`);
      return res.json({ success: true, callSid: result.callSid });
    } else {
      let friendlyError = result.error || 'Failed to place call. Please try again.';
      
      // Clean up provider names to keep it white-labeled
      friendlyError = friendlyError
        .replace(/vobiz/gi, 'Calling Engine')
        .replace(/exotel/gi, 'Calling Engine');
      
      // Handle incomplete setup
      if (friendlyError.toLowerCase().includes('incomplete') || friendlyError.toLowerCase().includes('not configured')) {
        friendlyError = 'Call service is temporarily unavailable. Please contact the site administrator to configure calling credentials.';
      }
      
      // Handle generic/unknown API failures
      if (friendlyError.toLowerCase().includes('unknown') || friendlyError.toLowerCase().includes('error')) {
        friendlyError = 'Call could not be placed. Please check your country code and phone number, or try again later.';
      }
      
      return res.status(response.status).json({ success: false, error: friendlyError });
    }
  } catch (err) {
    console.error(`[Trial Call Exception] Failed to trigger local call:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────


// 1. TwiML Endpoint for Incoming Twilio Call Webhooks
app.post('/incoming-call', (req, res) => {
  const toNum = (req.body.To || req.query.To || '').trim();
  const fromNum = (req.body.From || req.query.From || '').trim();
  const callSid = req.body.CallSid || '';
  
  console.log(`[Twilio Webhook] Received call: ${callSid || 'Unknown'} (To: ${toNum}, From: ${fromNum})`);
  
  let clientId = req.query.client_id || req.body.client_id || '';
  if (!clientId && toNum) {
    for (const [cId, c] of clientsDb.entries()) {
      if (c.phone_number && cleanAndComparePhone(c.phone_number, toNum)) {
        clientId = cId;
        break;
      }
    }
  }

  let callConfig = callSettingsMap.get(callSid) || callSettingsMap.get(toNum) || callSettingsMap.get(fromNum);
  
  if (!callConfig) {
    if (clientId && clientsDb.has(clientId)) {
      const client = clientsDb.get(clientId);
      console.log(`[Twilio Webhook] Dynamically routing call to client: ${client.name} (ID: ${client.id})`);
      callConfig = {
        voice: client.agent_config?.voice || defaultCallConfig.voice || 'Aoede',
        systemInstruction: client.agent_config?.system_prompt || defaultCallConfig.systemInstruction,
        model: defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
        name: client.name || '',
        recordCall: defaultCallConfig.gemini_record_call === 'true' || defaultCallConfig.recordCall || false,
        clientId: clientId
      };
    } else {
      console.log(`[Twilio Webhook] Configuration not found in backend memory map. Falling back to dynamic routing.`);
      callConfig = getIncomingCallConfig(req.query, fromNum);
    }
  } else {
    console.log(`[Twilio Webhook] Configuration successfully loaded from backend memory map.`);
    callConfig = { ...callConfig };
  }
  
  const matchedContact = findContactByPhone(fromNum);
  if (matchedContact && matchedContact.name) {
    console.log(`[Twilio Webhook] Found saved contact matching ${fromNum}: "${matchedContact.name}"`);
    callConfig.name = matchedContact.name;
  }
  
  if (req.body.CallSid) {
    callSettingsMap.set(req.body.CallSid, callConfig);
    getOrCreateCallState(req.body.CallSid, {
      provider: 'twilio',
      to: toNum,
      direction: 'incoming',
      name: callConfig.name || '',
      recordCall: callConfig.recordCall || false,
      status: 'active',
      clientId: callConfig.clientId || null
    });
  }
  
  res.type('text/xml');
  res.send(`
    <Response>
      <Connect>
        <Stream url="wss://${req.headers.host}/media-stream?voice=${encodeURIComponent(callConfig.voice)}&amp;systemInstruction=${encodeURIComponent(callConfig.systemInstruction)}" />
      </Connect>
    </Response>
  `);
});

// 2. Exotel Dynamic Voicebot Endpoint for Incoming Exotel Call Webhooks
app.all('/incoming-call-exotel', (req, res) => {
  const query = req.query || {};
  const body = req.body || {};
  
  console.log(`[Exotel Webhook Request] Method: ${req.method}, Query: ${JSON.stringify(query)}, Body: ${JSON.stringify(body)}`);
  
  const callSid = (body.CallSid || query.CallSid || body.call_sid || query.call_sid || body.callSid || query.callSid || '').trim();
  const toNum = (body.To || query.To || body.to || query.to || '').trim();
  const fromNum = (body.From || query.From || body.from || query.from || '').trim();
  
  console.log(`[Exotel Webhook] Incoming call received. CallSid: ${callSid || 'Unknown'} (To: ${toNum}, From: ${fromNum})`);
  
  let clientId = query.client_id || body.client_id || '';
  if (!clientId && toNum) {
    for (const [cId, c] of clientsDb.entries()) {
      if (c.phone_number && cleanAndComparePhone(c.phone_number, toNum)) {
        clientId = cId;
        break;
      }
    }
  }

  let callConfig = callSettingsMap.get(callSid) || callSettingsMap.get(toNum) || callSettingsMap.get(fromNum);
  
  if (!callConfig) {
    if (clientId && clientsDb.has(clientId)) {
      const client = clientsDb.get(clientId);
      console.log(`[Exotel Webhook] Dynamically routing call to client: ${client.name} (ID: ${client.id})`);
      callConfig = {
        voice: client.agent_config?.voice || defaultCallConfig.voice || 'Aoede',
        systemInstruction: client.agent_config?.system_prompt || defaultCallConfig.systemInstruction,
        model: defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
        name: client.name || '',
        recordCall: defaultCallConfig.gemini_record_call === 'true' || defaultCallConfig.recordCall || false,
        clientId: clientId
      };
    } else {
      console.log(`[Exotel Webhook] Configuration not found in backend memory map. Falling back to dynamic routing.`);
      callConfig = getIncomingCallConfig(req.query, fromNum);
    }
  } else {
    console.log(`[Exotel Webhook] Configuration successfully loaded from backend memory map.`);
    callConfig = { ...callConfig };
  }
  
  const matchedContact = findContactByPhone(fromNum);
  if (matchedContact && matchedContact.name) {
    console.log(`[Exotel Webhook] Found saved contact matching ${fromNum}: "${matchedContact.name}"`);
    callConfig.name = matchedContact.name;
  }
  
  if (callSid) {
    callSettingsMap.set(callSid, callConfig);
    console.log(`[Exotel Webhook] Config cached under CallSid: ${callSid}`);
    getOrCreateCallState(callSid, {
      provider: 'exotel',
      to: toNum,
      direction: 'incoming',
      name: callConfig.name || '',
      recordCall: callConfig.recordCall || false,
      status: 'active',
      clientId: callConfig.clientId || null
    });
  }
  
  const host = req.headers.host;
  const responseData = {
    url: `wss://${host}/media-stream?provider=exotel`
  };
  
  console.log(`[Exotel Webhook] Responding with WebSocket URL: ${responseData.url}`);
  res.json(responseData);
});

// 2.5. Vobiz XML Endpoint for Incoming/Answered Vobiz Calls
app.all('/incoming-call-vobiz', (req, res) => {
  const callSid = (
    req.body.CallSid || req.query.CallSid || 
    req.body.callSid || req.query.callSid || 
    req.body.CallUUID || req.query.CallUUID || 
    req.body.call_uuid || req.query.call_uuid || 
    req.body.request_uuid || req.query.request_uuid || ''
  ).trim();
  const toNum = (req.body.To || req.query.To || req.body.to || req.query.to || '').trim();
  const fromNum = (req.body.From || req.query.From || req.body.from || req.query.from || '').trim();
  
  let clientId = req.query.client_id || req.body.client_id || '';
  if (!clientId && toNum) {
    for (const [cId, c] of clientsDb.entries()) {
      if (c.phone_number && cleanAndComparePhone(c.phone_number, toNum)) {
        clientId = cId;
        break;
      }
    }
  }
  
  console.log(`[Vobiz Webhook] Received call. CallSid: ${callSid || 'Unknown'} (To: ${toNum}, From: ${fromNum}, Client: ${clientId || 'None'})`);
  
  const event = req.body.Event || req.query.Event || '';
  if (event === 'Hangup') {
    const callStatus = req.body.CallStatus || req.query.CallStatus || '';
    let finalStatus = 'completed';
    if (callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'failed' || callStatus === 'canceled') {
      finalStatus = 'failed';
    }
    console.log(`[Vobiz Webhook] Call Hangup event received for CallSid: ${callSid}. Final status: ${finalStatus}`);
    handleCallEnd(callSid, finalStatus);
    return res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }

  let callConfig = callSettingsMap.get(callSid) || callSettingsMap.get(toNum) || callSettingsMap.get(fromNum);
  
  if (!callConfig) {
    if (clientId && clientsDb.has(clientId)) {
      const client = clientsDb.get(clientId);
      console.log(`[Vobiz Webhook] Dynamically routing call to client: ${client.name} (ID: ${client.id})`);
      callConfig = {
        voice: client.agent_config?.voice || defaultCallConfig.voice || 'Aoede',
        systemInstruction: client.agent_config?.system_prompt || defaultCallConfig.systemInstruction,
        model: defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
        name: client.name || '',
        recordCall: defaultCallConfig.gemini_record_call === 'true' || defaultCallConfig.recordCall || false,
        clientId: clientId,
        vobizAuthId: client.vobiz_sub_auth_id,
        vobizAuthToken: client.vobiz_sub_auth_token
      };
    } else {
      console.log(`[Vobiz Webhook] Configuration not found in backend memory map. Falling back to dynamic routing.`);
      callConfig = getIncomingCallConfig(req.query, fromNum);
    }
  } else {
    console.log(`[Vobiz Webhook] Configuration successfully loaded from memory map.`);
    callConfig = { ...callConfig };
  }
  
  const matchedContact = findContactByPhone(fromNum);
  if (matchedContact && matchedContact.name) {
    console.log(`[Vobiz Webhook] Found saved contact matching ${fromNum}: "${matchedContact.name}"`);
    callConfig.name = matchedContact.name;
  }
  
  if (callSid) {
    // --- DEDUP FIX: Check if there is already a 'calling' state entry for this destination number.
    // When /make-call registers a call with 'request_uuid' and Vobiz later calls back with 'CallUUID',
    // these may differ. Find the pre-existing entry and merge instead of creating a duplicate.
    let resolvedSid = callSid;
    if (toNum) {
      for (const [sid, state] of activeCalls.entries()) {
        if (cleanAndComparePhone(state.to, toNum) && state.status === 'calling' && sid !== callSid) {
          console.log(`[Vobiz Webhook] Dedup: Found existing 'calling' entry for ${toNum} (sid: ${sid}). Merging into callSid ${callSid}.`);
          // Copy the old state into the new callSid
          const oldState = { ...state, callSid: callSid };
          activeCalls.delete(sid);
          activeCalls.set(callSid, oldState);
          callSettingsMap.set(callSid, callSettingsMap.get(sid) || callConfig);
          callSettingsMap.delete(sid);
          resolvedSid = callSid;
          break;
        }
      }
    }
    callSettingsMap.set(resolvedSid, callConfig);
    console.log(`[Vobiz Webhook] Config cached under CallSid: ${resolvedSid}`);
    getOrCreateCallState(resolvedSid, {
      provider: 'vobiz',
      to: toNum,
      direction: 'incoming',
      name: callConfig.name || '',
      recordCall: callConfig.recordCall || false,
      status: 'active',
      clientId: callConfig.clientId || null
    });
  }
  
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" contentType="audio/x-mulaw;rate=8000" keepCallAlive="true">wss://${req.headers.host}/media-stream?provider=vobiz${clientId ? `&amp;client_id=${clientId}` : ''}</Stream>
</Response>`);
});
// 3. Outbound Call Trigger Endpoint
app.post('/make-call', async (req, res) => {
  let { 
    provider = 'vobiz',
    to, 
    publicUrl, 
    voice, 
    systemInstruction,
    name = '',
    recordCall = false,
    model = 'gemini-3.1-flash-live-preview',
    exotelApiKey,
    exotelApiToken,
    exotelAccountSid,
    exotelSubdomain = 'api.exotel.com',
    exotelCallerId,
    vobizAuthId,
    vobizAuthToken,
    vobizCallerId,
    leadId,
    saasApiUrl
  } = req.body;

  // Support white-labeled parameter aliases
  if (req.body.authId) vobizAuthId = req.body.authId;
  if (req.body.authToken) vobizAuthToken = req.body.authToken;
  if (req.body.apiToken) vobizAuthToken = req.body.apiToken;
  if (req.body.callerId) vobizCallerId = req.body.callerId;
  if (req.body.virtualNumber) vobizCallerId = req.body.virtualNumber;
  
  if (!to || !publicUrl) {
    return res.status(400).json({ success: false, error: 'Missing destination (to) or publicUrl parameters.' });
  }

  // Wallet Low-Balance Blocking
  const activeClientId = req.body.client_id || req.body.clientId || null;
  if (activeClientId && clientsDb.has(activeClientId)) {
    const client = clientsDb.get(activeClientId);
    if (client.balance !== undefined && client.balance <= 0) {
      console.warn(`[Outbound Call Blocked] 🚫 Call blocked for client: ${client.name} (ID: ${activeClientId}) due to low balance: ₹${client.balance}`);
      return res.status(402).json({ success: false, error: 'Insufficient wallet balance. Please recharge your account.' });
    }
    // Plan minutes limit check
    const planId = (client.plan || 'basic').toLowerCase();
    const planDetails = plansDb.get(planId) || { max_minutes: 100 };
    const allowed = planDetails.max_minutes >= 99999 ? Infinity : planDetails.max_minutes;
    const used = client.used_minutes || 0;
    if (used >= allowed) {
      console.warn(`[Outbound Call Blocked] 🚫 Call blocked for client: ${client.name} (ID: ${activeClientId}) due to plan minutes limit reached: ${used}/${allowed} mins`);
      return res.status(402).json({ success: false, error: 'Your subscription plan call minutes limit has been reached. Please upgrade your plan.' });
    }
  }
  
  if (!name && to) {
    const contact = findContactByPhone(to);
    if (contact && contact.name) {
      name = contact.name;
      console.log(`[Outbound Call Resolution] Resolved phone ${to} to contact name: "${name}"`);
    }
  }
  
  let normalizedTo = to.trim();
  
  // Concurrent call protection (Debounce / Dial Locking)
  let isAlreadyCalling = false;
  for (const [sid, state] of activeCalls.entries()) {
    if (cleanAndComparePhone(state.to, normalizedTo) && 
        (state.status === 'calling' || state.status === 'active' || state.status === 'ringing' || state.status === 'in-progress')) {
      isAlreadyCalling = true;
      break;
    }
  }
  if (isAlreadyCalling) {
    console.warn(`[Outbound Call Blocked] 🚫 Call to ${normalizedTo} is already active or dialing. Skipping duplicate dial.`);
    return res.status(409).json({ success: false, error: 'Call to this number is already in progress.' });
  }
  
  if (provider === 'vobiz') {
    normalizedTo = normalizedTo.replace(/[\s\-\(\)\+]/g, '');
    
    let activeVobizAuthId = vobizAuthId || defaultCallConfig.vobizAuthId;
    let activeVobizAuthToken = vobizAuthToken || defaultCallConfig.vobizAuthToken;
    let activeVobizCallerId = vobizCallerId || defaultCallConfig.vobizCallerId || '+917971442441';
    let activeVoice = voice;
    let activeInstruction = systemInstruction;
    let activeClientId = req.body.client_id || req.body.clientId || null;

    if (activeClientId && clientsDb.has(activeClientId)) {
      const client = clientsDb.get(activeClientId);
      const subAuthId = client.vobiz_sub_auth_id;
      const subAuthToken = client.vobiz_sub_auth_token;
      
      const hasValidSubCredentials = subAuthId && subAuthToken 
        && subAuthToken !== 'token_test_subaccount' 
        && !subAuthToken.startsWith('token_test')
        && subAuthToken.length > 20;  // real tokens are long

      if (hasValidSubCredentials) {
        // Client has their own real sub-account — use their credentials + their number
        activeVobizAuthId = subAuthId;
        activeVobizAuthToken = subAuthToken;
        activeVobizCallerId = client.phone_number || activeVobizCallerId;
      } else {
        // No valid sub-account — use admin credentials but client's assigned number as caller ID
        // (admin must have this number configured in their Vobiz account)
        activeVobizCallerId = client.phone_number || defaultCallConfig.vobizCallerId || activeVobizCallerId;
      }
      // IMPORTANT: Only use client.agent_config as a last fallback.
      // The frontend sends the user-selected agent's voice/instruction — NEVER override it.
      // Only apply defaults if the frontend sent nothing at all (null/undefined/empty).
      if (!activeVoice) {
        activeVoice = client.agent_config?.voice;
      }
      if (!activeInstruction) {
        activeInstruction = client.agent_config?.system_prompt;
      }
      console.log(`[Vobiz REST API] ${hasValidSubCredentials ? 'Using sub-account' : 'Using admin account (fallback)'}: AuthID=${activeVobizAuthId}, CallerId=${activeVobizCallerId} for client: ${activeClientId}`);
    }
    
    if (!activeVobizAuthId || !activeVobizAuthToken || !activeVobizCallerId || activeVobizCallerId.trim() === '') {
      const missingField = !activeVobizAuthId ? 'Auth ID' : !activeVobizAuthToken ? 'Auth Token' : 'Virtual Number (Caller ID)';
      return res.status(400).json({ success: false, error: `Callio setup incomplete: ${missingField} is not configured. Please set it in Admin Settings → Callings tab.` });
    }
    
    console.log(`[Vobiz REST API] Attempting outbound call to: ${normalizedTo} (Name: ${name}) via CallerId: ${activeVobizCallerId}`);
    
    try {
      let callbackUrl = publicUrl.trim().replace(/^http:\/\//i, 'https://');
      if (!callbackUrl.startsWith('https://')) {
        callbackUrl = `https://${callbackUrl}`;
      }
      
      const answerUrl = `${callbackUrl}/incoming-call-vobiz?voice=${encodeURIComponent(activeVoice || 'Aoede')}${activeClientId ? `&client_id=${activeClientId}` : ''}`;
      
      const bodyPayload = {
        from: activeVobizCallerId.trim().replace(/[\s\-\(\)\+]/g, ''),
        to: normalizedTo,
        answer_url: answerUrl,
        answer_method: 'POST'
      };
      
      const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${activeVobizAuthId.trim()}/Call/`;
      
      const response = await fetch(vobizUrl, {
        method: 'POST',
        headers: {
          'X-Auth-ID': activeVobizAuthId.trim(),
          'X-Auth-Token': activeVobizAuthToken.trim(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyPayload)
      });
      
      const data = await response.json();
      const callUuid = data.request_uuid || data.call_uuid || data.sid;
      
      if (response.ok && callUuid) {
        console.log(`[Vobiz REST API] Call initiated successfully. CallSid: ${callUuid}`);
        callSettingsMap.set(callUuid, { 
          voice: activeVoice, 
          systemInstruction: activeInstruction, 
          name,
          vobizAuthId: activeVobizAuthId,
          vobizAuthToken: activeVobizAuthToken,
          vobizCallerId: activeVobizCallerId,
          recordCall,
          model,
          leadId,
          saasApiUrl,
          clientId: activeClientId
        });
        getOrCreateCallState(callUuid, {
          provider: 'vobiz',
          to: normalizedTo,
          direction: 'outgoing',
          name: name,
          recordCall: recordCall,
          status: 'calling',
          clientId: activeClientId
        });
        return res.json({ success: true, callSid: callUuid });
      } else {
        const errMsg = data.message || 'Unknown Call Service Error';
        console.error(`[Vobiz REST API Error] Msg: ${errMsg}`);
        return res.status(response.status).json({ success: false, error: errMsg });
      }
    } catch (err) {
      console.error(`[Vobiz Outbound Call Exception] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
  
  if (provider === 'exotel') {
    // Keep E.164 format (starts with +) but remove spaces/dashes for Singapore region compatibility
    normalizedTo = normalizedTo.replace(/[\s\-\(\)]/g, '');
    
    if (!exotelApiKey || !exotelApiToken || !exotelAccountSid || !exotelCallerId) {
      return res.status(400).json({ success: false, error: 'Missing Exotel configuration (API Key, Token, Account SID, or Virtual Number).' });
    }
    
    console.log(`[Exotel REST API] Attempting outbound call to: ${normalizedTo} (Name: ${name}) via CallerId: ${exotelCallerId}`);
    
    try {
      const authHeader = Buffer.from(`${exotelApiKey.trim()}:${exotelApiToken.trim()}`).toString('base64');
      
      let callbackUrl = publicUrl.trim();
      if (!callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
        callbackUrl = `https://${callbackUrl}`;
      }
      
      let wsUrl = callbackUrl.replace('https://', 'wss://').replace('http://', 'ws://');
      const wsUrlWithQuery = `${wsUrl}/media-stream?provider=exotel`;
      
      const params = new URLSearchParams();
      params.append('From', normalizedTo);
      params.append('CallerId', exotelCallerId.trim());
      params.append('StreamUrl', wsUrlWithQuery);
      params.append('StreamType', 'bidirectional');
      
      const exotelUrl = `https://${exotelSubdomain.trim()}/v1/Accounts/${exotelAccountSid.trim()}/Calls/connect.json`;
      
      const response = await fetch(exotelUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
      });
      
      const data = await response.json();
      
      if (response.ok && data.Call) {
        console.log(`[Exotel REST API] Call initiated successfully. CallSid: ${data.Call.Sid}`);
        callSettingsMap.set(data.Call.Sid, { 
          voice, 
          systemInstruction, 
          name,
          exotelApiKey,
          exotelApiToken,
          exotelAccountSid,
          exotelSubdomain,
          recordCall,
          model,
          leadId,
          saasApiUrl
        });
        getOrCreateCallState(data.Call.Sid, {
          provider: 'exotel',
          to: normalizedTo,
          direction: 'outgoing',
          name: name,
          recordCall: recordCall,
          status: 'calling'
        });
        return res.json({ success: true, callSid: data.Call.Sid });
      } else {
        const errMsg = data.RestException?.Message || data.message || 'Unknown Exotel Error';
        console.error(`[Exotel REST API Error] Msg: ${errMsg}`);
        return res.status(response.status).json({ success: false, error: errMsg });
      }
    } catch (err) {
      console.error(`[Exotel Outbound Call Exception] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  } else {
    // Twilio Flow (original)
    console.log(`[Twilio REST API] Caching call configuration for target: ${normalizedTo} (Name: ${name})`);
    callSettingsMap.set(normalizedTo, { voice, systemInstruction, name, recordCall, model, leadId, saasApiUrl });
    
    console.log(`[Twilio REST API] Attempting outbound call to: ${normalizedTo} using callback: ${publicUrl}/incoming-call`);
    
    try {
      const authHeader = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      
      let callbackUrl = publicUrl.trim();
      if (!callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
        callbackUrl = `https://${callbackUrl}`;
      }
      
      const callbackUrlWithQuery = `${callbackUrl}/incoming-call?voice=${encodeURIComponent(voice || 'Aoede')}`;
      
      const params = new URLSearchParams();
      params.append('To', normalizedTo);
      params.append('From', process.env.TWILIO_PHONE_NUMBER);
      params.append('Url', callbackUrlWithQuery);
      if (recordCall) {
        params.append('Record', 'true');
      }
      
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Calls.json`;
      
      const response = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
      });
      
      const data = await response.json();
      
      if (response.ok) {
        console.log(`[Twilio REST API] Call initiated successfully. CallSid: ${data.sid}`);
        callSettingsMap.set(data.sid, { voice, systemInstruction, name, recordCall, model, leadId, saasApiUrl });
        getOrCreateCallState(data.sid, {
          provider: 'twilio',
          to: normalizedTo,
          direction: 'outgoing',
          name: name,
          recordCall: recordCall,
          status: 'calling'
        });
        return res.json({ success: true, callSid: data.sid });
      } else {
        console.error(`[Twilio REST API Error] Code: ${data.code}, Msg: ${data.message}`);
        return res.status(response.status).json({ success: false, error: data.message });
      }
    } catch (err) {
      console.error(`[Outbound Call Exception] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
});

// GET /calls - Retrieve all active/past calls state list
app.get('/calls', (req, res) => {
  const { clientId } = req.query;
  let list = Array.from(activeCalls.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (clientId && clientId !== 'admin') {
    list = list.filter(c => c.clientId === clientId);
  } else if (clientId === 'admin') {
    list = list.filter(c => c.clientId === 'admin' || !c.clientId);
  }
  res.json({ success: true, calls: list });
});

// GET /call-status/:callSid - Retrieve a specific call state details
app.get('/call-status/:callSid', (req, res) => {
  const callSid = req.params.callSid;
  const callState = activeCalls.get(callSid);
  if (!callState) {
    return res.status(404).json({ success: false, error: 'Call state not found' });
  }
  const { clientId } = req.query;
  if (clientId && clientId !== 'admin' && callState.clientId !== clientId) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  res.json({ success: true, callState });
});

// GET /recording-proxy/:callSid - Proxy Vobiz recording with auth headers
app.get('/recording-proxy/:callSid', async (req, res) => {
  const callSid = req.params.callSid;
  const callState = activeCalls.get(callSid);
  if (!callState) {
    return res.status(404).json({ error: 'Call not found' });
  }

  const localPath = path.join(__dirname, 'recordings', `${callSid}.mp3`);
  const sendFileHeaders = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Disposition': `inline; filename="recording-${callSid.substring(0,8)}.mp3"`,
    'Content-Type': 'audio/mpeg'
  };

  if (fs.existsSync(localPath)) {
    return res.sendFile(localPath, { headers: sendFileHeaders });
  }

  if (callState.recordingUrl) {
    console.log(`[Recording Proxy] File not cached. Downloading on-the-fly for ${callSid}...`);
    const success = await downloadAndCacheRecording(callSid);
    if (success && fs.existsSync(localPath)) {
      return res.sendFile(localPath, { headers: sendFileHeaders });
    }
  }

  return res.status(404).json({ error: 'Recording file not available' });
});

// ==========================================
// NEW MULTI-TAB ARCHITECTURE APIs
// ==========================================

// --- AGENTS API ---
app.get('/api/agents', authMiddleware('agents'), (req, res) => {
  const { clientId } = req.query;
  let list = Array.from(agentsDb.values());
  if (clientId && clientId !== 'admin') {
    list = list.filter(a => a.clientId === clientId);
  } else if (clientId === 'admin') {
    list = list.filter(a => a.clientId === 'admin' || !a.clientId);
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ success: true, agents: list });
});

app.post('/api/agents', authMiddleware('agents'), (req, res) => {
  const { id, name, voice, systemInstruction, mood, model, clientId } = req.body;
  if (!name || !voice) {
    return res.status(400).json({ success: false, error: 'Name and Voice are required.' });
  }

  const isNew = !id;
  if (clientId && clientsDb.has(clientId)) {
    const client = clientsDb.get(clientId);
    if (client && client.role !== 'admin') {
      const plan = client.plan || 'basic';
      const planDetails = plansDb.get(plan.toLowerCase()) || { max_agents: 2 };
      const allowedAgents = planDetails.max_agents >= 99999 ? Infinity : planDetails.max_agents;
      const clientAgents = Array.from(agentsDb.values()).filter(a => a.clientId === clientId);
      
      if (isNew && clientAgents.length >= allowedAgents) {
        return res.status(400).json({
          success: false,
          error: `Your ${plan.toUpperCase()} plan only allows creating up to ${allowedAgents} agents. Please upgrade your plan.`
        });
      }
    }
  }
  
  const agentId = id || `agent_${Date.now()}`;
  const agentData = {
    id: agentId,
    name,
    voice,
    systemInstruction: systemInstruction || '',
    mood: mood || 'Professional',
    model: model || 'gemini-2.5-flash', // Fallback to flash if not provided
    clientId: clientId || null,
    createdAt: id ? agentsDb.get(id)?.createdAt : Date.now()
  };
  
  agentsDb.set(agentId, agentData);
  saveAgents();
  res.json({ success: true, agent: agentData });
});

app.delete('/api/agents/:id', authMiddleware('agents'), (req, res) => {
  const { id } = req.params;
  if (agentsDb.has(id)) {
    agentsDb.delete(id);
    saveAgents();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Agent not found' });
  }
});

// --- GROUPS API ---
app.get('/api/groups', authMiddleware('contacts'), (req, res) => {
  const { clientId } = req.query;
  let list = Array.from(groupsDb.values());
  if (clientId && clientId !== 'admin') {
    list = list.filter(g => g.clientId === clientId);
  } else if (clientId === 'admin') {
    list = list.filter(g => g.clientId === 'admin' || !g.clientId);
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  // Attach contacts to each group
  const listWithContacts = list.map(group => {
    const contacts = Array.from(contactsDb.values()).filter(c => c.groupId === group.id);
    return { ...group, contacts };
  });
  res.json({ success: true, groups: listWithContacts });
});

app.post('/api/groups', authMiddleware('contacts'), (req, res) => {
  const { name, clientId } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Group name required' });
  
  const groupId = `grp_${Date.now()}`;
  const groupData = { id: groupId, name, clientId: clientId || null, createdAt: Date.now() };
  groupsDb.set(groupId, groupData);
  saveGroups();
  
  res.json({ success: true, group: groupData });
});

app.delete('/api/groups/:id', authMiddleware('contacts'), (req, res) => {
  const { id } = req.params;
  if (groupsDb.has(id)) {
    groupsDb.delete(id);
    saveGroups();
    // Delete associated contacts
    for (const [cId, contact] of contactsDb.entries()) {
      if (contact.groupId === id) contactsDb.delete(cId);
    }
    saveContacts();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Group not found' });
  }
});

// --- CONTACTS API ---
app.post('/api/contacts/batch', authMiddleware('contacts'), (req, res) => {
  const { groupId, contacts } = req.body;
  if (!groupId || !Array.isArray(contacts)) {
    return res.status(400).json({ success: false, error: 'groupId and contacts array required' });
  }
  
  if (!groupsDb.has(groupId)) {
    return res.status(404).json({ success: false, error: 'Group not found' });
  }
  
  let added = 0;
  contacts.forEach(c => {
    if (c.phone) {
      const contactId = `cont_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      contactsDb.set(contactId, {
        id: contactId,
        groupId,
        phone: c.phone,
        name: c.name || '',
        createdAt: Date.now()
      });
      added++;
    }
  });
  
  saveContacts();
  res.json({ success: true, added });
});

app.post('/api/contacts', express.json(), authMiddleware('contacts'), (req, res) => {
  const { groupId, name, phone, tag } = req.body;
  if (!groupId || !groupsDb.has(groupId) || !phone) {
    return res.status(400).json({ success: false, error: 'groupId and phone are required.' });
  }
  const contactId = `cont_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const contact = {
    id: contactId,
    groupId,
    phone,
    name: name || '',
    tag: tag || '',
    createdAt: Date.now()
  };
  contactsDb.set(contactId, contact);
  saveContacts();
  res.json({ success: true, contact });
});

app.put('/api/contacts/:id', express.json(), authMiddleware('contacts'), (req, res) => {
  const { id } = req.params;
  const { name, phone } = req.body;
  if (!contactsDb.has(id)) {
    return res.status(404).json({ success: false, error: 'Contact not found' });
  }
  const contact = contactsDb.get(id);
  if (name !== undefined) contact.name = name;
  if (phone !== undefined) contact.phone = phone;
  if (req.body.tag !== undefined) contact.tag = req.body.tag;
  contactsDb.set(id, contact);
  saveContacts();
  res.json({ success: true, contact });
});

app.delete('/api/contacts/:id', authMiddleware('contacts'), (req, res) => {
  const { id } = req.params;
  if (contactsDb.has(id)) {
    contactsDb.delete(id);
    saveContacts();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Contact not found' });
  }
});


// --- CRM INTEGRATION API ---
app.get('/api/crm-rules', authMiddleware('calls'), (req, res) => {
  const { clientId } = req.query;
  const ruleId = clientId || 'default_rule';
  const rule = crmRulesDb.get(ruleId) || {
    id: ruleId,
    enabled: false,
    fromStage: 'new',
    toStage: 'qualified',
    agentId: '',
    provider: 'vobiz'
  };
  res.json({ success: true, rules: [rule] });
});

app.post('/api/crm-rules', express.json(), authMiddleware('calls'), (req, res) => {
  const { enabled, fromStage, toStage, agentId, provider, clientId } = req.body;
  
  const ruleId = clientId || 'default_rule';
  const rule = {
    id: ruleId,
    enabled: enabled !== undefined ? enabled : true,
    fromStage: fromStage || 'new',
    toStage: toStage || 'qualified',
    agentId: agentId || '',
    provider: provider || 'vobiz',
    clientId: clientId || null,
    updatedAt: new Date().toISOString()
  };
  crmRulesDb.set(ruleId, rule);
  saveCrmRules();
  res.json({ success: true, rule });
});

app.get('/api/crm-logs', authMiddleware('calls'), (req, res) => {
  const { clientId } = req.query;
  let logs = Array.from(crmLogsDb.values());
  if (clientId && clientId !== 'admin') {
    logs = logs.filter(l => l.clientId === clientId);
  } else if (clientId === 'admin') {
    logs = logs.filter(l => l.clientId === 'admin' || !l.clientId);
  }
  logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json({ success: true, logs: logs.slice(0, 100) });
});

app.post('/api/webhooks/crm-lead-stage-change', express.json(), authMiddleware('calls'), async (req, res) => {
  const targetClientId = req.query.clientId || req.body.clientId || 'default_rule';
  let leadName = req.body.leadName;
  let leadPhone = req.body.leadPhone;
  let previousStage = req.body.previousStage;
  let currentStage = req.body.currentStage;

  // Extract nested CRM payload if present
  if (req.body.data) {
    const data = req.body.data;
    leadName = data.name || leadName;
    previousStage = data.previous_stage || previousStage;
    currentStage = data.current_stage || currentStage;
    if (data.contact) {
      leadPhone = data.contact.phone || leadPhone;
      if (!leadName && (data.contact.first_name || data.contact.last_name)) {
        leadName = `${data.contact.first_name || ''} ${data.contact.last_name || ''}`.trim();
      }
    }
  }

  console.log(`[CRM Webhook] 📥 Received webhook request for lead: "${leadName || 'Unknown'}" (${leadPhone || 'No Phone'}). Transition: ${previousStage} ➔ ${currentStage} | Client: ${targetClientId}`);

  if (!leadPhone) {
    console.warn(`[CRM Webhook] ⚠️ Ignored request: missing leadPhone parameter.`);
    return res.status(400).json({ success: false, error: 'leadPhone is required in body' });
  }
  
  const rule = crmRulesDb.get(targetClientId) || { enabled: false, fromStage: 'new', toStage: 'qualified' };
  
  const logId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const crmLog = {
    id: logId,
    timestamp: new Date().toISOString(),
    leadName: leadName || 'Unknown Lead',
    leadPhone: leadPhone,
    transition: `${previousStage || '?'} ➔ ${currentStage || '?'}`,
    agentName: 'None',
    status: 'Skipped (Rule disabled or mismatch)',
    callSid: null,
    clientId: targetClientId !== 'default_rule' ? targetClientId : null
  };
  
  const cleanFromInput = (previousStage || '').trim().toLowerCase();
  const cleanToInput = (currentStage || '').trim().toLowerCase();
  const cleanRuleFrom = (rule.fromStage || 'new').trim().toLowerCase();
  const cleanRuleTo = (rule.toStage || 'qualified').trim().toLowerCase();
  
  const isMatch = rule.enabled && 
                  cleanFromInput === cleanRuleFrom && 
                  cleanToInput === cleanRuleTo;
                  
  if (!isMatch) {
    console.log(`[CRM Webhook] 💤 Event skipped. Rule Enabled: ${rule.enabled}. Rule Trigger: ${cleanRuleFrom} ➔ ${cleanRuleTo}. Received: ${cleanFromInput} ➔ ${cleanToInput}`);
    crmLogsDb.set(logId, crmLog);
    saveCrmLogs();
    return res.json({ success: true, message: 'Webhook received. Event skipped.', log: crmLog });
  }
  
  const agent = agentsDb.get(rule.agentId);
  if (!agent) {
    console.error(`[CRM Webhook] ❌ Error: Rule matched but assigned Agent (ID: ${rule.agentId}) was not found in agentsDb.`);
    crmLog.status = 'Failed (Assigned agent not found)';
    crmLogsDb.set(logId, crmLog);
    saveCrmLogs();
    return res.status(400).json({ success: false, error: 'Assigned agent not found', log: crmLog });
  }
  
  crmLog.agentName = agent.name;
  crmLog.status = 'Triggering Call...';
  
  const localCallUrl = `http://localhost:${PORT}/make-call`;
  
  let finalInstruction = agent.systemInstruction;
  if (agent.name) {
    finalInstruction = `[IDENTITY DIRECTIVE: Your name is "${agent.name}". You must introduce yourself as "${agent.name}" and identify as "${agent.name}" if asked for your name. In Hindi/Hinglish, you can say "Mera naam ${agent.name} hai".]\n\n` + finalInstruction;
  }
  if (agent.mood && agent.mood !== 'Professional') {
    finalInstruction = `[MOOD DIRECTIVE: You must act and speak in a ${agent.mood.toUpperCase()} mood at all times.]\n\n` + finalInstruction;
  }
  
  // Append contact context
  finalInstruction += `\n\n[CONTACT CONTEXT] You are talking to: ${leadName || 'a customer'}. Status transition: ${previousStage} ➔ ${currentStage}.`;

  const makeCallPayload = {
    provider: rule.provider || defaultCallConfig.telephonyProvider || 'vobiz',
    to: leadPhone,
    name: leadName || '',
    publicUrl: defaultCallConfig.publicUrl || '',
    voice: agent.voice,
    systemInstruction: finalInstruction,
    recordCall: defaultCallConfig.gemini_record_call === 'true' || defaultCallConfig.recordCall || true,
    model: agent.model || 'gemini-3.1-flash-live-preview',
    clientId: targetClientId !== 'default_rule' ? targetClientId : null,
    
    exotelApiKey: defaultCallConfig.exotelApiKey,
    exotelApiToken: defaultCallConfig.exotelApiToken,
    exotelAccountSid: defaultCallConfig.exotelAccountSid,
    exotelSubdomain: defaultCallConfig.exotelSubdomain || 'api.exotel.com',
    exotelCallerId: defaultCallConfig.exotelCallerId,
    
    vobizAuthId: defaultCallConfig.vobizAuthId,
    vobizAuthToken: defaultCallConfig.vobizAuthToken,
    vobizCallerId: defaultCallConfig.vobizCallerId
  };
  
  console.log(`[CRM Webhook] 🚀 Rule matched! Dispatching outbound call using Agent: "${agent.name}" (${agent.voice}) via Provider: "${makeCallPayload.provider}" to "${leadPhone}". Public URL: "${makeCallPayload.publicUrl || 'MISSING'}"`);
  
  try {
    const callRes = await fetch(localCallUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeCallPayload)
    });
    const callData = await callRes.json();
    if (callData.success) {
      crmLog.status = 'Call Initiated';
      crmLog.callSid = callData.callSid;
    } else {
      crmLog.status = `Call Failed: ${callData.error || 'Unknown Error'}`;
    }
  } catch (err) {
    crmLog.status = `Call Error: ${err.message}`;
    console.error(`[CRM Webhook Automation Error]`, err.message);
  }
  
  crmLogsDb.set(logId, crmLog);
  saveCrmLogs();
  
  res.json({ success: true, log: crmLog });
});

app.post('/api/webhooks/crm-trigger-call', express.json(), authMiddleware('calls'), async (req, res) => {
  const { agentId, leadPhone, leadName, previousStage = '', currentStage = '', leadId, saasApiUrl } = req.body;

  console.log(`[CRM Trigger Call] 📥 Direct trigger call requested. AgentID: ${agentId}, Phone: ${leadPhone}, Name: ${leadName}, LeadID: ${leadId}`);

  if (!leadPhone || !agentId) {
    return res.status(400).json({ success: false, error: 'agentId and leadPhone are required' });
  }

  const agent = agentsDb.get(agentId);
  if (!agent) {
    console.error(`[CRM Trigger Call] ❌ Error: Agent (ID: ${agentId}) not found in agentsDb.`);
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }

  const logId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const crmLog = {
    id: logId,
    timestamp: new Date().toISOString(),
    leadName: leadName || 'Unknown Lead',
    leadPhone: leadPhone,
    transition: `Direct Trigger (${previousStage} ➔ ${currentStage})`,
    agentName: agent.name,
    status: 'Triggering Call...',
    callSid: null
  };

  const localCallUrl = `http://localhost:${PORT}/make-call`;
  
  let finalInstruction = agent.systemInstruction;
  if (agent.name) {
    finalInstruction = `[IDENTITY DIRECTIVE: Your name is "${agent.name}". You must introduce yourself as "${agent.name}" and identify as "${agent.name}" if asked for your name. In Hindi/Hinglish, you can say "Mera naam ${agent.name} hai".]\n\n` + finalInstruction;
  }
  if (agent.mood && agent.mood !== 'Professional') {
    finalInstruction = `[MOOD DIRECTIVE: You must act and speak in a ${agent.mood.toUpperCase()} mood at all times.]\n\n` + finalInstruction;
  }
  
  // Append contact context
  finalInstruction += `\n\n[CONTACT CONTEXT] You are talking to: ${leadName || 'a customer'}.`;
  if (previousStage || currentStage) {
    finalInstruction += ` Status transition: ${previousStage} ➔ ${currentStage}.`;
  }

  const makeCallPayload = {
    provider: defaultCallConfig.telephonyProvider || 'vobiz',
    to: leadPhone,
    name: leadName || '',
    publicUrl: defaultCallConfig.publicUrl || '',
    voice: agent.voice,
    systemInstruction: finalInstruction,
    recordCall: defaultCallConfig.gemini_record_call === 'true' || defaultCallConfig.recordCall || true,
    model: agent.model || 'gemini-3.1-flash-live-preview',
    leadId: leadId || null,
    saasApiUrl: saasApiUrl || null,
    
    exotelApiKey: defaultCallConfig.exotelApiKey,
    exotelApiToken: defaultCallConfig.exotelApiToken,
    exotelAccountSid: defaultCallConfig.exotelAccountSid,
    exotelSubdomain: defaultCallConfig.exotelSubdomain || 'api.exotel.com',
    exotelCallerId: defaultCallConfig.exotelCallerId,
    
    vobizAuthId: defaultCallConfig.vobizAuthId,
    vobizAuthToken: defaultCallConfig.vobizAuthToken,
    vobizCallerId: defaultCallConfig.vobizCallerId
  };

  try {
    const callRes = await fetch(localCallUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeCallPayload)
    });
    const callData = await callRes.json();
    if (callData.success) {
      crmLog.status = 'Call Initiated';
      crmLog.callSid = callData.callSid;
      crmLogsDb.set(logId, crmLog);
      saveCrmLogs();
      return res.json({ success: true, callSid: callData.callSid });
    } else {
      crmLog.status = `Call Failed: ${callData.error || 'Unknown Error'}`;
      crmLogsDb.set(logId, crmLog);
      saveCrmLogs();
      return res.status(500).json({ success: false, error: callData.error });
    }
  } catch (err) {
    crmLog.status = `Call Error: ${err.message}`;
    crmLogsDb.set(logId, crmLog);
    saveCrmLogs();
    console.error(`[CRM Trigger Call Error]`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});


// --- BROADCAST API ---
app.post('/api/broadcast', async (req, res) => {
  const { agentId, groupId, provider, publicUrl } = req.body;
  
  if (!agentId || !groupId || !publicUrl) {
    return res.status(400).json({ success: false, error: 'agentId, groupId, and publicUrl required' });
  }
  
  const agent = agentsDb.get(agentId);
  if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
  
  const contacts = Array.from(contactsDb.values()).filter(c => c.groupId === groupId);
  if (contacts.length === 0) return res.status(400).json({ success: false, error: 'No contacts in this group' });
  
  // Return success immediately and process in background
  res.json({ success: true, totalContacts: contacts.length, message: 'Broadcast started' });
  
  console.log(`[Broadcast] Starting broadcast for Group ${groupId} using Agent ${agent.name} (${contacts.length} contacts)`);
  
  // Create a mood-injected system instruction if mood isn't 'Professional'
  let finalInstruction = agent.systemInstruction;
  if (agent.name) {
    finalInstruction = `[IDENTITY DIRECTIVE: Your name is "${agent.name}". You must introduce yourself as "${agent.name}" and identify as "${agent.name}" if asked for your name. In Hindi/Hinglish, you can say "Mera naam ${agent.name} hai".]\n\n` + finalInstruction;
  }
  if (agent.mood && agent.mood !== 'Professional') {
    finalInstruction = `[MOOD DIRECTIVE: You must act and speak in a ${agent.mood.toUpperCase()} mood at all times.]\n\n` + finalInstruction;
  }
  
  // We will call the existing /make-call logic for each contact with a delay
  // We'll reuse the logic from /make-call but do it directly here using fetch to our own server, 
  // or by abstracting the make-call logic. Since /make-call is an Express route, calling our own localhost is easiest.
  
  const localCallUrl = `http://localhost:${PORT}/make-call`;
  
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    console.log(`[Broadcast] Queuing call to ${contact.phone} (${i+1}/${contacts.length})...`);
    
    // Grab the global configurations since credentials are still stored globally for now
    const globalConfigData = {
      provider: provider || 'vobiz',
      to: contact.phone,
      name: contact.name,
      publicUrl,
      voice: agent.voice,
      systemInstruction: finalInstruction,
      recordCall: defaultCallConfig.recordCall || true,
      
      exotelApiKey: req.body.exotelApiKey,
      exotelApiToken: req.body.exotelApiToken,
      exotelAccountSid: req.body.exotelAccountSid,
      exotelSubdomain: req.body.exotelSubdomain,
      exotelCallerId: req.body.exotelCallerId,
      
      vobizAuthId: req.body.vobizAuthId,
      vobizAuthToken: req.body.vobizAuthToken,
      vobizCallerId: req.body.vobizCallerId
    };
    
    try {
      fetch(localCallUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(globalConfigData)
      }).catch(err => console.error(`[Broadcast Error] Failed calling ${contact.phone}:`, err.message));
    } catch(e) {}
    
    // Wait 5 seconds between each call initiation to prevent rate limiting
    if (i < contacts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  console.log(`[Broadcast] Broadcast for Group ${groupId} completed.`);
});


// ==========================================
// CLIENTS / MULTI-TENANT API
// ==========================================

// Password Hashing Helper
import crypto from 'crypto';
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// 1. Signup Endpoint (Client Onboarding)
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !phone || !password) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }

  // Check if email already exists
  for (const client of clientsDb.values()) {
    if (client.email.toLowerCase() === email.toLowerCase()) {
      return res.status(400).json({ success: false, error: 'Email already registered.' });
    }
  }

  const clientId = `client_${Date.now()}`;
  let subAuthId = 'SA_G0OY05TV'; // Default test sub-account from prompt
  let subAuthToken = 'token_test_subaccount';

  // Attempt to call Vobiz API to create a sub-account
  const masterAuthId = defaultCallConfig.vobizAuthId || process.env.VOBIZ_MASTER_AUTH_ID || 'MA_5VY3LRDW';
  const masterAuthToken = defaultCallConfig.vobizAuthToken || process.env.VOBIZ_MASTER_AUTH_TOKEN;

  if (masterAuthId && masterAuthToken) {
    try {
      console.log(`[Vobiz API] Creating sub-account for: ${email}`);
      const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${masterAuthId.trim()}/Subaccount/`;
      const response = await fetch(vobizUrl, {
        method: 'POST',
        headers: {
          'X-Auth-ID': masterAuthId.trim(),
          'X-Auth-Token': masterAuthToken.trim(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: name,
          email: email,
          phone: phone
        })
      });

      if (response.ok) {
        const data = await response.json();
        subAuthId = data.sub_auth_id || subAuthId;
        subAuthToken = data.sub_auth_token || subAuthToken;
        console.log(`[Vobiz API] Sub-account created successfully: ${subAuthId}`);
      } else {
        console.warn(`[Vobiz API] Failed to create sub-account: ${response.status}. Using test sub-account.`);
      }
    } catch (err) {
      console.error(`[Vobiz API Exception] Using test sub-account:`, err.message);
    }
  } else {
    console.log(`[Vobiz API] Master credentials missing. Using test sub-account: ${subAuthId}`);
  }

  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const currentReseller = getResellerFromHost(host);
  const resellerId = currentReseller ? currentReseller.id : null;

  const tenantId = req.headers['x-tenant-id'] || req.body.tenantId || '';
  const clientData = {
    tenantId: tenantId || null,
    reseller_id: resellerId,
    id: clientId,
    name,
    email,
    password: hashPassword(password),
    vobiz_sub_auth_id: subAuthId,
    vobiz_sub_auth_token: subAuthToken,
    phone_number: null,
    agent_config: {
      system_prompt: defaultCallConfig.systemInstruction || "You are a helpful voice assistant.",
      voice: "Aoede",
      language: "Hinglish"
    },
    status: 'pending_number',
    created_at: new Date().toISOString()
  };


  clientsDb.set(clientId, clientData);
  saveClients();

  res.json({
    success: true,
    client: {
      id: clientId,
      name: clientData.name,
      email: clientData.email,
      phone_number: clientData.phone_number,
      status: clientData.status,
      vobiz_sub_auth_id: clientData.vobiz_sub_auth_id
    }
  });
});

// 2. Login Endpoint
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required.' });
  }

  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const currentReseller = getResellerFromHost(host);

  // 1. Admin login check — Super Admin can ONLY log in on main Callio portal, NOT reseller portals
  const adminEmail = defaultCallConfig.adminEmail || 'admin@callingagent.com';
  const adminPassword = defaultCallConfig.adminPassword || 'admin123';
  const adminName = defaultCallConfig.adminName || 'Admin';

  if (email.toLowerCase() === adminEmail.toLowerCase() && password === adminPassword) {
    if (currentReseller) {
      return res.status(403).json({ success: false, error: 'Super Admin login is not permitted on reseller portals.' });
    }
    return res.json({
      success: true,
      user: { id: 'admin', name: adminName, email: adminEmail, role: 'admin' }
    });
  }

  const hashedPassword = hashPassword(password);

  // 2. Reseller Admin login check
  for (const reseller of resellersDb.values()) {
    if (reseller.email.toLowerCase() === email.toLowerCase() && reseller.password === hashedPassword) {
      if (reseller.status === 'suspended') {
        return res.status(403).json({ success: false, error: 'Your reseller account is suspended.' });
      }
      return res.json({
        success: true,
        user: {
          id: reseller.id,
          name: reseller.name,
          email: reseller.email,
          role: 'reseller',
          status: reseller.status,
          branding: reseller.branding,
          permissions: reseller.permissions
        }
      });
    }
  }

  // 3. Client login check
  const tenantId = req.headers['x-tenant-id'] || req.body.tenantId || '';
  for (const client of clientsDb.values()) {
    if (client.email.toLowerCase() === email.toLowerCase() && client.password === hashedPassword) {
      // Domain isolation check
      if (currentReseller) {
        if (!client.reseller_id) {
          // Auto-migrate client created on this reseller portal before fix
          client.reseller_id = currentReseller.id;
          clientsDb.set(client.id, client);
          saveClients();
          console.log(`[Auto Migration] Linked unassigned client ${client.email} to reseller ${currentReseller.name}`);
        } else if (client.reseller_id !== currentReseller.id) {
          return res.status(403).json({ success: false, error: 'User account does not belong to this portal.' });
        }
      } else {
        // Direct Callio portal — direct clients only
        if (client.reseller_id) {
          return res.status(403).json({ success: false, error: 'Reseller clients must log in on their reseller portal.' });
        }
      }


      if (client.status === 'suspended') {
        return res.status(403).json({ success: false, error: 'Your account is suspended.' });
      }

      if (tenantId && client.tenantId && client.tenantId !== tenantId) {
        return res.status(400).json({ success: false, error: 'User account does not belong to this branding portal.' });
      }
      return res.json({
        success: true,
        user: {
          id: client.id,
          name: client.name,
          email: client.email,
          role: 'client',
          status: client.status,
          phone_number: client.phone_number,
          agent_config: client.agent_config,
          balance: client.balance !== undefined ? client.balance : 500.00,
          plan: client.plan || 'basic',
          used_minutes: client.used_minutes !== undefined ? client.used_minutes : 0.00,
          pricing: client.pricing || { rate_per_minute: 2.00, rate_recording_per_minute: 1.00, rate_per_session: 0.00 },
          billing_history: client.billing_history || []
        }
      });
    }
  }

  res.status(401).json({ success: false, error: 'Invalid email or password.' });
});


// 2A. Update Profile Endpoint (for user/admin profile settings)
app.post('/api/auth/update-profile', (req, res) => {
  const { id, name, email, password } = req.body;
  if (!id || !name || !email) {
    return res.status(400).json({ success: false, error: 'ID, name, and email are required.' });
  }

  if (id === 'admin') {
    try {
      defaultCallConfig.adminName = name;
      defaultCallConfig.adminEmail = email;
      if (password) {
        defaultCallConfig.adminPassword = password;
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultCallConfig, null, 2), 'utf-8');
      console.log(`[Config Sync] Admin profile updated in config.json`);

      return res.json({
        success: true,
        user: {
          id: 'admin',
          name: name,
          email: email,
          role: 'admin'
        }
      });
    } catch (err) {
      console.error('[Admin Profile Update Error]', err);
      return res.status(500).json({ success: false, error: 'Failed to update admin profile.' });
    }
  }

  const client = clientsDb.get(id);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client account not found.' });
  }

  // Check email conflict
  for (const [cId, c] of clientsDb.entries()) {
    if (cId !== id && c.email.toLowerCase() === email.toLowerCase()) {
      return res.status(400).json({ success: false, error: 'Email already registered by another account.' });
    }
  }

  client.name = name;
  client.email = email;
  if (password) {
    client.password = hashPassword(password);
  }

  clientsDb.set(id, client);
  saveClients();

  res.json({
    success: true,
    user: {
      id: client.id,
      name: client.name,
      email: client.email,
      role: 'client',
      status: client.status,
      phone_number: client.phone_number,
      agent_config: client.agent_config,
      balance: client.balance !== undefined ? client.balance : 500.00,
      plan: client.plan || 'basic',
      used_minutes: client.used_minutes !== undefined ? client.used_minutes : 0.00,
      pricing: client.pricing || { rate_per_minute: 2.00, rate_recording_per_minute: 1.00, rate_per_session: 0.00 },
      billing_history: client.billing_history || []
    }
  });
});

// 3. Available Numbers Endpoint
app.get('/api/client/available-numbers', async (req, res) => {
  const masterAuthId = defaultCallConfig.vobizAuthId || 'MA_5VY3LRDW';
  const masterAuthToken = defaultCallConfig.vobizAuthToken;

  const mockNumbers = [
    { number: '+917971442441', type: 'Virtual Mobile', price: '₹500/month', status: 'Available' },
    { number: '+918047492101', type: 'Virtual Mobile', price: '₹500/month', status: 'Available' },
    { number: '+918047492102', type: 'Virtual Mobile', price: '₹500/month', status: 'Available' },
    { number: '+918047492103', type: 'Virtual Mobile', price: '₹500/month', status: 'Available' }
  ];

  if (masterAuthId && masterAuthToken) {
    try {
      const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${masterAuthId.trim()}/AvailableNumber/?country=IN`;
      const response = await fetch(vobizUrl, {
        headers: {
          'X-Auth-ID': masterAuthId.trim(),
          'X-Auth-Token': masterAuthToken.trim()
        }
      });
      if (response.ok) {
        const data = await response.json();
        const numbers = data.objects || data.numbers || [];
        if (numbers.length > 0) {
          return res.json({
            success: true,
            numbers: numbers.map(n => ({
              number: n.number || n.phone_number,
              type: n.type || 'Virtual Mobile',
              price: n.price || '₹500/month',
              status: 'Available'
            }))
          });
        }
      }
    } catch (err) {
      console.error(`[Vobiz Available Numbers Error]`, err.message);
    }
  }

  res.json({ success: true, numbers: mockNumbers });
});

// 4. Request Number Endpoint
app.post('/api/client/request-number', (req, res) => {
  const { clientId, number } = req.body;
  if (!clientId || !number) {
    return res.status(400).json({ success: false, error: 'clientId and number are required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  client.status = 'number_requested';
  client.requested_number = number;
  clientsDb.set(clientId, client);
  saveClients();

  res.json({ success: true, client });
});

// 5. Get Pending Requests (Admin)
app.get('/api/admin/pending-requests', (req, res) => {
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const currentReseller = getResellerFromHost(host);

  const pending = [];
  for (const client of clientsDb.values()) {
    if (client.status === 'number_requested') {
      if (currentReseller && client.reseller_id !== currentReseller.id) continue;
      pending.push(client);
    }
  }
  res.json({ success: true, requests: pending });
});

// 6. Get All Clients (Admin)
app.get('/api/admin/clients', (req, res) => {
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const currentReseller = getResellerFromHost(host);

  let list = Array.from(clientsDb.values());
  if (currentReseller) {
    list = list.filter(c => c.reseller_id === currentReseller.id);
  } else {
    // On main Callio portal, show all clients or direct clients
  }

  const safeList = list.map(c => {
    const { password, ...safeClient } = c;
    return safeClient;
  });
  res.json({ success: true, clients: safeList });
});


// 7. Approve Request Endpoint (Admin)
app.post('/api/admin/approve-request', async (req, res) => {
  const { clientId, action } = req.body;
  if (!clientId || !action) {
    return res.status(400).json({ success: false, error: 'clientId and action are required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  if (action === 'reject') {
    client.status = 'pending_number';
    client.requested_number = null;
    clientsDb.set(clientId, client);
    saveClients();
    return res.json({ success: true, message: 'Request rejected.' });
  }

  const numberToBuy = client.requested_number;
  if (!numberToBuy) {
    return res.status(400).json({ success: false, error: 'No number requested by this client.' });
  }

  const masterAuthId = defaultCallConfig.vobizAuthId || 'MA_5VY3LRDW';
  const masterAuthToken = defaultCallConfig.vobizAuthToken;

  if (masterAuthId && masterAuthToken) {
    try {
      console.log(`[Vobiz API] Purchasing number: ${numberToBuy}`);
      const buyUrl = `https://api.vobiz.ai/api/v1/Account/${masterAuthId.trim()}/Number/`;
      const buyRes = await fetch(buyUrl, {
        method: 'POST',
        headers: {
          'X-Auth-ID': masterAuthId.trim(),
          'X-Auth-Token': masterAuthToken.trim(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ number: numberToBuy })
      });

      if (buyRes.ok) {
        console.log(`[Vobiz API] Number purchased: ${numberToBuy}. Assigning to sub-account: ${client.vobiz_sub_auth_id}`);
        const assignUrl = `https://api.vobiz.ai/api/v1/Account/${masterAuthId.trim()}/Number/${numberToBuy}/Assign/`;
        await fetch(assignUrl, {
          method: 'POST',
          headers: {
            'X-Auth-ID': masterAuthId.trim(),
            'X-Auth-Token': masterAuthToken.trim(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ sub_auth_id: client.vobiz_sub_auth_id })
        });

        const publicUrl = defaultCallConfig.publicUrl || '';
        if (publicUrl) {
          const webhookUrl = `${publicUrl}/incoming-call-vobiz?client_id=${clientId}`;
          console.log(`[Vobiz API] Setting webhook for ${numberToBuy} to ${webhookUrl}`);
          const webhookApiUrl = `https://api.vobiz.ai/api/v1/Account/${masterAuthId.trim()}/Number/${numberToBuy}/`;
          await fetch(webhookApiUrl, {
            method: 'PUT',
            headers: {
              'X-Auth-ID': masterAuthId.trim(),
              'X-Auth-Token': masterAuthToken.trim(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ voice_url: webhookUrl, voice_method: 'POST' })
          });
        }
      }
    } catch (err) {
      console.error(`[Vobiz Purchase/Assign Exception]`, err.message);
    }
  }

  console.log(`[Admin Approval] Approving client ${clientId} for number ${numberToBuy}`);
  client.status = 'active';
  client.phone_number = numberToBuy;
  client.requested_number = null;
  clientsDb.set(clientId, client);
  saveClients();

  res.json({ success: true, client });
});

// 8. Client Dashboard Data
app.get('/api/client/dashboard-data', (req, res) => {
  const { clientId } = req.query;
  if (!clientId) {
    return res.status(400).json({ success: false, error: 'clientId is required.' });
  }

  let client;
  let clientLogs = [];

  if (clientId === 'admin') {
    const adminNum = defaultCallConfig.vobizCallerId || process.env.VOBIZ_CALLER_ID || '+917971442441';
    let assignedToOther = false;
    for (const c of clientsDb.values()) {
      if (c.phone_number && cleanAndComparePhone(c.phone_number, adminNum)) {
        assignedToOther = true;
        break;
      }
    }
    client = {
      id: 'admin',
      name: 'Admin',
      email: 'admin@callingagent.com',
      phone_number: assignedToOther ? null : adminNum,
      status: 'active',
      agent_config: {
        system_prompt: defaultCallConfig.systemInstruction || "You are a helpful voice assistant.",
        voice: defaultCallConfig.voice || 'Aoede',
        language: 'Hinglish'
      }
    };

    for (const call of activeCalls.values()) {
      if (call.clientId === 'admin' || !call.clientId) {
        clientLogs.push(call);
      }
    }
  } else {
    client = clientsDb.get(clientId);
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found.' });
    }

    for (const call of activeCalls.values()) {
      if (call.clientId === clientId || (client.phone_number && (call.to === client.phone_number || call.from === client.phone_number))) {
        clientLogs.push(call);
      }
    }
  }

  res.json({
    success: true,
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      phone_number: client.phone_number,
      status: client.status,
      agent_config: client.agent_config,
      balance: client.balance !== undefined ? client.balance : 500.00,
      plan: client.plan || 'basic',
      used_minutes: client.used_minutes !== undefined ? client.used_minutes : 0.00,
      pricing: client.pricing || { rate_per_minute: 2.00, rate_recording_per_minute: 1.00, rate_per_session: 0.00 },
      billing_history: client.billing_history || []
    },
    calls: clientLogs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  });
});


// 9. Update Client Agent Config
app.post('/api/client/agent-config', (req, res) => {
  const { clientId, system_prompt, voice, language } = req.body;
  if (!clientId) {
    return res.status(400).json({ success: false, error: 'clientId is required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  client.agent_config = {
    system_prompt: system_prompt || client.agent_config.system_prompt,
    voice: voice || client.agent_config.voice,
    language: language || client.agent_config.language
  };

  clientsDb.set(clientId, client);
  saveClients();

  res.json({ success: true, agent_config: client.agent_config });
});

// 10. Admin Billing - Recharge Client Wallet
app.post('/api/admin/recharge', (req, res) => {
  const { clientId, amount } = req.body;
  if (!clientId || amount === undefined) {
    return res.status(400).json({ success: false, error: 'clientId and amount are required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  const rechargeAmount = Number(amount);
  if (isNaN(rechargeAmount) || rechargeAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid recharge amount.' });
  }

  client.balance = Number(((client.balance || 0) + rechargeAmount).toFixed(2));
  client.billing_history = client.billing_history || [];
  client.billing_history.unshift({
    id: `txn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    type: 'recharge',
    amount: rechargeAmount,
    totalCharge: -rechargeAmount, // negative charge means credit
    description: `Wallet recharge of ${rechargeAmount} Mins`
  });

  clientsDb.set(clientId, client);
  saveClients();

  console.log(`[Admin Billing] Client ${client.name} (ID: ${clientId}) wallet recharged with ${rechargeAmount} Mins. New balance: ${client.balance} mins`);
  res.json({ success: true, balance: client.balance, billing_history: client.billing_history });
});

// 10B. Client Self-Recharge Wallet (Simulated)
app.post('/api/client/recharge', express.json(), (req, res) => {
  const { clientId, amount, paymentMethod } = req.body;
  if (!clientId || amount === undefined) {
    return res.status(400).json({ success: false, error: 'clientId and amount are required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  const rechargeAmount = Number(amount);
  if (isNaN(rechargeAmount) || rechargeAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid recharge amount.' });
  }

  const planId = (client.plan || 'basic').toLowerCase();
  const planDetails = plansDb.get(planId);
  const rate = planDetails ? planDetails.rate_per_minute : (planId === 'pro' ? 4.24 : 5.0);
  const cost = rechargeAmount * rate;

  client.balance = Number(((client.balance || 0) + rechargeAmount).toFixed(2));
  client.billing_history = client.billing_history || [];
  client.billing_history.unshift({
    id: `txn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    type: 'recharge',
    amount: rechargeAmount,
    totalCharge: -rechargeAmount, // negative charge means credit
    description: `Wallet Self-Recharge of ${rechargeAmount} Mins via ${paymentMethod || 'UPI'} (Paid ₹${cost.toFixed(2)} at ₹${rate}/min)`
  });

  clientsDb.set(clientId, client);
  saveClients();

  console.log(`[Billing Recharge] Client: ${client.name} (ID: ${clientId}) self-recharged ${rechargeAmount} Mins. New balance: ${client.balance} mins`);
  res.json({ success: true, balance: client.balance, billing_history: client.billing_history });
});

// 10C. Admin API - Get All Transactions
app.get('/api/admin/transactions', (req, res) => {
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const currentReseller = getResellerFromHost(host);

  const allTxns = [];
  for (const client of clientsDb.values()) {
    if (currentReseller && client.reseller_id !== currentReseller.id) continue;
    const history = client.billing_history || [];
    history.forEach(txn => {
      allTxns.push({
        ...txn,
        clientId: client.id,
        clientName: client.name,
        clientEmail: client.email
      });
    });
  }
  // Sort by timestamp descending
  allTxns.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json({ success: true, transactions: allTxns });
});



// 11. Admin Billing - Update Pricing Rates
app.post('/api/admin/update-pricing', (req, res) => {
  const { clientId, rate_per_minute, rate_recording_per_minute, rate_per_session } = req.body;
  if (!clientId) {
    return res.status(400).json({ success: false, error: 'clientId is required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  client.pricing = {
    rate_per_minute: rate_per_minute !== undefined ? Number(rate_per_minute) : (client.pricing?.rate_per_minute || 2.00),
    rate_recording_per_minute: rate_recording_per_minute !== undefined ? Number(rate_recording_per_minute) : (client.pricing?.rate_recording_per_minute || 0.50),
    rate_per_session: rate_per_session !== undefined ? Number(rate_per_session) : (client.pricing?.rate_per_session || 1.00)
  };

  clientsDb.set(clientId, client);
  saveClients();

  console.log(`[Admin Billing] Client ${client.name} (ID: ${clientId}) pricing updated: min=${client.pricing.rate_per_minute}, rec=${client.pricing.rate_recording_per_minute}, sess=${client.pricing.rate_per_session}`);
  res.json({ success: true, pricing: client.pricing });
});

// 11A1. Admin - Advanced Client Update (Plan, Status, Details)
app.post('/api/admin/update-client', (req, res) => {
  const { clientId, plan, status, name, email, phone_number } = req.body;
  if (!clientId) {
    return res.status(400).json({ success: false, error: 'clientId is required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  if (plan !== undefined) {
    client.plan = plan;
    // Dynamically update the client's per-minute pricing rate based on the plan's cost per minute
    const planDetails = plansDb.get(plan.toLowerCase());
    if (planDetails && planDetails.rate_per_minute !== undefined) {
      client.pricing = client.pricing || {};
      client.pricing.rate_per_minute = Number(planDetails.rate_per_minute);
    }
  }
  if (status !== undefined) client.status = status;
  if (name !== undefined) client.name = name;
  if (email !== undefined) {
    // Check conflict
    for (const [cId, c] of clientsDb.entries()) {
      if (cId !== clientId && c.email.toLowerCase() === email.toLowerCase()) {
        return res.status(400).json({ success: false, error: 'Email already in use by another client.' });
      }
    }
    client.email = email;
  }
  if (phone_number !== undefined) client.phone_number = phone_number;

  clientsDb.set(clientId, client);
  saveClients();

  console.log(`[Admin Update Client] Client ${client.name} (ID: ${clientId}) updated: plan=${client.plan}, status=${client.status}`);
  res.json({ success: true, client });
});

// 11A2. Admin - Delete Client
app.post('/api/admin/delete-client', (req, res) => {
  const { clientId } = req.body;
  if (!clientId) {
    return res.status(400).json({ success: false, error: 'clientId is required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  clientsDb.delete(clientId);
  saveClients();

  console.log(`[Admin Delete Client] Client ${client.name} (ID: ${clientId}) deleted.`);
  res.json({ success: true, message: 'Client deleted successfully.' });
});

// 11A3. Plans Database API routes
app.get('/api/plans', (req, res) => {
  const list = Array.from(plansDb.values());
  res.json({ success: true, plans: list });
});

app.post('/api/admin/plans/save', express.json(), (req, res) => {
  const { id, name, price_per_month, max_minutes, max_agents, rate_per_minute, crm_integration, api_sharing, description } = req.body;
  if (!id || !name || price_per_month === undefined) {
    return res.status(400).json({ success: false, error: 'id, name, and price_per_month are required.' });
  }

  const planId = id.trim().toLowerCase();
  const newRate = rate_per_minute !== undefined ? Number(rate_per_minute) : 5;
  const planData = {
    id: planId,
    name: name.trim(),
    price_per_month: Number(price_per_month),
    max_minutes: max_minutes !== undefined ? Number(max_minutes) : 99999,
    max_agents: max_agents !== undefined ? Number(max_agents) : 99999,
    rate_per_minute: newRate,
    crm_integration: !!crm_integration,
    api_sharing: !!api_sharing,
    description: description ? description.trim() : ''
  };

  plansDb.set(planId, planData);
  savePlans();

  // Retroactively sync rate_per_minute for ALL clients currently on this plan
  let updatedCount = 0;
  for (const [, client] of clientsDb.entries()) {
    if ((client.plan || 'basic').toLowerCase() === planId) {
      client.pricing = client.pricing || {};
      client.pricing.rate_per_minute = newRate;
      updatedCount++;
    }
  }
  if (updatedCount > 0) {
    saveClients();
    console.log(`[Admin Plans] Synced rate ₹${newRate}/min to ${updatedCount} client(s) on plan: ${planId}`);
  }

  console.log(`[Admin Plans] Saved plan: ${planId} (${planData.name})`);
  res.json({ success: true, plan: planData });
});

app.post('/api/admin/plans/delete', express.json(), (req, res) => {
  const { planId } = req.body;
  if (!planId) {
    return res.status(400).json({ success: false, error: 'planId is required.' });
  }
  const cleanId = planId.trim().toLowerCase();
  if (cleanId === 'basic') {
    return res.status(400).json({ success: false, error: 'Cannot delete the fallback Basic Plan.' });
  }
  if (!plansDb.has(cleanId)) {
    return res.status(404).json({ success: false, error: 'Plan not found.' });
  }

  plansDb.delete(cleanId);
  savePlans();
  console.log(`[Admin Plans] Deleted plan: ${cleanId}`);
  res.json({ success: true, message: 'Plan deleted successfully.' });
});

// 11B. Client Plan Subscription Endpoint (Simulated)
app.post('/api/client/subscribe-plan', express.json(), (req, res) => {
  const { clientId, plan, amount, paymentMethod } = req.body;
  if (!clientId || !plan || amount === undefined) {
    return res.status(400).json({ success: false, error: 'clientId, plan, and amount are required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  client.plan = plan;
  // Dynamically update the client's per-minute pricing rate based on the plan's cost per minute
  const planDetails = plansDb.get(plan.toLowerCase());
  if (planDetails && planDetails.rate_per_minute !== undefined) {
    client.pricing = client.pricing || {};
    client.pricing.rate_per_minute = Number(planDetails.rate_per_minute);
  }
  // Reset used minutes if subscribing/changing plan, or we can keep it as is.
  client.used_minutes = 0.00;
  if (planDetails) {
    client.balance = Number(planDetails.max_minutes);
  }
  
  client.billing_history = client.billing_history || [];
  client.billing_history.unshift({
    id: `txn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    type: 'recharge',
    amount: planDetails ? planDetails.max_minutes : 100,
    totalCharge: planDetails ? -planDetails.max_minutes : -100, // Negative means credit/subscription payment simulated
    description: `Subscribed to ${plan.toUpperCase()} Plan via ${paymentMethod || 'UPI'} (${planDetails ? planDetails.max_minutes : 100} Mins credited)`
  });

  clientsDb.set(clientId, client);
  saveClients();

  console.log(`[Plan Subscription] Client ${client.name} (ID: ${clientId}) subscribed to ${plan} plan. Mins credited: ${planDetails ? planDetails.max_minutes : 100}.`);
  res.json({ success: true, plan: client.plan, balance: client.balance, billing_history: client.billing_history });
});

// 12. Client Billing - Fetch Billing Summary & Transactions
app.get('/api/client/billing', (req, res) => {
  const { clientId } = req.query;
  if (!clientId) {
    return res.status(400).json({ success: false, error: 'clientId query parameter is required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  res.json({
    success: true,
    balance: client.balance !== undefined ? client.balance : 500.00,
    plan: client.plan || 'basic',
    used_minutes: client.used_minutes !== undefined ? client.used_minutes : 0.00,
    pricing: client.pricing || { rate_per_minute: 2.00, rate_recording_per_minute: 1.00, rate_per_session: 0.00 },
    billing_history: client.billing_history || []
  });
});


// ============================================================
//  WHITELABEL RESELLER SYSTEM
// ============================================================

const RESELLERS_DB_FILE = './resellers_db.json';
const resellersDb = new Map();

function loadResellers() { loadDatabase(RESELLERS_DB_FILE, resellersDb); }
function saveResellers() { saveDatabase(RESELLERS_DB_FILE, resellersDb); }
loadResellers();

// Middleware: validate reseller session token (simple token = resellerId)
function resellerAuthMiddleware(req, res, next) {
  const token = req.headers['x-reseller-token'] || req.query.reseller_token;
  if (!token) return res.status(401).json({ success: false, error: 'Reseller auth required.' });
  const reseller = resellersDb.get(token);
  if (!reseller) return res.status(401).json({ success: false, error: 'Invalid reseller token.' });
  if (reseller.status === 'suspended') return res.status(403).json({ success: false, error: 'Reseller account is suspended.' });
  req.reseller = reseller;
  next();
}

// Helper: check if reseller has permission
function resellerCan(reseller, permission) {
  return reseller.permissions && reseller.permissions[permission] === true;
}

// Helper: get all clients belonging to a reseller
function getResellerClients(resellerId) {
  const clients = [];
  for (const client of clientsDb.values()) {
    if (client.reseller_id === resellerId) clients.push(client);
  }
  return clients;
}

// ─── SUPER ADMIN — Reseller Management ───────────────────────────────────────

// GET all resellers
app.get('/api/admin/resellers', express.json(), (req, res) => {
  const adminPassword = defaultCallConfig.adminPassword || 'admin123';
  const authHeader = req.headers['x-admin-password'] || req.query.admin_password;
  if (authHeader !== adminPassword) return res.status(401).json({ success: false, error: 'Admin auth required.' });

  const list = Array.from(resellersDb.values()).map(r => ({
    id: r.id,
    name: r.name,
    email: r.email,
    status: r.status,
    domain: r.domain || '',
    subdomain: r.subdomain || '',
    created_at: r.created_at,
    quota: r.quota,
    permissions: r.permissions,
    branding: r.branding,
    client_count: getResellerClients(r.id).length
  }));
  res.json({ success: true, resellers: list });
});

// POST create reseller
app.post('/api/admin/resellers', express.json(), (req, res) => {
  const adminPassword = defaultCallConfig.adminPassword || 'admin123';
  if (req.body.admin_password !== adminPassword) return res.status(401).json({ success: false, error: 'Admin auth required.' });

  const { name, email, password, domain, subdomain } = req.body;
  if (!name || !email || !password) return res.status(400).json({ success: false, error: 'name, email, password required.' });

  // Check duplicate email
  for (const r of resellersDb.values()) {
    if (r.email.toLowerCase() === email.toLowerCase()) {
      return res.status(400).json({ success: false, error: 'Reseller with this email already exists.' });
    }
  }

  const id = 'reseller_' + Date.now();
  const reseller = {
    id,
    name,
    email,
    password: hashPassword(password),
    status: 'active',
    created_at: new Date().toISOString(),
    domain: domain || '',
    subdomain: subdomain || (name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.callio.in'),
    branding: {
      appName: name,
      logoUrl: '',
      faviconUrl: '',
      primaryColor: '#FF6B4A',
      secondaryColor: '#ae3115',
      supportEmail: email,
      copyrightText: `© ${new Date().getFullYear()} ${name}. All rights reserved.`
    },
    landing_page: {
      enabled: true,
      headline: 'AI Calling Agents That Actually Close Deals',
      subheadline: 'Not basic call bots — AI agents that manage tasks, nurture leads, and drive conversions on every call.',
      cta_text: 'Get Started Today',
      features: [],
      custom_css: ''
    },
    permissions: {
      can_add_clients: true,
      max_clients: 10,
      can_set_pricing: true,
      can_use_crm: true,
      can_use_recording: true,
      can_use_api: false,
      can_edit_landing_page: true,
      can_use_custom_domain: false,
      show_callio_branding: true,
      can_view_call_transcripts: true
    },
    quota: {
      total_minutes: 1000,
      used_minutes: 0,
      wholesale_rate_per_minute: 2.0
    },
    billing_history: []
  };

  resellersDb.set(id, reseller);
  saveResellers();
  console.log(`[Reseller] Created reseller: ${name} (${id})`);
  res.json({ success: true, reseller: { ...reseller, password: undefined } });
});

// PUT update reseller details
app.put('/api/admin/resellers/:id', express.json(), (req, res) => {
  const adminPassword = defaultCallConfig.adminPassword || 'admin123';
  if (req.body.admin_password !== adminPassword) return res.status(401).json({ success: false, error: 'Admin auth required.' });

  const reseller = resellersDb.get(req.params.id);
  if (!reseller) return res.status(404).json({ success: false, error: 'Reseller not found.' });

  const { name, email, password, domain, subdomain, status } = req.body;
  if (name) reseller.name = name;
  if (email) reseller.email = email;
  if (password) reseller.password = hashPassword(password);
  if (domain !== undefined) reseller.domain = domain;
  if (subdomain !== undefined) reseller.subdomain = subdomain;
  if (status) reseller.status = status;

  resellersDb.set(reseller.id, reseller);
  saveResellers();
  res.json({ success: true, reseller: { ...reseller, password: undefined } });
});

// PUT update reseller permissions
app.put('/api/admin/resellers/:id/permissions', express.json(), (req, res) => {
  const adminPassword = defaultCallConfig.adminPassword || 'admin123';
  if (req.body.admin_password !== adminPassword) return res.status(401).json({ success: false, error: 'Admin auth required.' });

  const reseller = resellersDb.get(req.params.id);
  if (!reseller) return res.status(404).json({ success: false, error: 'Reseller not found.' });

  reseller.permissions = { ...reseller.permissions, ...req.body.permissions };
  resellersDb.set(reseller.id, reseller);
  saveResellers();
  res.json({ success: true, permissions: reseller.permissions });
});

// PUT update reseller quota & wholesale rate (Super Admin only)
app.put('/api/admin/resellers/:id/quota', express.json(), (req, res) => {
  const adminPassword = defaultCallConfig.adminPassword || 'admin123';
  if (req.body.admin_password !== adminPassword) return res.status(401).json({ success: false, error: 'Admin auth required.' });

  const reseller = resellersDb.get(req.params.id);
  if (!reseller) return res.status(404).json({ success: false, error: 'Reseller not found.' });

  if (req.body.total_minutes !== undefined) reseller.quota.total_minutes = Number(req.body.total_minutes);
  if (req.body.wholesale_rate_per_minute !== undefined) reseller.quota.wholesale_rate_per_minute = Number(req.body.wholesale_rate_per_minute);

  resellersDb.set(reseller.id, reseller);
  saveResellers();
  res.json({ success: true, quota: reseller.quota });
});

// PUT suspend or activate reseller
app.put('/api/admin/resellers/:id/status', express.json(), (req, res) => {
  const adminPassword = defaultCallConfig.adminPassword || 'admin123';
  if (req.body.admin_password !== adminPassword) return res.status(401).json({ success: false, error: 'Admin auth required.' });

  const reseller = resellersDb.get(req.params.id);
  if (!reseller) return res.status(404).json({ success: false, error: 'Reseller not found.' });

  reseller.status = req.body.status === 'suspended' ? 'suspended' : 'active';
  resellersDb.set(reseller.id, reseller);
  saveResellers();
  res.json({ success: true, status: reseller.status });
});

// DELETE reseller (only if no clients)
app.delete('/api/admin/resellers/:id', express.json(), (req, res) => {
  const adminPassword = defaultCallConfig.adminPassword || 'admin123';
  const authParam = req.body.admin_password || req.query.admin_password;
  if (authParam !== adminPassword) return res.status(401).json({ success: false, error: 'Admin auth required.' });

  const reseller = resellersDb.get(req.params.id);
  if (!reseller) return res.status(404).json({ success: false, error: 'Reseller not found.' });

  const clients = getResellerClients(req.params.id);
  if (clients.length > 0) return res.status(400).json({ success: false, error: `Cannot delete reseller with ${clients.length} active client(s). Remove or reassign them first.` });

  resellersDb.delete(req.params.id);
  saveResellers();
  res.json({ success: true });
});

// GET reseller's clients (admin oversight)
app.get('/api/admin/resellers/:id/clients', (req, res) => {
  const adminPassword = defaultCallConfig.adminPassword || 'admin123';
  if ((req.query.admin_password || req.headers['x-admin-password']) !== adminPassword) {
    return res.status(401).json({ success: false, error: 'Admin auth required.' });
  }

  const reseller = resellersDb.get(req.params.id);
  if (!reseller) return res.status(404).json({ success: false, error: 'Reseller not found.' });

  const clients = getResellerClients(req.params.id).map(c => ({
    id: c.id, name: c.name, email: c.email, status: c.status,
    balance: c.balance, used_minutes: c.used_minutes || 0,
    plan: c.plan, created_at: c.created_at
  }));
  res.json({ success: true, clients });
});

// ─── RESELLER AUTH ────────────────────────────────────────────────────────────

// POST reseller login
app.post('/api/reseller/login', express.json(), (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required.' });

  const hashed = hashPassword(password);
  for (const reseller of resellersDb.values()) {
    if (reseller.email.toLowerCase() === email.toLowerCase() && reseller.password === hashed) {
      if (reseller.status === 'suspended') {
        return res.status(403).json({ success: false, error: 'Your account has been suspended. Contact support.' });
      }
      return res.json({
        success: true,
        token: reseller.id,  // simple token = resellerId
        reseller: {
          id: reseller.id,
          name: reseller.name,
          email: reseller.email,
          branding: reseller.branding,
          domain: reseller.domain,
          subdomain: reseller.subdomain,
          permissions: reseller.permissions,
          quota: {
            total_minutes: reseller.quota.total_minutes,
            used_minutes: reseller.quota.used_minutes
            // wholesale_rate NOT sent to reseller
          }
        }
      });
    }
  }
  res.status(401).json({ success: false, error: 'Invalid email or password.' });
});

// GET reseller profile & stats
app.get('/api/reseller/me', resellerAuthMiddleware, (req, res) => {
  const reseller = req.reseller;
  const clients = getResellerClients(reseller.id);
  const totalCallsAcrossClients = Array.from(activeCalls.values())
    .filter(c => clients.some(cl => cl.id === c.clientId)).length;

  res.json({
    success: true,
    reseller: {
      id: reseller.id,
      name: reseller.name,
      email: reseller.email,
      status: reseller.status,
      domain: reseller.domain,
      subdomain: reseller.subdomain,
      branding: reseller.branding,
      landing_page: reseller.landing_page,
      permissions: reseller.permissions,
      quota: {
        total_minutes: reseller.quota.total_minutes,
        used_minutes: reseller.quota.used_minutes,
        remaining_minutes: reseller.quota.total_minutes - reseller.quota.used_minutes
      }
    },
    stats: {
      total_clients: clients.length,
      active_clients: clients.filter(c => c.status === 'active').length,
      total_calls: totalCallsAcrossClients
    }
  });
});

// PUT reseller branding update
app.put('/api/reseller/branding', express.json(), resellerAuthMiddleware, (req, res) => {
  const reseller = req.reseller;
  const { appName, logoUrl, faviconUrl, primaryColor, secondaryColor, supportEmail, copyrightText } = req.body;

  reseller.branding = {
    appName: appName || reseller.branding.appName,
    logoUrl: logoUrl !== undefined ? logoUrl : reseller.branding.logoUrl,
    faviconUrl: faviconUrl !== undefined ? faviconUrl : reseller.branding.faviconUrl,
    primaryColor: primaryColor || reseller.branding.primaryColor,
    secondaryColor: secondaryColor || reseller.branding.secondaryColor,
    supportEmail: supportEmail || reseller.branding.supportEmail,
    copyrightText: copyrightText || reseller.branding.copyrightText
  };

  resellersDb.set(reseller.id, reseller);
  saveResellers();
  res.json({ success: true, branding: reseller.branding });
});

// PUT reseller landing page update
app.put('/api/reseller/landing-page', express.json(), resellerAuthMiddleware, (req, res) => {
  const reseller = req.reseller;
  if (!resellerCan(reseller, 'can_edit_landing_page')) {
    return res.status(403).json({ success: false, error: 'Landing page editing not permitted for your account.' });
  }

  reseller.landing_page = { ...reseller.landing_page, ...req.body };
  resellersDb.set(reseller.id, reseller);
  saveResellers();
  res.json({ success: true, landing_page: reseller.landing_page });
});

// ─── RESELLER CLIENT MANAGEMENT ───────────────────────────────────────────────

// GET reseller's own clients
app.get('/api/reseller/clients', resellerAuthMiddleware, (req, res) => {
  const clients = getResellerClients(req.reseller.id).map(c => ({
    id: c.id, name: c.name, email: c.email, status: c.status,
    balance: c.balance, used_minutes: c.used_minutes || 0,
    plan: c.plan, created_at: c.created_at, phone_number: c.phone_number,
    pricing: c.pricing
  }));
  res.json({ success: true, clients });
});

// POST create client under reseller
app.post('/api/reseller/clients', express.json(), resellerAuthMiddleware, (req, res) => {
  const reseller = req.reseller;
  if (!resellerCan(reseller, 'can_add_clients')) {
    return res.status(403).json({ success: false, error: 'Adding clients is not permitted for your account.' });
  }

  const currentClients = getResellerClients(reseller.id);
  if (currentClients.length >= (reseller.permissions.max_clients || 10)) {
    return res.status(400).json({ success: false, error: `Client limit reached (max ${reseller.permissions.max_clients || 10}).` });
  }

  const { name, email, password, phone_number } = req.body;
  if (!name || !email || !password) return res.status(400).json({ success: false, error: 'name, email, password required.' });

  // Check duplicate
  for (const c of clientsDb.values()) {
    if (c.email.toLowerCase() === email.toLowerCase()) {
      return res.status(400).json({ success: false, error: 'A client with this email already exists.' });
    }
  }

  const clientId = 'client_' + Date.now();
  const defaultRate = 5.0; // default client rate — reseller can change
  const newClient = {
    id: clientId,
    name,
    email,
    password: hashPassword(password),
    phone_number: phone_number || '',
    status: 'active',
    reseller_id: reseller.id,
    created_at: new Date().toISOString(),
    balance: 0,
    used_minutes: 0,
    plan: 'basic',
    pricing: {
      rate_per_minute: defaultRate,
      rate_recording_per_minute: 1.0,
      rate_per_session: 0.0
    },
    billing_history: [],
    agent_config: {
      system_prompt: 'You are a helpful AI assistant.',
      voice: 'Aoede',
      language: 'English'
    }
  };

  clientsDb.set(clientId, newClient);
  saveClients();
  console.log(`[Reseller] ${reseller.name} created client: ${name} (${clientId})`);
  res.json({ success: true, client: { ...newClient, password: undefined } });
});

// PUT update client (by reseller)
app.put('/api/reseller/clients/:id', express.json(), resellerAuthMiddleware, (req, res) => {
  const reseller = req.reseller;
  const client = clientsDb.get(req.params.id);
  if (!client || client.reseller_id !== reseller.id) {
    return res.status(404).json({ success: false, error: 'Client not found or not in your account.' });
  }

  const { name, email, status, balance, pricing, agent_config } = req.body;
  if (name) client.name = name;
  if (email) client.email = email;
  if (status) client.status = status;
  if (balance !== undefined) client.balance = Number(balance);
  if (pricing && resellerCan(reseller, 'can_set_pricing')) {
    client.pricing = { ...client.pricing, ...pricing };
  }
  if (agent_config) client.agent_config = { ...client.agent_config, ...agent_config };

  clientsDb.set(client.id, client);
  saveClients();
  res.json({ success: true, client: { ...client, password: undefined } });
});

// DELETE client (by reseller)
app.delete('/api/reseller/clients/:id', express.json(), resellerAuthMiddleware, (req, res) => {
  const reseller = req.reseller;
  const client = clientsDb.get(req.params.id);
  if (!client || client.reseller_id !== reseller.id) {
    return res.status(404).json({ success: false, error: 'Client not found or not in your account.' });
  }

  clientsDb.delete(req.params.id);
  saveClients();
  res.json({ success: true });
});

// GET reseller stats dashboard
app.get('/api/reseller/stats', resellerAuthMiddleware, (req, res) => {
  const reseller = req.reseller;
  const clients = getResellerClients(reseller.id);

  const totalCalls = Array.from(activeCalls.values())
    .filter(c => clients.some(cl => cl.id === c.clientId));
  const completedCalls = totalCalls.filter(c => c.status === 'completed');

  res.json({
    success: true,
    stats: {
      total_clients: clients.length,
      active_clients: clients.filter(c => c.status === 'active').length,
      total_calls: totalCalls.length,
      completed_calls: completedCalls.length,
      quota_used: reseller.quota.used_minutes,
      quota_total: reseller.quota.total_minutes,
      quota_remaining: reseller.quota.total_minutes - reseller.quota.used_minutes
    }
  });
});

// ─── PUBLIC: Reseller Landing Page API ───────────────────────────────────────

// GET reseller branding by domain (for public landing page)
app.get('/api/public/reseller-branding', (req, res) => {
  const host = req.query.domain || req.headers.host || '';
  const hostname = host.split(':')[0].toLowerCase();

  for (const reseller of resellersDb.values()) {
    if (reseller.status !== 'active') continue;
    if ((reseller.domain && reseller.domain.toLowerCase() === hostname) ||
        (reseller.subdomain && reseller.subdomain.toLowerCase() === hostname)) {
      return res.json({
        success: true,
        isReseller: true,
        resellerId: reseller.id,
        branding: reseller.branding,
        landing_page: reseller.landing_page,
        permissions: { show_callio_branding: reseller.permissions.show_callio_branding }
      });
    }
  }
  res.json({ success: true, isReseller: false });
});

// ─── LOGIN EXTENSION: Reseller login added to existing /api/auth/login ───────
// Already handled in the existing route — resellers use /api/reseller/login separately.

// ─── BILLING: Deduct from reseller quota when their client call ends ──────────
// This hooks into the existing client billing flow.
// Called from the call end logic — we monkey-patch it here.
const _originalSaveClients = saveClients;
function chargeResellerForCall(clientId, durationMinutes) {
  const client = clientsDb.get(clientId);
  if (!client || !client.reseller_id) return;

  const reseller = resellersDb.get(client.reseller_id);
  if (!reseller) return;

  const wholesaleRate = reseller.quota.wholesale_rate_per_minute || 2.0;
  const charge = Math.ceil(durationMinutes) * wholesaleRate;

  reseller.quota.used_minutes = (reseller.quota.used_minutes || 0) + Math.ceil(durationMinutes);
  reseller.billing_history = reseller.billing_history || [];
  reseller.billing_history.unshift({
    id: 'rtxn_' + Date.now(),
    timestamp: new Date().toISOString(),
    clientId,
    clientName: client.name,
    duration_minutes: Math.ceil(durationMinutes),
    wholesale_rate: wholesaleRate,
    total_charge: charge,
    description: `Call by client ${client.name} — ${Math.ceil(durationMinutes)} min @ ₹${wholesaleRate}/min`
  });

  resellersDb.set(reseller.id, reseller);
  saveResellers();
  console.log(`[Reseller Billing] Charged ${reseller.name}: ${Math.ceil(durationMinutes)} min, ₹${charge} wholesale for client ${client.name}`);
}

// Export for use in billing code
global.chargeResellerForCall = chargeResellerForCall;

// ─── END RESELLER SYSTEM ──────────────────────────────────────────────────────

const server = createServer(app);


// 2. WebSocket Server for Telephony Streams
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  if (pathname === '/api/trial-live-ws') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const count = trialLimits.get(ip) || 0;

    // Enforce IP trial limit only if admin has enabled it
    if (defaultCallConfig.trialLimitEnabled && count >= 2) {
      console.warn(`[Browser Trial WS] Trial call blocked for IP ${ip} (limit reached).`);
      ws.send(JSON.stringify({ error: 'You have reached the maximum of 2 trial calls for this IP.' }));
      ws.close(4029, 'Trial limit reached');
      return;
    }
    
    if (defaultCallConfig.trialLimitEnabled) {
      trialLimits.set(ip, count + 1);
      saveTrialLimits();
      console.log(`[Browser Trial WS] IP ${ip} trial count incremented to ${count + 1}`);
    } else {
      console.log(`[Browser Trial WS] Trial limits OFF. IP ${ip} connecting freely.`);
    }

    const queryVoice = urlObj.searchParams.get('voice') || 'Aoede';
    const queryInstruction = urlObj.searchParams.get('prompt') || defaultCallConfig.systemInstruction || 'You are a helpful assistant.';

    const femaleVoices = ['Aoede', 'Kore', 'Puck', 'Leda', 'Callirrhoe', 'Autonoe', 'Despina', 'Erinome', 'Laomedeia', 'Achernar', 'Pulcherrima', 'Vindemiatrix', 'Sulafat'];
    const queryGender = femaleVoices.includes(queryVoice) ? 'female' : 'male';

    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
    let geminiWs;
    try {
      geminiWs = new WebSocket(geminiUrl);
    } catch (err) {
      console.error('[Browser Trial WS] Gemini WS init failed:', err.message);
      ws.send(JSON.stringify({ error: 'Failed to connect to AI engine.' }));
      ws.close();
      return;
    }

    geminiWs.on('open', () => {
      console.log('[Browser Trial WS] Connected to Gemini Live API. Sending setup...');

      // Build gender-appropriate persona instruction with rich emotional tone guidelines
      const emotionRules = `
[EXPRESSIVE TONE & EMOTIONS RULES]:
You are not a standard text-to-speech engine. You are a highly emotional, expressive conversational agent. The voice synthesizer reads your words and punctuation to render your pitch, speed, and emotion.
Follow these rules strictly to sound completely human, lively, and emotional:
1. Use expressive Hinglish interjections and fillers to trigger the voice engine's pitch changes:
   - When the user shares good news or exciting things: Use high-energy, happy interjections like: "Arey waah! 🎉", "Arey waah, batao batao! 😍", "Sach mein?! Mast yaar!", "Arey waah, yeh toh bahut badhiya khabar hai!"
   - When the user is frustrated, disappointed, or says "arey yaar": Respond with empathetic concern and tone drops: "Arey yaar... kya hua?", "Oh ho... kya ho gaya?", "Arey re... yeh toh bada ajeeb hai."
   - When joking or laughing: Use explicit textual laughter: "haha!", "hehe!", "kya baat hai yaar, mast joke tha!"
   - When thinking or pausing: Use "Hmm...", "Achha...", "Waise..." to make pauses sound natural.
2. Use dynamic punctuation:
   - Exclamation marks (!) for excitement, surprise, or high energy.
   - Question marks (?) to show genuine curiosity.
   - Ellipses (...) for thoughtful pauses or empathetic concern.
3. Be conversational: Speak like a warm, supportive, and active friend. Do not use robotic or too polite phrasing. Speak in casual everyday colloquial Hinglish.
\n\n`;

      const genderPrefix = queryGender === 'male'
        ? `[PERSONA]: You are a male AI voice assistant named Callio. You MUST always speak in first person as a male. In Hindi/Hinglish, always use masculine verb forms (e.g., "bol raha hoon", "kar raha hoon", "sun raha hoon", "ja raha hoon"). Never use feminine forms. You are confident, warm, and professional.\n\n`
        : `[PERSONA]: You are a female AI voice assistant named Callio. You MUST always speak in first person as a female. In Hindi/Hinglish, always use feminine verb forms (e.g., "bol rahi hoon", "kar rahi hoon", "sun rahi hoon", "ja rahi hoon"). Never use masculine forms. You are warm, friendly, and professional.\n\n`;
      const finalInstruction = genderPrefix + emotionRules + queryInstruction;

      const setupMessage = {
        setup: {
          model: 'models/gemini-3.1-flash-live-preview',
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: queryVoice
                }
              }
            }
          },
          systemInstruction: {
            parts: [{ text: finalInstruction }]
          },
          // Send both camelCase and snake_case to guarantee compatibility across all environments
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          input_audio_transcription: {},
          output_audio_transcription: {}
        }
      };
      geminiWs.send(JSON.stringify(setupMessage));
    });

    // Collect transcript for post-call summary
    const conversationLog = [];

    geminiWs.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        console.log('[Browser Trial WS] Received from Gemini:', Object.keys(parsed), data.toString().substring(0, 200));
        // Collect transcription lines for summary from the serverContent object
        if (parsed.serverContent) {
          if (parsed.serverContent.outputTranscription?.text) {
            conversationLog.push({ role: 'Callio AI', text: parsed.serverContent.outputTranscription.text });
          }
          if (parsed.serverContent.inputTranscription?.text) {
            conversationLog.push({ role: 'User', text: parsed.serverContent.inputTranscription.text });
          }
        }
      } catch(e) {}
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data.toString());
      }
    });

    async function generateTrialSummary(log) {
      if (!log || log.length === 0) return null;
      const transcript = log.map(l => `${l.role}: ${l.text}`).join('\n');
      const prompt = `You are a helpful assistant. Below is a transcript of a short live voice demo conversation between a user and an AI voice assistant called "Callio AI". Write a 2-3 sentence friendly summary of what was discussed. Be concise and natural.\n\nTranscript:\n${transcript}\n\nSummary:`;
      try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] })
        });
        const json = await resp.json();
        return json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
      } catch(e) {
        console.error('[Browser Trial WS] Summary generation failed:', e.message);
        return null;
      }
    }

    geminiWs.on('close', async (code, reason) => {
      console.log(`[Browser Trial WS] Gemini WS closed. Code: ${code}, Reason: ${reason}`);
      // Generate and send summary before closing client WS
      if (conversationLog.length > 0 && ws.readyState === WebSocket.OPEN) {
        const summary = await generateTrialSummary(conversationLog);
        if (summary && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ callSummary: summary }));
          await new Promise(r => setTimeout(r, 200)); // give client time to receive
        }
      }
      ws.close();
    });

    geminiWs.on('error', (err) => {
      console.error('[Browser Trial WS] Gemini WS error:', err.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ error: 'AI engine error occurred.' }));
      }
      ws.close();
    });

    ws.on('message', (message) => {
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(message.toString());
      }
    });

    ws.on('close', () => {
      console.log('[Browser Trial WS] Client browser connection closed.');
      if (geminiWs && (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING)) {
        geminiWs.close();
      }
    });

    ws.on('error', (err) => {
      console.error('[Browser Trial WS] Client WS error:', err.message);
      if (geminiWs && (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING)) {
        geminiWs.close();
      }
    });

    return;
  }

  const provider = urlObj.searchParams.get('provider') || 'twilio';
  ws.provider = provider;
  const queryVoice = urlObj.searchParams.get('voice') || 'Aoede';
  const queryInstruction = urlObj.searchParams.get('systemInstruction') || "You are a helpful, extremely polite, and friendly voice assistant. Speak naturally, keep your answers relatively concise, and feel free to converse in Hinglish or English depending on how the user greets you.";
  
  console.log(`Incoming call stream connected from ${provider === 'exotel' ? 'Exotel' : (provider === 'vobiz' ? 'Vobiz' : 'Twilio')}.`);
  
  let streamSid = null;
  let activeCallSid = null;
  let geminiWs = null;
  let isGeminiReady = false;
  
  // Outer scope references for call-scoped inactivity tracking
  let agentSpeakingUntil = Date.now();
  let resetInactivityTimer = () => {};
  
  function sendAudioToGemini(base64Pcm16) {
    const audioMessage = {
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: base64Pcm16
        }
      }
    };
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.send(JSON.stringify(audioMessage));
    }
  }

  function initializeGemini(voice, systemInstruction, name = '', callSid = '', model = 'gemini-3.1-flash-live-preview') {
    let inactivityTimeout = null;
    agentSpeakingUntil = Date.now();
    
    resetInactivityTimer = function() {
      if (inactivityTimeout) {
        clearTimeout(inactivityTimeout);
      }
      const now = Date.now();
      const delay = Math.max(10000, (agentSpeakingUntil - now) + 10000);
      
      inactivityTimeout = setTimeout(() => {
        console.log(`[Inactivity Timeout] User silent for 10s on CallSid: ${callSid}. Triggering automated farewell...`);
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          const timeoutGreeting = {
            clientContent: {
              turns: [
                {
                  role: "user",
                  parts: [{ text: "The user has been silent for 10 seconds. Say a quick polite goodbye in Hinglish and hang up the call using the hangupCall tool." }]
                }
              ],
              turnComplete: true
            }
          };
          geminiWs.send(JSON.stringify(timeoutGreeting));
        }
      }, delay);
    };

    const femaleVoices = ['Aoede', 'Kore', 'Puck', 'Leda', 'Callirrhoe', 'Autonoe', 'Despina', 'Erinome', 'Laomedeia', 'Achernar', 'Pulcherrima', 'Vindemiatrix', 'Sulafat'];
    const isFemale = femaleVoices.includes(voice);
    const genderRule = isFemale
      ? "You have a female voice. In Hindi/Hinglish, you must ALWAYS use feminine verb inflections (e.g., 'bol rahi hoon', 'kar rahi hoon', 'samajh rahi hoon', 'sun rahi hoon') and NEVER use masculine verb inflections like 'raha'."
      : "You have a male voice. In Hindi/Hinglish, you must ALWAYS use masculine verb inflections (e.g., 'bol raha hoon', 'kar raha hoon', 'samajh raha hoon', 'sun raha hoon') and NEVER use feminine verb inflections like 'rahi'.";
      
    let greetingInstruction = '';
    const cleanName = name ? name.trim() : '';
    const isPhoneNumber = /^[+\d\s\-\(\)]+$/.test(cleanName);
    const isDefaultLead = cleanName.toLowerCase() === 'saas lead' || cleanName.toLowerCase() === 'saas' || cleanName.toLowerCase() === 'customer' || cleanName.toLowerCase() === 'a customer';
    
    if (cleanName && !isPhoneNumber && !isDefaultLead) {
      const callState = activeCalls.get(callSid);
      const direction = (callState && callState.direction) || 'incoming';
      const firstName = getFirstName(cleanName);
      if (firstName && firstName.toLowerCase() !== 'saas' && firstName.toLowerCase() !== 'lead') {
        if (direction === 'incoming') {
          greetingInstruction = `\n\n[USER DETAIL]: The caller's name is "${cleanName}". Please greet them by their first name "${firstName}" immediately at the start of the call (e.g., 'Hello ${firstName}, ...').`;
        } else {
          greetingInstruction = `\n\n[USER DETAIL]: You are calling "${cleanName}". Please greet them by their first name "${firstName}" immediately at the start of the call (e.g., 'Hello ${firstName}, ...').`;
        }
      }
    }
    const toolRule = `\n\n[CRITICAL TOOL RULE]: If the user says goodbye, bye, or asks to hang up/cut the call, YOU MUST IMMEDIATELY CALL THE 'hangupCall' TOOL to end the connection. Do not wait or ask for confirmation.\n\n[VOICEMAIL RULE]: If you hear an automated voicemail greeting (e.g., 'forwarded to voicemail', 'leave a message', 'record your message', 'after the tone'), YOU MUST IMMEDIATELY CALL THE 'hangupCall' TOOL. DO NOT PITCH THE EVENT. DO NOT LEAVE A VOICEMAIL MESSAGE. Just call hangupCall immediately!`;
    const finalInstruction = `${systemInstruction}${greetingInstruction}${toolRule}\n\n[CRITICAL GRAMMAR RULE]: ${genderRule}`;
    
    let resolvedModel = model || 'gemini-3.1-flash-live-preview';
    if (resolvedModel === 'gemini-2.5-flash') {
      resolvedModel = 'gemini-3.1-flash-live-preview';
    }
    console.log(`[WebSocket Stream Setup] Voice: ${voice}, Model: ${resolvedModel}, Instruction: ${finalInstruction.substring(0, 45)}...`);

    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
    
    try {
      geminiWs = new WebSocket(geminiUrl);
    } catch (err) {
      console.log('Failed to instantiate Gemini WebSocket:', err.message);
      ws.close();
      return;
    }
    
    geminiWs.on('open', () => {
      console.log('Connected to Gemini Live API. Sending setup...');
      
      const setupMessage = {
        setup: {
          model: resolvedModel.startsWith('models/') ? resolvedModel : `models/${resolvedModel}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice
                }
              }
            }
          },
          systemInstruction: {
            parts: [{ text: finalInstruction }]
          },
          tools: [{
            functionDeclarations: [
              {
                name: 'hangupCall',
                description: 'Ends and terminates the current phone call immediately. Call this function only when the user explicitly asks to hang up, end the call, cut the call, says goodbye to terminate the call, or if you encounter a voicemail greeting.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    reason: {
                      type: 'STRING',
                      description: 'The reason for hanging up. E.g., "user_requested", "voicemail_detected", "conversation_ended"'
                    }
                  },
                  required: ['reason']
                }
              },
              {
                name: 'scheduleCallback',
                description: 'Schedules a callback for later when the user says they are busy and want to be called back at a specific time. Examples: "2 ghante baad call karo", "kal subah call karna", "call me back at 6pm". Always confirm the time with the user before calling this tool, then say a polite goodbye and hang up.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    requestedTime: {
                      type: 'STRING',
                      description: 'The time the user requested in their own words, e.g., "2 ghante baad", "tomorrow morning", "6pm".'
                    },
                    isoTime: {
                      type: 'STRING',
                      description: 'Your best estimate of the callback time in ISO-8601 UTC format (e.g., "2026-07-02T14:30:00Z"). Calculate based on current time and the user\'s requested offset.'
                    },
                    notes: {
                      type: 'STRING',
                      description: 'Any relevant context for the callback, e.g., "User was in a meeting", "User will be free after lunch".'
                    }
                  },
                  required: ['requestedTime', 'isoTime']
                }
              },
              {
                name: 'checkAvailableSlots',
                description: 'Checks for available appointment slots on a specific date. Call this when the user asks what slots, timings, or hours are free/available for booking on a specific day.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    date: {
                      type: 'STRING',
                      description: 'The target date in YYYY-MM-DD format (e.g. "2026-07-13"). Calculate this based on user input and current day.'
                    }
                  },
                  required: ['date']
                }
              },
              {
                name: 'bookAppointment',
                description: 'Books an appointment at a confirmed date and time slot. Call this tool IMMEDIATELY as soon as the user selects or confirms an available slot. Do NOT ask for phone numbers, email, or other details first (the phone number is already known). Call this tool first to secure the booking, then confirm it to the user.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    date: {
                      type: 'STRING',
                      description: 'The booking date in YYYY-MM-DD format (e.g. "2026-07-13").'
                    },
                    time: {
                      type: 'STRING',
                      description: 'The selected available slot/time in HH:mm format (e.g. "11:30" or "14:00").'
                    },
                    notes: {
                      type: 'STRING',
                      description: 'Purpose or context for the booking.'
                    }
                  },
                  required: ['date', 'time']
                }
              }
            ]
          }]

        }
      };
      
      geminiWs.send(JSON.stringify(setupMessage));
    });
    
    geminiWs.on('message', async (data) => {
      try {
        let text;
        if (data instanceof Buffer) {
          text = data.toString('utf-8');
        } else {
          text = data;
        }
        
        const response = JSON.parse(text);

        // Capture user input transcription
        if (response.serverContent?.inputTranscription?.text) {
          const transText = response.serverContent.inputTranscription.text.trim();
          if (transText) {
            console.log(`[Call ${callSid}] User: ${transText}`);
            
            // Cancel greeting timeout since user has spoken
            if (ws.greetingTimeout) {
              clearTimeout(ws.greetingTimeout);
              ws.greetingTimeout = null;
              console.log(`[Call ${callSid}] User spoke first. Cancelled initial greeting timeout.`);
            }
            ws.userHasSpoken = true;
            
            const callState = getOrCreateCallState(callSid);
            if (callState) {
              // If call is already terminating, ignore further input
              if (callState._terminating) return;

              callState.transcript.push({ role: 'user', text: transText });
              callState.status = 'active';
              
              // Voicemail Detection Logic
              const isVoicemail = /voicemail|record your message|after the tone|leave a message|person you(?: a|')re trying to reach/i.test(transText);
              
              if (isVoicemail) {
                console.log(`[Voicemail Detected] Call ${callSid} hit a voicemail machine. Terminating.`);
                callState.summary = '**Verdict:** Voicemail / No Answer\n\n**Reason:** Call reached voicemail. Agent terminated the call automatically.';
                callState._terminating = true;
                scheduleSaveCalls();
                
                if (inactivityTimeout) {
                  clearTimeout(inactivityTimeout);
                  inactivityTimeout = null;
                }
                terminateActiveCall(callSid, ws, geminiWs, ws.provider || 'twilio', 'voicemail');
                return;
              }

              // Hard hang-up detection: if user explicitly says to stop/cut, send hangup signal immediately
              const userWantsHangup = /\b(not interested|no interest|interested nahi|dilchaspi nahi|no thanks|no thank you|hang up|cut the call|end the call|stop calling|don't call|don't call again|bye|goodbye|ruk|band karo|call mat karo|phone rakho|rakho phone|kat do|kato|nahi chahiye|nahi chahie)\b/i.test(transText);
              if (userWantsHangup && !callState._terminating) {
                console.log(`[Hard Hangup Detected] User said: "${transText}". Injecting hangup instruction to Gemini...`);
                callState._terminating = true;
                if (inactivityTimeout) { clearTimeout(inactivityTimeout); inactivityTimeout = null; }
                // Inject a forcing instruction to Gemini to say goodbye and call hangupCall
                if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                  const hangupPrompt = {
                    clientContent: {
                      turns: [{ role: 'user', parts: [{ text: 'The user wants to end the call. Say a brief polite goodbye in one sentence, then IMMEDIATELY call the hangupCall tool.' }] }],
                      turnComplete: true
                    }
                  };
                  try { geminiWs.send(JSON.stringify(hangupPrompt)); } catch(e) {}
                }

                // Fallback timer: force terminate call after 4 seconds if Gemini does not trigger toolCall
                callState._fallbackHangupTimer = setTimeout(() => {
                  console.log(`[Hard Hangup Fallback] Gemini failed to trigger toolCall in 4s. Forcing call termination for CallSid: ${callSid}`);
                  terminateActiveCall(callSid, ws, geminiWs, ws.provider || 'twilio', 'completed');
                }, 4000);
              }

              scheduleSaveCalls();
            }
          }
        }
        
        // Capture agent output transcription
        if (response.serverContent?.outputTranscription?.text) {
          const transText = response.serverContent.outputTranscription.text.trim();
          if (transText) {
            console.log(`[Call ${callSid}] Agent: ${transText}`);
            const callState = getOrCreateCallState(callSid);
            if (callState) {
              const len = callState.transcript.length;
              if (len > 0 && callState.transcript[len - 1].role === 'agent') {
                callState.transcript[len - 1].text += ' ' + transText;
              } else {
                callState.transcript.push({ role: 'agent', text: transText });
              }
              scheduleSaveCalls();
            }
          }
        }
        
        // Handle Tool Call from Gemini
        if (response.toolCall) {
          const functionCalls = response.toolCall.functionCalls;
          for (const call of functionCalls) {
            if (call.name === 'hangupCall') {
              const reason = call.args?.reason || 'user_requested';
              console.log(`[Gemini ToolCall] hangupCall triggered by agent. Reason: ${reason}`);
              
              const isVoicemail = reason.toLowerCase().includes('voicemail');
              const finalStatus = isVoicemail ? 'failed' : 'completed';

              if (inactivityTimeout) {
                clearTimeout(inactivityTimeout);
                inactivityTimeout = null;
              }

              // Immediately mark call as terminating so no more audio/logic runs
              const callState = activeCalls.get(callSid);
              if (callState) {
                callState._terminating = true;
                if (callState._fallbackHangupTimer) {
                  clearTimeout(callState._fallbackHangupTimer);
                  callState._fallbackHangupTimer = null;
                }
              }
              
              // Send tool response back to Gemini to let it finish its goodbye audio
              const toolResponse = {
                toolResponse: {
                  functionResponses: [{
                    response: { output: { success: true, message: `Call ending now.` } },
                    id: call.id
                  }]
                }
              };
              try { geminiWs.send(JSON.stringify(toolResponse)); } catch(e) {}
              
              if (isVoicemail) {
                const cs = getOrCreateCallState(callSid);
                if (cs) {
                  cs.summary = '**Verdict:** Not Interested\n\n**Reason:** Call reached voicemail. Agent terminated the call automatically using tool.';
                  scheduleSaveCalls();
                }
              }
              
              // Wait 3s for final goodbye audio to finish, then hard-terminate
              console.log(`[Gemini ToolCall] Waiting 3s to play final audio, then hanging up as ${finalStatus}...`);
              setTimeout(() => {
                terminateActiveCall(callSid, ws, geminiWs, ws.provider || 'twilio', finalStatus);
              }, 3000);
            }

            // --- scheduleCallback Tool Handler ---
            if (call.name === 'scheduleCallback') {
              const { requestedTime = '', isoTime = '', notes = '' } = call.args || {};
              console.log(`[Gemini ToolCall] scheduleCallback triggered. RequestedTime: "${requestedTime}", ISO: ${isoTime}`);

              // 1. Persist callback to local callbacks_db.json
              const cbId = `cb_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
              const settings = callSettingsMap.get(callSid);
              const callState = activeCalls.get(callSid);
              const cbRecord = {
                id: cbId,
                callSid,
                phone: callState?.to || '',
                name: callState?.name || '',
                requestedTime,
                isoTime,
                notes,
                scheduledAt: isoTime,
                status: 'pending',      // pending → dialing → dialed/failed
                leadId: settings?.leadId || null,
                saasApiUrl: settings?.saasApiUrl || null,
                agentId: settings?.agentId || null,
                provider: settings?.provider || defaultCallConfig.telephonyProvider || 'vobiz',
                clientId: settings?.clientId || callState?.clientId || null,
                createdAt: new Date().toISOString()
              };
              callbacksDb.set(cbId, cbRecord);
              saveCallbacks();
              console.log(`[ScheduleCallback] ✅ Callback saved to DB: ID=${cbId}, At=${isoTime}`);

              // 2. Notify DigiNext CRM (fire-and-forget)
              if (settings?.saasApiUrl) {
                fetch(`${settings.saasApiUrl}/crm/calling-agent/schedule-callback`, {
                  method: 'POST',
                  headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${defaultCallConfig.apiKey || ''}`
                  },
                  body: JSON.stringify({
                    callbackId: cbRecord.id,
                    leadId: settings.leadId || null,
                    phone: cbRecord.phone,
                    name: cbRecord.name,
                    scheduledAt: isoTime,
                    requestedTime,
                    notes
                  })
                }).then(r => {
                  if (r.ok) console.log(`[ScheduleCallback] CRM notified successfully.`);
                  else console.warn(`[ScheduleCallback] CRM notification returned ${r.status}`);
                }).catch(err => console.warn(`[ScheduleCallback] CRM notification failed: ${err.message}`));
              }

              // 3. Send tool response back to Gemini
              const cbToolResponse = {
                toolResponse: {
                  functionResponses: [{
                    response: { output: { success: true, message: `Callback scheduled for ${requestedTime}. Confirming and ending call.` } },
                    id: call.id
                  }]
                }
              };
              try { geminiWs.send(JSON.stringify(cbToolResponse)); } catch(e) {}

              // 4. Graceful hangup after 3s (let Gemini deliver confirmation audio)
              if (inactivityTimeout) { clearTimeout(inactivityTimeout); inactivityTimeout = null; }
              const cbCallState = activeCalls.get(callSid);
              if (cbCallState) {
                cbCallState._terminating = true;
                if (cbCallState._fallbackHangupTimer) {
                  clearTimeout(cbCallState._fallbackHangupTimer);
                  cbCallState._fallbackHangupTimer = null;
                }
              }
              console.log(`[ScheduleCallback] Hanging up after 3s confirmation window...`);
              setTimeout(() => {
                terminateActiveCall(callSid, ws, geminiWs, ws.provider || 'twilio', 'completed');
              }, 3000);
            }

            // --- checkAvailableSlots Tool Handler ---
            if (call.name === 'checkAvailableSlots') {
              const { date = '' } = call.args || {};
              console.log(`[Gemini ToolCall] checkAvailableSlots triggered for date: ${date}`);
              
              const apiToken = defaultCallConfig.apiKey || '';
              fetch(`https://growlio.in/api/crm/calling-agent/check-slots?date=${date}`, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${apiToken}`
                }
              })
              .then(r => r.json())
              .then(data => {
                console.log(`[CheckAvailableSlots] API response:`, JSON.stringify(data));
                const toolResponse = {
                  toolResponse: {
                    functionResponses: [{
                      response: { 
                        output: { 
                          success: data.success || false, 
                          availableSlots: data.availableSlots || [], 
                          message: data.success && data.availableSlots?.length > 0 
                            ? `Available slots on ${date}: ${data.availableSlots.join(', ')}` 
                            : `No slots available or failed to load slots for ${date}.` 
                        } 
                      },
                      id: call.id
                    }]
                  }
                };
                try { geminiWs.send(JSON.stringify(toolResponse)); } catch(e) {}
              })
              .catch(err => {
                console.error(`[CheckAvailableSlots] API request failed:`, err.message);
                const toolResponse = {
                  toolResponse: {
                    functionResponses: [{
                      response: { output: { success: false, error: err.message, message: 'Could not load slots due to a network error.' } },
                      id: call.id
                    }]
                  }
                };
                try { geminiWs.send(JSON.stringify(toolResponse)); } catch(e) {}
              });
            }

            // --- bookAppointment Tool Handler ---
            if (call.name === 'bookAppointment') {
              const { date = '', time = '', notes = '' } = call.args || {};
              console.log(`[Gemini ToolCall] bookAppointment triggered. Date: ${date}, Time: ${time}, Notes: ${notes}`);

              const settings = callSettingsMap.get(callSid);
              const callState = activeCalls.get(callSid);
              const apiToken = defaultCallConfig.apiKey || '';

              const bookingPayload = {
                leadId: settings?.leadId || null,
                phone: callState?.to || '',
                name: callState?.name || '',
                dateTimeIso: `${date}T${time}:00Z`,
                notes: notes || 'Booked via AI Voice Calling Agent',
                callSid: callSid
              };

              console.log(`[BookAppointment] Sending payload to CRM:`, JSON.stringify(bookingPayload));

              fetch(`https://growlio.in/api/crm/calling-agent/book-appointment`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiToken}`
                },
                body: JSON.stringify(bookingPayload)
              })
              .then(r => r.json())
              .then(data => {
                console.log(`[BookAppointment] CRM response:`, JSON.stringify(data));
                const toolResponse = {
                  toolResponse: {
                    functionResponses: [{
                      response: { 
                        output: { 
                          success: data.success || false, 
                          appointmentId: data.appointmentId || null, 
                          message: data.success 
                            ? `Appointment booked successfully! Confirmation ID is ${data.appointmentId}.` 
                            : `Booking failed: ${data.message || 'Unknown error'}.` 
                        } 
                      },
                      id: call.id
                    }]
                  }
                };
                try { geminiWs.send(JSON.stringify(toolResponse)); } catch(e) {}
              })
              .catch(err => {
                console.error(`[BookAppointment] API request failed:`, err.message);
                const toolResponse = {
                  toolResponse: {
                    functionResponses: [{
                      response: { output: { success: false, error: err.message, message: 'Could not confirm booking due to a connection error.' } },
                      id: call.id
                    }]
                  }
                };
                try { geminiWs.send(JSON.stringify(toolResponse)); } catch(e) {}
              });
            }

          }
          return;
        }
        
        // Handshake Complete
        if (response.setupComplete) {
          console.log('Gemini setup complete. Call channel active.');
          isGeminiReady = true;

          // Trigger initial greeting with a 1.5-second delay, unless user speaks first
          ws.userHasSpoken = false;
          ws.isInterrupted = false;
          
          ws.greetingTimeout = setTimeout(() => {
            if (geminiWs && geminiWs.readyState === WebSocket.OPEN && !ws.userHasSpoken) {
              ws.userHasSpoken = true;
              const cleanName = name ? name.trim() : '';
              const isPhoneNumber = /^[+\d\s\-\(\)]+$/.test(cleanName);
              const isDefaultLead = cleanName.toLowerCase() === 'saas lead' || cleanName.toLowerCase() === 'saas' || cleanName.toLowerCase() === 'customer' || cleanName.toLowerCase() === 'a customer';
              const isValidName = cleanName && !isPhoneNumber && !isDefaultLead;
              const firstName = isValidName ? getFirstName(cleanName) : '';

              const greetPrompt = (isValidName && firstName && firstName.toLowerCase() !== 'saas' && firstName.toLowerCase() !== 'lead')
                ? `Greet ${firstName} politely by name in English to start the conversation.` 
                : "Say hello politely in English to start the conversation.";
              
              const initGreeting = {
                clientContent: {
                  turns: [
                    {
                      role: "user",
                      parts: [{ text: greetPrompt }]
                    }
                  ],
                  turnComplete: true
                }
              };
              
              console.log(`[WebSocket Stream Setup] Injecting initial greeting turn after 1.5s silence: "${greetPrompt}"`);
              try {
                geminiWs.send(JSON.stringify(initGreeting));
              } catch (e) {
                console.error('Failed to send initial greeting:', e.message);
              }
            }
          }, 2000); // 2s delay so audio path fully stabilizes before agent speaks
          
          resetInactivityTimer();
          return;
        }
        
        // Audio Response from Gemini
        if (response.serverContent?.modelTurn) {
          ws.isInterrupted = false; // Reset interruption flag since a new turn has started
          if (ws.greetingTimeout) {
            clearTimeout(ws.greetingTimeout);
            ws.greetingTimeout = null;
            ws.userHasSpoken = true;
            console.log(`[Call ${callSid}] Gemini started generating audio. Cancelled greeting timeout.`);
          }
        }
        
        if (response.serverContent?.modelTurn?.parts) {
          if (ws.isInterrupted) {
            console.log(`[Call ${callSid}] Discarding audio chunk because turn was interrupted.`);
            return;
          }
          let agentText = '';
          for (const part of response.serverContent.modelTurn.parts) {
            if (part.text) {
              agentText += part.text;
            }
            if (part.inlineData && part.inlineData.data) {
              const base64Pcm24 = part.inlineData.data;
              const pcm24Buffer = Buffer.from(base64Pcm24, 'base64');
              
              // Dynamically track the duration of agent audio generated to extend the inactivity timer
              const chunkDurationMs = (pcm24Buffer.length / 48000) * 1000;
              agentSpeakingUntil = Math.max(agentSpeakingUntil, Date.now()) + chunkDurationMs;
              
              if (ws.provider === 'exotel') {
                // Transcode: 24kHz PCM -> 8kHz PCM
                const pcm8Buffer = pcm24ToPcm8(pcm24Buffer);
                const base64Pcm8 = pcm8Buffer.toString('base64');
                
                const exotelMessage = {
                  event: 'media',
                  stream_sid: streamSid,
                  media: {
                    payload: base64Pcm8
                  }
                };
                
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify(exotelMessage));
                }
              } else if (ws.provider === 'vobiz') {
                // Transcode: 24kHz PCM -> 8kHz Mu-law (Vobiz uses same format as Twilio)
                const mulawBuffer = geminiToTwilio(pcm24Buffer);
                const base64Mulaw = mulawBuffer.toString('base64');
                
                const vobizMessage = {
                  event: 'playAudio',
                  media: {
                    contentType: 'audio/x-mulaw',
                    sampleRate: 8000,
                    payload: base64Mulaw
                  }
                };
                
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify(vobizMessage));
                }
              } else {
                // Transcode: 24kHz PCM -> 8kHz Mu-law (Twilio)
                const mulawBuffer = geminiToTwilio(pcm24Buffer);
                const base64Mulaw = mulawBuffer.toString('base64');
                
                const twilioMessage = {
                  event: 'media',
                  streamSid: streamSid,
                  media: {
                    payload: base64Mulaw
                  }
                };
                
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify(twilioMessage));
                }
              }
            }
          }
          agentText = agentText.trim();
          if (agentText) {
            console.log(`[Call ${callSid}] Agent: ${agentText}`);
            const callState = getOrCreateCallState(callSid);
            if (callState) {
              const len = callState.transcript.length;
              if (len > 0 && callState.transcript[len - 1].role === 'agent') {
                callState.transcript[len - 1].text += ' ' + agentText;
              } else {
                callState.transcript.push({ role: 'agent', text: agentText });
              }
            }
          }
        }
        
        // Interruption handling
        if (response.serverContent?.interrupted) {
          console.log('Gemini speaker interrupted by user voice.');
          ws.isInterrupted = true;
          // Reset agentSpeakingUntil to now so inactivity timer gives a FULL fresh 10s
          // for the user to finish speaking and Gemini to respond
          agentSpeakingUntil = Date.now();
          resetInactivityTimer(); // This now gives full 10s window
          
          if (ws.provider === 'exotel') {
            const clearMsg = {
              event: 'clear',
              stream_sid: streamSid
            };
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(clearMsg));
            }
          } else if (ws.provider === 'vobiz') {
            const clearMsg = {
              event: 'clearAudio',
              streamId: streamSid
            };
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(clearMsg));
            }
          } else {
            const clearMsg = {
              event: 'clear',
              streamSid: streamSid
            };
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(clearMsg));
            }
          }
        }
        
        // Reset inactivity timer on any content received from Gemini or user speech
        if (response.serverContent) {
          resetInactivityTimer();
        }
        
      } catch (err) {
        console.error('Error processing Gemini packet:', err.message);
      }
    });
    
    geminiWs.on('close', (code, reason) => {
      console.log(`Gemini connection closed. Code: ${code}, Reason: ${reason}`);
      if (inactivityTimeout) {
        clearTimeout(inactivityTimeout);
        inactivityTimeout = null;
      }
      ws.close();
    });
    
    geminiWs.on('error', (err) => {
      console.error('Gemini connection error:', err);
      if (inactivityTimeout) {
        clearTimeout(inactivityTimeout);
        inactivityTimeout = null;
      }
      ws.close();
    });
  }
  
  // Handle Messages from Phone Stream (Twilio/Exotel/Vobiz)
  ws.on('message', (message, isBinary) => {
    try {
      // Vobiz bidirectional streams MAY send raw binary PCM audio frames directly.
      // Only handle as binary if: (1) ws library flags it as binary, AND (2) we already
      // received the 'start' event (ws.provider is set), AND (3) Gemini is ready.
      if (isBinary && ws.provider === 'vobiz' && isGeminiReady) {
        // Binary message = raw PCM audio from caller's phone (L16 16kHz)
        const audioBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
        const pcm16Base64 = audioBuffer.toString('base64');
        sendAudioToGemini(pcm16Base64);
        
        // RMS check for inactivity reset
        if (audioBuffer.length >= 2) {
          const pcm16 = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, Math.floor(audioBuffer.length / 2));
          let sum = 0;
          for (let i = 0; i < pcm16.length; i++) sum += pcm16[i] * pcm16[i];
          const rms = Math.sqrt(sum / Math.max(pcm16.length, 1));
          if (rms > 300) resetInactivityTimer();
        }
        return; // binary handled, skip JSON parse
      }

      const msg = JSON.parse(message);


      
      switch (msg.event) {
        case 'start':
          // Auto-detect provider based on keys in the start event
          const isVobiz = ('streamId' in msg.start) || ('callId' in msg.start) || (provider === 'vobiz');
          const isExotel = !isVobiz && (('stream_sid' in msg.start) || ('call_sid' in msg.start) || (provider === 'exotel'));
          ws.provider = isVobiz ? 'vobiz' : (isExotel ? 'exotel' : 'twilio');
          
          const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          const clientId = urlObj.searchParams.get('client_id');

          if (ws.provider === 'vobiz') {
            streamSid = msg.start.streamId;
            const callSid = msg.start.callId;
            activeCallSid = callSid;
            console.log(`Vobiz call started. StreamSid: ${streamSid}, CallSid: ${callSid}`);
            
            // Retrieve config by CallSid or fallback to client specific/default
            let callConfig = callSettingsMap.get(callSid);
            if (!callConfig) {
              if (clientId && clientsDb.has(clientId)) {
                const client = clientsDb.get(clientId);
                callConfig = {
                  voice: client.agent_config?.voice || defaultCallConfig.voice || 'Aoede',
                  systemInstruction: client.agent_config?.system_prompt || defaultCallConfig.systemInstruction,
                  model: defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
                  name: client.name || '',
                  recordCall: defaultCallConfig.gemini_record_call === 'true' || defaultCallConfig.recordCall || false,
                  clientId: clientId,
                  vobizAuthId: client.vobiz_sub_auth_id,
                  vobizAuthToken: client.vobiz_sub_auth_token
                };
                callSettingsMap.set(callSid, callConfig);
              } else {
                callConfig = getIncomingCallConfig();
              }
            }
            const callState = getOrCreateCallState(callSid, {
              provider: 'vobiz',
              to: callSid,
              name: callConfig.name || '',
              recordCall: callConfig.recordCall || false,
              status: 'active',
              clientId: callConfig.clientId || null
            });
            if (callState) {
              callState.status = 'active';
              if (callState.recordCall) {
                startVobizCallRecording(callSid, callConfig);
              }
            }
            initializeGemini(callConfig.voice, callConfig.systemInstruction, callConfig.name || '', callSid, callConfig.model);
          } else if (ws.provider === 'exotel') {
            streamSid = msg.start.stream_sid;
            const callSid = msg.start.call_sid;
            activeCallSid = callSid;
            console.log(`Exotel call started. StreamSid: ${streamSid}, CallSid: ${callSid}`);
            
            // Retrieve config by CallSid or fallback to default
            const rawConfig = callSettingsMap.get(callSid) || defaultCallConfig;
            const callConfig = (rawConfig === defaultCallConfig) ? getIncomingCallConfig() : rawConfig;
            const callState = getOrCreateCallState(callSid, {
              provider: 'exotel',
              to: callSid,
              name: callConfig.name || '',
              recordCall: callConfig.recordCall || false,
              status: 'active'
            });
            if (callState) {
              callState.status = 'active';
            }
            initializeGemini(callConfig.voice, callConfig.systemInstruction, callConfig.name || '', callSid, callConfig.model);
          } else {
            streamSid = msg.start.streamSid;
            const callSid = msg.start.callSid;
            activeCallSid = callSid;
            console.log(`Twilio call started. StreamSid: ${streamSid}, CallSid: ${callSid}`);
            
            // Retrieve config by CallSid or fallback to default
            const rawConfig = callSettingsMap.get(callSid) || defaultCallConfig;
            const callConfig = (rawConfig === defaultCallConfig) ? getIncomingCallConfig() : rawConfig;
            const callState = getOrCreateCallState(callSid, {
              provider: 'twilio',
              to: callSid,
              name: callConfig.name || '',
              recordCall: callConfig.recordCall || false,
              status: 'active'
            });
            if (callState) {
              callState.status = 'active';
            }
            initializeGemini(callConfig.voice, callConfig.systemInstruction, callConfig.name || '', callSid, callConfig.model);
          }

          // Max call duration enforcement (standard 15 minutes limit)
          let maxCallDurationMs = 15 * 60 * 1000;
          const maxDurationTimeout = setTimeout(() => {
            console.log(`[Plan Limit] CallSid: ${activeCallSid} exceeded plan limit duration. Terminating...`);
            if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
              try {
                geminiWs.send(JSON.stringify({
                  clientContent: {
                    turns: [{
                      role: "user",
                      parts: [{ text: "The call duration limit has been reached. Please say a brief polite goodbye in Hinglish and hang up using the hangupCall tool." }]
                    }],
                    turnComplete: true
                  }
                }));
              } catch(e) {}
            } else {
              terminateActiveCall(activeCallSid, ws, geminiWs, ws.provider || 'twilio', 'completed');
            }
          }, maxCallDurationMs);
          ws._maxDurationTimeout = maxDurationTimeout;

          break;
          
        case 'media':
          const base64Media = msg.media.payload;
          const mediaBuffer = Buffer.from(base64Media, 'base64');
          let pcm16Buffer = null;
          let pcm16Base64 = '';
          
          if (ws.provider === 'vobiz') {
            if (!ws.loggedFirstMedia) {
              ws.loggedFirstMedia = true;
              console.log(`[Vobiz Media] First media packet received. ContentType: ${msg.media?.contentType}, Payload length: ${base64Media.length}`);
            }
            // Vobiz sends mu-law 8kHz audio (same as Twilio) — transcode to 16kHz PCM for Gemini
            pcm16Buffer = twilioToGemini(mediaBuffer);
            pcm16Base64 = pcm16Buffer.toString('base64');
          } else if (ws.provider === 'exotel') {
            // Transcode: 8kHz PCM -> 16kHz PCM
            pcm16Buffer = pcm8ToPcm16(mediaBuffer);
            pcm16Base64 = pcm16Buffer.toString('base64');
          } else {
            // Transcode: 8kHz Mu-law -> 16kHz PCM (Twilio)
            pcm16Buffer = twilioToGemini(mediaBuffer);
            pcm16Base64 = pcm16Buffer.toString('base64');
          }
          
          // Check audio energy (RMS) to detect if user is actively speaking
          if (pcm16Buffer) {
            let sum = 0;
            const numSamples = pcm16Buffer.length / 2;
            if (numSamples > 0) {
              for (let i = 0; i < pcm16Buffer.length; i += 2) {
                const sample = pcm16Buffer.readInt16LE(i);
                sum += sample * sample;
              }
              const rms = Math.sqrt(sum / numSamples);
              if (rms > 1000) {
                // User is actively making sound, reset inactivity timer
                resetInactivityTimer();
              }
            }
          }
          
          if (isGeminiReady) {
            sendAudioToGemini(pcm16Base64);
          }
          break;
          
        case 'stop':
          console.log(`${ws.provider === 'vobiz' ? 'Vobiz' : (ws.provider === 'exotel' ? 'Exotel' : 'Twilio')} call stream stopped.`);
          if (geminiWs) {
            geminiWs.close();
          }
          handleCallEnd(activeCallSid, 'completed');
          break;
      }
    } catch (err) {
      console.error('Error handling packet:', err.message);
    }
  });
  
  ws.on('close', () => {
    console.log(`${ws.provider === 'vobiz' ? 'Vobiz' : (ws.provider === 'exotel' ? 'Exotel' : 'Twilio')} client disconnected.`);
    if (ws.greetingTimeout) {
      clearTimeout(ws.greetingTimeout);
      ws.greetingTimeout = null;
    }
    if (ws._maxDurationTimeout) {
      clearTimeout(ws._maxDurationTimeout);
      ws._maxDurationTimeout = null;
    }
    if (geminiWs) {
      geminiWs.close();
    }
    handleCallEnd(activeCallSid, 'completed');
  });
});

async function terminateActiveCall(callSid, ws, geminiWs, provider, status = 'completed') {
  console.log(`[Call Termination] Hanging up active call: ${callSid} (${provider}) with status ${status}...`);
  handleCallEnd(callSid, status);
  
  // 1. Immediately close the carrier WebSocket stream to tear down media connection
  if (ws) {
    if (ws.greetingTimeout) {
      clearTimeout(ws.greetingTimeout);
      ws.greetingTimeout = null;
    }
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.close(); } catch(e){}
    }
  }
  
  if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
    try { geminiWs.close(); } catch(e){}
  }
  
  if (!callSid) return;
  
  const callState = activeCalls.get(callSid);
  if (callState && callState._fallbackHangupTimer) {
    clearTimeout(callState._fallbackHangupTimer);
    callState._fallbackHangupTimer = null;
  }
  
  // 2. Perform REST API hangup requests in the background for clean carriers state
  const cachedConfig = callSettingsMap.get(callSid);
  const resolvedVobizAuthId = (cachedConfig && cachedConfig.vobizAuthId) || defaultCallConfig.vobizAuthId;
  const resolvedVobizAuthToken = (cachedConfig && cachedConfig.vobizAuthToken) || defaultCallConfig.vobizAuthToken;
  
  if (provider === 'vobiz') {
    if (resolvedVobizAuthId && resolvedVobizAuthToken) {
      try {
        const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${resolvedVobizAuthId.trim()}/Call/${callSid.trim()}/`;
        await fetch(vobizUrl, {
          method: 'DELETE',
          headers: {
            'X-Auth-ID': resolvedVobizAuthId.trim(),
            'X-Auth-Token': resolvedVobizAuthToken.trim()
          }
        });
        console.log(`[Vobiz REST API Hangup] Terminated call: ${callSid}`);
      } catch (err) {
        console.error(`[Vobiz REST API Hangup Error] Failed:`, err.message);
      }
    }
  } else if (provider === 'exotel' && cachedConfig) {
    const { exotelApiKey, exotelApiToken, exotelAccountSid, exotelSubdomain = 'api.exotel.com' } = cachedConfig;
    if (exotelApiKey && exotelApiToken && exotelAccountSid) {
      try {
        const authHeader = Buffer.from(`${exotelApiKey.trim()}:${exotelApiToken.trim()}`).toString('base64');
        const exotelUrl = `https://${exotelSubdomain.trim()}/v1/Accounts/${exotelAccountSid.trim()}/Calls/${callSid.trim()}.json`;
        
        const params = new URLSearchParams();
        params.append('Status', 'completed');
        
        await fetch(exotelUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params
        });
        console.log(`[Exotel REST API Hangup] Set call state to completed for: ${callSid}`);
      } catch (err) {
        console.error(`[Exotel REST API Hangup Error] Failed:`, err.message);
      }
    }
  } else if (provider === 'twilio') {
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (twilioSid && twilioAuthToken) {
      try {
        const authHeader = Buffer.from(`${twilioSid}:${twilioAuthToken}`).toString('base64');
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls/${callSid}.json`;
        
        const params = new URLSearchParams();
        params.append('Status', 'completed');
        
        await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params
        });
        console.log(`[Twilio REST API Hangup] Set call state to completed for: ${callSid}`);
      } catch (err) {
        console.error(`[Twilio REST API Hangup Error] Failed:`, err.message);
      }
    }
  }
}

// ================================================================
// API FOR CALLS (END / DELETE)
// ================================================================
app.delete('/api/calls/:callSid', (req, res) => {
  const { callSid } = req.params;
  if (activeCalls.has(callSid)) {
    activeCalls.delete(callSid);
    saveCalls();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Not found' });
  }
});

app.post('/api/calls/group/delete', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Missing phone in body' });
  let deletedCount = 0;
  for (const [sid, call] of activeCalls.entries()) {
    if (call.to === phone) {
      activeCalls.delete(sid);
      deletedCount++;
    }
  }
  saveCalls();
  res.json({ success: true, deleted: deletedCount });
});

app.post('/api/calls/:callSid/end', async (req, res) => {
  const { callSid } = req.params;
  const callState = activeCalls.get(callSid);
  if (!callState || callState.status === 'completed' || callState.status === 'failed' || callState.status === 'voicemail') {
    return res.status(400).json({ success: false, error: 'Call already ended or not found' });
  }
  
  await terminateActiveCall(callSid, null, null, callState.provider, 'completed');
  res.json({ success: true });
});



// ============================================================
// CALLBACKS REST API
// ============================================================

// GET /api/callbacks — list all callbacks (optionally filter by status)
app.get('/api/callbacks', authMiddleware('calls'), (req, res) => {
  const { status, clientId } = req.query; // optional: ?status=pending
  let list = Array.from(callbacksDb.values()).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  if (status) list = list.filter(c => c.status === status);
  if (clientId && clientId !== 'admin') {
    list = list.filter(c => c.clientId === clientId);
  } else if (clientId === 'admin') {
    list = list.filter(c => c.clientId === 'admin' || !c.clientId);
  }
  res.json({ success: true, callbacks: list });
});

// DELETE /api/callbacks/:id — delete/cancel a callback
app.delete('/api/callbacks/:id', authMiddleware('calls'), (req, res) => {
  const { id } = req.params;
  console.log(`[API Request] 🗑️ Received DELETE /api/callbacks/${id}`);
  
  if (!callbacksDb.has(id)) {
    console.warn(`[API Request] ❌ DELETE failed: Callback ID ${id} not found.`);
    return res.status(404).json({ success: false, error: 'Callback not found' });
  }

  const cb = callbacksDb.get(id);
  const authHeader = req.headers.authorization;
  const isFromCRM = authHeader && authHeader.startsWith('Bearer ');

  callbacksDb.delete(id);
  saveCallbacks();
  console.log(`[API Request] ✅ Callback ID ${id} deleted successfully.`);

  // Notify CRM if request is local (e.g. from Dashboard) and CRM config exists
  if (!isFromCRM && cb && cb.saasApiUrl) {
    console.log(`[CRM Cancel Sync] Notifying CRM: ${cb.saasApiUrl}/crm/calling-agent/cancel-callback for Lead: ${cb.leadId}`);
    fetch(`${cb.saasApiUrl}/crm/calling-agent/cancel-callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${defaultCallConfig.apiKey || ''}`
      },
      body: JSON.stringify({
        callbackId: cb.id,
        leadId: cb.leadId || null
      })
    }).then(crmRes => {
      console.log(`[CRM Cancel Sync] Response status: ${crmRes.status}`);
    }).catch(err => {
      console.error(`[CRM Cancel Sync Error] Failed:`, err.message);
    });
  }

  res.json({ success: true, message: 'Callback deleted.' });
});

// PATCH /api/callbacks/:id — reschedule or update callback fields
app.patch('/api/callbacks/:id', express.json(), authMiddleware('calls'), (req, res) => {
  const { id } = req.params;
  console.log(`[API Request] 🔄 Received PATCH /api/callbacks/${id}. Body:`, req.body);
  const cb = callbacksDb.get(id);
  if (!cb) {
    console.warn(`[API Request] ❌ PATCH failed: Callback ID ${id} not found.`);
    return res.status(404).json({ success: false, error: 'Callback not found' });
  }

  const authHeader = req.headers.authorization;
  const isFromCRM = authHeader && authHeader.startsWith('Bearer ');

  const { scheduledAt, isoTime, requestedTime, notes, status } = req.body;
  if (scheduledAt || isoTime) {
    cb.scheduledAt = scheduledAt || isoTime;
    cb.isoTime = scheduledAt || isoTime;
    cb.status = 'pending'; // Reset to pending on reschedule
  }
  if (requestedTime !== undefined) cb.requestedTime = requestedTime;
  if (notes !== undefined) cb.notes = notes;
  if (status !== undefined) cb.status = status;
  cb.updatedAt = new Date().toISOString();
  
  callbacksDb.set(id, cb);
  saveCallbacks();

  // Notify CRM if request is local (e.g. from Dashboard) and CRM config exists
  if (!isFromCRM && cb.saasApiUrl) {
    console.log(`[CRM Reschedule Sync] Notifying CRM: ${cb.saasApiUrl}/crm/calling-agent/reschedule-callback for Lead: ${cb.leadId}`);
    fetch(`${cb.saasApiUrl}/crm/calling-agent/reschedule-callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${defaultCallConfig.apiKey || ''}`
      },
      body: JSON.stringify({
        callbackId: cb.id,
        leadId: cb.leadId || null,
        scheduledAt: cb.scheduledAt,
        requestedTime: cb.requestedTime,
        notes: cb.notes || "Rescheduled from Calling Agent dashboard"
      })
    }).then(crmRes => {
      console.log(`[CRM Reschedule Sync] Response status: ${crmRes.status}`);
    }).catch(err => {
      console.error(`[CRM Reschedule Sync Error] Failed:`, err.message);
    });
  }

  res.json({ success: true, callback: cb });
});


// ============================================================
// CALLBACK AUTO-DIALER SCHEDULER (runs every 60 seconds)
// Checks callbacksDb for pending callbacks whose scheduledAt
// time has arrived and auto-dials via /make-call
// ============================================================
setInterval(async () => {
  const now = new Date();
  for (const [id, cb] of callbacksDb.entries()) {
    if (cb.status !== 'pending') continue;

    let scheduledAt;
    try {
      scheduledAt = new Date(cb.scheduledAt);
    } catch (e) {
      continue;
    }

    // Only dial if scheduled time has passed
    if (scheduledAt > now) continue;

    console.log(`[Callback Scheduler] ⏰ Due callback ID=${id} for ${cb.phone} (Requested: "${cb.requestedTime}"). Initiating call...`);
    cb.status = 'dialing';
    callbacksDb.set(id, cb);
    saveCallbacks();

    // Resolve agent config from stored agentId or fall back to defaultCallConfig
    const agent = cb.agentId ? agentsDb.get(cb.agentId) : null;

    let callbackInstruction = agent?.systemInstruction || defaultCallConfig.systemInstruction || '';

    if (agent?.name) {
      callbackInstruction = `[IDENTITY DIRECTIVE: Your name is "${agent.name}". You must introduce yourself as "${agent.name}".]\n\n` + callbackInstruction;
    }
    if (agent?.mood && agent.mood !== 'Professional') {
      callbackInstruction = `[MOOD DIRECTIVE: You must act and speak in a ${agent.mood.toUpperCase()} mood.]\n\n` + callbackInstruction;
    }

    // Append callback context
    callbackInstruction += `\n\n[CALLBACK CONTEXT] This is a scheduled callback call. The user ${cb.name || 'the customer'} had previously requested to be called back at "${cb.requestedTime}".${cb.notes ? ' Note: ' + cb.notes : ''} Greet them warmly, remind them of the callback request, and continue the conversation.`;

    const makeCallPayload = {
      provider: cb.provider || defaultCallConfig.telephonyProvider || 'vobiz',
      to: cb.phone,
      name: cb.name || 'Callback Customer',
      publicUrl: defaultCallConfig.publicUrl || '',
      voice: agent?.voice || defaultCallConfig.voice,
      systemInstruction: callbackInstruction,
      recordCall: defaultCallConfig.gemini_record_call === 'true' || defaultCallConfig.recordCall || true,
      model: agent?.model || defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
      leadId: cb.leadId || null,
      saasApiUrl: cb.saasApiUrl || null,
      clientId: cb.clientId || null,
      exotelApiKey: defaultCallConfig.exotelApiKey,
      exotelApiToken: defaultCallConfig.exotelApiToken,
      exotelAccountSid: defaultCallConfig.exotelAccountSid,
      exotelSubdomain: defaultCallConfig.exotelSubdomain || 'api.exotel.com',
      exotelCallerId: defaultCallConfig.exotelCallerId,
      vobizAuthId: defaultCallConfig.vobizAuthId,
      vobizAuthToken: defaultCallConfig.vobizAuthToken,
      vobizCallerId: defaultCallConfig.vobizCallerId
    };

    try {
      const callRes = await fetch(`http://localhost:${PORT}/make-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeCallPayload)
      });
      const callData = await callRes.json();
      if (callData.success) {
        cb.status = 'dialed';
        cb.dialedAt = new Date().toISOString();
        cb.callSid = callData.callSid;
        console.log(`[Callback Scheduler] ✅ Callback call placed. CallSid: ${callData.callSid}`);
      } else {
        cb.status = 'failed';
        cb.error = callData.error || 'Unknown error';
        console.error(`[Callback Scheduler] ❌ Call failed: ${cb.error}`);
      }
    } catch (err) {
      cb.status = 'failed';
      cb.error = err.message;
      console.error(`[Callback Scheduler] ❌ Exception dialing callback: ${err.message}`);
    }

    callbacksDb.set(id, cb);
    saveCallbacks();
  }
}, 60 * 1000); // Check every 60 seconds

console.log('[Callback Scheduler] Auto-dialer scheduler started (60s interval).');


// Run server on specified port
server.listen(PORT, () => {
  console.log(`🚀 Telephony Calling Agent Backend running on port ${PORT}`);
});
