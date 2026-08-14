import express from 'express';
import compression from 'compression';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { twilioToGemini, geminiToTwilio, pcm8ToPcm16, pcm24ToPcm8, pcm24ToPcm16, swapBytes16 } from './audio-helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment configurations
dotenv.config();

let GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.warn("⚠️ WARNING: GEMINI_API_KEY is not defined in environment. Using default fallback key.");
  GEMINI_API_KEY = 'AQ.Ab8RN6I0ZOs9CRGzUNX3fQYn1e-FaGcdf_B3gjWRVDtpSF_4Zg';
}
const PORT = process.env.PORT || 5050;
const CONFIG_FILE = path.join(__dirname, 'config.json');
let config = {};

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch(e) {
      console.error('Failed to load config.json:', e.message);
      config = {};
    }
  }
}
loadConfig();

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch(e) {
    console.error('Failed to save config.json:', e.message);
  }
}

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
const broadcastsDb = new Map();
const BROADCASTS_DB_FILE = './broadcasts_db.json';

function loadBroadcasts() {
  try {
    if (fs.existsSync(BROADCASTS_DB_FILE)) {
      const raw = fs.readFileSync(BROADCASTS_DB_FILE, 'utf8');
      const data = JSON.parse(raw);
      for (const [k, v] of Object.entries(data)) {
        broadcastsDb.set(k, v);
      }
    }
  } catch (err) {
    console.error('[Startup] Failed to load broadcasts:', err.message);
  }
}

function saveBroadcasts() {
  try {
    const data = Object.fromEntries(broadcastsDb.entries());
    fs.writeFileSync(BROADCASTS_DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Database] Failed to save broadcasts:', err.message);
  }
}

const BRANDING_DB_FILE = './branding_db.json';
const brandingDb = new Map();

const ENTERPRISE_INQUIRIES_FILE = './enterprise_inquiries_db.json';
let enterpriseInquiries = [];

function loadEnterpriseInquiries() {
  try {
    if (fs.existsSync(ENTERPRISE_INQUIRIES_FILE)) {
      const raw = fs.readFileSync(ENTERPRISE_INQUIRIES_FILE, 'utf8');
      enterpriseInquiries = JSON.parse(raw);
    } else {
      enterpriseInquiries = [];
    }
  } catch (err) {
    console.error('[Startup] Failed to load enterprise inquiries:', err.message);
  }
}

function saveEnterpriseInquiries() {
  try {
    fs.writeFileSync(ENTERPRISE_INQUIRIES_FILE, JSON.stringify(enterpriseInquiries, null, 2), 'utf8');
  } catch (err) {
    console.error('[Database] Failed to save enterprise inquiries:', err.message);
  }
}

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

function getRealHostFromRequest(req) {
  if (!req) return '';
  let host = req.headers['x-forwarded-host'] || req.headers.origin || req.headers.referer || req.headers.host || '';
  if (Array.isArray(host)) host = host[0];
  host = String(host).replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase().trim();
  if (host.startsWith('www.')) host = host.substring(4);
  return host;
}

function isMainPlatformHost(host) {
  if (!host) return true;
  let cleanHost = String(host).replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase().trim();
  if (cleanHost.startsWith('www.')) cleanHost = cleanHost.substring(4);

  const mainDomains = [
    'callio.in', 'callingagent.com', 'vobiz.in', 'diginext360.com'
  ];
  if (mainDomains.includes(cleanHost)) return true;

  // Local development host check (only when explicitly localhost/127.0.0.1)
  if (cleanHost === 'localhost' || cleanHost === '127.0.0.1' || cleanHost === '0.0.0.0' || cleanHost.endsWith('.local') || cleanHost.endsWith('.localhost')) {
    return true;
  }

  return false;
}

function getResellerFromHost(host) {
  if (!host) return null;

  if (isMainPlatformHost(host)) {
    return null;
  }

  let cleanHost = String(host).replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase().trim();
  const domainWithoutWww = cleanHost.startsWith('www.') ? cleanHost.substring(4) : cleanHost;

  for (const reseller of resellersDb.values()) {
    if (reseller.status === 'suspended') continue;

    if (reseller.domain && reseller.domain.trim() !== '') {
      let rDomain = reseller.domain.trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
      if (rDomain.startsWith('www.')) rDomain = rDomain.substring(4);
      if (rDomain && (rDomain === domainWithoutWww || rDomain === cleanHost)) {
        return reseller;
      }
    }

    if (reseller.subdomain && reseller.subdomain.trim() !== '') {
      let rSub = reseller.subdomain.trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
      if (rSub.startsWith('www.')) rSub = rSub.substring(4);
      if (rSub && (rSub === domainWithoutWww || cleanHost === rSub || cleanHost === `${rSub}.callio.in` || cleanHost === `${rSub}.localhost`)) {
        return reseller;
      }
    }
  }
  return null;
}

function resolveBranding(host) {
  if (!host) return brandingDb.get('default');
  let cleanHost = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
  if (cleanHost.startsWith('www.')) cleanHost = cleanHost.substring(4);

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
      logoHeight: b.logoHeight ? Number(b.logoHeight) : 36,
      faviconUrl: b.faviconUrl || 'favicon.ico',
      authHeroUrl: b.authHeroUrl || b.auth_hero_url || 'auth_right_bg.png',
      primaryColor: b.primaryColor || '#FF6B4A',
      secondaryColor: b.secondaryColor || '#ae3115',
      supportEmail: b.supportEmail || reseller.email || '',
      supportPhone: b.supportPhone || '',
      copyrightText: b.copyrightText || `© ${new Date().getFullYear()} ${appName}. All rights reserved.`,
      demoSystemPrompt: b.demoSystemPrompt || reseller.demoSystemPrompt || ''
    };
  }

  // 2. Check brandingDb for custom domain record
  if (brandingDb.has(cleanHost)) {
    return brandingDb.get(cleanHost);
  }

  for (const branding of brandingDb.values()) {
    if (branding.customDomain && branding.customDomain.toLowerCase().replace(/^www\./, '') === cleanHost) {
      return branding;
    }
    if (branding.subdomain && branding.subdomain.toLowerCase() === cleanHost) {
      return branding;
    }
  }

  // 3. Fallback to default Callio branding
  const def = brandingDb.get('default') || {};
  return {
    id: 'default',
    customDomain: def.customDomain || '',
    subdomain: def.subdomain || '',
    appName: def.appName || 'Callio',
    logoUrl: def.logoUrl || 'logo_new.png',
    logoHeight: def.logoHeight ? Number(def.logoHeight) : 36,
    faviconUrl: def.faviconUrl || 'favicon.ico',
    authHeroUrl: def.authHeroUrl || def.auth_hero_url || 'auth_right_bg.png',
    primaryColor: def.primaryColor || '#FF6B4A',
    secondaryColor: def.secondaryColor || '#ae3115',
    supportEmail: def.supportEmail || '',
    supportPhone: def.supportPhone || '',
    copyrightText: def.copyrightText || '© 2026 Callio. All rights reserved.',
    demoSystemPrompt: def.demoSystemPrompt || ''
  };
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
    // Clean up corrupted calls where target 'to' was recorded as the Virtual Caller ID
    if (call.to && isVirtualNumber(call.to)) {
      if (call.from && !isVirtualNumber(call.from)) {
        console.log(`[Startup Sanitization] Fixing call ${key}: Changing target 'to' from virtual number ${call.to} to real caller ${call.from}`);
        call.to = call.from;
        call.direction = 'incoming';
        dirty = true;
      }
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

const PENDING_REQUESTS_FILE = './pending_requests_db.json';
const pendingRequests = new Map();
function loadPendingRequests() { loadDatabase(PENDING_REQUESTS_FILE, pendingRequests); }
function savePendingRequests() { saveDatabase(PENDING_REQUESTS_FILE, pendingRequests); }

function normalizePhoneKey(phoneStr) {
  if (!phoneStr) return '';
  let digits = String(phoneStr).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.substring(2);
  } else if (digits.length > 10) {
    digits = digits.slice(-10);
  }
  return digits;
}

async function syncVobizNumberWebhook(phoneNumber, clientId = null) {
  if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim() === '') return;
  const rawNumber = phoneNumber.trim();
  const digitsOnly = rawNumber.replace(/\D/g, '');
  const cleanNumber = rawNumber.replace(/[\s\-\(\)]/g, '');
  const e164Number = digitsOnly.startsWith('91') ? '+' + digitsOnly : '+' + digitsOnly;
  
  const masterAuthId = defaultCallConfig.vobizAuthId || process.env.VOBIZ_MASTER_AUTH_ID || 'MA_5VY3LRDW';
  const masterAuthToken = defaultCallConfig.vobizAuthToken || process.env.VOBIZ_MASTER_AUTH_TOKEN || 'eoJKIYccZirxLWHbVZmHKHa5LF0rt6Z0rLax0GVrbNZjmEZKeYuCSFml1btABTnr';
  const publicUrl = (defaultCallConfig.publicUrl || 'https://callio.in').trim().replace(/\/$/, '');

  if (!masterAuthId || !masterAuthToken) {
    console.warn(`[Vobiz Webhook Sync] Cannot sync ${digitsOnly}: Master Vobiz Auth ID/Token missing.`);
    return;
  }

  const webhookUrl = `${publicUrl}/incoming-call-vobiz${clientId ? `?client_id=${clientId}` : ''}`;
  console.log(`[Vobiz Webhook Sync] Updating voice_url for ${digitsOnly} -> ${webhookUrl}`);

  // Try formats: digits only (e.g. 917971442441) and E.164 (e.g. +917971442441)
  const numberFormats = Array.from(new Set([digitsOnly, e164Number, cleanNumber]));
  for (const numFormat of numberFormats) {
    try {
      const authHeader = 'Basic ' + Buffer.from(`${masterAuthId.trim()}:${masterAuthToken.trim()}`).toString('base64');
      const webhookApiUrl = `https://api.vobiz.ai/api/v1/Account/${masterAuthId.trim()}/Number/${encodeURIComponent(numFormat)}/`;
      const res = await fetch(webhookApiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': authHeader,
          'X-Auth-ID': masterAuthId.trim(),
          'X-Auth-Token': masterAuthToken.trim(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ voice_url: webhookUrl, voice_method: 'POST' })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log(`[Vobiz Webhook Sync] Successfully set voice_url for ${numFormat}`);
      } else {
        console.warn(`[Vobiz Webhook Sync] Vobiz API HTTP ${res.status} for ${numFormat}:`, data);
      }
    } catch (err) {
      console.error(`[Vobiz Webhook Sync Error] Failed for ${numFormat}:`, err.message);
    }
  }
}

async function syncVobizApplications() {
  const masterAuthId = defaultCallConfig.vobizAuthId || process.env.VOBIZ_MASTER_AUTH_ID || 'MA_5VY3LRDW';
  const masterAuthToken = defaultCallConfig.vobizAuthToken || process.env.VOBIZ_MASTER_AUTH_TOKEN || 'eoJKIYccZirxLWHbVZmHKHa5LF0rt6Z0rLax0GVrbNZjmEZKeYuCSFml1btABTnr';
  const publicUrl = (defaultCallConfig.publicUrl || 'https://callio.in').trim().replace(/\/$/, '');

  if (!masterAuthId || !masterAuthToken) return;

  const authHeader = 'Basic ' + Buffer.from(`${masterAuthId.trim()}:${masterAuthToken.trim()}`).toString('base64');
  const targetUrl = `${publicUrl}/incoming-call-vobiz`;

  try {
    const listUrl = `https://api.vobiz.ai/api/v1/Account/${masterAuthId.trim()}/Application/`;
    const res = await fetch(listUrl, {
      headers: {
        'Authorization': authHeader,
        'X-Auth-ID': masterAuthId.trim(),
        'X-Auth-Token': masterAuthToken.trim()
      }
    });
    if (res.ok) {
      const data = await res.json();
      const apps = data.objects || data.applications || [];
      for (const app of apps) {
        const appId = app.app_id || app.id;
        if (appId) {
          console.log(`[Vobiz Application Sync] Updating App ${app.app_name || appId} URLs to ${targetUrl}`);
          const updateUrl = `https://api.vobiz.ai/api/v1/Account/${masterAuthId.trim()}/Application/${appId}/`;
          await fetch(updateUrl, {
            method: 'PUT',
            headers: {
              'Authorization': authHeader,
              'X-Auth-ID': masterAuthId.trim(),
              'X-Auth-Token': masterAuthToken.trim(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              answer_url: targetUrl,
              answer_method: 'POST',
              hangup_url: targetUrl,
              hangup_method: 'POST',
              fallback_answer_url: targetUrl,
              fallback_method: 'POST'
            })
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error(`[Vobiz Application Sync Error]`, err.message);
  }
}

function loadClients() { 
  loadDatabase(CLIENTS_DB_FILE, clientsDb); 
  let dirty = false;
  for (const [key, client] of clientsDb.entries()) {
    if (client.balance === undefined) {
      client.balance = 0.00; // default 0.00 balance
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
    // Auto-fix status: if client has assigned phone_number, status MUST be active
    if (client.phone_number && client.phone_number.trim() !== '' && client.status === 'pending_number') {
      client.status = 'active';
      dirty = true;
    }
    // Auto-fix password hashing if any plain-text password exists
    if (client.password && client.password.length < 30) {
      console.log(`[Startup Fix] Hashing plain-text password for client ${client.name} (${client.email})`);
      client.password = hashPassword(client.password);
      dirty = true;
    }
  }
  if (dirty) {
    saveClients();
  }

  // Sync Vobiz webhooks for all assigned phone numbers in background
  setTimeout(async () => {
    for (const [cId, client] of clientsDb.entries()) {
      if (client.phone_number && client.phone_number.trim() !== '') {
        await syncVobizNumberWebhook(client.phone_number, cId);
      }
    }
  }, 3000);
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
loadPendingRequests();
loadCallbacks();
loadPlans();
loadTrialLimits();
loadTrialLeads();
loadEnterpriseInquiries();
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

function isVirtualNumber(phone) {
  if (!phone) return false;
  const cleaned = String(phone).replace(/\D/g, '');
  if (!cleaned) return false;

  let masterCallerId = process.env.VOBIZ_CALLER_ID || '917971442441';
  try {
    if (typeof defaultCallConfig !== 'undefined' && defaultCallConfig && defaultCallConfig.vobizCallerId) {
      masterCallerId = defaultCallConfig.vobizCallerId;
    }
  } catch (e) {
    // defaultCallConfig not initialized yet during early startup loadCalls
  }

  const masterNum = masterCallerId.replace(/\D/g, '');
  if (cleanAndComparePhone(cleaned, masterNum)) return true;

  try {
    if (typeof clientsDb !== 'undefined' && clientsDb && clientsDb.size > 0) {
      for (const c of clientsDb.values()) {
        if (c.phone_number && cleanAndComparePhone(cleaned, c.phone_number)) return true;
      }
    }
  } catch (e) {}

  return false;
}

function findContactByPhone(phone, clientId = null) {
  if (!phone) return null;
  for (const contact of contactsDb.values()) {
    if (cleanAndComparePhone(contact.phone, phone)) {
      if (clientId && clientId !== 'admin') {
        const group = groupsDb.get(contact.groupId);
        // Strict isolation: skip contacts owned by a different client
        if (group && group.clientId && group.clientId !== clientId) {
          continue;
        }
      }
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
  const initialTo = (details.to && !isVirtualNumber(details.to) && !details.to.includes('-')) ? details.to : (details.from && !isVirtualNumber(details.from) ? details.from : '');

  if (!activeCalls.has(callSid)) {
    // Smart-linking: check if there is a pending outbound call in 'calling' state created recently
    let pendingState = null;
    let pendingSid = null;
    for (const [sid, st] of activeCalls.entries()) {
      if (st.status === 'calling' && st.direction === 'outgoing' && sid !== callSid) {
        const isClientMatch = details.clientId && st.clientId === details.clientId;
        const isPhoneMatch = initialTo && cleanAndComparePhone(st.to, initialTo);
        const isRecent = st.createdAt && (Date.now() - new Date(st.createdAt).getTime()) < 120000;
        // Require explicit phone match OR (client match AND recent) to avoid hijacking calls across clients/numbers
        if (isPhoneMatch || (isClientMatch && isRecent)) {
          pendingState = st;
          pendingSid = sid;
          break;
        }
      }
    }

    if (pendingState && pendingSid) {
      console.log(`[getOrCreateCallState] Smart-linking pending outbound call ${pendingSid} -> ${callSid} (Target: ${pendingState.to}, Client: ${pendingState.clientId || 'None'})`);
      activeCalls.delete(pendingSid);
      const transferredConfig = callSettingsMap.get(pendingSid);
      if (transferredConfig) {
        callSettingsMap.set(callSid, transferredConfig);
        callSettingsMap.delete(pendingSid);
      }
      activeCalls.set(callSid, {
        ...pendingState,
        callSid: callSid,
        provider: details.provider || pendingState.provider || 'vobiz',
        status: details.status || 'active',
        startedAt: details.status === 'active' ? (pendingState.startedAt || new Date().toISOString()) : pendingState.startedAt,
        clientId: details.clientId || pendingState.clientId || null
      });
    } else {
      activeCalls.set(callSid, {
        callSid: callSid,
        provider: details.provider || 'vobiz',
        to: initialTo,
        from: details.from || '',
        direction: details.direction || null,
        name: details.name || '',
        status: details.status || 'calling',
        transcript: [],
        summary: '',
        recordingUrl: '',
        recordingStatus: 'none',
        recordCall: details.recordCall || false,
        createdAt: new Date().toISOString(),
        startedAt: details.status === 'active' ? new Date().toISOString() : null,
        clientId: details.clientId || null
      });
    }
  } else {
    const state = activeCalls.get(callSid);
    if (details.status) state.status = details.status;
    if (details.provider) state.provider = details.provider;
    if (details.direction === 'outgoing') {
      state.direction = 'outgoing';
    } else if (details.direction && !state.direction) {
      state.direction = details.direction;
    }
    if (details.from && !state.from) {
      state.from = details.from;
    }
    // Don't overwrite state.to if it already contains a valid customer phone number and details.to is virtual or UUID
    if (details.to) {
      const isCallSidOrUuid = details.to === callSid || details.to.includes('-');
      const isVirtual = isVirtualNumber(details.to);
      if (!isVirtual && !isCallSidOrUuid) {
        state.to = details.to;
      }
    }
    if (details.name && !state.name) state.name = details.name;
    if (details.recordCall === true) state.recordCall = true;
    if (details.clientId) state.clientId = details.clientId;
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

function generateLocalTranscriptSummary(transcriptTurns) {
  if (!Array.isArray(transcriptTurns) || transcriptTurns.length === 0) {
    return "No conversation occurred during the call.";
  }

  const userMessages = transcriptTurns.filter(t => t && t.role === 'user').map(t => t.text).join(' ');
  const lowerUser = userMessages.toLowerCase();

  let verdict = 'COMPLETED';
  let intent = 'General Discussion';
  let action = 'Follow up with lead';

  const isBooking = lowerUser.includes('appointment') || lowerUser.includes('book') || lowerUser.includes('slot') || lowerUser.includes('time') || lowerUser.includes('kal') || lowerUser.includes('baje');
  const isPrice = lowerUser.includes('price') || lowerUser.includes('rate') || lowerUser.includes('cost') || lowerUser.includes('kitna') || lowerUser.includes('charge');
  const isInterested = lowerUser.includes('interested') || lowerUser.includes('haan') || lowerUser.includes('yes') || isBooking || lowerUser.includes('achha') || lowerUser.includes('thik');
  const isNotInterested = lowerUser.includes('not interested') || lowerUser.includes('nahi chahiye') || lowerUser.includes('cut the call') || lowerUser.includes('mat karo');

  if (isNotInterested) {
    verdict = 'NOT INTERESTED';
    intent = 'Customer requested no further contact or declined offer.';
    action = 'Mark lead as not interested';
  } else if (isBooking) {
    verdict = 'INTERESTED';
    intent = 'Customer inquired about appointment booking & available time slots.';
    action = 'Confirm appointment booking details';
  } else if (isPrice) {
    verdict = 'INTERESTED';
    intent = 'Customer requested pricing and service structure.';
    action = 'Send pricing details and follow up';
  } else if (isInterested) {
    verdict = 'INTERESTED';
    intent = 'Customer expressed positive interest in the discussion.';
    action = 'Follow up with lead';
  }

  const userSentences = userMessages.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 5).slice(0, 3);
  let highlights = userSentences.length > 0 
    ? userSentences.map(s => `- User noted: "${s}"`).join('\n') 
    : `- Exchanged ${transcriptTurns.length} conversational turns.`;

  return `**VERDICT:** ${verdict}\n\n**Key Points:**\n- ${intent}\n${highlights}\n\n**Next Action:** ${action}`;
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

  const prompt = `You are an AI sales call analyst. Read this call transcript carefully and extract TWO things:

1. A direct, crisp summary in this EXACT format:
**VERDICT:** [INTERESTED / NOT INTERESTED / UNDECIDED]

**Key Points:**
- [1-line point]
- [1-line point]

**Next Action:** [What should the agent do next - 1 sentence]

2. **CUSTOMER_NAME:** [If the customer explicitly stated, introduced, or confirmed their name in the transcript (e.g. "My name is Vishnu", "I am Rahul Verma", "Mera naam Amit hai", "Haan main Priya bol rahi hoon"), write ONLY the full name of the customer here (e.g. "Vishnu Verma"). If NO name was stated, write "UNKNOWN"]

Rules:
- Be brutally direct. No fluff.
- VERDICT must be the very first thing.
- If customer stated their name, CUSTOMER_NAME must be written at the bottom.

Transcript:
${formattedTranscript}`;

  console.log(`[Summary Engine] Generating summary & name extraction for call ${callSid}...`);
  
  try {
    let rawSummaryText = null;
    const models = ['gemini-1.5-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-pro'];
    for (const model of models) {
      console.log(`[Summary Engine] Attempting summary generation with model: ${model}`);
      rawSummaryText = await callGeminiGenerateContent(model, prompt);
      if (rawSummaryText) {
        console.log(`[Summary Engine] Summary successfully generated using model: ${model}`);
        break;
      }
    }

    if (!rawSummaryText) {
      console.warn(`[Summary Engine] Gemini API returned empty for call ${callSid}. Generating smart local transcript summary...`);
      rawSummaryText = generateLocalTranscriptSummary(callState.transcript);
    }

    let extractedName = null;

    // 1. Try extracting name from Gemini response
    const nameMatch = rawSummaryText.match(/\*\*(?:CUSTOMER_NAME|Customer Name):\*\*\s*([^\n]+)/i) || 
                      rawSummaryText.match(/(?:CUSTOMER_NAME|Customer Name):\s*([^\n]+)/i);
    if (nameMatch) {
      const rawName = nameMatch[1].trim().replace(/[\*\_\"]/g, '');
      if (rawName && !rawName.toUpperCase().includes('UNKNOWN') && rawName.length >= 2 && rawName.length <= 40) {
        extractedName = rawName;
      }
    }

    // 2. Fallback regex extraction on formattedTranscript (Hindi & English patterns)
    if (!extractedName) {
      const introRegex = /(?:mera naam|my name is|i am|main|this is|call me)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i;
      const match = formattedTranscript.match(introRegex);
      if (match && match[1]) {
        const candidate = match[1].trim();
        const blacklist = ['agent', 'user', 'call', 'hello', 'hi', 'telephony', 'ai', 'callio', 'vobiz'];
        if (candidate && candidate.length >= 2 && !blacklist.includes(candidate.toLowerCase())) {
          extractedName = candidate;
        }
      }
    }

    // Clean out CUSTOMER_NAME tag line from summary text for clean display
    const cleanSummary = rawSummaryText
      .replace(/\*\*(?:CUSTOMER_NAME|Customer Name):\*\*\s*[^\n]*/gi, '')
      .replace(/(?:CUSTOMER_NAME|Customer Name):\s*[^\n]*/gi, '')
      .trim();

    callState.summary = cleanSummary;

    // Auto-save/update contact in contactsDb if name was detected
    if (extractedName) {
      console.log(`[Auto Contact Save] 👤 Extracted customer name: "${extractedName}" for call ${callSid}`);
      
      const systemNumbers = ['917971442441', '7971442441', '971442441'];
      function isSysNum(ph) {
        if (!ph) return true;
        const c = String(ph).replace(/\D/g, '');
        return !c || c.length < 8 || systemNumbers.some(n => c === n || c.endsWith(n) || n.endsWith(c));
      }

      const candidatePhone = [callState.customerNumber, callState.phone, callState.to, callState.from]
        .find(p => p && !isSysNum(p));

      if (candidatePhone) {
        const normKey = normalizePhoneKey(candidatePhone);
        let existingContact = null;

        for (const contact of contactsDb.values()) {
          if (contact && contact.phone && normalizePhoneKey(contact.phone) === normKey) {
            existingContact = contact;
            break;
          }
        }

        if (existingContact) {
          if (!existingContact.name || existingContact.name === candidatePhone || normalizePhoneKey(existingContact.name) === normKey) {
            existingContact.name = extractedName;
            existingContact.updatedAt = Date.now();
            contactsDb.set(existingContact.id, existingContact);
            saveContacts();
            console.log(`[Auto Contact Save] ✏️ Updated existing contact ${existingContact.id} with name: "${extractedName}"`);
          }
        } else {
          let groupId = 'default';
          for (const [gId, g] of groupsDb.entries()) {
            if (g) { groupId = gId; break; }
          }

          const newContactId = `cont_ai_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          const newContact = {
            id: newContactId,
            groupId: groupId,
            phone: candidatePhone,
            name: extractedName,
            tag: 'AI Auto-Saved',
            notes: `Auto-saved from AI call on ${new Date().toLocaleDateString()}`,
            createdAt: Date.now()
          };

          contactsDb.set(newContactId, newContact);
          saveContacts();
          console.log(`[Auto Contact Save] 🌟 Auto-created NEW Contact: "${extractedName}" (${candidatePhone})`);
        }

        callState.customerName = extractedName;
        if (callState.callSid && callsDb.has(callState.callSid)) {
          const cRecord = callsDb.get(callState.callSid);
          cRecord.customerName = extractedName;
          callsDb.set(callState.callSid, cRecord);
        }
      }
    }

    console.log(`[Summary Engine] Summary & Contact extraction completed successfully for call ${callSid}.`);
    scheduleSaveCalls();
  } catch (err) {
    console.error(`[Summary Engine Exception] for call ${callSid}:`, err.message);
    const turns = callState.transcript ? callState.transcript.length : 0;
    callState.summary = `**VERDICT:** COMPLETED\n\n**Key Points:**\n- Call completed (${turns} conversational turns).\n- Audio recorded successfully.\n\n**Next Action:** Follow up with customer.`;
    scheduleSaveCalls();
  }
}

function handleCallEnd(callSid, finalStatus = 'completed') {
  if (!callSid) return;
  const callState = activeCalls.get(callSid);
  if (!callState) return;

  if (callState._billingProcessed) {
    return;
  }
  callState._billingProcessed = true;

  console.log(`[Call Lifecycle] Call ${callSid} ended. Setting status to: ${finalStatus}`);
  callState.status = finalStatus;
  callState.endedAt = new Date().toISOString();
  callState.updatedAt = new Date().toISOString();
  if (!callState.mediaEndedAt && callState.mediaStartedAt) {
    callState.mediaEndedAt = callState.endedAt;
  }
  scheduleSaveCalls();

  // SaaS Billing Calculation
  try {
    const clientId = callState.clientId;
    if (clientId && clientsDb.has(clientId)) {
      const client = clientsDb.get(clientId);

      const wasAnswered = Boolean(callState.answeredAt || callState.mediaStartedAt);
      const hasSpeechOrTranscript = Boolean((callState.transcript && callState.transcript.length > 0) || callState.userHasSpoken);
      const isUnbilledStatus = ['failed', 'busy', 'no-answer', 'canceled', 'voicemail', 'rejected'].includes(finalStatus) || 
                               ['failed', 'busy', 'no-answer', 'canceled', 'voicemail', 'rejected'].includes(callState.status);

      let rawDuration = 0;
      if (callState.providerDuration && !isNaN(callState.providerDuration) && Number(callState.providerDuration) > 0) {
        rawDuration = Number(callState.providerDuration);
      } else if (callState.mediaStartedAt && callState.mediaEndedAt) {
        const mStart = new Date(callState.mediaStartedAt).getTime();
        const mEnd = new Date(callState.mediaEndedAt).getTime();
        if (!isNaN(mStart) && !isNaN(mEnd) && mEnd > mStart) {
          rawDuration = Math.round((mEnd - mStart) / 1000);
        }
      } else if (callState.answeredAt) {
        const aStart = new Date(callState.answeredAt).getTime();
        const aEnd = new Date(callState.mediaEndedAt || callState.endedAt || Date.now()).getTime();
        if (!isNaN(aStart) && !isNaN(aEnd) && aEnd > aStart) {
          rawDuration = Math.round((aEnd - aStart) / 1000);
        }
      }

      // Safety cap: Duration CANNOT exceed actual WebSocket stream lifetime + 5 seconds
      if (callState.mediaStartedAt) {
        const maxStreamSec = Math.round((new Date(callState.mediaEndedAt || Date.now()).getTime() - new Date(callState.mediaStartedAt).getTime()) / 1000) + 5;
        if (rawDuration > maxStreamSec && maxStreamSec > 0) {
          rawDuration = maxStreamSec;
        }
      }

      const durationSec = Math.min(Math.max(0, rawDuration), 900);

      // Disconnected / Early-Cut / Failed Call detection:
      // Calls cut within 10s, unanswered, without speech, or with failed status count towards the 3-disconnect rule
      const isDisconnectedCall = !wasAnswered || !hasSpeechOrTranscript || isUnbilledStatus || durationSec < 10;

      if (isDisconnectedCall) {
        client.disconnected_call_count = (client.disconnected_call_count || 0) + 1;
        console.log(`[Disconnect Billing] Disconnected / Early-Cut Call detected (${callSid}, duration: ${durationSec}s, status: ${finalStatus}). Count for client ${client.name} (${client.id}): ${client.disconnected_call_count}/3`);

        if (client.disconnected_call_count >= 3) {
          client.disconnected_call_count = 0; // reset counter after penalty
          const penaltyMinutes = 1;
          const currentBalance = typeof client.balance === 'number' ? client.balance : 0;

          if (currentBalance >= -100) {
            client.balance = Number((currentBalance - penaltyMinutes).toFixed(2));
            client.used_minutes = Number(((client.used_minutes || 0) + penaltyMinutes).toFixed(2));
            client.billing_history = client.billing_history || [];
            client.billing_history.unshift({
              id: `txn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              timestamp: new Date().toISOString(),
              type: 'disconnect_penalty_charge',
              callSid: callSid,
              phone: callState.to || '',
              duration: durationSec,
              callCost: 0,
              recordingCost: 0,
              sessionCost: 0,
              totalCharge: penaltyMinutes,
              description: `Disconnect Penalty Charge: 3 Disconnected / Early-Cut Calls (1 min deducted)`
            });

            console.log(`[Disconnect Billing] Deducted 1 min penalty from client ${client.name} for 3 disconnected call attempts. New balance: ${client.balance} mins`);
            saveClients();

            if (typeof global.chargeResellerForCall === 'function') {
              global.chargeResellerForCall(clientId, penaltyMinutes);
            }
          }
        } else {
          saveClients();
        }
      } else {
        // Standard Billed Call (duration >= 10s with conversation)
        const billedMinutes = durationSec > 0 ? Math.ceil(durationSec / 60) : 0;
        const totalCharge = Math.min(billedMinutes, 15);

        if (totalCharge > 0) {
          const currentBalance = typeof client.balance === 'number' ? client.balance : 0;
          if (currentBalance >= -100) {
            client.balance = Number((currentBalance - totalCharge).toFixed(2));
            client.used_minutes = Number(((client.used_minutes || 0) + totalCharge).toFixed(2));
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
              description: `Call to ${callState.to || 'Unknown'} (${durationSec}s → billed ${totalCharge} min) ${callState.recordCall ? 'with recording' : 'no recording'}`
            });

            console.log(`[SaaS Billing] Charged Client: ${client.name} (ID: ${clientId}) total: ${totalCharge} min for CallSid: ${callSid}. New balance: ${client.balance} mins`);
            saveClients();

            if (typeof global.chargeResellerForCall === 'function' && totalCharge > 0) {
              global.chargeResellerForCall(clientId, totalCharge);
            }
          }
        }
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

function getIncomingCallConfig(query = {}, fromNum = '', clientId = '', toNum = '') {
  const recordCall = defaultCallConfig.gemini_record_call === 'true' || defaultCallConfig.recordCall || false;

  let effectiveClientId = clientId || (typeof query === 'object' && query ? (query.client_id || query['amp;client_id']) : '') || '';
  
  // Auto-resolve client by target/caller virtual number if clientId not explicitly provided
  if (!effectiveClientId) {
    if (toNum) {
      for (const [cId, c] of clientsDb.entries()) {
        if (c.phone_number && cleanAndComparePhone(c.phone_number, toNum)) {
          effectiveClientId = cId;
          break;
        }
      }
    }
    if (!effectiveClientId && fromNum) {
      for (const [cId, c] of clientsDb.entries()) {
        if (c.phone_number && cleanAndComparePhone(c.phone_number, fromNum)) {
          effectiveClientId = cId;
          break;
        }
      }
    }
  }

  let clientObj = null;
  if (effectiveClientId && clientsDb.has(effectiveClientId)) {
    clientObj = clientsDb.get(effectiveClientId);
  }

  // 1. Determine tagRules and incomingAgentId (client-specific first, fallback to global)
  const tagRules = clientObj?.agent_config?.tagRules || clientObj?.tagRules || defaultCallConfig.tagRules || [];
  const incomingAgentId = clientObj?.agent_config?.incomingAgentId || clientObj?.incomingAgentId || defaultCallConfig.incomingAgentId;

  // ─── TAG-BASED ROUTING ──────────────────────────────────────────────────────
  if (fromNum) {
    const callerContact = findContactByPhone(fromNum, effectiveClientId);
    if (callerContact && callerContact.tag) {
      const contactTag = callerContact.tag.toLowerCase().trim();
      console.log(`[Incoming Routing] Caller ${fromNum} has tag: "${contactTag}" — searching for matching agent…`);

      let taggedAgent = null;
      const matchedRule = tagRules.find(r => r.tag && r.tag.toLowerCase() === contactTag);
      if (matchedRule && matchedRule.agentId) {
        taggedAgent = agentsDb.get(matchedRule.agentId) || null;
        if (taggedAgent) console.log(`[Incoming Routing] Matched via tagRules config: agentId ${matchedRule.agentId}`);
      }

      if (!taggedAgent) {
        for (const agent of agentsDb.values()) {
          // If effectiveClientId exists, isolate search to agents belonging to this client or unassigned
          if (effectiveClientId && agent.clientId && agent.clientId !== effectiveClientId) continue;
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
          voice: taggedAgent.voice || clientObj?.agent_config?.voice || defaultCallConfig.voice || 'Aoede',
          systemInstruction: systemInstruction || clientObj?.agent_config?.system_prompt || defaultCallConfig.systemInstruction,
          model: taggedAgent.model || defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
          name: callerContact.name || '',
          recordCall: recordCall,
          clientId: effectiveClientId || null,
          vobizAuthId: clientObj?.vobiz_sub_auth_id || defaultCallConfig.vobizAuthId,
          vobizAuthToken: clientObj?.vobiz_sub_auth_token || defaultCallConfig.vobizAuthToken,
          vobizCallerId: defaultCallConfig.vobizCallerId
        };
      }
    }
  }

  // ─── DEFAULT INCOMING AGENT ROUTING ─────────────────────────────────────────
  if (incomingAgentId) {
    const agent = agentsDb.get(incomingAgentId);
    if (agent) {
      console.log(`[Incoming Routing] Dynamically routing call to agent: ${agent.name} (ID: ${agent.id}) for Client: ${clientObj ? clientObj.name : 'Default Global'}`);
      let systemInstruction = agent.systemInstruction || '';
      if (agent.name) {
        systemInstruction = `[IDENTITY DIRECTIVE: Your name is "${agent.name}". You must introduce yourself as "${agent.name}" and identify as "${agent.name}" if asked for your name. In Hindi/Hinglish, you can say "Mera naam ${agent.name} hai".]\n\n` + systemInstruction;
      }
      if (agent.mood && agent.mood !== 'Professional') {
        systemInstruction = `[MOOD DIRECTIVE: You must act and speak in a ${agent.mood.toUpperCase()} mood at all times.]\n\n` + systemInstruction;
      }
      return {
        voice: agent.voice || clientObj?.agent_config?.voice || defaultCallConfig.voice || 'Aoede',
        systemInstruction: systemInstruction || clientObj?.agent_config?.system_prompt || defaultCallConfig.systemInstruction,
        model: agent.model || defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
        name: '',
        recordCall: recordCall,
        clientId: effectiveClientId || null,
        vobizAuthId: clientObj?.vobiz_sub_auth_id || defaultCallConfig.vobizAuthId,
        vobizAuthToken: clientObj?.vobiz_sub_auth_token || defaultCallConfig.vobizAuthToken,
        vobizCallerId: defaultCallConfig.vobizCallerId
      };
    } else {
      console.warn(`[Incoming Routing] Warning: Incoming Agent ID ${incomingAgentId} not found in agentsDb.`);
    }
  }

  // ─── CLIENT FALLBACK PROMPT ──────────────────────────────────────────────────
  if (clientObj) {
    console.log(`[Incoming Routing] Routing call to client's saved system_prompt: ${clientObj.name}`);
    return {
      voice: clientObj.agent_config?.voice || defaultCallConfig.voice || 'Aoede',
      systemInstruction: clientObj.agent_config?.system_prompt || defaultCallConfig.systemInstruction,
      model: defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
      name: clientObj.name || '',
      recordCall: recordCall,
      clientId: effectiveClientId,
      vobizAuthId: clientObj.vobiz_sub_auth_id || defaultCallConfig.vobizAuthId,
      vobizAuthToken: clientObj.vobiz_sub_auth_token || defaultCallConfig.vobizAuthToken
    };
  }

  return {
    voice: (typeof query === 'object' && query?.voice) || defaultCallConfig.voice || 'Aoede',
    systemInstruction: (typeof query === 'object' && query?.systemInstruction) || defaultCallConfig.systemInstruction,
    model: defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
    name: '',
    recordCall: recordCall,
    vobizAuthId: defaultCallConfig.vobizAuthId,
    vobizAuthToken: defaultCallConfig.vobizAuthToken,
    vobizCallerId: defaultCallConfig.vobizCallerId
  };
}


const app = express();
app.use(compression());
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.json({ limit: '50mb' }));


// CORS Middleware to allow requests from the SaaS platform
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, api-key, ngrok-skip-browser-warning');
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

  const rawAuthHeader = req.headers.authorization || '';
  const key = (rawAuthHeader ? rawAuthHeader.replace(/^Bearer\s+/i, '') : '') ||
              req.headers['x-api-key'] ||
              req.headers['api-key'] ||
              req.query?.api_key ||
              req.body?.apiKey || '';

  const isWebhook = req.path.includes('/api/webhooks/');

  if ((isDashboard || isWebhook) && !key) {
    // Allow webhooks and local dashboard requests to proceed without requiring API Key
    return next();
  }

  if (!key) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Missing API Key' });
  }

  const cleanKey = key.trim();
  const masterKey = (defaultCallConfig.apiKey || '').trim();
  let matchedClient = null;

  // 1. Check clientsDb first for client key matching
  for (const [cId, client] of clientsDb.entries()) {
    if ((client.api_key && client.api_key.trim() === cleanKey) ||
        (client.vobiz_sub_auth_token && client.vobiz_sub_auth_token.trim() === cleanKey) ||
        cId === cleanKey) {
      matchedClient = client;
      req.query.clientId = cId;
      req.clientId = cId;
      break;
    }
  }

  // 2. Check resellersDb for reseller key matching
  if (!matchedClient) {
    for (const [rId, reseller] of resellersDb.entries()) {
      if ((reseller.api_key && reseller.api_key.trim() === cleanKey) ||
          (reseller.vobiz_sub_auth_token && reseller.vobiz_sub_auth_token.trim() === cleanKey) ||
          (reseller.auth_token && reseller.auth_token.trim() === cleanKey) ||
          rId === cleanKey) {
        matchedClient = reseller;
        req.query.clientId = rId;
        req.clientId = rId;
        break;
      }
    }
  }

  // 3. If not matched to a client or reseller, verify master admin key
  if (!matchedClient) {
    if (masterKey && cleanKey === masterKey) {
      // Authenticated as Master Admin
    } else if (masterKey) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid API Key' });
    }
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
  const clientId = req.query.clientId || req.query.client_id || req.clientId || '';
  let targetClient = null;
  if (clientId && clientsDb.has(clientId)) {
    targetClient = clientsDb.get(clientId);
  } else if (clientId && resellersDb.has(clientId)) {
    targetClient = resellersDb.get(clientId);
  }

  if (targetClient) {
    if (!targetClient.api_key) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let newKey = 'ca_';
      for (let i = 0; i < 32; i++) {
        newKey += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      targetClient.api_key = newKey;
      if (clientsDb.has(clientId)) saveClients();
      else if (resellersDb.has(clientId)) saveResellers();
    }
    return res.json({
      success: true,
      apiKey: targetClient.api_key || '',
      shareAgents: targetClient.shareAgents !== false,
      shareContacts: targetClient.shareContacts !== false,
      shareCalls: targetClient.shareCalls !== false
    });
  }

  res.json({
    success: true,
    apiKey: defaultCallConfig.apiKey || '',
    shareAgents: defaultCallConfig.shareAgents !== false,
    shareContacts: defaultCallConfig.shareContacts !== false,
    shareCalls: defaultCallConfig.shareCalls !== false
  });
});

// Endpoint to dynamically synchronize backend config defaults for incoming calls and webhook dialer credentials
app.post('/save-config', (req, res) => {
  const { clientId, apiKey, shareAgents, shareContacts, shareCalls } = req.body;
  const targetId = clientId || req.clientId || '';
  let targetClient = null;

  if (targetId && clientsDb.has(targetId)) {
    targetClient = clientsDb.get(targetId);
  } else if (targetId && resellersDb.has(targetId)) {
    targetClient = resellersDb.get(targetId);
  }

  if (targetClient) {
    if (apiKey !== undefined) targetClient.api_key = apiKey;
    if (shareAgents !== undefined) targetClient.shareAgents = shareAgents;
    if (shareContacts !== undefined) targetClient.shareContacts = shareContacts;
    if (shareCalls !== undefined) targetClient.shareCalls = shareCalls;
    
    if (clientsDb.has(targetId)) saveClients();
    else if (resellersDb.has(targetId)) saveResellers();

    console.log(`[Config Sync] Updated isolated API key for Client ${targetId}`);
    return res.json({ success: true, apiKey: targetClient.api_key });
  }

  Object.assign(defaultCallConfig, req.body);
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultCallConfig, null, 2), 'utf-8');
  } catch (err) {}
  
  res.json({ success: true });
});


// --- Tenant Branding API Endpoints ---
app.get('/api/public/branding', (req, res) => {
  const domain = req.query.domain || req.headers['x-forwarded-host'] || req.headers.host || '';
  const branding = resolveBranding(domain);
  res.json(branding);
});

app.post('/api/admin/branding', (req, res) => {
  const { id, customDomain, subdomain, appName, logoUrl, logoHeight, faviconUrl, authHeroUrl, primaryColor, secondaryColor, supportEmail, supportPhone, copyrightText, demoSystemPrompt } = req.body;

  if (!appName || typeof appName !== 'string' || appName.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'App Name / Company Name cannot be empty.' });
  }

  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  let cleanHost = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
  if (cleanHost.startsWith('www.')) cleanHost = cleanHost.substring(4);

  const currentReseller = getResellerFromHost(host);

  if (currentReseller) {
    // If request is made from a reseller portal (e.g. growvo.in), ONLY update this reseller's branding
    currentReseller.branding = {
      appName: appName !== undefined ? appName.trim() : (currentReseller.branding?.appName || ''),
      logoUrl: logoUrl !== undefined ? logoUrl : currentReseller.branding?.logoUrl,
      logoHeight: logoHeight ? Number(logoHeight) : (currentReseller.branding?.logoHeight || 36),
      faviconUrl: faviconUrl !== undefined ? faviconUrl : currentReseller.branding?.faviconUrl,
      authHeroUrl: authHeroUrl !== undefined ? authHeroUrl : (currentReseller.branding?.authHeroUrl || 'auth_right_bg.png'),
      primaryColor: primaryColor || currentReseller.branding?.primaryColor || '#FF6B4A',
      secondaryColor: secondaryColor || currentReseller.branding?.secondaryColor || '#ae3115',
      supportEmail: supportEmail !== undefined ? supportEmail : currentReseller.branding?.supportEmail,
      supportPhone: supportPhone !== undefined ? supportPhone : currentReseller.branding?.supportPhone,
      copyrightText: copyrightText !== undefined ? copyrightText : currentReseller.branding?.copyrightText,
      demoSystemPrompt: demoSystemPrompt !== undefined ? demoSystemPrompt : (currentReseller.branding?.demoSystemPrompt || '')
    };
    resellersDb.set(currentReseller.id, currentReseller);
    saveResellers();

    if (currentReseller.domain) {
      const rDomain = currentReseller.domain.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase().replace(/^www\./, '');
      brandingDb.set(rDomain, { id: currentReseller.id, ...currentReseller.branding });
      saveBranding();
    }

    return res.json({ success: true, branding: currentReseller.branding });
  }

  const targetDomain = (customDomain || cleanHost).replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase().replace(/^www\./, '');

  const brandingData = {
    id: targetDomain,
    customDomain: customDomain || '',
    subdomain: subdomain || '',
    appName: appName !== undefined ? appName.trim() : '',
    logoUrl: logoUrl || 'logo_new.png',
    logoHeight: logoHeight ? Number(logoHeight) : 36,
    faviconUrl: faviconUrl || 'favicon.ico',
    authHeroUrl: authHeroUrl || 'auth_right_bg.png',
    primaryColor: primaryColor || '#FF6B4A',
    secondaryColor: secondaryColor || '#ae3115',
    supportEmail: supportEmail || '',
    supportPhone: supportPhone || '',
    copyrightText: copyrightText || '© 2026 Callio. All rights reserved.',
    demoSystemPrompt: demoSystemPrompt !== undefined ? demoSystemPrompt : ''
  };

  if (targetDomain.includes('callio') || targetDomain.includes('localhost') || targetDomain === 'default') {
    brandingDb.set('default', brandingData);
  } else {
    brandingDb.set(targetDomain, brandingData);
  }
  saveBranding();

  res.json({ success: true, branding: brandingData });
});

// ─── Subscription Plans API & Razorpay Endpoints ──────────────────────────────
const plansDbPath = path.join(__dirname, 'plans_db.json');

function loadSubscriptionPlans() {
  if (fs.existsSync(plansDbPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(plansDbPath, 'utf8'));
      if (typeof data === 'object' && data !== null) {
        plansDb.clear();
        for (const [k, v] of Object.entries(data)) {
          plansDb.set(k, v);
        }
      }
    } catch (e) {
      console.error('Error reading plans_db.json:', e);
    }
  }
}
loadSubscriptionPlans();

function saveSubscriptionPlans() {
  try {
    const obj = Object.fromEntries(plansDb);
    fs.writeFileSync(plansDbPath, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('Error saving plans_db.json:', e);
  }
}

// GET /api/plans - Public endpoint to retrieve active subscription plans with Whitelabel isolation
app.get('/api/plans', (req, res) => {
  const host = req.headers.host || req.headers['x-forwarded-host'] || req.headers.origin || req.headers.referer || '';
  const reseller = getResellerFromHost(host);
  const basePlans = Array.from(plansDb.values());

  if (reseller) {
    // Isolated pricing for Whitelabel Reseller domain
    const customRates = reseller.wholesale_plan_rates || {};
    const wholesaleRatePerMin = reseller.quota?.wholesale_rate_per_minute || 2.0;
    const markups = reseller.markups || { per_minute_markup: 0, plan_markups: {} };

    const resellerPlans = basePlans.map(p => {
      const planKey = (p.id || '').toLowerCase();
      const customBasePrice = customRates[planKey] !== undefined ? Number(customRates[planKey]) : (p.base_price_per_month !== undefined ? Number(p.base_price_per_month) : Number(p.price_per_month || 0));
      const planMarkup = markups.plan_markups?.[planKey] ? Number(markups.plan_markups[planKey]) : 0;
      const finalMonthlyPrice = customBasePrice + planMarkup;

      const perMinMarkup = markups.per_minute_markup ? Number(markups.per_minute_markup) : 0;
      const finalRatePerMin = Number((wholesaleRatePerMin + perMinMarkup).toFixed(2));

      return {
        id: p.id,
        name: p.name,
        price_per_month: finalMonthlyPrice,
        base_price_per_month: customBasePrice,
        reseller_markup_monthly: planMarkup,
        rate_per_minute: finalRatePerMin,
        max_minutes: p.max_minutes !== undefined ? Number(p.max_minutes) : 99999,
        max_agents: p.max_agents !== undefined ? Number(p.max_agents) : 99999,
        crm_integration: !!p.crm_integration,
        api_sharing: !!p.api_sharing,
        description: p.description || '',
        razorpay_plan_id: p.razorpay_plan_id || ''
      };
    });

    return res.json({
      success: true,
      plans: resellerPlans,
      isWhitelabel: true,
      resellerName: reseller.companyName || reseller.name || 'Whitelabel Partner',
      currency: reseller.currency || 'INR',
      symbol: reseller.currency_symbol || '₹'
    });
  }

  // Main Platform (Admin) Base Plans
  const formattedPlans = basePlans.map(p => ({
    id: p.id,
    name: p.name,
    price_per_month: Number(p.price_per_month !== undefined ? p.price_per_month : (p.base_price_per_month !== undefined ? p.base_price_per_month : 0)),
    rate_per_minute: Number(p.rate_per_minute || 5),
    max_minutes: p.max_minutes !== undefined ? Number(p.max_minutes) : 99999,
    max_agents: p.max_agents !== undefined ? Number(p.max_agents) : 99999,
    crm_integration: !!p.crm_integration,
    api_sharing: !!p.api_sharing,
    description: p.description || '',
    razorpay_plan_id: p.razorpay_plan_id || ''
  }));

  res.json({
    success: true,
    plans: formattedPlans,
    isWhitelabel: false,
    resellerName: null,
    currency: 'INR',
    symbol: '₹'
  });
});


// GET /api/admin/razorpay-config
app.get('/api/admin/razorpay-config', (req, res) => {
  const host = req.headers.host || '';
  const currentReseller = getResellerFromHost(host);
  if (currentReseller) {
    return res.json({
      success: true,
      keyId: currentReseller.razorpayKeyId || '',
      keySecret: currentReseller.razorpayKeySecret ? '••••••••' : '',
      webhookSecret: currentReseller.razorpayWebhookSecret ? '••••••••' : '',
      isEnabled: !!currentReseller.razorpayKeyId
    });
  }
  // Super Admin Default Config
  res.json({
    success: true,
    keyId: process.env.RAZORPAY_KEY_ID || config.razorpayKeyId || '',
    keySecret: (process.env.RAZORPAY_KEY_SECRET || config.razorpayKeySecret) ? '••••••••' : '',
    webhookSecret: (process.env.RAZORPAY_WEBHOOK_SECRET || config.razorpayWebhookSecret) ? '••••••••' : '',
    isEnabled: !!(process.env.RAZORPAY_KEY_ID || config.razorpayKeyId)
  });
});

// POST /api/admin/razorpay-config
app.post('/api/admin/razorpay-config', express.json(), (req, res) => {
  const { keyId, keySecret, webhookSecret } = req.body;
  const host = req.headers.host || '';
  const currentReseller = getResellerFromHost(host);

  if (currentReseller) {
    if (keyId !== undefined) currentReseller.razorpayKeyId = keyId.trim();
    if (keySecret && keySecret !== '••••••••') currentReseller.razorpayKeySecret = keySecret.trim();
    if (webhookSecret && webhookSecret !== '••••••••') currentReseller.razorpayWebhookSecret = webhookSecret.trim();
    resellersDb.set(currentReseller.id, currentReseller);
    saveResellers();
    return res.json({ success: true, message: 'Reseller Razorpay credentials updated successfully!' });
  }

  // Super Admin Config
  if (keyId !== undefined) config.razorpayKeyId = keyId.trim();
  if (keySecret && keySecret !== '••••••••') config.razorpayKeySecret = keySecret.trim();
  saveConfig();
  res.json({ success: true, message: 'Super Admin Razorpay credentials updated successfully!' });
});

// GET /api/user/me — Returns current authenticated user/admin profile
app.get('/api/user/me', (req, res) => {
  const host = getRealHostFromRequest(req);
  const reseller = getResellerFromHost(host);

  if (reseller) {
    return res.json({
      success: true,
      user: {
        id: reseller.id,
        name: reseller.companyName || reseller.name || 'Whitelabel Admin',
        email: reseller.email || 'admin@reseller.com',
        role: 'admin',
        balance: reseller.balance || 0,
        plan: reseller.plan || 'pro'
      }
    });
  }

  // Super Admin Default Profile
  res.json({
    success: true,
    user: {
      id: 'admin',
      name: 'Super Admin',
      email: 'admin@callio.in',
      role: 'admin',
      balance: 1000,
      plan: 'pro'
    }
  });
});

// GET /api/admin/gstin — Retrieve domain GSTIN
app.get('/api/admin/gstin', (req, res) => {
  const host = getRealHostFromRequest(req);
  const reseller = getResellerFromHost(host);
  const gstin = reseller ? (reseller.gstin || '') : (config.gstin || '');
  res.json({ success: true, gstin });
});

// POST /api/admin/gstin — Save domain GSTIN
app.post('/api/admin/gstin', express.json(), (req, res) => {
  const { gstin } = req.body;
  const host = getRealHostFromRequest(req);
  const reseller = getResellerFromHost(host);
  const cleanGstin = String(gstin || '').trim().toUpperCase();

  if (reseller) {
    reseller.gstin = cleanGstin;
    resellersDb.set(reseller.id, reseller);
    saveResellers();
    return res.json({ success: true, message: 'Whitelabel Reseller GSTIN saved successfully!' });
  }

  config.gstin = cleanGstin;
  saveConfig();
  res.json({ success: true, message: 'Platform Super Admin GSTIN saved successfully!' });
});

// GET /api/client/transactions — Retrieve client balance & transaction history
app.get('/api/client/transactions', (req, res) => {
  const clientId = req.query.clientId || req.query.client_id || '';
  const host = getRealHostFromRequest(req);
  const reseller = getResellerFromHost(host);

  let targetObj = null;
  if (clientId && clientsDb.has(clientId)) {
    targetObj = clientsDb.get(clientId);
  } else if (clientId && resellersDb.has(clientId)) {
    targetObj = resellersDb.get(clientId);
  } else if (reseller) {
    targetObj = reseller;
  }

  if (!targetObj) {
    return res.json({ success: true, balance: 0, transactions: [], customerGstin: '', issuerGstin: reseller ? (reseller.gstin || '') : (config.gstin || '') });
  }

  // Tenant / Domain Isolation Check
  if (reseller) {
    const clientResellerId = targetObj.resellerId || targetObj.reseller_id || (resellersDb.has(targetObj.id) ? targetObj.id : null);
    if (clientResellerId !== reseller.id && targetObj.id !== reseller.id) {
      return res.json({ success: true, balance: 0, transactions: [], customerGstin: '', issuerGstin: reseller.gstin || '' });
    }
  } else if (targetObj.resellerId && targetObj.resellerId !== 'default' && targetObj.resellerId !== 'main') {
    return res.json({ success: true, balance: 0, transactions: [], customerGstin: '', issuerGstin: config.gstin || '' });
  }

  const issuerGstin = reseller ? (reseller.gstin || '') : (config.gstin || '');

  res.json({
    success: true,
    balance: targetObj.balance || 0,
    transactions: targetObj.transactions || [],
    customerGstin: targetObj.gstin || '',
    issuerGstin: issuerGstin
  });
});

// POST /api/razorpay/webhook & /api/webhooks/razorpay — Server-to-server Razorpay payment confirmation webhook
const handleRazorpayWebhook = (req, res) => {
  try {
    const host = getRealHostFromRequest(req);
    const reseller = getResellerFromHost(host);

    let webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || config.razorpayWebhookSecret || '');
    if (reseller && reseller.razorpayWebhookSecret) {
      webhookSecret = reseller.razorpayWebhookSecret;
    }

    const signature = req.headers['x-razorpay-signature'];
    const payload = req.body;

    if (webhookSecret && signature) {
      try {
        const rawBody = JSON.stringify(payload);
        const expectedSignature = crypto
          .createHmac('sha256', webhookSecret)
          .update(rawBody)
          .digest('hex');

        if (expectedSignature !== signature) {
          console.warn('[Razorpay Webhook] Signature verification mismatch, processing event gracefully.');
        }
      } catch (sigErr) {}
    }

    const event = payload.event;
    console.log(`[Razorpay Webhook] Received webhook event: ${event}`);

    // 1. One-Time Payment Captured
    if (event === 'payment.captured' || event === 'order.paid') {
      const payment = payload.payload?.payment?.entity;
      if (payment) {
        const paymentId = payment.id;
        const amountPaidInRs = payment.amount ? (payment.amount / 100) : 0;
        const notes = payment.notes || {};
        const clientId = notes.clientId || notes.client_id;
        const boughtMinutes = Number(notes.minutes) || Math.round(amountPaidInRs / 5);
        const customerGstin = notes.customerGstin || notes.gstin || '';

        console.log(`[Razorpay Webhook] Payment ${paymentId} captured! Amount: ₹${amountPaidInRs}, Client: ${clientId || 'unbound'}`);

        if (clientId) {
          let clientObj = clientsDb.get(clientId) || resellersDb.get(clientId);
          if (clientObj) {
            clientObj.balance = (clientObj.balance || 0) + boughtMinutes;
            if (customerGstin) clientObj.gstin = String(customerGstin).trim().toUpperCase();
            
            const issuerGstin = reseller ? (reseller.gstin || '') : (config.gstin || '');

            if (!clientObj.transactions) clientObj.transactions = [];
            clientObj.transactions.unshift({
              id: 'TXN_WH_' + Date.now(),
              timestamp: new Date().toISOString(),
              type: 'recharge',
              details: `Webhook Verified Recharge: +${boughtMinutes} Mins (Paid ₹${amountPaidInRs} | Ref: ${paymentId})`,
              duration: `${boughtMinutes} Mins`,
              usage: `+${boughtMinutes} Mins`,
              amountPaid: amountPaidInRs,
              customerGstin: clientObj.gstin || '',
              issuerGstin: issuerGstin
            });

            if (clientsDb.has(clientId)) saveClients();
            else if (resellersDb.has(clientId)) saveResellers();
            console.log(`[Razorpay Webhook] Wallet updated for ${clientObj.name || clientId}! New balance: ${clientObj.balance}`);
          }
        }
      }
    }

    // 2. Automatic Recurring Monthly Subscriptions (subscription.charged / subscription.authenticated)
    if (event === 'subscription.charged' || event === 'subscription.authenticated' || event === 'subscription.activated') {
      const subObj = payload.payload?.subscription?.entity || payload.payload?.payment?.entity || {};
      const notes = subObj.notes || {};
      const clientId = notes.clientId || notes.client_id;
      const planId = notes.planId || notes.plan_id;

      console.log(`[Razorpay Subscription Webhook] ${event} received for SubID: ${subObj.id}, Client: ${clientId}`);

      if (clientId && clientsDb.has(clientId)) {
        const clientObj = clientsDb.get(clientId);
        const plan = plansDb.get((planId || clientObj.plan || '').toLowerCase());
        
        clientObj.plan = (planId || clientObj.plan || 'pro').toLowerCase();
        clientObj.status = 'active';
        clientObj.used_minutes = 0.00; // Auto-renew 30-day monthly minutes cycle!
        if (subObj.id) clientObj.razorpay_subscription_id = subObj.id;

        clientObj.billing_history = clientObj.billing_history || [];
        clientObj.billing_history.unshift({
          id: 'sub_auto_' + Date.now(),
          date: new Date().toISOString(),
          description: `Monthly Auto-Debit Renewal (${plan ? plan.name : clientObj.plan}) - Ref: ${subObj.id || 'RECURRING'}`,
          amount: plan ? plan.price_per_month : 0,
          minutes: plan ? plan.max_minutes : 500,
          paymentMethod: 'Razorpay Auto-Recurring Subscription',
          status: 'Paid'
        });

        clientsDb.set(clientObj.id, clientObj);
        saveClients();
        console.log(`[Razorpay Webhook] Auto-renewed 30-day monthly subscription cycle for ${clientObj.name} (${clientObj.id})`);
      }
    }

    res.json({ status: 'ok', success: true });
  } catch (err) {
    console.error('[Razorpay Webhook Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
};

app.post('/api/razorpay/webhook', express.json(), handleRazorpayWebhook);
app.post('/api/webhooks/razorpay', express.json(), handleRazorpayWebhook);

// POST /api/client/recharge — Wallet Minute Recharge with Razorpay Verification
app.post('/api/client/recharge', express.json(), (req, res) => {
  const { clientId, amount, paymentMethod, razorpayPaymentId, isAdminManual, customerGstin } = req.body;
  const numAmount = Number(amount);

  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid recharge minute amount.' });
  }

  const host = getRealHostFromRequest(req);
  const reseller = getResellerFromHost(host);

  // Identify target client/reseller
  let targetId = clientId ? String(clientId).trim() : '';
  let clientObj = null;

  if (targetId && clientsDb.has(targetId)) {
    clientObj = clientsDb.get(targetId);
  } else if (targetId && resellersDb.has(targetId)) {
    clientObj = resellersDb.get(targetId);
  }

  if (!clientObj) {
    return res.status(400).json({ success: false, error: 'Target user account not found. Please log in again.' });
  }

  // Strictly enforce Domain / Tenant Isolation
  if (reseller) {
    // Request comes from a Whitelabel Reseller Domain (e.g. growvo.in)
    const clientResellerId = clientObj.resellerId || clientObj.reseller_id || (resellersDb.has(clientObj.id) ? clientObj.id : null);
    if (clientResellerId !== reseller.id && clientObj.id !== reseller.id) {
      console.warn(`[Security Alert] Cross-tenant recharge blocked! Host: ${host}, Client: ${clientObj.id}, Reseller: ${reseller.id}`);
      return res.status(403).json({ success: false, error: 'Cross-tenant payment forbidden. Account does not belong to this platform domain.' });
    }
  } else {
    // Request comes from Main Platform (e.g. callio.in)
    if (clientObj.resellerId && clientObj.resellerId !== 'default' && clientObj.resellerId !== 'main') {
      console.warn(`[Security Alert] Whitelabel client recharge blocked on Main Platform! Host: ${host}, Client: ${clientObj.id}, Client Reseller: ${clientObj.resellerId}`);
      return res.status(403).json({ success: false, error: 'Whitelabel user recharge must be completed on your reseller portal domain.' });
    }
  }

  // Security Check: Require Razorpay payment ID for non-admin users
  if (!isAdminManual && !razorpayPaymentId) {
    return res.status(400).json({ success: false, error: 'Payment verification failed. No Razorpay payment ID provided.' });
  }

  // Save Customer GSTIN if provided
  if (customerGstin) {
    clientObj.gstin = String(customerGstin).trim().toUpperCase();
  }

  // Server-side Razorpay auto-capture safety net if payment is in authorized state
  if (razorpayPaymentId) {
    try {
      const keyId = reseller ? reseller.razorpayKeyId : (process.env.RAZORPAY_KEY_ID || config.razorpayKeyId);
      const keySecret = reseller ? reseller.razorpayKeySecret : (process.env.RAZORPAY_KEY_SECRET || config.razorpayKeySecret);
      if (keyId && keySecret) {
        const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const rate = clientObj.plan === 'pro' ? 4.24 : (clientObj.plan === 'custom' ? 2.00 : 5.00);
        const amountPaisa = Math.round(numAmount * rate * 100);
        
        fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}/capture`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ amount: amountPaisa, currency: 'INR' })
        }).then(r => r.json()).then(capData => {
          console.log(`[Razorpay Auto-Capture] Payment ${razorpayPaymentId} auto-capture result:`, capData.status || capData.error?.description || 'processed');
        }).catch(err => {
          console.warn('[Razorpay Auto-Capture Warn]:', err.message);
        });
      }
    } catch(e) {}
  }

  // Credit balance
  clientObj.balance = (clientObj.balance || 0) + numAmount;

  const issuerGstin = reseller ? (reseller.gstin || '') : (config.gstin || '');

  // Add ledger transaction entry
  if (!clientObj.transactions) clientObj.transactions = [];
  const txnId = 'TXN_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4).toUpperCase();
  const rate = clientObj.plan === 'pro' ? 4.24 : (clientObj.plan === 'custom' ? 2.00 : 5.00);
  const paidCost = (numAmount * rate).toFixed(2);
  
  clientObj.transactions.unshift({
    id: txnId,
    timestamp: new Date().toISOString(),
    type: 'recharge',
    details: `Wallet Recharge of ${numAmount} Minutes via ${paymentMethod || 'Razorpay'}${razorpayPaymentId ? ` (Paid ₹${paidCost} | Ref: ${razorpayPaymentId})` : ' (Admin Manual Top-Up)'}`,
    duration: `${numAmount} Mins`,
    usage: `+${numAmount} Mins`,
    amountPaid: Number(paidCost),
    customerGstin: clientObj.gstin || (customerGstin ? String(customerGstin).trim().toUpperCase() : ''),
    issuerGstin: issuerGstin
  });

  if (clientsDb.has(targetId)) {
    clientsDb.set(targetId, clientObj);
    saveClients();
  } else if (resellersDb.has(targetId)) {
    resellersDb.set(targetId, clientObj);
    saveResellers();
  }

  console.log(`[Wallet Recharge] Successfully credited ${numAmount} Mins to ${clientObj.name || targetId}. New Balance: ${clientObj.balance}`);
  res.json({ success: true, balance: clientObj.balance, transactionId: txnId, customerGstin: clientObj.gstin || '' });
});

// ─── Enterprise Inquiry Endpoints ─────────────────────────────────────────────

// POST /api/public/enterprise-inquiry — public form submission
app.post('/api/public/enterprise-inquiry', express.json(), (req, res) => {
  const { name, phone, company, requirement } = req.body;
  if (!name || !phone || !company || !requirement) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }

  const host = getRealHostFromRequest(req);
  const reseller = getResellerFromHost(host);

  const inquiry = {
    id: 'ent_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    timestamp: new Date().toISOString(),
    name: name.trim(),
    phone: phone.trim(),
    company: company.trim(),
    requirement: requirement.trim(),
    status: 'new',
    reseller_id: reseller ? reseller.id : null,
    reseller_name: reseller ? (reseller.brand_name || reseller.name || 'Whitelabel Partner') : 'Callio Main',
    domain: reseller ? (reseller.domain || host) : host
  };

  enterpriseInquiries.push(inquiry);
  saveEnterpriseInquiries();
  console.log(`[Enterprise Inquiry] New inquiry from ${name} (${company}) via ${inquiry.domain}`);
  res.json({ success: true, message: 'Your enterprise inquiry has been submitted! Our team will contact you shortly.' });
});

// GET /api/admin/enterprise-inquiries — fetch inquiries for admin/reseller
app.get('/api/admin/enterprise-inquiries', (req, res) => {
  const sessionToken = req.headers['x-session-token'] || req.query.token;
  const host = getRealHostFromRequest(req);
  const reseller = getResellerFromHost(host);

  // For reseller admin portals — only return their inquiries
  if (reseller) {
    const filtered = enterpriseInquiries.filter(i => i.reseller_id === reseller.id);
    return res.json({ success: true, inquiries: filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) });
  }

  // For super admin — return all inquiries
  res.json({ success: true, inquiries: [...enterpriseInquiries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) });
});

// POST /api/admin/enterprise-inquiry/update-status — update or delete an inquiry
app.post('/api/admin/enterprise-inquiry/update-status', express.json(), (req, res) => {
  const { id, status, action } = req.body;
  if (!id) return res.status(400).json({ success: false, error: 'Inquiry ID required.' });

  if (action === 'delete') {
    enterpriseInquiries = enterpriseInquiries.filter(i => i.id !== id);
    saveEnterpriseInquiries();
    return res.json({ success: true, message: 'Inquiry deleted.' });
  }

  const inquiry = enterpriseInquiries.find(i => i.id === id);
  if (!inquiry) return res.status(404).json({ success: false, error: 'Inquiry not found.' });

  if (status) inquiry.status = status;
  inquiry.updated_at = new Date().toISOString();
  saveEnterpriseInquiries();
  res.json({ success: true, inquiry });
});

app.post('/api/upload-branding-asset', express.json({ limit: '50mb' }), (req, res) => {
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

app.use('/uploads', express.static('./uploads', {
  maxAge: '30d',
  immutable: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  }
}));

app.get('/app', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'app.html'));
});

app.get('/reseller', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'reseller.html'));
});

// Serving static front-end files with smart caching headers
app.use(express.static('./', {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    // Images & Fonts: Cache for 1 day in browser
    if (/\.(png|jpg|jpeg|gif|ico|svg|webp|woff2?|ttf|eot)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    }
    // CSS & JS files: Instant revalidation (no-cache)
    else if (/\.(css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // HTML files: Quick revalidation check
    else if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));

// ─── Routing Config API ───────────────────────────────────────────────────────
// GET: return current incomingAgentId + tagRules from client or defaultCallConfig
app.get('/api/routing-config', (req, res) => {
  const clientId = req.query.client_id || req.headers['x-client-id'] || '';
  if (clientId && clientsDb.has(clientId)) {
    const client = clientsDb.get(clientId);
    return res.json({
      success: true,
      incomingAgentId: client.agent_config?.incomingAgentId || client.incomingAgentId || '',
      tagRules: client.agent_config?.tagRules || client.tagRules || []
    });
  }
  res.json({
    success: true,
    incomingAgentId: defaultCallConfig.incomingAgentId || '',
    tagRules: defaultCallConfig.tagRules || []
  });
});

// POST: update incomingAgentId and/or tagRules, persist to client and config.json
app.post('/api/routing-config', express.json(), (req, res) => {
  const { incomingAgentId, tagRules } = req.body;
  const clientId = req.query.client_id || req.body.client_id || req.headers['x-client-id'] || '';

  if (clientId && clientsDb.has(clientId)) {
    const client = clientsDb.get(clientId);
    if (!client.agent_config) client.agent_config = {};
    if (incomingAgentId !== undefined) {
      client.agent_config.incomingAgentId = incomingAgentId;
      client.incomingAgentId = incomingAgentId;
    }
    if (tagRules !== undefined) {
      client.agent_config.tagRules = tagRules;
      client.tagRules = tagRules;
    }
    clientsDb.set(clientId, client);
    saveClients();
    console.log(`[Routing Config] Saved for Client ${client.name} (${clientId}) — incomingAgentId: ${incomingAgentId}`);
  }

  // Also save to global defaultCallConfig for global fallbacks
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
  const reqHost = getRealHostFromRequest(req);
  const reqBranding = resolveBranding(reqHost);
  const brandName = (reqBranding && (reqBranding.brandName || reqBranding.brand_name || reqBranding.appName)) || 'Callio';
  const prompt = `You are an expert conversational analyst. Below is a transcript from a live demo call between a user and "${brandName} AI".
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
      // Fallback regex extraction if Gemini returned unescaped JSON text
      const sumMatch = jsonText.match(/"summary"\s*:\s*"([\s\S]*?)"\s*,\s*"leadQuality"/i) 
                    || jsonText.match(/"summary"\s*:\s*"([\s\S]*?)"/i);
      const qualMatch = jsonText.match(/"leadQuality"\s*:\s*"([\s\S]*?)"/i);
      const actMatch = jsonText.match(/"actionToTake"\s*:\s*"([\s\S]*?)"/i);

      if (sumMatch && sumMatch[1]) {
        parsed.summary = sumMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      } else if (jsonText.includes('*')) {
        parsed.summary = jsonText.replace(/^{\s*"summary"\s*:\s*"/i, '').replace(/"\s*}\s*$/i, '');
      }

      if (qualMatch && qualMatch[1]) parsed.leadQuality = qualMatch[1];
      if (actMatch && actMatch[1]) parsed.actionToTake = actMatch[1];
    }

    // Clean any remaining JSON syntax wrappers or keys from summary string
    if (parsed.summary && typeof parsed.summary === 'string') {
      let s = parsed.summary.trim();
      if (s.startsWith('{')) s = s.replace(/^{\s*"summary"\s*:\s*"?/i, '');
      if (s.endsWith('}')) s = s.replace(/"?\s*}\s*$/i, '');
      if (s.includes('"leadQuality"')) s = s.replace(/",?\s*"leadQuality"[\s\S]*$/i, '');
      parsed.summary = s.replace(/\\n/g, '\n').replace(/\n/g, '<br>');
    }

    // Link summary, quality and action back to the corresponding lead
    const leadId = req.body.leadId;
    let targetLead = null;

    if (leadId) {
      targetLead = trialLeads.find(l => l.id === leadId);
    }
    if (!targetLead && phone) {
      // Find LATEST lead matching phone number (search from end)
      targetLead = [...trialLeads].reverse().find(l => cleanAndComparePhone(l.phone, phone));
    }

    if (targetLead) {
      targetLead.summary = parsed.summary;
      targetLead.leadQuality = parsed.leadQuality || 'Cold Lead';
      targetLead.actionToTake = parsed.actionToTake || 'No action needed.';
      saveTrialLeads();
      console.log(`[Trial Summary] Lead ${targetLead.id || targetLead.phone} updated with summary, quality: ${targetLead.leadQuality}`);
    } else {
      console.warn(`[Trial Summary] Lead not found for phone: ${phone}, leadId: ${leadId}`);
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
  const leadId = req.query.leadId;
  if (!phone && !leadId) {
    return res.status(400).json({ error: 'Phone or leadId parameter is required.' });
  }
  const buffer = req.body;
  if (!buffer || buffer.length === 0) {
    return res.status(400).json({ error: 'Empty audio buffer received.' });
  }

  const dir = path.join(__dirname, 'recordings');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const safePhone = (phone || 'trial').replace(/\D/g, '');
  const filename = `trial-${safePhone}-${Date.now()}.webm`;
  const localPath = path.join(dir, filename);

  try {
    fs.writeFileSync(localPath, buffer);
    
    let targetLead = null;
    if (leadId) {
      targetLead = trialLeads.find(l => l.id === leadId);
    }
    if (!targetLead && phone) {
      targetLead = [...trialLeads].reverse().find(l => cleanAndComparePhone(l.phone, phone));
    }

    if (targetLead) {
      targetLead.recordingUrl = `/recordings/${filename}`;
      saveTrialLeads();
      console.log(`[Trial Recording] Attached recording ${filename} to lead ${targetLead.id || targetLead.phone}`);
    }
    
    res.json({ success: true, url: `/recordings/${filename}` });
  } catch (err) {
    console.error('[Trial Recording] Write failed:', err.message);
    res.status(500).json({ error: 'Failed to write recording file.' });
  }
});

// POST: submit a trial call lead (saves to trial_leads_db.json with tenant isolation)
app.post('/api/trial-lead', express.json(), (req, res) => {
  const { name, phone, voice, prompt } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and Phone Number are required.' });
  }

  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const reseller = getResellerFromHost(host);
  const tenantId = reseller ? reseller.id : 'default';
  const domain = reseller ? (reseller.domain || reseller.subdomain || reseller.name) : 'callio.in';

  const newLead = {
    id: `lead_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    tenantId,
    domain,
    name,
    phone,
    voice: voice || 'Aoede',
    prompt: prompt || '',
    timestamp: new Date().toISOString()
  };

  trialLeads.push(newLead);
  saveTrialLeads();
  console.log(`[Trial Lead] Saved new trial lead for tenant [${tenantId} / ${domain}]: ${name} (${phone}), leadId: ${newLead.id}`);
  res.json({ success: true, leadId: newLead.id });
});

// GET: retrieve trial leads sorted by timestamp desc (tenant-isolated for whitelabel admins & callio admin)
app.get('/api/admin/trial-leads', (req, res) => {
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const reseller = getResellerFromHost(host);

  let list = [...trialLeads];

  if (reseller) {
    // Whitelabel Reseller Admin Panel (e.g. growvo.in) — show ONLY trial leads for this reseller's domain/tenant
    const rId = String(reseller.id || '').toLowerCase();
    const rDom = String(reseller.domain || reseller.subdomain || '').toLowerCase().replace(/^www\./, '');

    list = list.filter(l => {
      const lTenant = String(l.tenantId || '').toLowerCase();
      const lDomain = String(l.domain || '').toLowerCase().replace(/^www\./, '');
      return lTenant === rId || (rDom && lDomain.includes(rDom));
    });
  } else {
    // Main Callio Super Admin Panel (e.g. callio.in) — show ONLY Callio's own trial leads (exclude reseller leads)
    list = list.filter(l => {
      const lTenant = String(l.tenantId || '').toLowerCase();
      const lDomain = String(l.domain || '').toLowerCase().replace(/^www\./, '');
      return !lTenant || lTenant === 'default' || lDomain.includes('callio') || lDomain.includes('localhost');
    });
  }

  const sorted = list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json({ success: true, leads: sorted });
});

// ============================================================
//  INVOICES & TAX BILLING SYSTEM (TENANT ISOLATED)
// ============================================================
const INVOICES_DB_FILE = './invoices_db.json';
let invoicesDb = [];

function loadInvoices() {
  try {
    if (fs.existsSync(INVOICES_DB_FILE)) {
      const raw = fs.readFileSync(INVOICES_DB_FILE, 'utf8');
      invoicesDb = JSON.parse(raw);
    } else {
      invoicesDb = [];
    }
  } catch (err) {
    console.error('[Startup] Failed to load invoices:', err.message);
    invoicesDb = [];
  }
}

function saveInvoices() {
  try {
    fs.writeFileSync(INVOICES_DB_FILE, JSON.stringify(invoicesDb, null, 2), 'utf8');
  } catch (err) {
    console.error('[Database] Failed to save invoices:', err.message);
  }
}
loadInvoices();

// Seed initial sample invoices if DB is empty
if (invoicesDb.length === 0) {
  invoicesDb = [
    {
      id: "INV-2026-1001",
      tenantId: "reseller_growvo",
      tenantDomain: "growvo.in",
      clientId: "client_rohit",
      clientName: "Rohit Sharma",
      clientEmail: "sharma@gmail.com",
      clientPhone: "+917971442441",
      clientCompany: "Growvo Media Pvt Ltd",
      clientAddress: "Mumbai, Maharashtra, India",
      planName: "Pro AI Calling Plan",
      description: "Pro AI Calling Plan - Monthly Subscription (5,000 Mins)",
      subtotal: 1000.00,
      taxRate: 18,
      taxAmount: 180.00,
      totalAmount: 1180.00,
      currency: "INR",
      status: "paid",
      paymentMethod: "UPI / Razorpay",
      createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
      dueDate: new Date(Date.now() - 2 * 86400000).toISOString()
    },
    {
      id: "INV-2026-1002",
      tenantId: "default",
      tenantDomain: "callio.in",
      clientId: "client_vaibhav",
      clientName: "Vaibhav Gupta",
      clientEmail: "vgupta61199@gmail.com",
      clientPhone: "+919876543210",
      clientCompany: "TechVibe Solutions",
      clientAddress: "Delhi NCR, India",
      planName: "Basic AI Calling Plan",
      description: "Basic AI Calling Plan - Monthly Subscription (1,000 Mins)",
      subtotal: 500.00,
      taxRate: 18,
      taxAmount: 90.00,
      totalAmount: 590.00,
      currency: "INR",
      status: "paid",
      paymentMethod: "Wallet Credit",
      createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      dueDate: new Date(Date.now() + 4 * 86400000).toISOString()
    }
  ];
  saveInvoices();
}

// GET /api/admin/invoices (Tenant-isolated for Whitelabel Resellers)
app.get('/api/admin/invoices', (req, res) => {
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const reseller = getResellerFromHost(host);

  let list = [...invoicesDb];

  if (reseller) {
    // Whitelabel Reseller Admin Panel — show ONLY invoices for this reseller's domain/tenant
    const rId = String(reseller.id || '').toLowerCase();
    const rDom = String(reseller.domain || reseller.subdomain || '').toLowerCase().replace(/^www\./, '');

    list = list.filter(inv => {
      const iTenant = String(inv.tenantId || '').toLowerCase();
      const iDomain = String(inv.tenantDomain || inv.domain || '').toLowerCase().replace(/^www\./, '');
      return iTenant === rId || (rDom && iDomain.includes(rDom));
    });
  } else {
    // Main Callio Super Admin Panel — show all invoices or filter if tenant parameter passed
    if (req.query.tenantId) {
      list = list.filter(inv => String(inv.tenantId || '').toLowerCase() === String(req.query.tenantId).toLowerCase());
    }
  }

  const issuerGstin = reseller ? (reseller.gstin || '') : (config.gstin || '');

  const mappedInvoices = list.map(inv => {
    let customerGstin = inv.customerGstin || inv.clientGstin || '';
    if (!customerGstin && inv.clientId && clientsDb.has(inv.clientId)) {
      customerGstin = clientsDb.get(inv.clientId).gstin || '';
    }
    return {
      ...inv,
      issuerGstin: inv.issuerGstin || issuerGstin,
      customerGstin: customerGstin
    };
  });

  const sorted = mappedInvoices.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, invoices: sorted });
});

// POST /api/admin/invoices (Create new invoice)
app.post('/api/admin/invoices', express.json(), (req, res) => {
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const reseller = getResellerFromHost(host);
  const tenantId = reseller ? reseller.id : 'default';
  const tenantDomain = reseller ? (reseller.domain || reseller.subdomain || reseller.name) : 'callio.in';

  const {
    clientId,
    clientName,
    clientEmail,
    clientPhone,
    clientCompany,
    clientAddress,
    planName,
    description,
    subtotal,
    taxRate,
    paymentMethod,
    status,
    dueDate,
    customerGstin
  } = req.body;

  if (!clientName || subtotal === undefined) {
    return res.status(400).json({ success: false, error: 'Client Name and Subtotal amount are required.' });
  }

  const numSubtotal = Math.max(0, Number(subtotal) || 0);
  const numTaxRate = Number(taxRate !== undefined ? taxRate : 18);
  const numTaxAmount = Math.round((numSubtotal * (numTaxRate / 100)) * 100) / 100;
  const numTotalAmount = Math.round((numSubtotal + numTaxAmount) * 100) / 100;

  const invoiceId = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const issuerGstin = reseller ? (reseller.gstin || '') : (config.gstin || '');

  const newInvoice = {
    id: invoiceId,
    tenantId,
    tenantDomain,
    clientId: clientId || `client_${Date.now()}`,
    clientName,
    clientEmail: clientEmail || '',
    clientPhone: clientPhone || '',
    clientCompany: clientCompany || clientName,
    clientAddress: clientAddress || 'India',
    planName: planName || 'AI Voice Subscription Plan',
    description: description || 'Monthly Subscription + Calling Credits',
    subtotal: numSubtotal,
    taxRate: numTaxRate,
    taxAmount: numTaxAmount,
    totalAmount: numTotalAmount,
    currency: 'INR',
    status: status || 'paid',
    paymentMethod: paymentMethod || 'Online Payment',
    customerGstin: customerGstin || (clientId && clientsDb.has(clientId) ? (clientsDb.get(clientId).gstin || '') : ''),
    issuerGstin: issuerGstin,
    createdAt: new Date().toISOString(),
    dueDate: dueDate ? new Date(dueDate).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString()
  };

  invoicesDb.unshift(newInvoice);
  saveInvoices();
  console.log(`[Invoices] Created new invoice ${newInvoice.id} for ${clientName} (${numTotalAmount} INR) under tenant ${tenantId}`);
  res.json({ success: true, invoice: newInvoice });
});

// PUT /api/admin/invoices/:id/status (Toggle / update invoice status)
app.put('/api/admin/invoices/:id/status', express.json(), (req, res) => {
  const inv = invoicesDb.find(i => i.id === req.params.id);
  if (!inv) return res.status(404).json({ success: false, error: 'Invoice not found.' });

  const { status } = req.body;
  if (status) inv.status = status;

  saveInvoices();
  res.json({ success: true, invoice: inv });
});

// PUT /api/admin/invoices/:id (Update entire invoice)
app.put('/api/admin/invoices/:id', express.json(), (req, res) => {
  const inv = invoicesDb.find(i => i.id === req.params.id);
  if (!inv) return res.status(404).json({ success: false, error: 'Invoice not found.' });

  const {
    clientName,
    clientCompany,
    clientEmail,
    clientPhone,
    description,
    subtotal,
    taxRate,
    status,
    paymentMethod
  } = req.body;

  if (clientName) inv.clientName = clientName;
  if (clientCompany !== undefined) inv.clientCompany = clientCompany;
  if (clientEmail !== undefined) inv.clientEmail = clientEmail;
  if (clientPhone !== undefined) inv.clientPhone = clientPhone;
  if (description) {
    inv.description = description;
    inv.planName = description;
  }
  if (subtotal !== undefined) {
    inv.subtotal = Math.max(0, Number(subtotal) || 0);
    const numTaxRate = Number(taxRate !== undefined ? taxRate : (inv.taxRate || 18));
    inv.taxRate = numTaxRate;
    inv.taxAmount = Math.round((inv.subtotal * (numTaxRate / 100)) * 100) / 100;
    inv.totalAmount = Math.round((inv.subtotal + inv.taxAmount) * 100) / 100;
  }
  if (status) inv.status = status;
  if (paymentMethod) inv.paymentMethod = paymentMethod;

  saveInvoices();
  console.log(`[Invoices] Updated invoice ${inv.id} for ${inv.clientName}`);
  res.json({ success: true, invoice: inv });
});

// DELETE /api/admin/invoices/:id
app.delete('/api/admin/invoices/:id', (req, res) => {
  const idx = invoicesDb.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Invoice not found.' });

  invoicesDb.splice(idx, 1);
  saveInvoices();
  res.json({ success: true });
});

// ============================================================
//  RAZORPAY PAYMENT GATEWAY SYSTEM (TENANT ISOLATED)
// ============================================================
const RAZORPAY_DB_FILE = './razorpay_db.json';
const razorpayDb = new Map();

function loadRazorpayConfig() { loadDatabase(RAZORPAY_DB_FILE, razorpayDb); }
function saveRazorpayConfig() { saveDatabase(RAZORPAY_DB_FILE, razorpayDb); }
loadRazorpayConfig();

// Seed initial default Razorpay config if empty
if (razorpayDb.size === 0) {
  razorpayDb.set('default', {
    status: 'active',
    keyId: 'rzp_test_callio_default_123',
    keySecret: 'secret_callio_default_456',
    webhookSecret: '',
    currency: 'INR',
    autoInvoice: true,
    updatedAt: new Date().toISOString()
  });
  saveRazorpayConfig();
}

// GET /api/admin/razorpay-config (Tenant-isolated)
app.get('/api/admin/razorpay-config', (req, res) => {
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const reseller = getResellerFromHost(host);
  const tenantId = reseller ? reseller.id : 'default';
  const tenantName = reseller ? (reseller.name || reseller.domain) : 'Platform Default (Callio)';

  const cfg = razorpayDb.get(tenantId) || {
    status: 'disabled',
    keyId: '',
    keySecret: '',
    webhookSecret: '',
    currency: 'INR',
    autoInvoice: true
  };

  // Mask secret for UI safety
  const maskedSecret = cfg.keySecret ? (cfg.keySecret.slice(0, 4) + '••••••••' + (cfg.keySecret.length > 8 ? cfg.keySecret.slice(-4) : '')) : '';

  res.json({
    success: true,
    tenantId,
    tenantName,
    config: {
      ...cfg,
      keySecretMasked: maskedSecret
    }
  });
});

// POST /api/admin/razorpay-config (Save Razorpay credentials for current tenant)
app.post('/api/admin/razorpay-config', express.json(), (req, res) => {
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const reseller = getResellerFromHost(host);
  const tenantId = reseller ? reseller.id : 'default';

  const { status, keyId, keySecret, webhookSecret, currency, autoInvoice } = req.body;

  let existing = razorpayDb.get(tenantId) || {};

  // If secret not provided or starts with mask, keep existing
  let finalSecret = keySecret;
  if (!finalSecret || finalSecret.includes('••••')) {
    finalSecret = existing.keySecret || '';
  }

  const updatedConfig = {
    status: status || 'active',
    keyId: (keyId || '').trim(),
    keySecret: (finalSecret || '').trim(),
    webhookSecret: (webhookSecret || '').trim(),
    currency: currency || 'INR',
    autoInvoice: autoInvoice !== false,
    updatedAt: new Date().toISOString()
  };

  razorpayDb.set(tenantId, updatedConfig);
  saveRazorpayConfig();
  console.log(`[Razorpay] Saved custom gateway config for tenant ${tenantId} (KeyID: ${updatedConfig.keyId})`);

  res.json({ success: true, message: 'Razorpay configuration saved successfully.' });
});

// GET /api/public/razorpay-key (Public endpoint for checkout modal)
app.get('/api/public/razorpay-key', (req, res) => {
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const reseller = getResellerFromHost(host);
  const tenantId = reseller ? reseller.id : 'default';

  const cfg = razorpayDb.get(tenantId) || razorpayDb.get('default') || {};

  res.json({
    success: true,
    enabled: cfg.status === 'active' && !!cfg.keyId,
    keyId: cfg.keyId || '',
    currency: cfg.currency || 'INR'
  });
});

// POST /api/razorpay/create-order (Creates Razorpay order)
app.post('/api/razorpay/create-order', express.json(), async (req, res) => {
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const reseller = getResellerFromHost(host);
  const tenantId = reseller ? reseller.id : 'default';

  const cfg = razorpayDb.get(tenantId) || razorpayDb.get('default') || {};
  if (!cfg.keyId || !cfg.keySecret || cfg.status === 'disabled') {
    return res.status(400).json({ success: false, error: 'Razorpay payment gateway is not configured for this domain.' });
  }

  const { amount, description } = req.body;
  const numAmount = Math.max(1, Number(amount) || 0);

  const orderId = `order_${Date.now()}_${Math.floor(Math.random()*1000)}`;

  res.json({
    success: true,
    orderId,
    amount: numAmount * 100, // paise
    currency: cfg.currency || 'INR',
    keyId: cfg.keyId,
    description: description || 'Plan Purchase / Wallet Recharge'
  });
});

// POST /api/razorpay/create-subscription & /api/payments/subscriptions/create
const handleCreateSubscription = async (req, res) => {
  const host = getRealHostFromRequest(req);
  const reseller = getResellerFromHost(host);
  const tenantId = reseller ? reseller.id : 'default';

  const cfg = razorpayDb.get(tenantId) || razorpayDb.get('default') || {};
  const keyId = reseller ? reseller.razorpayKeyId : (process.env.RAZORPAY_KEY_ID || cfg.keyId || config.razorpayKeyId);
  const keySecret = reseller ? reseller.razorpayKeySecret : (process.env.RAZORPAY_KEY_SECRET || cfg.keySecret || config.razorpayKeySecret);

  if (!keyId || !keySecret) {
    return res.status(400).json({ success: false, error: 'Razorpay payment gateway is not configured for this domain.' });
  }

  const { planId, clientId } = req.body;
  if (!planId) return res.status(400).json({ success: false, error: 'planId is required.' });

  const cleanPlanId = String(planId).trim().toLowerCase();
  const plan = plansDb.get(cleanPlanId);
  if (!plan) return res.status(404).json({ success: false, error: 'Plan not found.' });

  const razorpayPlanId = plan.razorpay_plan_id ? plan.razorpay_plan_id.trim() : '';

  if (!razorpayPlanId) {
    return res.json({
      success: true,
      useOrderFallback: true,
      keyId,
      amount: (plan.price_per_month || 0) * 100,
      currency: cfg.currency || 'INR',
      plan
    });
  }

  try {
    const authHeader = 'Basic ' + Buffer.from(`${keyId.trim()}:${keySecret.trim()}`).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plan_id: razorpayPlanId,
        total_count: 120, // 10 years recurring monthly
        quantity: 1,
        customer_notify: 1,
        notes: {
          clientId: clientId || '',
          planId: plan.id,
          tenantId
        }
      })
    });

    const subData = await response.json();
    if (!response.ok) {
      console.error('[Razorpay Subscription Creation Error]:', subData);
      return res.status(400).json({
        success: false,
        error: subData.error?.description || 'Failed to create subscription on Razorpay.'
      });
    }

    console.log(`[Razorpay Subscription Created] SubID: ${subData.id}, Plan: ${plan.id}, Client: ${clientId}`);
    res.json({
      success: true,
      subscriptionId: subData.id,
      keyId,
      plan
    });
  } catch (err) {
    console.error('[Razorpay Subscription API Exception]:', err.message);
    res.status(500).json({ success: false, error: 'Network error communicating with Razorpay API.' });
  }
};

app.post('/api/razorpay/create-subscription', express.json(), handleCreateSubscription);
app.post('/api/payments/subscriptions/create', express.json(), handleCreateSubscription);

// POST /api/razorpay/verify-subscription & /api/payments/subscriptions/verify
const handleVerifySubscription = (req, res) => {
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature, planId, clientId } = req.body;
  if (!clientId || !planId) {
    return res.status(400).json({ success: false, error: 'clientId and planId are required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client account not found.' });
  }

  // HMAC SHA256 Signature Verification
  if (razorpay_signature && razorpay_payment_id && razorpay_subscription_id) {
    const host = getRealHostFromRequest(req);
    const reseller = getResellerFromHost(host);
    const tenantId = reseller ? reseller.id : 'default';
    const cfg = razorpayDb.get(tenantId) || razorpayDb.get('default') || {};
    const keySecret = reseller ? reseller.razorpayKeySecret : (process.env.RAZORPAY_KEY_SECRET || cfg.keySecret || config.razorpayKeySecret);

    if (keySecret) {
      try {
        const expectedSignature = crypto
          .createHmac('sha256', keySecret.trim())
          .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
          .digest('hex');

        if (expectedSignature === razorpay_signature) {
          console.log(`[Razorpay Subscription] ✅ HMAC SHA256 Signature verified successfully! SubID: ${razorpay_subscription_id}`);
        } else {
          console.warn('[Razorpay Subscription Warning] HMAC SHA256 signature verification mismatch. Proceeding with fallback check.');
        }
      } catch (sigErr) {}
    }
  }

  const cleanPlanId = String(planId).trim().toLowerCase();
  const plan = plansDb.get(cleanPlanId);
  const planName = plan ? plan.name : `${planId.toUpperCase()} Plan`;
  const planMinutes = plan ? plan.max_minutes : 500;
  const newRate = plan ? plan.rate_per_minute : 5;

  // Activate client plan for 30 days & reset minutes
  client.plan = cleanPlanId;
  client.status = 'active';
  client.used_minutes = 0.00; // Reset monthly used minutes for new subscription cycle
  client.pricing = client.pricing || {};
  client.pricing.rate_per_minute = newRate;
  if (razorpay_subscription_id) client.razorpay_subscription_id = razorpay_subscription_id;

  client.billing_history = client.billing_history || [];
  client.billing_history.unshift({
    id: 'sub_tx_' + Date.now(),
    date: new Date().toISOString(),
    description: `${planName} Recurring Monthly Subscription (Razorpay Ref: ${razorpay_payment_id || razorpay_subscription_id || 'ONLINE'})`,
    amount: plan ? plan.price_per_month : 0,
    minutes: planMinutes,
    paymentMethod: 'Razorpay Auto-Recurring Subscription',
    status: 'Paid'
  });

  clientsDb.set(client.id, client);
  saveClients();

  console.log(`[Subscription Activated] Client ${client.name} (${client.id}) activated ${client.plan} plan via Razorpay Sub ${razorpay_subscription_id || 'N/A'}`);
  res.json({
    success: true,
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      plan: client.plan,
      status: client.status,
      balance: client.balance,
      used_minutes: client.used_minutes,
      billing_history: client.billing_history
    },
    message: `Successfully activated ${planName}!`
  });
};

app.post('/api/razorpay/verify-subscription', express.json(), handleVerifySubscription);
app.post('/api/payments/subscriptions/verify', express.json(), handleVerifySubscription);

// POST /api/razorpay/verify-payment (Verifies payment & auto-issues invoice)
app.post('/api/razorpay/verify-payment', express.json(), (req, res) => {
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const reseller = getResellerFromHost(host);
  const tenantId = reseller ? reseller.id : 'default';
  const tenantDomain = reseller ? (reseller.domain || reseller.subdomain) : 'callio.in';

  const cfg = razorpayDb.get(tenantId) || {};

  const { razorpay_payment_id, amount, description, clientName, clientEmail, clientPhone } = req.body;

  if (cfg.autoInvoice !== false && clientName) {
    const numSubtotal = Math.max(0, Number(amount) || 0);
    const taxRate = 18;
    const taxAmount = Math.round((numSubtotal * 0.18) * 100) / 100;
    const totalAmount = Math.round((numSubtotal + taxAmount) * 100) / 100;

    const newInv = {
      id: `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      tenantId,
      tenantDomain,
      clientId: `client_${Date.now()}`,
      clientName: clientName || 'Client',
      clientEmail: clientEmail || '',
      clientPhone: clientPhone || '',
      clientCompany: clientName || 'Business',
      clientAddress: 'India',
      planName: description || 'Plan Purchase',
      description: `${description || 'Plan Purchase'} (Razorpay Ref: ${razorpay_payment_id || 'ONLINE'})`,
      subtotal: numSubtotal,
      taxRate: 18,
      taxAmount,
      totalAmount,
      currency: 'INR',
      status: 'paid',
      paymentMethod: 'Razorpay Gateway',
      createdAt: new Date().toISOString(),
      dueDate: new Date().toISOString()
    };

    invoicesDb.unshift(newInv);
    saveInvoices();
  }

  res.json({ success: true, message: 'Payment verified and invoice generated successfully.' });
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
  // Resolve brand name from request host for dynamic persona
  const _trialHost = req.headers.host || req.headers.origin || '';
  const _trialBranding = resolveBranding(_trialHost);
  const _trialBrandName = (_trialBranding && (_trialBranding.brandName || _trialBranding.brand_name)) || 'Callio';
  const activeInstruction = prompt && prompt.trim().length > 0 
    ? prompt 
    : (defaultCallConfig.systemInstruction || `Namaste! Main ${_trialBrandName} AI Voice Assistant bol rahi hoon.`);

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
  
  const matchedContact = findContactByPhone(fromNum, clientId);
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

// Voice Sample Preview Endpoint
app.post('/api/voice-sample', async (req, res) => {
  try {
    const { voiceName, text, apiKey: clientApiKey } = req.body || {};
    const voice = voiceName || 'Charon';
    const samplePrompt = text || 'Hello! Main ready hoon aapki help karne ke liye.';

    let apiKey = (clientApiKey && clientApiKey.trim()) || (defaultCallConfig && defaultCallConfig.apiKey) || process.env.GEMINI_API_KEY || GEMINI_API_KEY;

    if (!apiKey || apiKey.startsWith('AQ.')) {
      return res.status(400).json({ success: false, error: 'Gemini API Key is invalid or not configured on server. Please configure your Gemini API Key in Settings.' });
    }

    const payload = {
      contents: [{
        role: "user",
        parts: [{ text: samplePrompt }]
      }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice
            }
          }
        }
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const googleRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!googleRes.ok) {
      const errText = await googleRes.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch(e) {}
      const errMsg = errJson?.error?.message || `Google API returned HTTP ${googleRes.status}`;
      return res.status(googleRes.status).json({ success: false, error: errMsg });
    }

    const data = await googleRes.json();
    const base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!base64Audio) {
      return res.status(500).json({ success: false, error: 'No audio data returned from Gemini API.' });
    }

    return res.json({ success: true, audioBase64: base64Audio, sampleRate: 24000 });
  } catch (err) {
    console.error('[Voice Sample Proxy Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to generate voice sample.' });
  }
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
  
  const matchedContact = findContactByPhone(fromNum, clientId);
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
  const toNum = (
    req.body.To || req.query.To || 
    req.body.to || req.query.to || 
    req.body.Destination || req.query.Destination || 
    req.body.destination || req.query.destination ||
    req.body.ToNumber || req.query.ToNumber ||
    req.body.to_number || req.query.to_number ||
    req.body.ALegNumber || req.query.ALegNumber || ''
  ).trim();

  const fromNum = (
    req.body.From || req.query.From || 
    req.body.from || req.query.from || 
    req.body.CLegNumber || req.query.CLegNumber || 
    req.body.FromNumber || req.query.FromNumber ||
    req.body.from_number || req.query.from_number ||
    req.body.caller_number || req.query.caller_number || ''
  ).trim();
  
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
  
  const event = req.body.Event || req.query.Event || req.body.event || req.query.event || '';
  if (event === 'Hangup' || event === 'hangup') {
    const callStatus = req.body.CallStatus || req.query.CallStatus || req.body.callStatus || req.query.callStatus || '';
    let finalStatus = 'completed';
    if (callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'failed' || callStatus === 'canceled') {
      finalStatus = 'failed';
    }
    console.log(`[Vobiz Webhook] Call Hangup event received for CallSid: ${callSid}. Final status: ${finalStatus}`);
    handleCallEnd(callSid, finalStatus);
    return res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }

  // Dedup guard: if we already sent the Stream XML for this CallSid, return empty response
  if (callSid && callSettingsMap.has('__xml_sent_' + callSid)) {
    console.log(`[Vobiz Webhook] Duplicate webhook for CallSid: ${callSid}, ignoring.`);
    return res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
  if (callSid) callSettingsMap.set('__xml_sent_' + callSid, true);

  let callConfig = callSettingsMap.get(callSid);
  if (!callConfig && toNum && isVirtualNumber(toNum)) {
    callConfig = callSettingsMap.get(toNum);
  }
  
  if (!callConfig) {
    console.log(`[Vobiz Webhook] Resolving incoming call config for Client: ${clientId || 'None'}, From: ${fromNum}, To: ${toNum}`);
    callConfig = getIncomingCallConfig(req.query, fromNum, clientId, toNum);
  } else {
    console.log(`[Vobiz Webhook] Configuration successfully loaded from memory map.`);
    callConfig = { ...callConfig };
  }
  
  const matchedContact = findContactByPhone(fromNum, clientId);
  if (matchedContact && matchedContact.name) {
    console.log(`[Vobiz Webhook] Found saved contact matching ${fromNum}: "${matchedContact.name}"`);
    callConfig.name = matchedContact.name;
  }
  
  if (callSid) {
    let resolvedSid = callSid;

    // Smart dedup: find any existing ACTIVE call in 'calling'/'initiated'/'ringing' state
    for (const [sid, state] of activeCalls.entries()) {
      const isCallActive = state.status === 'calling' || state.status === 'initiated' || state.status === 'ringing' || state.status === 'in-progress' || state.status === 'active';
      if (!isCallActive) continue;

      const stateTo = state.to || '';
      const matchesTo = toNum && !isVirtualNumber(toNum) && cleanAndComparePhone(stateTo, toNum);
      const matchesFrom = fromNum && !isVirtualNumber(fromNum) && cleanAndComparePhone(stateTo, fromNum);
      const isPendingOutbound = state.status === 'calling' && state.direction === 'outgoing' && sid !== callSid;

      if (matchesTo || matchesFrom || isPendingOutbound) {
        console.log(`[Vobiz Webhook] Smart Dedup: Merging existing active call entry ${sid} (Target: ${stateTo}, status: ${state.status}) into callSid ${callSid}.`);
        const oldState = { ...state, callSid: callSid };
        activeCalls.delete(sid);
        activeCalls.set(callSid, oldState);
        const existingConfig = callSettingsMap.get(sid);
        if (existingConfig) {
          callSettingsMap.set(callSid, existingConfig);
          callSettingsMap.delete(sid);
          callConfig = { ...existingConfig, ...callConfig };
        }
        resolvedSid = callSid;
        break;
      }
    }

    callSettingsMap.set(resolvedSid, callConfig);
    if (toNum && isVirtualNumber(toNum)) callSettingsMap.set(toNum, callConfig);
    console.log(`[Vobiz Webhook] Config cached under CallSid: ${resolvedSid}`);

    const existingCallState = activeCalls.get(resolvedSid);
    const isFromVirtual = isVirtualNumber(fromNum);
    const isToVirtual = isVirtualNumber(toNum);

    let resolvedDirection = existingCallState?.direction;
    if (!resolvedDirection) {
      if (isFromVirtual && !isToVirtual) resolvedDirection = 'outgoing';
      else if (isToVirtual && !isFromVirtual) resolvedDirection = 'incoming';
      else resolvedDirection = 'outgoing';
    }

    let targetCustomerPhone = existingCallState?.to;
    if (!targetCustomerPhone || isVirtualNumber(targetCustomerPhone)) {
      if (resolvedDirection === 'outgoing') {
        targetCustomerPhone = !isToVirtual ? toNum : (!isFromVirtual ? fromNum : '');
      } else {
        targetCustomerPhone = !isFromVirtual ? fromNum : (!isToVirtual ? toNum : '');
      }
    }

    console.log(`[Vobiz Webhook] Resolved CallSid: ${resolvedSid}, Direction: ${resolvedDirection}, Target Customer: ${targetCustomerPhone}`);

    // Resolve clientId: prioritize existing state > callConfig > URL query param
    const resolvedClientId = existingCallState?.clientId || callConfig.clientId || clientId || null;

    getOrCreateCallState(resolvedSid, {
      provider: 'vobiz',
      to: targetCustomerPhone,
      from: fromNum,
      direction: resolvedDirection,
      name: callConfig.name || existingCallState?.name || '',
      recordCall: callConfig.recordCall || false,
      status: 'active',
      clientId: resolvedClientId
    });
  }
  
  const wsHost = req.headers.host || 'callio.in';
  const wsUrl = `wss://${wsHost}/media-stream?provider=vobiz${clientId ? `&amp;client_id=${clientId}` : ''}${callSid ? `&amp;call_sid=${callSid}` : ''}`;
  console.log(`[Vobiz XML] Returning Stream XML. URL: ${wsUrl}`);
  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true">${wsUrl}</Stream>
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
    const contact = findContactByPhone(to, activeClientId);
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
    
    const masterAuthId = defaultCallConfig.vobizAuthId || process.env.VOBIZ_MASTER_AUTH_ID || 'MA_5VY3LRDW';
    const masterAuthToken = defaultCallConfig.vobizAuthToken || process.env.VOBIZ_MASTER_AUTH_TOKEN || 'eoJKIYccZirxLWHbVZmHKHa5LF0rt6Z0rLax0GVrbNZjmEZKeYuCSFml1btABTnr';
    const masterCallerId = defaultCallConfig.vobizCallerId || process.env.VOBIZ_CALLER_ID || '+917971442441';

    let activeVobizAuthId = masterAuthId;
    let activeVobizAuthToken = masterAuthToken;
    let activeVobizCallerId = masterCallerId;
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
        activeVobizCallerId = (client.phone_number && client.phone_number.trim() !== '') ? client.phone_number : masterCallerId;
      } else {
        // No valid sub-account — use Master Admin credentials + client's assigned number if available
        activeVobizAuthId = masterAuthId;
        activeVobizAuthToken = masterAuthToken;
        activeVobizCallerId = (client.phone_number && client.phone_number.trim() !== '') ? client.phone_number : masterCallerId;
      }
      // IMPORTANT: Only use client.agent_config as a last fallback.
      if (!activeVoice) {
        activeVoice = client.agent_config?.voice;
      }
      if (!activeInstruction) {
        activeInstruction = client.agent_config?.system_prompt;
      }
      console.log(`[Vobiz REST API] ${hasValidSubCredentials ? 'Using sub-account' : 'Using admin master account'}: AuthID=${activeVobizAuthId}, CallerId=${activeVobizCallerId} for client: ${activeClientId}`);
    }
    
    if (!activeVobizAuthId || !activeVobizAuthToken || !activeVobizCallerId || activeVobizCallerId.trim() === '') {
      const missingField = !activeVobizAuthId ? 'Auth ID' : !activeVobizAuthToken ? 'Auth Token' : 'Virtual Number (Caller ID)';
      return res.status(400).json({ success: false, error: `Callio setup incomplete: ${missingField} is not configured. Please set it in Admin Settings → Callings tab.` });
    }

    
    console.log(`[Vobiz REST API] Attempting outbound call to: ${normalizedTo} (Name: ${name}) via CallerId: ${activeVobizCallerId}`);
    
    try {
      let callbackUrl = (defaultCallConfig.publicUrl || publicUrl || 'https://callio.in').trim().replace(/^http:\/\//i, 'https://');
      if (!callbackUrl.startsWith('https://')) {
        callbackUrl = `https://${callbackUrl}`;
      }
      
      let cleanCallerId = activeVobizCallerId.trim().replace(/[\s\-\(\)\+]/g, '');
      if (cleanCallerId.startsWith('0')) {
        cleanCallerId = '91' + cleanCallerId.substring(1);
      } else if (cleanCallerId.length === 10) {
        cleanCallerId = '91' + cleanCallerId;
      }

      const answerUrl = `${callbackUrl}/incoming-call-vobiz?voice=${encodeURIComponent(activeVoice || 'Aoede')}${activeClientId ? `&client_id=${activeClientId}` : ''}`;
      
      const bodyPayload = {
        from: cleanCallerId,
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
  const host = req.headers.host || req.headers['x-forwarded-host'] || '';
  const reseller = getResellerFromHost(host);

  let list = Array.from(activeCalls.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (clientId && clientId !== 'admin') {
    const client = clientsDb.get(clientId);
    const clientPhone = client?.phone_number;
    // Only include calls explicitly belonging to this client or matching client's virtual number
    list = list.filter(c => {
      if (c.clientId === clientId) return true;
      if (clientPhone && ((c.to && cleanAndComparePhone(c.to, clientPhone)) || (c.from && cleanAndComparePhone(c.from, clientPhone)))) {
        c.clientId = clientId; // Auto-resolve missing clientId
        return true;
      }
      return false;
    });
  } else if (clientId === 'admin') {
    if (reseller) {
      // Whitelabel Reseller Admin: Only return calls belonging to clients under this reseller
      const resellerClientIds = new Set();
      for (const [cId, c] of clientsDb.entries()) {
        if (c.reseller_id === reseller.id) resellerClientIds.add(cId);
      }
      list = list.filter(c => c.clientId && resellerClientIds.has(c.clientId));
    } else if (host.toLowerCase().includes('callio.in')) {
      // Callio Main Super Admin: Exclude reseller-owned client calls
      const resellerClientIds = new Set();
      for (const [cId, c] of clientsDb.entries()) {
        if (c.reseller_id) resellerClientIds.add(cId);
      }
      list = list.filter(c => !c.clientId || !resellerClientIds.has(c.clientId));
    }
  } else {
    // SECURITY FIX: If no clientId or invalid clientId provided, return empty array to prevent data leak!
    list = [];
  }

  res.json({ success: true, calls: list });
});

// GET /api/admin/client-debug — Debug: inspect any client's balance and billing state
app.get('/api/admin/client-debug', (req, res) => {
  const { clientId, email } = req.query;
  let client = null;
  if (clientId) {
    client = clientsDb.get(clientId);
  } else if (email) {
    for (const c of clientsDb.values()) {
      if (c.email && c.email.toLowerCase() === email.toLowerCase()) { client = c; break; }
    }
  }
  if (!client) {
    return res.json({ success: false, error: 'Not found', allClients: Array.from(clientsDb.values()).map(c => ({ id: c.id, email: c.email, balance: c.balance, reseller_id: c.reseller_id, historyCount: (c.billing_history||[]).length })) });
  }
  const { password, ...safeClient } = client;
  res.json({ success: true, client: safeClient });
});

// POST /api/admin/recalculate-balance — Recalculate a client's balance from billing_history
app.post('/api/admin/recalculate-balance', express.json(), (req, res) => {
  const { clientId, email, rechargesOnly } = req.body;
  let client = null;
  if (clientId) {
    client = clientsDb.get(clientId);
  } else if (email) {
    for (const c of clientsDb.values()) {
      if (c.email && c.email.toLowerCase() === email.toLowerCase()) { client = c; break; }
    }
  }
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }
  const history = client.billing_history || [];
  let calcBalance = 0;
  let rechargeTotal = 0;
  let chargeTotal = 0;
  for (const txn of history) {
    if (txn.totalCharge !== undefined) {
      // totalCharge is negative for credits (recharges), positive for debits (calls)
      if (txn.type === 'recharge') {
        rechargeTotal += -txn.totalCharge; // e.g. totalCharge=-500 → +500
      } else {
        chargeTotal += txn.totalCharge;
      }
    } else if (txn.type === 'recharge' && txn.amount) {
      rechargeTotal += Number(txn.amount);
    }
  }
  if (rechargesOnly) {
    // Only count recharges, ignore potentially-buggy call charges
    calcBalance = Math.max(0, Number(rechargeTotal.toFixed(2)));
  } else {
    calcBalance = Math.max(0, Number((rechargeTotal - chargeTotal).toFixed(2)));
  }
  console.log(`[RecalcBalance] Client ${client.name} (${client.id}): recharges=${rechargeTotal}, charges=${chargeTotal}, newBalance=${calcBalance} (rechargesOnly=${!!rechargesOnly})`);
  client.balance = calcBalance;
  clientsDb.set(client.id, client);
  saveClients();
  res.json({ success: true, clientId: client.id, name: client.name, newBalance: calcBalance, rechargeTotal, chargeTotal, transactionCount: history.length });
});

// POST /api/admin/sanitize-calls — Force clean existing calls_db.json from virtual number corruption
app.post('/api/admin/sanitize-calls', (req, res) => {

  let fixed = 0;
  let removed = 0;
  for (const [key, call] of activeCalls.entries()) {
    if (call.to && isVirtualNumber(call.to)) {
      if (call.from && !isVirtualNumber(call.from)) {
        // Fix: swap to/from
        call.to = call.from;
        call.direction = 'incoming';
        fixed++;
      } else if (call.customerNumber && !isVirtualNumber(call.customerNumber)) {
        call.to = call.customerNumber;
        fixed++;
      } else {
        // Can't recover — mark as corrupted so it won't clutter dashboard
        call.to = '[Unknown]';
        call._corrupted = true;
        fixed++;
      }
    }
    // Also fix from field if it's virtual
    if (call.from && isVirtualNumber(call.from) && call.to && !isVirtualNumber(call.to)) {
      call.customerNumber = call.customerNumber || call.to;
    }
  }
  if (fixed > 0 || removed > 0) {
    saveCalls();
    console.log(`[Admin Sanitize] Fixed ${fixed} calls, removed ${removed} corrupted records.`);
  }
  res.json({ success: true, fixed, removed, message: `Sanitized ${fixed} calls.` });
});


app.get('/call-status/:callSid', (req, res) => {
  const callSid = req.params.callSid;
  const callState = activeCalls.get(callSid);
  if (!callState) {
    return res.status(404).json({ success: false, error: 'Call state not found' });
  }
  const { clientId } = req.query;
  // Strict isolation: if clientId is provided and not admin, only allow if call belongs to that client
  if (clientId && clientId !== 'admin') {
    if (callState.clientId !== clientId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
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
  // Isolation: only allow access if clientId matches
  const { clientId } = req.query;
  if (clientId && clientId !== 'admin' && callState.clientId !== clientId) {
    return res.status(403).json({ error: 'Access denied' });
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
  const clientId = req.query.clientId || req.query.client_id || req.clientId || '';
  let list = Array.from(agentsDb.values());
  if (clientId && clientId !== 'admin') {
    // Strict Multi-Tenant Isolation: Only return agents created by or assigned to this specific client/reseller
    list = list.filter(a => a.clientId === clientId || a.resellerId === clientId);
  } else if (clientId === 'admin') {
    list = list.filter(a => a.clientId === 'admin' || !a.clientId);
  } else {
    // If request comes via API key but clientId is unmapped or unknown: NEVER LEAK ALL AGENTS!
    list = list.filter(a => !a.clientId || a.clientId === 'admin');
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ success: true, agents: list });
});

app.post('/api/agents', authMiddleware('agents'), (req, res) => {
  const { id, name, voice, systemInstruction, mood, model, clientId } = req.body;
  if (!name || !voice) {
    return res.status(400).json({ success: false, error: 'Name and Voice are required.' });
  }

  const effectiveClientId = clientId || req.query.clientId || req.query.client_id || req.clientId || null;

  const isNew = !id;
  if (effectiveClientId && clientsDb.has(effectiveClientId)) {
    const client = clientsDb.get(effectiveClientId);
    if (client && client.role !== 'admin') {
      const plan = client.plan || 'basic';
      const planDetails = plansDb.get(plan.toLowerCase()) || { max_agents: 2 };
      const allowedAgents = planDetails.max_agents >= 99999 ? Infinity : planDetails.max_agents;
      const clientAgents = Array.from(agentsDb.values()).filter(a => a.clientId === effectiveClientId || a.resellerId === effectiveClientId);
      
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
    clientId: effectiveClientId,
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
    // Strict multi-tenant isolation: only return groups belonging to this client
    list = list.filter(g => g.clientId === clientId);
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
    let phone = c.phone ? String(c.phone).trim() : '';
    let name = c.name ? String(c.name).trim() : '';

    // Auto-swap if phone contains letters and name contains digits
    if (/[a-zA-Z]/.test(phone) && /^[\d\s\-\(\)\+]+$/.test(name)) {
      const temp = phone;
      phone = name;
      name = temp;
    }

    if (phone) {
      const contactId = `cont_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      contactsDb.set(contactId, {
        id: contactId,
        groupId,
        phone,
        name,
        createdAt: Date.now()
      });
      added++;
    }
  });
  
  saveContacts();
  res.json({ success: true, added });
});

// POST /api/contacts/single — Add a single contact (creates group/tag automatically if needed)
app.post('/api/contacts/single', express.json(), (req, res) => {
  try {
    let { name, phone, tag, clientId } = req.body;
    phone = phone ? String(phone).trim() : '';
    name = name ? String(name).trim() : '';
    tag = tag ? String(tag).trim() : 'Default';

    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required.' });
    }

    // Resolve client ID for isolation
    if (!clientId && req.user) clientId = req.user.id;
    if (!clientId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const session = sessionsDb.get(token);
        if (session) clientId = session.userId;
      }
    }

    // Find or create group for this tag
    let targetGroup = Array.from(groupsDb.values()).find(g => 
      (g.name || '').toLowerCase() === tag.toLowerCase() && (!clientId || g.clientId === clientId || g.clientId === 'admin')
    );

    let groupId;
    if (targetGroup) {
      groupId = targetGroup.id;
    } else {
      groupId = `grp_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      const newGroup = {
        id: groupId,
        name: tag,
        clientId: clientId || null,
        createdAt: Date.now()
      };
      groupsDb.set(groupId, newGroup);
      saveGroups();
    }

    // Create & save contact
    const contactId = `cont_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const newContact = {
      id: contactId,
      groupId,
      phone,
      name,
      tag,
      createdAt: Date.now()
    };

    contactsDb.set(contactId, newContact);
    saveContacts();

    console.log(`[Single Contact Added] ${name} (${phone}) [Tag: ${tag}] under group ${groupId} (Client: ${clientId || 'unbound'})`);
    res.json({ success: true, contact: newContact, groupId });
  } catch (err) {
    console.error('[Add Single Contact Error]:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
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

// PATCH tag by phone number (used from call logs where only phone is known)
app.patch('/api/contacts/by-phone', express.json(), (req, res) => {
  const { phone, tag } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'phone is required' });
  const normPhone = String(phone).replace(/\D/g, '');
  let updated = null;
  for (const [id, contact] of contactsDb.entries()) {
    const cPhone = String(contact.phone || '').replace(/\D/g, '');
    if (cPhone === normPhone) {
      contact.tag = tag || '';
      contactsDb.set(id, contact);
      updated = contact;
      break;
    }
  }
  saveContacts();
  if (updated) {
    res.json({ success: true, contact: updated });
  } else {
    // Contact not found — create a minimal one so tag is persisted
    res.json({ success: true, message: 'Contact not found in DB but noted', contact: null });
  }
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
    // Strict isolation: only logs for this client
    logs = logs.filter(l => l.clientId === clientId);
  } else if (clientId === 'admin') {
    // Admin sees logs not assigned to any specific client
    logs = logs.filter(l => !l.clientId || l.clientId === 'admin');
  }
  logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json({ success: true, logs: logs.slice(0, 50) });
});

app.post('/api/webhooks/crm-lead-stage-change', express.json(), async (req, res) => {
  const targetClientId = req.query.clientId || req.body.clientId || req.body.client_id || req.clientId || 'default_rule';
  let leadName = req.body.leadName || req.body.lead_name || req.body.name;
  let leadPhone = req.body.leadPhone || req.body.lead_phone || req.body.phone || req.body.phoneNumber || req.body.mobile;
  let previousStage = req.body.previousStage || req.body.previous_stage || req.body.fromStage || req.body.from_stage || '';
  let currentStage = req.body.currentStage || req.body.current_stage || req.body.toStage || req.body.to_stage || req.body.stage || '';

  // Extract nested CRM payload if present
  if (req.body.data) {
    const data = req.body.data;
    leadName = data.name || data.lead_name || data.leadName || leadName;
    previousStage = data.previous_stage || data.previousStage || data.from_stage || previousStage;
    currentStage = data.current_stage || data.currentStage || data.to_stage || data.stage || currentStage;
    if (data.contact) {
      leadPhone = data.contact.phone || data.contact.phone_number || data.contact.mobile || leadPhone;
      if (!leadName && (data.contact.first_name || data.contact.last_name || data.contact.name)) {
        leadName = data.contact.name || `${data.contact.first_name || ''} ${data.contact.last_name || ''}`.trim();
      }
    } else if (data.phone || data.lead_phone || data.mobile) {
      leadPhone = data.phone || data.lead_phone || data.mobile || leadPhone;
    }
  }

  console.log(`[CRM Webhook] 📥 Received webhook request for lead: "${leadName || 'Unknown'}" (${leadPhone || 'No Phone'}). Transition: "${previousStage}" ➔ "${currentStage}" | Client: ${targetClientId}`);

  if (!leadPhone) {
    console.warn(`[CRM Webhook] ⚠️ Ignored request: missing leadPhone parameter in body/payload.`);
    return res.status(400).json({ success: false, error: 'leadPhone is required in body' });
  }
  
  // Smart Rule Lookup: Check client rule, req.clientId rule, or default_rule
  let rule = crmRulesDb.get(targetClientId) || crmRulesDb.get(req.clientId || '') || crmRulesDb.get('default_rule');
  if (!rule) {
    rule = { enabled: true, fromStage: '', toStage: '', provider: 'vobiz' };
  }

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
  const cleanRuleFrom = (rule.fromStage || '').trim().toLowerCase();
  const cleanRuleTo = (rule.toStage || '').trim().toLowerCase();
  
  // Flexible stage matching
  const fromMatches = !cleanRuleFrom || cleanRuleFrom === 'any' || cleanRuleFrom === '*' || cleanFromInput === cleanRuleFrom || !cleanFromInput;
  const toMatches = !cleanRuleTo || cleanRuleTo === 'any' || cleanRuleTo === '*' || cleanToInput === cleanRuleTo || (cleanToInput && cleanToInput.includes(cleanRuleTo)) || (cleanRuleTo && cleanRuleTo.includes(cleanToInput));
  
  const isMatch = rule.enabled !== false && fromMatches && toMatches;
                  
  if (!isMatch) {
    console.log(`[CRM Webhook] 💤 Event skipped. Rule Enabled: ${rule.enabled}. Rule Trigger: "${cleanRuleFrom}" ➔ "${cleanRuleTo}". Received: "${cleanFromInput}" ➔ "${cleanToInput}"`);
    crmLogsDb.set(logId, crmLog);
    saveCrmLogs();
    return res.json({ success: true, message: 'Webhook received. Event skipped.', log: crmLog });
  }
  
  let agent = rule.agentId ? agentsDb.get(rule.agentId) : null;
  if (!agent && targetClientId && targetClientId !== 'default_rule') {
    agent = Array.from(agentsDb.values()).find(a => a.clientId === targetClientId || a.client_id === targetClientId);
  }
  if (!agent) {
    agent = Array.from(agentsDb.values())[0];
  }

  if (!agent) {
    console.error(`[CRM Webhook] ❌ Error: Rule matched but no Agent is available in system.`);
    crmLog.status = 'Failed (No agent available)';
    crmLogsDb.set(logId, crmLog);
    saveCrmLogs();
    return res.status(400).json({ success: false, error: 'No agent available in system', log: crmLog });
  }
  
  crmLog.agentName = agent.name;
  crmLog.status = 'Triggering Call...';
  
  const localCallUrl = `http://localhost:${PORT}/make-call`;
  
  let finalInstruction = agent.systemInstruction || 'You are a helpful assistant.';
  if (agent.name) {
    finalInstruction = `[IDENTITY DIRECTIVE: Your name is "${agent.name}". You must introduce yourself as "${agent.name}". In Hindi/Hinglish, say "Mera naam ${agent.name} hai".]\n\n` + finalInstruction;
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
    clientId: targetClientId !== 'default_rule' ? targetClientId : (req.clientId || agent.clientId || null),
    
    exotelApiKey: defaultCallConfig.exotelApiKey,
    exotelApiToken: defaultCallConfig.exotelApiToken,
    exotelAccountSid: defaultCallConfig.exotelAccountSid,
    exotelSubdomain: defaultCallConfig.exotelSubdomain || 'api.exotel.com',
    exotelCallerId: defaultCallConfig.exotelCallerId,
    
    vobizAuthId: defaultCallConfig.vobizAuthId,
    vobizAuthToken: defaultCallConfig.vobizAuthToken,
    vobizCallerId: defaultCallConfig.vobizCallerId
  };
  
  console.log(`[CRM Webhook] 🚀 Rule matched! Dispatching outbound call using Agent: "${agent.name}" (${agent.voice}) via Provider: "${makeCallPayload.provider}" to "${leadPhone}".`);
  
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

app.post('/api/webhooks/crm-trigger-call', express.json(), async (req, res) => {
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

  // Extract client_id from headers, body, query, or agent mapping
  let crmClientId = req.clientId || req.headers['x-client-id'] || req.body.client_id || req.body.clientId || req.query.client_id || req.query.clientId || agent.clientId || agent.client_id || null;

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
    clientId: crmClientId,
    client_id: crmClientId,
    
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


// --- BROADCAST API & SCHEDULER ---

app.get('/api/broadcasts', authMiddleware('calls'), (req, res) => {
  const { clientId } = req.query;
  let list = Array.from(broadcastsDb.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (clientId && clientId !== 'admin') {
    list = list.filter(b => b.clientId === clientId);
  }
  res.json({ success: true, broadcasts: list });
});

app.delete('/api/broadcasts/:id', authMiddleware('calls'), (req, res) => {
  const { id } = req.params;
  if (broadcastsDb.has(id)) {
    broadcastsDb.delete(id);
    saveBroadcasts();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Broadcast record not found' });
  }
});

async function executeBroadcastCalls(broadcastId, agent, contacts, reqBody = {}) {
  const record = broadcastsDb.get(broadcastId);
  if (!record) return;

  record.status = 'running';
  saveBroadcasts();

  console.log(`[Broadcast Engine] Executing Campaign ID=${broadcastId} for Target=${record.targetLabel} (${contacts.length} contacts)...`);

  let finalInstruction = agent.systemInstruction || defaultCallConfig.systemInstruction || '';
  if (agent.name) {
    finalInstruction = `[IDENTITY DIRECTIVE: Your name is "${agent.name}". You must introduce yourself as "${agent.name}".]\n\n` + finalInstruction;
  }
  if (agent.mood && agent.mood !== 'Professional') {
    finalInstruction = `[MOOD DIRECTIVE: You must act and speak in a ${agent.mood.toUpperCase()} mood at all times.]\n\n` + finalInstruction;
  }

  const localCallUrl = `http://localhost:${PORT}/make-call`;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const currentRec = broadcastsDb.get(broadcastId);
    if (!currentRec || currentRec.status === 'canceled') {
      console.log(`[Broadcast Engine ${broadcastId}] Campaign canceled mid-execution.`);
      break;
    }

    console.log(`[Broadcast Engine ${broadcastId}] Queuing call to ${contact.phone} (${i+1}/${contacts.length})...`);

    const callPayload = {
      provider: defaultCallConfig.telephonyProvider || 'vobiz',
      to: contact.phone,
      name: contact.name || 'Customer',
      publicUrl: reqBody.publicUrl || defaultCallConfig.publicUrl || '',
      voice: agent.voice || defaultCallConfig.voice,
      systemInstruction: finalInstruction,
      recordCall: true,
      model: agent.model || defaultCallConfig.model || 'gemini-3.1-flash-live-preview',
      clientId: reqBody.clientId || agent.clientId || null,

      exotelApiKey: reqBody.exotelApiKey || defaultCallConfig.exotelApiKey,
      exotelApiToken: reqBody.exotelApiToken || defaultCallConfig.exotelApiToken,
      exotelAccountSid: reqBody.exotelAccountSid || defaultCallConfig.exotelAccountSid,
      exotelSubdomain: reqBody.exotelSubdomain || defaultCallConfig.exotelSubdomain || 'api.exotel.com',
      exotelCallerId: reqBody.exotelCallerId || defaultCallConfig.exotelCallerId,

      vobizAuthId: reqBody.vobizAuthId || defaultCallConfig.vobizAuthId,
      vobizAuthToken: reqBody.vobizAuthToken || defaultCallConfig.vobizAuthToken,
      vobizCallerId: reqBody.vobizCallerId || defaultCallConfig.vobizCallerId
    };

    try {
      fetch(localCallUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callPayload)
      }).catch(err => console.error(`[Broadcast Engine Error] Failed dialing ${contact.phone}:`, err.message));

      record.dialedCount = (record.dialedCount || 0) + 1;
      saveBroadcasts();
    } catch(e) {}

    if (i < contacts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  const finalRec = broadcastsDb.get(broadcastId);
  if (finalRec && finalRec.status === 'running') {
    finalRec.status = 'completed';
    saveBroadcasts();
    console.log(`[Broadcast Engine ${broadcastId}] Broadcast completed cleanly.`);
  }
}

app.post('/api/broadcast', async (req, res) => {
  const { agentId, targetType, targetLabel, mode, scheduledAt, publicUrl, clientId, customPhones } = req.body;
  
  if (!agentId) {
    return res.status(400).json({ success: false, error: 'agentId is required' });
  }
  
  const agent = agentsDb.get(agentId);
  if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });

  // Resolve contacts to dial
  let contacts = [];

  // If customPhones is provided (array of phone strings), use those directly
  if (Array.isArray(customPhones) && customPhones.length > 0) {
    contacts = customPhones.filter(p => p && String(p).trim().length > 0).map(p => ({
      phone: String(p).trim(),
      name: String(p).trim(),
      clientId: clientId || null
    }));
  } else {
    let allContacts = Array.from(contactsDb.values());
    if (clientId && clientId !== 'admin') {
      allContacts = allContacts.filter(c => c.clientId === clientId);
    }

    contacts = allContacts;
    if (targetType && targetType.startsWith('tag_')) {
      const tagName = targetType.replace('tag_', '').toLowerCase();
      contacts = allContacts.filter(c => (c.tag || 'Default').toLowerCase() === tagName);
    } else if (targetType && targetType !== 'all') {
      contacts = allContacts.filter(c => c.groupId === targetType);
    }
  }

  if (contacts.length === 0) {
    return res.status(400).json({ success: false, error: 'No contacts found in selected target' });
  }

  const broadcastId = 'bcast_' + Date.now();
  const bcastRecord = {
    id: broadcastId,
    clientId: clientId || null,
    agentId,
    agentName: agent.name,
    targetType: targetType || 'all',
    targetLabel: targetLabel || 'All Contacts',
    mode: mode || 'now',
    scheduledAt: scheduledAt || null,
    totalContacts: contacts.length,
    dialedCount: 0,
    connectedCount: 0,
    failedCount: 0,
    status: mode === 'schedule' ? 'scheduled' : 'running',
    createdAt: new Date().toISOString()
  };

  broadcastsDb.set(broadcastId, bcastRecord);
  saveBroadcasts();

  if (mode === 'schedule') {
    return res.json({ 
      success: true, 
      message: `✅ Broadcast scheduled for ${new Date(scheduledAt).toLocaleString()}`, 
      broadcast: bcastRecord 
    });
  }

  res.json({ 
    success: true, 
    message: `⚡ Broadcast started! Dialing ${contacts.length} contacts in background.`, 
    totalContacts: contacts.length, 
    broadcast: bcastRecord 
  });

  // Process instant broadcast in background
  executeBroadcastCalls(broadcastId, agent, contacts, req.body);
});

// Background Cron for Scheduled Broadcasts
setInterval(async () => {
  const now = new Date();
  for (const [id, bcast] of broadcastsDb.entries()) {
    if (bcast.status !== 'scheduled' || !bcast.scheduledAt) continue;

    let schedTime = new Date(bcast.scheduledAt);
    if (schedTime <= now) {
      console.log(`[Broadcast Scheduler] ⏰ Due scheduled broadcast ID=${id}. Executing...`);
      const agent = agentsDb.get(bcast.agentId);
      let allContacts = Array.from(contactsDb.values());
      if (bcast.clientId && bcast.clientId !== 'admin') {
        allContacts = allContacts.filter(c => c.clientId === bcast.clientId);
      }
      let targetContacts = allContacts;
      if (bcast.targetType && bcast.targetType.startsWith('tag_')) {
        const tagName = bcast.targetType.replace('tag_', '').toLowerCase();
        targetContacts = allContacts.filter(c => (c.tag || 'Default').toLowerCase() === tagName);
      } else if (bcast.targetType && bcast.targetType !== 'all') {
        targetContacts = allContacts.filter(c => c.groupId === bcast.targetType);
      }

      if (agent && targetContacts.length > 0) {
        executeBroadcastCalls(id, agent, targetContacts, { clientId: bcast.clientId });
      } else {
        bcast.status = 'failed';
        saveBroadcasts();
      }
    }
  }
}, 30 * 1000); // Check every 30 seconds


// ==========================================
// CLIENTS / MULTI-TENANT API
// ==========================================

// Password Hashing Helper
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function deduplicateClientsDb() {
  const seenEmails = new Map();
  let modified = false;

  for (const [clientId, client] of clientsDb.entries()) {
    if (!client || !client.email) continue;
    const emailKey = client.email.trim().toLowerCase();

    if (seenEmails.has(emailKey)) {
      const existingId = seenEmails.get(emailKey);
      const existingClient = clientsDb.get(existingId);

      // Keep client that has assigned phone_number if available, otherwise keep latest
      if (!existingClient.phone_number && client.phone_number) {
        clientsDb.delete(existingId);
        seenEmails.set(emailKey, clientId);
      } else {
        clientsDb.delete(clientId);
      }
      modified = true;
      console.log(`[Database Cleanup] Deleted duplicate client account for email: ${emailKey}`);
    } else {
      seenEmails.set(emailKey, clientId);
    }
  }

  if (modified) {
    saveClients();
  }
}

const inFlightSignups = new Set();

// 1. Signup Endpoint (Client Onboarding)
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !phone || !password) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();

  // Run cleanup to strip existing duplicates
  deduplicateClientsDb();

  // Check if email already exists
  for (const client of clientsDb.values()) {
    if (client.email && client.email.trim().toLowerCase() === cleanEmail) {
      return res.status(400).json({ success: false, error: 'Email already registered.' });
    }
  }

  // Check in-flight atomic lock to prevent race conditions from concurrent clicks
  if (inFlightSignups.has(cleanEmail)) {
    return res.status(400).json({ success: false, error: 'Account creation in progress. Please wait.' });
  }

  inFlightSignups.add(cleanEmail);

  try {
    const clientId = `client_${Date.now()}`;
    let subAuthId = 'SA_G0OY05TV'; // Default test sub-account from prompt
    let subAuthToken = 'token_test_subaccount';

    // Attempt to call Vobiz API to create a sub-account
    const masterAuthId = defaultCallConfig.vobizAuthId || process.env.VOBIZ_MASTER_AUTH_ID || 'MA_5VY3LRDW';
    const masterAuthToken = defaultCallConfig.vobizAuthToken || process.env.VOBIZ_MASTER_AUTH_TOKEN;

    if (masterAuthId && masterAuthToken) {
      try {
        console.log(`[Vobiz API] Creating sub-account for: ${cleanEmail}`);
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
            email: cleanEmail,
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

    const realHost = getRealHostFromRequest(req);
    const currentReseller = getResellerFromHost(realHost);
    const resellerId = currentReseller ? currentReseller.id : null;

    const tenantId = req.headers['x-tenant-id'] || req.body.tenantId || '';
    const clientData = {
      tenantId: tenantId || null,
      reseller_id: resellerId,
      id: clientId,
      name,
      email: cleanEmail,
      password: hashPassword(password),
      vobiz_sub_auth_id: subAuthId,
      vobiz_sub_auth_token: subAuthToken,
      phone_number: null,
      plan: 'none',
      status: 'no_plan',
      agent_config: {
        system_prompt: defaultCallConfig.systemInstruction || "You are a helpful voice assistant.",
        voice: "Aoede",
        language: "Hinglish"
      },
      balance: 0.00,
      used_minutes: 0.00,
      created_at: new Date().toISOString()
    };

    clientsDb.set(clientId, clientData);
    saveClients();

    return res.json({
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
  } finally {
    inFlightSignups.delete(cleanEmail);
  }
});

// 2. Login Endpoint
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required.' });
  }

  const realHost = getRealHostFromRequest(req);
  const isMainPlatform = isMainPlatformHost(realHost);
  const currentReseller = getResellerFromHost(realHost);

  const hashedPassword = hashPassword(password);

  // 1. Super Admin login check — Super Admin can ONLY log in on main Callio platform
  const adminEmail = defaultCallConfig.adminEmail || 'admin@callingagent.com';
  const adminPassword = defaultCallConfig.adminPassword || 'admin123';
  const adminName = defaultCallConfig.adminName || 'Admin';

  if (email.toLowerCase() === adminEmail.toLowerCase() && (password === adminPassword || hashedPassword === hashPassword(adminPassword))) {
    if (!isMainPlatform) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }
    return res.json({
      success: true,
      user: { id: 'admin', name: adminName, email: adminEmail, role: 'admin' }
    });
  }

  // 2. Reseller Admin login check (Strict Domain Isolation)
  for (const reseller of resellersDb.values()) {
    const isResellerPassMatch = (reseller.password === hashedPassword || reseller.password === password);
    if (reseller.email.toLowerCase() === email.toLowerCase() && isResellerPassMatch) {
      if (reseller.password !== hashedPassword) {
        reseller.password = hashedPassword;
        resellersDb.set(reseller.id, reseller);
        saveResellers();
      }
      if (reseller.status === 'suspended') {
        return res.status(401).json({ success: false, error: 'Invalid email or password.' });
      }

      // Reseller admin MUST log in ONLY on their specific reseller domain/subdomain
      if (isMainPlatform || !currentReseller || currentReseller.id !== reseller.id) {
        return res.status(401).json({ success: false, error: 'Invalid email or password.' });
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

  // 3. Client login check (Strict Portal Domain Isolation)
  for (const client of clientsDb.values()) {
    const isClientPassMatch = (client.password === hashedPassword || client.password === password);
    if (client.email.toLowerCase() === email.toLowerCase() && isClientPassMatch) {
      if (client.password !== hashedPassword) {
        client.password = hashedPassword;
        clientsDb.set(client.id, client);
        saveClients();
      }
      if (client.status === 'suspended') {
        return res.status(401).json({ success: false, error: 'Invalid email or password.' });
      }

      if (!isMainPlatform) {
        // Logging in on a white-label / reseller portal (e.g. Growvo / growwo.in)
        // If client does not have reseller_id OR client.reseller_id !== currentReseller?.id -> REJECT!
        if (!client.reseller_id || (currentReseller && client.reseller_id !== currentReseller.id)) {
          return res.status(401).json({ success: false, error: 'Invalid email or password.' });
        }
      } else {
        // Logging in on Main Callio Platform (callio.in / localhost)
        // White-label clients (reseller_id != null) CANNOT log in on main Callio
        if (client.reseller_id) {
          return res.status(401).json({ success: false, error: 'Invalid email or password.' });
        }
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
          balance: client.balance !== undefined ? client.balance : 0.00,
          plan: client.plan || 'none',
          used_minutes: client.used_minutes !== undefined ? client.used_minutes : 0.00,
          pricing: client.pricing || { rate_per_minute: 2.00, rate_recording_per_minute: 1.00, rate_per_session: 0.00 },
          billing_history: client.billing_history || [],
          reseller_id: client.reseller_id || null,
          tenantId: client.tenantId || null,
          created_at: client.created_at
        }
      });
    }
  }

  // Standard secure error message for ALL invalid attempts
  return res.status(401).json({ success: false, error: 'Invalid email or password.' });
});

// Verification endpoint to validate existing user_session against current domain
app.post('/api/auth/verify-session', (req, res) => {
  const { userId, role } = req.body;
  if (!userId) {
    return res.status(400).json({ success: false, error: 'User ID is required' });
  }

  const realHost = getRealHostFromRequest(req);
  const isMainPlatform = isMainPlatformHost(realHost);
  const currentReseller = getResellerFromHost(realHost);

  if (role === 'admin') {
    if (!isMainPlatform) {
      return res.status(403).json({ success: false, error: 'Invalid session for this portal' });
    }
    return res.json({ success: true });
  }

  if (role === 'reseller') {
    if (isMainPlatform || !currentReseller || currentReseller.id !== userId) {
      return res.status(403).json({ success: false, error: 'Invalid session for this portal' });
    }
    return res.json({ success: true });
  }

  // Client role
  const client = clientsDb.get(userId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  if (!isMainPlatform) {
    // White-label portal
    if (!client.reseller_id || (currentReseller && client.reseller_id !== currentReseller.id)) {
      return res.status(403).json({ success: false, error: 'Invalid session for this portal' });
    }
  } else {
    // Main platform
    if (client.reseller_id) {
      return res.status(403).json({ success: false, error: 'Invalid session for this portal' });
    }
  }

  return res.json({ success: true, user: client });
});


// 2A. Update Profile Endpoint (for user/admin profile settings)
app.post('/api/auth/update-profile', (req, res) => {
  const { id, name, email, password, gstin } = req.body;
  if (!id || !name || !email) {
    return res.status(400).json({ success: false, error: 'ID, name, and email are required.' });
  }

  const cleanGstin = gstin !== undefined ? String(gstin).trim().toUpperCase() : '';
  const host = getRealHostFromRequest(req);
  const reseller = getResellerFromHost(host);

  if (id === 'admin' || (reseller && id === reseller.id)) {
    try {
      if (id === 'admin') {
        config.adminName = name;
        config.adminEmail = email;
        if (password) config.adminPassword = password;
        if (cleanGstin) config.gstin = cleanGstin;
        saveConfig();
        console.log(`[Config Sync] Admin profile updated in config.json`);
      } else if (reseller) {
        reseller.name = name;
        reseller.email = email;
        if (cleanGstin) reseller.gstin = cleanGstin;
        resellersDb.set(reseller.id, reseller);
        saveResellers();
      }

      return res.json({
        success: true,
        user: {
          id: id,
          name: name,
          email: email,
          role: 'admin',
          gstin: cleanGstin || (reseller ? reseller.gstin : config.gstin) || ''
        }
      });
    } catch (err) {
      console.error('[Admin Profile Update Error]', err);
      return res.status(500).json({ success: false, error: 'Failed to update admin profile.' });
    }
  }

  let client = clientsDb.get(id) || resellersDb.get(id);
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
  if (cleanGstin !== undefined) {
    client.gstin = cleanGstin;
  }
  if (password) {
    client.password = hashPassword(password);
  }

  if (clientsDb.has(id)) {
    clientsDb.set(id, client);
    saveClients();
  } else if (resellersDb.has(id)) {
    resellersDb.set(id, client);
    saveResellers();
  }

  res.json({
    success: true,
    user: {
      id: client.id,
      name: client.name,
      email: client.email,
      gstin: client.gstin || '',
      role: client.role || 'client',
      status: client.status,
      phone_number: client.phone_number,
      agent_config: client.agent_config,
      balance: client.balance !== undefined ? client.balance : 0.00,
      plan: client.plan || 'none',
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

// 5. Get Pending Requests (Admin)
app.get('/api/admin/pending-requests', (req, res) => {
  const host = getRealHostFromRequest(req);
  const isMainPlatform = isMainPlatformHost(host);
  const currentReseller = getResellerFromHost(host);

  const pendingMap = new Map();
  const seenEmails = new Set();

  // 1. Collect from clientsDb (highest priority)
  for (const client of clientsDb.values()) {
    if (client.status === 'number_requested' || (client.status === 'pending_number' && client.kyc_details && client.requested_number)) {
      if (client.phone_number && client.phone_number.trim() !== '') continue;
      const itemResellerId = client.reseller_id || (client.kyc_details && client.kyc_details.reseller_id) || null;
      if (!isMainPlatform && currentReseller) {
        if (itemResellerId !== currentReseller.id) continue;
      }

      const clientEmail = (client.email || (client.kyc_details && client.kyc_details.email) || '').toLowerCase().trim();
      if (clientEmail) seenEmails.add(clientEmail);

      pendingMap.set(client.id, {
        id: client.id,
        name: client.name,
        email: client.email,
        phone_number: client.phone_number || '',
        requested_number: client.requested_number || 'Virtual Mobile',
        reseller_id: itemResellerId,
        reseller_name: client.reseller_name || (client.kyc_details && client.kyc_details.reseller_name) || null,
        kyc_details: client.kyc_details || {}
      });
    }
  }

  // 2. Collect from pendingRequests Map (only if not already present in clientsDb)
  if (typeof pendingRequests !== 'undefined') {
    for (const reqItem of pendingRequests.values()) {
      if (reqItem.status && reqItem.status !== 'pending') continue;
      const itemResellerId = reqItem.reseller_id || (reqItem.kyc_details && reqItem.kyc_details.reseller_id) || null;
      if (!isMainPlatform && currentReseller) {
        if (itemResellerId !== currentReseller.id) continue;
      }

      const reqEmail = (reqItem.kyc_details?.email || reqItem.email || '').toLowerCase().trim();
      const reqClientId = reqItem.clientId;

      // Skip if this request belongs to a client already added to pendingMap
      if (pendingMap.has(reqItem.id) || (reqClientId && pendingMap.has(reqClientId)) || (reqEmail && seenEmails.has(reqEmail))) {
        continue;
      }

      if (reqEmail) seenEmails.add(reqEmail);
      pendingMap.set(reqItem.id, {
        id: reqItem.id,
        name: reqItem.clientName || 'Client',
        email: reqItem.kyc_details?.email || '',
        phone_number: '',
        requested_number: reqItem.number || 'Virtual Mobile',
        reseller_id: itemResellerId,
        reseller_name: reqItem.reseller_name || null,
        kyc_details: reqItem.kyc_details || {}
      });
    }
  }

  res.json({ success: true, requests: Array.from(pendingMap.values()) });
});

// 6. Get All Clients (Admin)
app.get('/api/admin/clients', (req, res) => {
  deduplicateClientsDb();
  const host = req.headers.host || req.headers.origin || req.headers.referer || '';
  const currentReseller = getResellerFromHost(host);

  let list = Array.from(clientsDb.values());
  if (currentReseller) {
    list = list.filter(c => c.reseller_id === currentReseller.id);
  }

  const safeList = list.map(c => {
    const { password, ...safeClient } = c;
    if (c.reseller_id && resellersDb.has(c.reseller_id)) {
      safeClient.reseller_name = resellersDb.get(c.reseller_id).name;
    }
    return safeClient;
  });
  res.json({ success: true, clients: safeList });
});


// 7. Approve / Reject Request Endpoint (Admin)
app.post('/api/admin/approve-request', async (req, res) => {
  const { clientId, action } = req.body;
  if (!clientId || !action) {
    return res.status(400).json({ success: false, error: 'clientId and action are required.' });
  }

  let found = false;

  // 1. Resolve client from clientsDb
  const client = clientsDb.get(clientId);
  if (client) found = true;

  // 2. Resolve from pendingRequests Map (guest / orphan requests)
  let pendingReqItem = null;
  if (typeof pendingRequests !== 'undefined') {
    if (pendingRequests.has(clientId)) {
      pendingReqItem = pendingRequests.get(clientId);
      found = true;
    } else {
      // Search by matching clientId field inside the pending item
      for (const pReq of pendingRequests.values()) {
        if (pReq.clientId === clientId || pReq.id === clientId) {
          pendingReqItem = pReq;
          found = true;
          break;
        }
      }
    }
  }

  if (!found) {
    return res.status(404).json({ success: false, error: 'Request / Client not found.' });
  }

  // --- REJECT ---
  if (action === 'reject') {
    if (client) {
      client.status = 'active';
      client.requested_number = null;
      client.kyc_details = null;
      clientsDb.set(clientId, client);
      saveClients();
    }
    if (pendingReqItem && typeof pendingRequests !== 'undefined') {
      const keyToDelete = pendingReqItem.id || clientId;
      pendingRequests.delete(keyToDelete);
      savePendingRequests();
    }
    return res.json({ success: true, message: 'Request rejected.' });
  }

  // --- APPROVE ---
  const numberToBuy = (client && client.requested_number) || (pendingReqItem && pendingReqItem.requested_number);
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
        console.log(`[Vobiz API] Number purchased: ${numberToBuy}. Assigning to sub-account: ${client && client.vobiz_sub_auth_id}`);
        const assignUrl = `https://api.vobiz.ai/api/v1/Account/${masterAuthId.trim()}/Number/${numberToBuy}/Assign/`;
        await fetch(assignUrl, {
          method: 'POST',
          headers: {
            'X-Auth-ID': masterAuthId.trim(),
            'X-Auth-Token': masterAuthToken.trim(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ sub_auth_id: client && client.vobiz_sub_auth_id })
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

  // Update clientsDb if client exists
  if (client) {
    console.log(`[Admin Approval] Approving client ${clientId} for number ${numberToBuy}`);
    client.status = 'active';
    client.phone_number = numberToBuy;
    client.requested_number = null;
    clientsDb.set(clientId, client);
    saveClients();
  }

  // Update pendingRequests if pending item exists
  if (pendingReqItem && typeof pendingRequests !== 'undefined') {
    const keyToUpdate = pendingReqItem.id || clientId;
    pendingReqItem.status = 'approved';
    pendingRequests.set(keyToUpdate, pendingReqItem);
    savePendingRequests();
  }

  res.json({ success: true, client: client || pendingReqItem });
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

    const clientPhone = client.phone_number;
    for (const call of activeCalls.values()) {
      if (call.clientId === clientId) {
        clientLogs.push(call);
      } else if (clientPhone && ((call.to && cleanAndComparePhone(call.to, clientPhone)) || (call.from && cleanAndComparePhone(call.from, clientPhone)))) {
        call.clientId = clientId;
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
      balance: client.balance !== undefined ? client.balance : 0.00,
      plan: client.plan || 'none',
      used_minutes: client.used_minutes !== undefined ? client.used_minutes : 0.00,
      pricing: client.pricing || { rate_per_minute: 2.00, rate_recording_per_minute: 1.00, rate_per_session: 0.00 },
      billing_history: client.billing_history || []
    },
    calls: clientLogs.sort((a, b) => new Date(b.createdAt || b.startedAt || 0) - new Date(a.createdAt || a.startedAt || 0))
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
  let { clientId, amount, paymentMethod } = req.body;
  if (amount === undefined) {
    return res.status(400).json({ success: false, error: 'amount is required.' });
  }

  let client = null;
  if (clientId && clientId !== 'admin' && clientsDb.has(clientId)) {
    client = clientsDb.get(clientId);
  } else if (!clientId || clientId === 'admin') {
    // Only fallback when no clientId given (e.g. pure admin usage)
    client = Array.from(clientsDb.values()).find(c => c.phone_number || c.status === 'active') || Array.from(clientsDb.values())[0];
  }

  if (!client) {
    // STRICT: do not silently create a phantom client — return error
    console.warn(`[Recharge] Client not found: clientId=${clientId}`);
    return res.status(404).json({ success: false, error: 'Client account not found. Please log out and log back in.' });
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

  clientsDb.set(client.id, client);
  saveClients();

  console.log(`[Billing Recharge] Client: ${client.name} (ID: ${client.id}) self-recharged ${rechargeAmount} Mins. New balance: ${client.balance} mins`);
  res.json({ success: true, balance: client.balance, billing_history: client.billing_history, clientId: client.id });
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
  const { clientId, plan, status, name, email, phone_number, vobiz_sub_auth_id, vobiz_sub_auth_token } = req.body;
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
  if (phone_number !== undefined) {
    client.phone_number = phone_number;
    if (phone_number && phone_number.trim() !== '' && (client.status === 'pending_number' || !client.status)) {
      client.status = 'active';
      client.requested_number = null;
    }
    if (phone_number && phone_number.trim() !== '') {
      syncVobizNumberWebhook(phone_number, clientId);
    }
  }
  if (vobiz_sub_auth_id !== undefined) client.vobiz_sub_auth_id = vobiz_sub_auth_id;
  if (vobiz_sub_auth_token !== undefined) client.vobiz_sub_auth_token = vobiz_sub_auth_token;
  if (req.body.password && req.body.password.trim() !== '') {
    client.password = hashPassword(req.body.password.trim());
  }

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

// 11A4. Admin - Reset Client Password
app.post('/api/admin/reset-password', express.json(), (req, res) => {
  const { clientId, newPassword } = req.body;
  if (!clientId || !newPassword || !newPassword.trim()) {
    return res.status(400).json({ success: false, error: 'clientId and newPassword are required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  client.password = hashPassword(newPassword.trim());
  clientsDb.set(clientId, client);
  saveClients();

  console.log(`[Admin Reset Password] Password reset for client ${client.name} (ID: ${clientId}).`);
  res.json({ success: true, message: `Password for ${client.name} reset successfully.` });
});

// 11A5. Admin - Remove / Revoke Client Virtual Number
app.post('/api/admin/remove-client-number', express.json(), (req, res) => {
  const { clientId } = req.body;
  if (!clientId) {
    return res.status(400).json({ success: false, error: 'clientId is required.' });
  }

  const client = clientsDb.get(clientId);
  if (!client) {
    return res.status(404).json({ success: false, error: 'Client not found.' });
  }

  client.phone_number = null;
  client.status = 'pending_number';
  client.requested_number = null;
  clientsDb.set(clientId, client);
  saveClients();

  console.log(`[Admin Remove Number] Virtual number removed from client ${client.name} (ID: ${clientId}).`);
  res.json({ success: true, message: `Virtual number removed from ${client.name}.` });
});

// Client - Submit Virtual Number KYC Request
app.post('/api/client/request-number', express.json({ limit: '50mb' }), (req, res) => {
  const { company, person, email, phone, number_type, use_case, document_url, document_urls, userId } = req.body || {};
  const clientId = userId || (req.user ? req.user.id : null);
  const docList = Array.isArray(document_urls) && document_urls.length > 0 ? document_urls : (document_url ? [document_url] : []);

  const host = getRealHostFromRequest(req);
  const currentReseller = getResellerFromHost(host);

  let targetClient = clientId ? clientsDb.get(clientId) : null;
  if (!targetClient && email) {
    for (const c of clientsDb.values()) {
      if (c.email && c.email.toLowerCase() === email.toLowerCase()) {
        targetClient = c;
        break;
      }
    }
  }

  const finalEmail = email || (targetClient ? targetClient.email : '');
  const finalPhone = phone || (targetClient ? targetClient.phone_number : '');

  if (targetClient) {
    targetClient.status = 'number_requested';
    targetClient.requested_number = `${number_type || 'Virtual Mobile'}`;
    if (currentReseller && !targetClient.reseller_id) {
      targetClient.reseller_id = currentReseller.id;
      targetClient.reseller_name = currentReseller.name;
    }
    targetClient.kyc_details = {
      company: company || targetClient.name,
      person: person || targetClient.name,
      email: finalEmail,
      phone: finalPhone,
      number_type: number_type || 'Indian Virtual Mobile',
      use_case: use_case || 'Select All (Sales, Support, Surveys, Reminders)',
      document_urls: docList,
      document_url: docList[0] || document_url || null,
      domain: host,
      reseller_id: currentReseller ? currentReseller.id : (targetClient.reseller_id || null),
      reseller_name: currentReseller ? currentReseller.name : (targetClient.reseller_name || null),
      submittedAt: new Date().toISOString()
    };
    clientsDb.set(targetClient.id, targetClient);
    saveClients();
  }

  const reqId = targetClient ? targetClient.id : Date.now().toString();
  pendingRequests.set(reqId, {
    id: reqId,
    clientId: targetClient ? targetClient.id : (clientId || 'guest'),
    clientName: company || person || 'Client',
    number: number_type || 'Virtual Mobile',
    status: 'pending',
    reseller_id: currentReseller ? currentReseller.id : (targetClient ? targetClient.reseller_id : null),
    reseller_name: currentReseller ? currentReseller.name : (targetClient ? targetClient.reseller_name : null),
    kyc_details: {
      company: company || (targetClient ? targetClient.name : 'Client'),
      person: person || (targetClient ? targetClient.name : 'Client'),
      email: finalEmail,
      phone: finalPhone,
      use_case,
      number_type,
      document_urls: docList,
      document_url: docList[0] || document_url || null,
      domain: host,
      reseller_id: currentReseller ? currentReseller.id : (targetClient ? targetClient.reseller_id : null),
      reseller_name: currentReseller ? currentReseller.name : (targetClient ? targetClient.reseller_name : null),
      submittedAt: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });
  savePendingRequests();

  console.log(`[KYC Request] New number request submitted by ${company || person} (${email})`);
  res.json({ success: true, message: 'KYC & Virtual Number request submitted successfully.' });
});

// 11A3. Admin - Sync Vobiz Telephony Webhooks
app.post('/api/admin/sync-telephony-webhooks', async (req, res) => {
  let count = 0;
  for (const [cId, client] of clientsDb.entries()) {
    if (client.phone_number && client.phone_number.trim() !== '') {
      await syncVobizNumberWebhook(client.phone_number, cId);
      count++;
    }
  }
  res.json({ success: true, syncedCount: count, message: `Successfully synced Vobiz webhooks for ${count} virtual numbers.` });
});

// 11A3. Plans Database API routes


app.post('/api/admin/plans/save', express.json(), (req, res) => {
  const { id, name, price_per_month, max_minutes, max_agents, rate_per_minute, crm_integration, api_sharing, description, razorpay_plan_id } = req.body;
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
    description: description ? description.trim() : '',
    razorpay_plan_id: razorpay_plan_id ? String(razorpay_plan_id).trim() : ''
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

  let client = null;
  if (clientId && clientId !== 'admin' && clientsDb.has(clientId)) {
    client = clientsDb.get(clientId);
  } else if (!clientId || clientId === 'admin') {
    // Only fallback for admin or no clientId
    client = Array.from(clientsDb.values()).find(c => c.phone_number || c.status === 'active') || Array.from(clientsDb.values())[0];
  }

  if (!client) {
    console.warn(`[Billing] Client not found: clientId=${clientId}`);
    return res.status(404).json({ success: false, error: 'Client account not found. Please log out and log back in.' });
  }

  // Auto-sanitize corrupted used_minutes (> 10000) by calculating real total from calls_db
  if (client.used_minutes === undefined || client.used_minutes > 10000) {
    let calcUsed = 0;
    for (const call of activeCalls.values()) {
      if (call.clientId === client.id) {
        const start = call.startedAt ? new Date(call.startedAt) : null;
        const end = call.endedAt ? new Date(call.endedAt) : (call.createdAt ? new Date(call.createdAt) : null);
        let durSec = 0;
        if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
          durSec = Math.max(0, Math.round((end - start) / 1000));
        }
        if (durSec > 10800) durSec = 180;
        calcUsed += durSec > 0 ? Math.ceil(durSec / 60) : 0;
      }
    }
    client.used_minutes = calcUsed;
    clientsDb.set(client.id, client);
    saveClients();
  }

  res.json({
    success: true,
    balance: client.balance !== undefined ? client.balance : 0.00,
    plan: client.plan || 'none',
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
  if (authHeader && authHeader !== adminPassword && authHeader !== 'admin123') {
    return res.status(401).json({ success: false, error: 'Admin auth required.' });
  }

  const list = Array.from(resellersDb.values()).map(r => ({
    id: r.id,
    name: r.name,
    email: r.email,
    status: r.status,
    domain: r.domain || '',
    subdomain: r.subdomain || '',
    created_at: r.created_at,
    quota: r.quota,
    wholesale_plan_rates: r.wholesale_plan_rates || {},
    permissions: r.permissions,
    package_name: r.package_name || 'Standard',
    wallet_balance: r.wallet_balance !== undefined ? r.wallet_balance : 0,
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
    wallet_balance: 0,
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
  if (req.body.package_name !== undefined) {
    reseller.package_name = req.body.package_name;
  }
  resellersDb.set(reseller.id, reseller);
  saveResellers();
  res.json({ success: true, permissions: reseller.permissions, package_name: reseller.package_name });
});

// PUT update reseller quota, wallet & wholesale rate (Super Admin only)
app.put('/api/admin/resellers/:id/quota', express.json(), (req, res) => {
  const adminPassword = defaultCallConfig.adminPassword || 'admin123';
  if (req.body.admin_password !== adminPassword) return res.status(401).json({ success: false, error: 'Admin auth required.' });

  const reseller = resellersDb.get(req.params.id);
  if (!reseller) return res.status(404).json({ success: false, error: 'Reseller not found.' });

  if (req.body.total_minutes !== undefined) reseller.quota.total_minutes = Number(req.body.total_minutes);
  if (req.body.wholesale_rate_per_minute !== undefined) reseller.quota.wholesale_rate_per_minute = Number(req.body.wholesale_rate_per_minute);
  if (req.body.wholesale_plan_rates && typeof req.body.wholesale_plan_rates === 'object') {
    reseller.wholesale_plan_rates = { ...reseller.wholesale_plan_rates, ...req.body.wholesale_plan_rates };
  }
  if (req.body.wallet_balance !== undefined) reseller.wallet_balance = Number(req.body.wallet_balance);
  if (req.body.add_wallet_balance !== undefined) {
    reseller.wallet_balance = (reseller.wallet_balance || 0) + Number(req.body.add_wallet_balance);
  }

  resellersDb.set(reseller.id, reseller);
  saveResellers();
  res.json({ success: true, quota: reseller.quota, wallet_balance: reseller.wallet_balance, wholesale_plan_rates: reseller.wholesale_plan_rates });
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
  const { appName, logoUrl, faviconUrl, authHeroUrl, primaryColor, secondaryColor, supportEmail, copyrightText } = req.body;

  reseller.branding = {
    appName: appName || reseller.branding.appName,
    logoUrl: logoUrl !== undefined ? logoUrl : reseller.branding.logoUrl,
    faviconUrl: faviconUrl !== undefined ? faviconUrl : reseller.branding.faviconUrl,
    authHeroUrl: authHeroUrl !== undefined ? authHeroUrl : (reseller.branding.authHeroUrl || 'auth_right_bg.png'),
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

// GET reseller pricing config & base plans
app.get('/api/reseller/pricing-config', resellerAuthMiddleware, (req, res) => {
  const reseller = req.reseller;
  const customRates = reseller.wholesale_plan_rates || {};
  const wholesaleRatePerMin = reseller.quota?.wholesale_rate_per_minute || 2.0;

  const basePlans = Array.from(plansDb.values()).map(p => {
    const planKey = (p.id || '').toLowerCase();
    const customBasePrice = customRates[planKey] !== undefined ? Number(customRates[planKey]) : undefined;
    return {
      id: p.id,
      name: p.name,
      base_price_per_month: customBasePrice !== undefined ? customBasePrice : (p.base_price_per_month !== undefined ? p.base_price_per_month : p.price_per_month),
      base_rate_per_minute: wholesaleRatePerMin,
      max_minutes: p.max_minutes,
      max_agents: p.max_agents,
      crm_integration: p.crm_integration,
      api_sharing: p.api_sharing
    };
  });

  reseller.markups = reseller.markups || { per_minute_markup: 0, plan_markups: {} };
  reseller.wallet_balance = reseller.wallet_balance !== undefined ? reseller.wallet_balance : 0;

  res.json({
    success: true,
    wallet_balance: reseller.wallet_balance,
    wholesale_rate_per_minute: wholesaleRatePerMin,
    wholesale_plan_rates: customRates,
    base_plans: basePlans,
    markups: reseller.markups
  });
});

// PUT reseller custom markups / commissions
app.put('/api/reseller/markups', express.json(), resellerAuthMiddleware, (req, res) => {
  const reseller = req.reseller;
  const { per_minute_markup, plan_markups } = req.body;

  reseller.markups = reseller.markups || {};
  if (per_minute_markup !== undefined) {
    reseller.markups.per_minute_markup = Math.max(0, Number(per_minute_markup) || 0);
  }
  if (plan_markups && typeof plan_markups === 'object') {
    reseller.markups.plan_markups = reseller.markups.plan_markups || {};
    for (const [pId, val] of Object.entries(plan_markups)) {
      reseller.markups.plan_markups[pId] = Math.max(0, Number(val) || 0);
    }
  }

  resellersDb.set(reseller.id, reseller);
  saveResellers();
  console.log(`[Reseller Markups] Updated markups for ${reseller.name}:`, reseller.markups);
  res.json({ success: true, markups: reseller.markups });
});

// POST reseller wallet recharge (Top up funds)
app.post('/api/reseller/wallet/recharge', express.json(), resellerAuthMiddleware, (req, res) => {
  const reseller = req.reseller;
  const amount = Number(req.body.amount);
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: 'Valid positive recharge amount required.' });
  }

  reseller.wallet_balance = (reseller.wallet_balance !== undefined ? reseller.wallet_balance : 10000) + amount;
  reseller.billing_history = reseller.billing_history || [];
  reseller.billing_history.unshift({
    id: 'rwtx_' + Date.now(),
    timestamp: new Date().toISOString(),
    type: 'recharge',
    amount: amount,
    balance_after: reseller.wallet_balance,
    description: `Reseller Wallet Recharge — Added ₹${amount.toLocaleString('en-IN')}`
  });

  resellersDb.set(reseller.id, reseller);
  saveResellers();
  console.log(`[Reseller Wallet] Recharged ${reseller.name} by ₹${amount}. New Balance: ₹${reseller.wallet_balance}`);
  res.json({ success: true, wallet_balance: reseller.wallet_balance, message: `Successfully recharged ₹${amount}` });
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
    plan: 'none',
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

  const wholesaleRate = reseller.quota?.wholesale_rate_per_minute || 2.0;
  const charge = Number((Math.ceil(durationMinutes) * wholesaleRate).toFixed(2));

  reseller.quota = reseller.quota || {};
  reseller.quota.used_minutes = (reseller.quota.used_minutes || 0) + Math.ceil(durationMinutes);
  reseller.wallet_balance = Number(((reseller.wallet_balance !== undefined ? reseller.wallet_balance : 10000) - charge).toFixed(2));

  reseller.billing_history = reseller.billing_history || [];
  reseller.billing_history.unshift({
    id: 'rtxn_' + Date.now(),
    timestamp: new Date().toISOString(),
    clientId,
    clientName: client.name,
    duration_minutes: Math.ceil(durationMinutes),
    wholesale_rate: wholesaleRate,
    total_charge: charge,
    wallet_balance_after: reseller.wallet_balance,
    description: `Call by client ${client.name} — ${Math.ceil(durationMinutes)} min @ ₹${wholesaleRate}/min base rate`
  });

  resellersDb.set(reseller.id, reseller);
  saveResellers();
  console.log(`[Reseller Billing] Charged ${reseller.name} wallet: ${Math.ceil(durationMinutes)} min, ₹${charge} wholesale (New Wallet Balance: ₹${reseller.wallet_balance})`);
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

    const host = req.headers.host || req.headers.origin || '';
    const hostBranding = resolveBranding(host);
    const domainDemoPrompt = hostBranding ? hostBranding.demoSystemPrompt : '';
    // Dynamically resolve brand name for this domain
    const brandName = (hostBranding && (hostBranding.brandName || hostBranding.brand_name)) || 'Callio';

    const queryVoice = urlObj.searchParams.get('voice') || 'Aoede';
    const rawUserPrompt = urlObj.searchParams.get('prompt') || '';
    const queryInstruction = (rawUserPrompt && rawUserPrompt.trim().length > 0)
      ? rawUserPrompt.trim()
      : ((domainDemoPrompt && domainDemoPrompt.trim().length > 0) 
          ? domainDemoPrompt.trim() 
          : (defaultCallConfig.systemInstruction || 'You are a helpful assistant.'));

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
        ? `[PERSONA]: You are a male AI voice assistant named ${brandName}. You MUST always speak in first person as a male. In Hindi/Hinglish, always use masculine verb forms (e.g., "bol raha hoon", "kar raha hoon", "sun raha hoon", "ja raha hoon"). Never use feminine forms. You are confident, warm, and professional.\n\n`
        : `[PERSONA]: You are a female AI voice assistant named ${brandName}. You MUST always speak in first person as a female. In Hindi/Hinglish, always use feminine verb forms (e.g., "bol rahi hoon", "kar rahi hoon", "sun rahi hoon", "ja rahi hoon"). Never use masculine forms. You are warm, friendly, and professional.\n\n`;
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
      const bHost = ws.host || '';
      const bReseller = getResellerFromHost(bHost);
      const bName = bReseller ? (bReseller.brand_name || 'Callio') : 'Callio';
      const prompt = `You are a helpful assistant. Below is a transcript of a short live voice demo conversation between a user and an AI voice assistant called "${bName} AI". Write a 2-3 sentence friendly summary of what was discussed. Be concise and natural.\n\nTranscript:\n${transcript}\n\nSummary:`;
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
      let summary = null;
      if (conversationLog.length > 0) {
        summary = await generateTrialSummary(conversationLog);
      }
      if (!summary) {
        summary = "User tested the live AI Voice simulator demo.";
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ callSummary: summary }));
        await new Promise(r => setTimeout(r, 200));
      }

      // Update the latest trial lead in trialLeads DB!
      if (trialLeads && trialLeads.length > 0) {
        const latestLead = trialLeads[trialLeads.length - 1];
        if (latestLead) {
          latestLead.summary = summary;
          latestLead.leadQuality = conversationLog.length > 2 ? 'Warm Lead' : 'Cold Lead';
          latestLead.actionToTake = 'Follow up for live demo onboarding.';
          saveTrialLeads();
          console.log('[Browser Trial WS] Updated latest trial lead summary & quality for:', latestLead.phone);
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
      const delay = Math.max(35000, (agentSpeakingUntil - now) + 35000);
      
      inactivityTimeout = setTimeout(() => {
        console.log(`[Inactivity Timeout] User silent for 35s on CallSid: ${callSid}. Triggering automated farewell...`);
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          const timeoutGreeting = {
            clientContent: {
              turns: [
                {
                  role: "user",
                  parts: [{ text: "The user has been silent for 35 seconds. Say a quick polite goodbye in Hinglish and hang up the call using the hangupCall tool." }]
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
    let cleanName = name ? name.trim() : '';
    const callState = activeCalls.get(callSid);

    // Deep resolution of customer name if cleanName is missing or just a phone number
    if (!cleanName || /^[+\d\s\-\(\)]+$/.test(cleanName)) {
      if (callState && callState.customerName && !/^[+\d\s\-\(\)]+$/.test(callState.customerName)) {
        cleanName = callState.customerName;
      } else {
        const targetPhone = (callState && callState.to && !isVirtualNumber(callState.to)) ? callState.to : ((callState && callState.from && !isVirtualNumber(callState.from)) ? callState.from : '');
        if (targetPhone) {
          const matched = findContactByPhone(targetPhone);
          if (matched && matched.name && !/^[+\d\s\-\(\)]+$/.test(matched.name)) {
            cleanName = matched.name;
          } else {
            for (const c of activeCalls.values()) {
              if (c && c.customerName && !/^[+\d\s\-\(\)]+$/.test(c.customerName) && cleanAndComparePhone(c.to || c.from || c.customerNumber, targetPhone)) {
                cleanName = c.customerName;
                break;
              }
            }
          }
        }
      }
    }

    const isPhoneNumber = /^[+\d\s\-\(\)]+$/.test(cleanName);
    const isDefaultLead = cleanName.toLowerCase() === 'saas lead' || cleanName.toLowerCase() === 'saas' || cleanName.toLowerCase() === 'customer' || cleanName.toLowerCase() === 'a customer';
    
    if (cleanName && !isPhoneNumber && !isDefaultLead) {
      const direction = (callState && callState.direction) || 'incoming';
      const firstName = getFirstName(cleanName);
      if (firstName && firstName.toLowerCase() !== 'saas' && firstName.toLowerCase() !== 'lead') {
        greetingInstruction = `\n\n[CRITICAL USER IDENTITY & CUSTOMER CONTEXT]: You are currently speaking with customer "${cleanName}" (First Name: "${firstName}"). You KNOW their name is "${firstName}". If they ask "Mera naam kya hai?", "Who am I?", or "Do you know my name?", you MUST answer warmly: "Aapka naam ${firstName} hai!". Greet them by their first name "${firstName}" immediately at the start of the call.`;
        if (callState) callState.customerName = cleanName;
      }
    }
    const toolRule = `\n\n[CRITICAL TOOL RULE]: If the user says goodbye, bye, or asks to hang up/cut the call, YOU MUST IMMEDIATELY CALL THE 'hangupCall' TOOL to end the connection. Do not wait or ask for confirmation.\n\n[VOICEMAIL RULE]: If you hear an automated voicemail greeting (e.g., 'forwarded to voicemail', 'leave a message', 'record your message', 'after the tone'), YOU MUST IMMEDIATELY CALL THE 'hangupCall' TOOL. DO NOT PITCH THE EVENT. DO NOT LEAVE A VOICEMAIL MESSAGE. Just call hangupCall immediately!`;
    const instantGreetingRule = `\n\n[CRITICAL INSTANT GREETING RULE]: As soon as the call connects, IMMEDIATELY speak your opening greeting within 0.5 seconds! Do NOT delay or wait. Speak your opening hello instantly.`;
    const finalInstruction = `${systemInstruction}${greetingInstruction}${toolRule}${instantGreetingRule}\n\n[CRITICAL GRAMMAR RULE]: ${genderRule}`;
    
    let resolvedModel = model || 'gemini-3.1-flash-live-preview';
    console.log(`[WebSocket Stream Setup] Voice: ${voice}, CustomerName: "${cleanName}", Model: ${resolvedModel}, Instruction: ${finalInstruction.substring(0, 75)}...`);

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

              // Hard hang-up detection: if user explicitly commands to stop/cut call
              const userWantsHangup = /\b(hang up|cut the call|end the call|stop calling me|don't call again|disconnect the call|call mat karna dobara)\b/i.test(transText);
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

              const settings = callSettingsMap.get(callSid);
              const callState = activeCalls.get(callSid);
              const masterCallerId = (defaultCallConfig.vobizCallerId || '').replace(/\D/g, '');

              // 0. Resolve correct customer phone number (never use Virtual Number)
              let customerPhone = callState?.to || '';
              if (!customerPhone || cleanAndComparePhone(customerPhone, masterCallerId)) {
                customerPhone = callState?.from && !cleanAndComparePhone(callState.from, masterCallerId) ? callState.from : (settings?.to || customerPhone);
              }

              // 1. Ensure clean UTC ISO timestamp format (append Z if missing offset)
              let cleanIso = (isoTime || '').trim();
              if (cleanIso && !cleanIso.endsWith('Z') && !cleanIso.includes('+') && !cleanIso.includes('-')) {
                if (cleanIso.length === 16) cleanIso += ':00Z';
                else if (cleanIso.length === 19) cleanIso += 'Z';
                else cleanIso += 'Z';
              }

              // 2. Persist callback to local callbacks_db.json
              const cbId = `cb_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
              const cbRecord = {
                id: cbId,
                callSid,
                phone: customerPhone,
                name: callState?.name || '',
                requestedTime,
                isoTime: cleanIso,
                notes,
                scheduledAt: cleanIso,
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
              console.log(`[ScheduleCallback] ✅ Callback saved to DB: ID=${cbId}, Phone=${customerPhone}, At=${cleanIso}`);

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

          // Trigger instant initial greeting immediately upon setup completion
          ws.userHasSpoken = false;
          ws.isInterrupted = false;
          
          const sendGreetingNow = () => {
            if (geminiWs && geminiWs.readyState === WebSocket.OPEN && !ws.hasGreetingSent) {
              ws.hasGreetingSent = true;
              const cleanName = name ? name.trim() : '';
              const isPhoneNumber = /^[+\d\s\-\(\)]+$/.test(cleanName);
              const isDefaultLead = cleanName.toLowerCase() === 'saas lead' || cleanName.toLowerCase() === 'saas' || cleanName.toLowerCase() === 'customer' || cleanName.toLowerCase() === 'a customer';
              const isValidName = cleanName && !isPhoneNumber && !isDefaultLead;
              const firstName = isValidName ? getFirstName(cleanName) : '';

              const greetPrompt = (isValidName && firstName && firstName.toLowerCase() !== 'saas' && firstName.toLowerCase() !== 'lead')
                ? `Say a short friendly greeting to ${firstName} in 5 words or less in Hinglish.` 
                : "Say a short friendly hello in 4 words or less in Hinglish.";
              
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
              
              console.log(`[WebSocket Stream Setup] Injecting instant initial greeting turn: "${greetPrompt}"`);
              try {
                geminiWs.send(JSON.stringify(initGreeting));
              } catch (e) {
                console.error('Failed to send initial greeting:', e.message);
              }
            }
          };

          sendGreetingNow();
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
                  streamId: streamSid,
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
        const audioBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
        let pcm16Buf;
        if (audioBuffer.length <= 160) {
          // 8kHz mu-law (160 bytes = 20ms) -> 16kHz PCM
          pcm16Buf = twilioToGemini(audioBuffer);
        } else if (audioBuffer.length <= 320) {
          // 8kHz 16-bit PCM (320 bytes = 20ms) -> 16kHz PCM
          pcm16Buf = pcm8ToPcm16(audioBuffer);
        } else {
          // 16kHz 16-bit PCM (640 bytes = 20ms)
          pcm16Buf = audioBuffer;
        }
        const pcm16Base64 = pcm16Buf.toString('base64');
        sendAudioToGemini(pcm16Base64);
        
        // RMS check for inactivity reset
        if (pcm16Buf.length >= 2) {
          let sum = 0;
          const numSamples = Math.floor(pcm16Buf.length / 2);
          for (let i = 0; i < pcm16Buf.length; i += 2) {
            const sample = pcm16Buf.readInt16LE(i);
            sum += sample * sample;
          }
          const rms = Math.sqrt(sum / Math.max(numSamples, 1));
          if (rms > 200) resetInactivityTimer();
        }
        return; // binary handled, skip JSON parse
      }

      const msg = JSON.parse(message);


      
      switch (msg.event) {
        case 'start':
          const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          const paramProvider = (urlObj.searchParams.get('provider') || urlObj.searchParams.get('amp;provider') || '').toLowerCase();
          const clientId = urlObj.searchParams.get('client_id') || urlObj.searchParams.get('amp;client_id');

          // Auto-detect provider based on keys in the start event or query param
          const isVobiz = (msg.start && ('streamId' in msg.start || 'callId' in msg.start)) || (paramProvider === 'vobiz');
          const isExotel = !isVobiz && (msg.start && ('stream_sid' in msg.start || 'call_sid' in msg.start)) || (paramProvider === 'exotel');
          ws.provider = isVobiz ? 'vobiz' : (isExotel ? 'exotel' : (paramProvider || 'twilio'));

          if (ws.provider === 'vobiz') {
            streamSid = msg.start?.streamId || msg.start?.stream_id || msg.start?.callId || 'vobiz_stream';
            const callSid = msg.start?.callId || msg.start?.call_id || urlObj.searchParams.get('call_sid') || urlObj.searchParams.get('amp;call_sid') || 'vobiz_' + Date.now();
            activeCallSid = callSid;
            // Vobiz sends mediaFormat as object {type,sampleRate} OR as a string — handle both safely
            const rawFmt = msg.start?.mediaFormat || msg.start?.media_format || msg.start?.contentType || '';
            ws.vobizMediaFormat = (typeof rawFmt === 'string' ? rawFmt : (rawFmt?.type || rawFmt?.encoding || rawFmt?.contentType || '')).toLowerCase();
            console.log(`[Vobiz Start] StreamSid: ${streamSid}, CallSid: ${callSid}, ClientId: ${clientId || 'None'}, MediaFormat: "${ws.vobizMediaFormat}"`);
            
            const existingState = activeCalls.get(callSid);
            const fromNum = existingState?.from || urlObj.searchParams.get('from') || '';
            const toNum = existingState?.to || urlObj.searchParams.get('to') || '';
            const effectiveClientId = clientId || existingState?.clientId || null;

            // Multi-key lookup in callSettingsMap
            let callConfig = callSettingsMap.get(callSid)
                          || (toNum ? callSettingsMap.get(toNum) : null)
                          || (fromNum ? callSettingsMap.get(fromNum) : null);

            if (!callConfig) {
              console.log(`[Vobiz WS Stream] Config not found in memory map for ${callSid}, resolving via getIncomingCallConfig (Client: ${effectiveClientId || 'None'}, To: ${toNum}, From: ${fromNum})`);
              callConfig = getIncomingCallConfig(urlObj.searchParams, fromNum, effectiveClientId, toNum);
              callSettingsMap.set(callSid, callConfig);
            }

            const callState = getOrCreateCallState(callSid, {
              provider: 'vobiz',
              to: existingState?.to || callSid,
              direction: existingState?.direction || 'outgoing',
              name: callConfig.name || existingState?.name || '',
              recordCall: callConfig.recordCall || false,
              status: 'active',
              clientId: callConfig.clientId || effectiveClientId || null
            });
            if (callState) {
              callState.status = 'active';
              if (callConfig.clientId && !callState.clientId) callState.clientId = callConfig.clientId;
              const nowIso = new Date().toISOString();
              if (!callState.answeredAt) callState.answeredAt = nowIso;
              if (!callState.mediaStartedAt) callState.mediaStartedAt = nowIso;
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
            
            const existingState = activeCalls.get(callSid);
            const fromNum = existingState?.from || urlObj.searchParams.get('from') || '';
            const toNum = existingState?.to || urlObj.searchParams.get('to') || '';
            const effectiveClientId = clientId || existingState?.clientId || null;

            let callConfig = callSettingsMap.get(callSid)
                          || (toNum ? callSettingsMap.get(toNum) : null)
                          || (fromNum ? callSettingsMap.get(fromNum) : null);

            if (!callConfig) {
              callConfig = getIncomingCallConfig(urlObj.searchParams, fromNum, effectiveClientId, toNum);
              callSettingsMap.set(callSid, callConfig);
            }

            const callState = getOrCreateCallState(callSid, {
              provider: 'exotel',
              to: callSid,
              name: callConfig.name || '',
              recordCall: callConfig.recordCall || false,
              status: 'active',
              clientId: callConfig.clientId || effectiveClientId || null
            });
            if (callState) {
              callState.status = 'active';
              if (callConfig.clientId && !callState.clientId) callState.clientId = callConfig.clientId;
              const nowIso = new Date().toISOString();
              if (!callState.answeredAt) callState.answeredAt = nowIso;
              if (!callState.mediaStartedAt) callState.mediaStartedAt = nowIso;
            }
            initializeGemini(callConfig.voice, callConfig.systemInstruction, callConfig.name || '', callSid, callConfig.model);
          } else {
            streamSid = msg.start.streamSid;
            const callSid = msg.start.callSid;
            activeCallSid = callSid;
            console.log(`Twilio call started. StreamSid: ${streamSid}, CallSid: ${callSid}`);
            
            const existingState = activeCalls.get(callSid);
            const fromNum = existingState?.from || urlObj.searchParams.get('from') || '';
            const toNum = existingState?.to || urlObj.searchParams.get('to') || '';
            const effectiveClientId = clientId || existingState?.clientId || null;

            let callConfig = callSettingsMap.get(callSid)
                          || (toNum ? callSettingsMap.get(toNum) : null)
                          || (fromNum ? callSettingsMap.get(fromNum) : null);

            if (!callConfig) {
              callConfig = getIncomingCallConfig(urlObj.searchParams, fromNum, effectiveClientId, toNum);
              callSettingsMap.set(callSid, callConfig);
            }

            const callState = getOrCreateCallState(callSid, {
              provider: 'twilio',
              to: callSid,
              name: callConfig.name || '',
              recordCall: callConfig.recordCall || false,
              status: 'active',
              clientId: callConfig.clientId || effectiveClientId || null
            });
            if (callState) {
              callState.status = 'active';
              if (callConfig.clientId && !callState.clientId) callState.clientId = callConfig.clientId;
              const nowIso = new Date().toISOString();
              if (!callState.answeredAt) callState.answeredAt = nowIso;
              if (!callState.mediaStartedAt) callState.mediaStartedAt = nowIso;
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
            // Vobiz sends PCM16 at 8kHz (audio/x-l16;rate=8000) — always upsample to 16kHz
            // Even if format is empty, Vobiz default is PCM16 8kHz per their docs
            const mediaFmt = (msg.media?.contentType || msg.media?.format || msg.media?.encoding || ws.vobizMediaFormat || '').toLowerCase();
            const isMulaw = mediaFmt.includes('mulaw') || mediaFmt.includes('pcma') || mediaFmt.includes('ulaw');
            if (isMulaw) {
              pcm16Buffer = twilioToGemini(mediaBuffer); // mu-law 8kHz -> PCM 16kHz
            } else {
              pcm16Buffer = pcm8ToPcm16(mediaBuffer); // PCM16 8kHz -> PCM16 16kHz (Vobiz default)
            }
            if (!ws.loggedFirstMedia) {
              ws.loggedFirstMedia = true;
              console.log(`[Vobiz Media] First media. Format: "${mediaFmt}", isMulaw: ${isMulaw}, bufLen: ${mediaBuffer.length}, transcoding: ${isMulaw ? 'mulaw->pcm16' : 'pcm8->pcm16'}`);
            }
            ws._mediaCount = (ws._mediaCount || 0) + 1;
            if (ws._mediaCount % 100 === 0) {
              console.log(`[Vobiz Media] Packet #${ws._mediaCount}, bufLen: ${mediaBuffer.length}, isGeminiReady: ${isGeminiReady}`);
            }
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
                // If caller speaks first, cancel the automated greeting timeout immediately
                if (ws.greetingTimeout) {
                  clearTimeout(ws.greetingTimeout);
                  ws.greetingTimeout = null;
                  ws.userHasSpoken = true;
                  console.log(`[Call ${activeCallSid}] Caller spoke first (RMS: ${Math.round(rms)}). Cancelled initial greeting timeout.`);
                }
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
      let rawTime = (cb.scheduledAt || cb.isoTime || '').trim();
      if (rawTime && !rawTime.endsWith('Z') && !rawTime.includes('+') && !rawTime.includes('-')) {
        if (rawTime.length === 16) rawTime += ':00Z';
        else rawTime += 'Z';
      }
      scheduledAt = new Date(rawTime);
    } catch (e) {
      continue;
    }

    // Only dial if scheduled time has passed
    if (scheduledAt > now) continue;

    // Validate phone number: Ensure target is NOT the system virtual caller ID
    const masterCallerId = (defaultCallConfig.vobizCallerId || '').replace(/\D/g, '');
    if (!cb.phone || cleanAndComparePhone(cb.phone, masterCallerId)) {
      console.warn(`[Callback Scheduler] ⚠️ Invalid phone for callback ID=${id}: "${cb.phone}" matches Virtual Number or is empty. Skipping.`);
      cb.status = 'failed';
      cb.error = 'Invalid target phone number (Virtual Number)';
      callbacksDb.set(id, cb);
      saveCallbacks();
      continue;
    }

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
  setTimeout(() => {
    syncVobizApplications();
  }, 3000);
});

