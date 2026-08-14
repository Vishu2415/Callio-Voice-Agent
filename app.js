/**
 * Gemini Live API - Calling Agent Client Logic
 * Uses wss:// connection to stream audio input (16kHz PCM) and receive audio output (24kHz PCM).
 */

let loggedInUser = null;

// --- DOM References ---
const elApiKey = document.getElementById('api-key');
const elModelName = document.getElementById('model-name');
const elVoiceName = document.getElementById('voice-name');
const elSystemInstruction = document.getElementById('system-instruction');
const elConnectionBadge = document.getElementById('connection-badge');
const elCallingOrb = document.getElementById('calling-orb');
const elCallStatus = document.getElementById('call-status');
const elCallTimer = document.getElementById('call-timer');
const elBtnToggleCall = document.getElementById('btn-toggle-call');
const elBtnMute = document.getElementById('btn-mute');
const elTranscriptContainer = document.getElementById('transcript-container');
const elLogsContainer = document.getElementById('logs-container');
const elTabTranscript = document.getElementById('tab-transcript');
const elTabLogs = document.getElementById('tab-logs');

const elRecordCall = document.getElementById('record-call');
const elTabSummary = document.getElementById('tab-summary');
const elSummaryContainer = document.getElementById('summary-container');
const elCallsListFeed = document.getElementById('calls-list-feed');
const elCallDetailsEmpty = document.getElementById('call-details-empty');
const elCallDetailsPanel = document.getElementById('call-details-panel');
const elDetailsPhone = document.getElementById('details-phone');
const elDetailsStatusBadge = document.getElementById('details-status-badge');
const elDetailsRecordingBox = document.getElementById('details-recording-box');
const elCallSummaryBox = document.getElementById('call-summary-box');

const elTelephonyProvider = document.getElementById('telephony-provider');
const elExotelConfigContainer = document.getElementById('exotel-config-container');
const elExotelApiKey = document.getElementById('exotel-api-key');
const elExotelApiToken = document.getElementById('exotel-api-token');
const elExotelAccountSid = document.getElementById('exotel-account-sid');
const elExotelSubdomain = document.getElementById('exotel-subdomain');
const elExotelCallerId = document.getElementById('exotel-caller-id');
const elVobizConfigContainer = document.getElementById('vobiz-config-container');
const elVobizAuthId = document.getElementById('vobiz-auth-id');
const elVobizAuthToken = document.getElementById('vobiz-auth-token');
const elVobizCallerId = document.getElementById('vobiz-caller-id');
const elCampaignFileInput = document.getElementById('campaign-file-input');
const elBtnSavePrompt = document.getElementById('btn-save-prompt');

// --- API & Data Sharing DOM References ---
const elSharedApiKeyInput = document.getElementById('shared-api-key-input');
const elBtnToggleSharedKeyVisibility = document.getElementById('btn-toggle-shared-key-visibility');
const elBtnCopySharedKey = document.getElementById('btn-copy-shared-key');
const elBtnGenerateApiKey = document.getElementById('btn-generate-api-key');
const elBtnDeleteApiKey = document.getElementById('btn-delete-api-key');
const elShareAgentsCheckbox = document.getElementById('share-agents-checkbox');
const elShareContactsCheckbox = document.getElementById('share-contacts-checkbox');
const elShareCallsCheckbox = document.getElementById('share-calls-checkbox');
const elBtnSaveSharingSettings = document.getElementById('btn-save-sharing-settings');

// --- State Variables ---
let ws = null;
let audioContext = null;
let micStream = null;
let micSourceNode = null;
let processorNode = null;
let isConnected = false;
let isConnecting = false;
let isMuted = false;
let callStartTime = 0;
let callTimerInterval = null;

// Audio Playback state
let nextPlayTime = 0;
let playOutNode = null; // Node to connect playback to agent analyser

// Visualizer State
let canvasCtx = null;
let animationFrameId = null;
let userAnalyser = null;
let agentAnalyser = null;
let userBufferLength = 0;
let agentBufferLength = 0;
let userDataArray = null;
let agentDataArray = null;
window.campaignLeads = {};

// Load API key from localStorage if it exists
if (localStorage.getItem('gemini_api_key')) {
  elApiKey.value = localStorage.getItem('gemini_api_key');
}

// Load System Instruction from localStorage if it exists
if (localStorage.getItem('gemini_system_instruction')) {
  elSystemInstruction.value = localStorage.getItem('gemini_system_instruction');
}

// Load Agent Voice from localStorage if it exists
if (localStorage.getItem('gemini_agent_voice')) {
  elVoiceName.value = localStorage.getItem('gemini_agent_voice');
}

// --- Navbar Main Tab Navigation ---
document.querySelectorAll('.glass-navbar .nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active class from all buttons
    document.querySelectorAll('.glass-navbar .nav-btn').forEach(b => b.classList.remove('active'));
    // Hide all tab panes
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    
    // Add active class to clicked button
    btn.classList.add('active');
    // Show target tab pane (with null guard in case tab pane doesn't exist)
    const targetId = btn.getAttribute('data-tab');
    const targetPane = document.getElementById(targetId);
    if (targetPane) targetPane.classList.add('active');

    // Save active tab to localStorage
    localStorage.setItem('activeTab', targetId);
    document.documentElement.setAttribute('data-active-tab', targetId);

    // Handle specific tab load logic
    if (targetId === 'tab-agents') fetchAgents();
    if (targetId === 'tab-contacts') fetchGroups();
    if (targetId === 'tab-broadcast' || targetId === 'tab-quick-call') {
      fetchAgentsForDropdowns();
      if (targetId === 'tab-broadcast') fetchGroupsForDropdowns();
    }
    if (targetId === 'tab-crm-automation') {
      fetchCrmRulesAndAgents();
      fetchCrmLogs();
    }
    if (targetId === 'tab-api-sharing') {
      fetchSharingConfig();
    }
    if (targetId === 'tab-call-history') {
      renderHistoryList();
    }
    if (targetId === 'tab-billing') {
      fetchBillingData();
    }
    if (targetId === 'tab-admin-panel') {
      fetchAdminRequests();
      fetchAdminClients();
      fetchAdminTransactions();
    }
    if (targetId === 'tab-dashboard') {
      refreshCallsList();
    }
  });
});

// --- Dashboard Navigation Helpers ---

// Navigate to Callings (Quick Call) tab
window.navigateToCallingsPage = function() {
  const btn = document.querySelector('.glass-navbar .nav-btn[data-tab="tab-quick-call"]');
  if (btn) { btn.click(); return; }
  // Fallback: manually switch
  document.querySelectorAll('.glass-navbar .nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
  const pane = document.getElementById('tab-quick-call');
  if (pane) { pane.classList.add('active'); pane.style.display = 'block'; }
  localStorage.setItem('activeTab', 'tab-quick-call');
  document.documentElement.setAttribute('data-active-tab', 'tab-quick-call');
};

// Navigate to AI Summaries full page view
window.navigateToSummariesPage = function() {
  if (typeof window.navigateToAISummariesPage === 'function') {
    window.navigateToAISummariesPage();
  } else {
    window.switchFullPageTab('tab-ai-summaries');
  }
};

// openMetricDetailsModal is defined further below (see renderMetricDetailsModalContent section)

// --- Tab Navigation (Logs/Transcript) ---
elTabTranscript.addEventListener('click', () => {
  elTabTranscript.classList.add('active');
  elTabLogs.classList.remove('active');
  elTabSummary.classList.remove('active');
  elTranscriptContainer.classList.add('active');
  elLogsContainer.classList.remove('active');
  elSummaryContainer.classList.remove('active');
});

elTabLogs.addEventListener('click', () => {
  elTabLogs.classList.add('active');
  elTabTranscript.classList.remove('active');
  elTabSummary.classList.remove('active');
  elLogsContainer.classList.add('active');
  elTranscriptContainer.classList.remove('active');
  elSummaryContainer.classList.remove('active');
});

elTabSummary.addEventListener('click', () => {
  elTabSummary.classList.add('active');
  elTabTranscript.classList.remove('active');
  elTabLogs.classList.remove('active');
  elSummaryContainer.classList.add('active');
  elTranscriptContainer.classList.remove('active');
  elLogsContainer.classList.remove('active');
  if (!selectedCallSid) {
    showListView();
  } else {
    showDetailsView();
  }
  refreshCallsList();
});

// --- System Logging Helpers ---
function logInfo(msg) {
  const div = document.createElement('div');
  div.className = 'log-entry log-info';
  div.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
  elLogsContainer.appendChild(div);
  elLogsContainer.scrollTop = elLogsContainer.scrollHeight;
}

function logWarn(msg) {
  const div = document.createElement('div');
  div.className = 'log-entry log-warn';
  div.innerText = `[${new Date().toLocaleTimeString()}] ⚠️ ${msg}`;
  elLogsContainer.appendChild(div);
  elLogsContainer.scrollTop = elLogsContainer.scrollHeight;
}

function logError(msg) {
  const div = document.createElement('div');
  div.className = 'log-entry log-error';
  div.innerText = `[${new Date().toLocaleTimeString()}] ❌ ${msg}`;
  elLogsContainer.appendChild(div);
  elLogsContainer.scrollTop = elLogsContainer.scrollHeight;
}

function logSuccess(msg) {
  const div = document.createElement('div');
  div.className = 'log-entry log-success';
  div.innerText = `[${new Date().toLocaleTimeString()}] ✓ ${msg}`;
  elLogsContainer.appendChild(div);
  elLogsContainer.scrollTop = elLogsContainer.scrollHeight;
}

// --- Live Call Monitor & AI Action Planner Helpers ---
window.triggerLeadCall = async function(phone) {
  if (!phone) return;
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  
  // 1. Fill Quick Call phone number input
  const quickCallInput = document.getElementById('quick-call-phone');
  if (quickCallInput) {
    quickCallInput.value = cleanPhone;
    quickCallInput.dispatchEvent(new Event('input'));
  }
  
  const confirmCall = confirm(`📞 Place AI Voice Call to ${cleanPhone} now?`);
  if (!confirmCall) {
    const quickCallTab = document.getElementById('nav-quick-call');
    if (quickCallTab) quickCallTab.click();
    return;
  }

  // Directly trigger outbound call via /make-call
  const publicUrl = window.location.origin;
  const u = typeof loggedInUser !== 'undefined' ? loggedInUser : null;
  const clientId = u ? (u.id || u._id) : null;
  const callerIdEl = document.getElementById('calling-vobiz-caller-id');
  const vobizCallerId = (callerIdEl && callerIdEl.value.trim()) ? callerIdEl.value.trim() : (u ? u.phone_number : '');

  const payload = {
    provider: 'vobiz',
    to: cleanPhone,
    publicUrl: publicUrl,
    vobizCallerId: vobizCallerId,
    clientId: clientId,
    client_id: clientId,
    recordCall: true
  };

  try {
    const response = await fetch('/make-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.success) {
      alert(`✅ Outbound call to ${cleanPhone} initiated successfully!`);
    } else {
      alert(`❌ Call failed: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    alert(`❌ Network error: ${error.message}`);
  }
};

// Trigger Call Back with Agent selector popup (used by AI lead cards)
window.triggerCallBackWithAgent = function(phone) {
  const cleanPhone = phone ? phone.replace(/[^0-9+]/g, '') : '';
  if (!cleanPhone) return;

  // Build the agent-select popup
  let popup = document.getElementById('callback-agent-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'callback-agent-popup';
    popup.style.cssText = 'display:none; position:fixed !important; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.75); z-index:999999999; align-items:center; justify-content:center; backdrop-filter:blur(6px);';
    popup.innerHTML = `
      <div style="background:var(--bg-surface,#18181b); border:1px solid var(--border-color,#27272a); border-radius:20px; padding:28px 28px 22px; width:360px; max-width:94vw; box-shadow:0 24px 60px rgba(0,0,0,0.7); position:relative;">
        <div style="font-size:1.05rem; font-weight:800; color:var(--text-main,#fff); margin-bottom:4px;">📞 Initiate Callback</div>
        <div id="callback-popup-phone" style="font-size:0.82rem; color:var(--color-cyan,#06b6d4); font-family:var(--font-mono,monospace); margin-bottom:18px; font-weight:700;"></div>
        <label style="font-size:0.78rem; color:var(--text-muted,#a1a1aa); font-weight:700; text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Select AI Agent</label>
        <select id="callback-agent-select" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid var(--border-color,#27272a); color:var(--text-main,#fff); border-radius:10px; padding:10px 12px; font-size:0.88rem; box-sizing:border-box; outline:none; cursor:pointer; margin-bottom:18px;">
          <option value="">-- Loading agents... --</option>
        </select>
        <div style="display:flex; gap:10px;">
          <button onclick="document.getElementById('callback-agent-popup').style.display='none';" style="flex:1; padding:10px; border-radius:10px; background:rgba(255,255,255,0.06); border:1px solid var(--border-color,#27272a); color:var(--text-muted,#a1a1aa); font-weight:700; cursor:pointer; font-size:0.85rem;">Cancel</button>
          <button id="callback-start-btn" style="flex:2; padding:10px; border-radius:10px; background:linear-gradient(135deg,#ff5f52,#e11d48); border:none; color:#fff; font-weight:800; cursor:pointer; font-size:0.85rem; display:flex; align-items:center; justify-content:center; gap:7px; box-shadow:0 4px 14px rgba(225,29,72,0.3);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            Call Now
          </button>
        </div>
      </div>
    `;
    popup.onclick = function(e) { if (e.target === popup) popup.style.display = 'none'; };
    document.body.appendChild(popup);
  }

  // Set phone label
  const phoneLabel = popup.querySelector('#callback-popup-phone');
  if (phoneLabel) phoneLabel.innerText = cleanPhone;

  // Populate agent dropdown
  const agentSel = popup.querySelector('#callback-agent-select');
  if (agentSel) {
    agentSel.innerHTML = '<option value="">-- Loading... --</option>';
    const clientId = (typeof loggedInUser !== 'undefined' && loggedInUser) ? (loggedInUser.id || '') : '';
    fetch(`/api/agents?clientId=${clientId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.agents && d.agents.length > 0) {
          agentSel.innerHTML = '<option value="">-- Select Agent --</option>' +
            d.agents.map(a => `<option value="${a.id}">${a.name} (${a.voice || 'Default'})</option>`).join('');
          // Auto-select first agent
          if (d.agents.length === 1) agentSel.value = d.agents[0].id;
        } else {
          agentSel.innerHTML = '<option value="">No agents found. Create one first.</option>';
        }
      })
      .catch(() => { agentSel.innerHTML = '<option value="">Failed to load agents</option>'; });
  }

  // Wire up Call Now button
  const startBtn = popup.querySelector('#callback-start-btn');
  if (startBtn) {
    startBtn.onclick = async function() {
      const agentId = agentSel ? agentSel.value : '';
      if (!agentId) { alert('Please select an agent first.'); return; }
      startBtn.disabled = true;
      startBtn.innerHTML = '⏳ Calling...';
      try {
        const publicUrl = document.getElementById('public-url')?.value || '';
        const payload = {
          agentId,
          targetType: 'custom',
          targetLabel: `Callback: ${cleanPhone}`,
          mode: 'now',
          publicUrl,
          clientId: (typeof loggedInUser !== 'undefined' && loggedInUser) ? loggedInUser.id : null,
          customPhones: [cleanPhone]
        };
        const res = await fetch('/api/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        popup.style.display = 'none';
        if (data.success) {
          alert(`✅ Callback initiated for ${cleanPhone}!`);
        } else {
          alert('Failed to start call: ' + (data.error || 'Unknown error'));
        }
      } catch(e) {
        alert('Network error: ' + e.message);
      } finally {
        startBtn.disabled = false;
        startBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Call Now';
      }
    };
  }

  popup.style.display = 'flex';
};

// Dismiss by card ID string (works even if card is not in DOM)
window.dismissLeadCardById = function(cardId) {
  if (!cardId) return;
  const storageKey = typeof loggedInUser !== 'undefined' && loggedInUser 
    ? `dismissed_leads_${loggedInUser.id || loggedInUser.username || 'default'}` 
    : 'dismissed_leads';
  let dismissed = [];
  try { dismissed = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch(e) { dismissed = []; }
  if (!dismissed.includes(String(cardId))) {
    dismissed.push(String(cardId));
    localStorage.setItem(storageKey, JSON.stringify(dismissed));
  }
  // Remove from DOM if present
  const cardOnDom = document.querySelector(`.action-lead-card[data-id="${cardId}"]`);
  if (cardOnDom) {
    cardOnDom.style.opacity = '0';
    cardOnDom.style.transform = 'scale(0.9)';
    cardOnDom.style.transition = 'all 0.2s';
    setTimeout(() => {
      cardOnDom.remove();
      const container = document.getElementById('ai-action-cards-container');
      if (container && container.querySelectorAll('.action-lead-card').length === 0) {
        showEmptyState(container);
      }
    }, 200);
  }
};

window.dismissLeadCard = function(btn) {
  if (typeof btn === 'string') { window.dismissLeadCardById(btn); return; }
  const card = btn && btn.closest ? btn.closest('.action-lead-card') : null;
  if (card) {
    const cardId = card.dataset.id;
    window.dismissLeadCardById(cardId);
    return;
  }
  // Fallback if btn element doesn't have a parent card — just log
  console.warn('[dismissLeadCard] Could not find parent .action-lead-card for button');
};

function showEmptyState(container) {
  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: var(--bg-surface); border: 1px dashed var(--border-color); border-radius: 16px; padding: 20px; box-sizing: border-box; text-align: center; gap: 24px; min-width: 500px;">
      <!-- Radar Pulse Icon -->
      <div style="position: relative; width: 60px; height: 60px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
        <!-- Pulsing Rings -->
        <div style="position: absolute; width: 100%; height: 100%; border-radius: 50%; background: rgba(6, 182, 212, 0.15); animation: radar-pulse 2s infinite ease-out;"></div>
        <div style="position: absolute; width: 100%; height: 100%; border-radius: 50%; background: rgba(6, 182, 212, 0.1); animation: radar-pulse 2s infinite ease-out; animation-delay: 0.8s;"></div>
        <!-- Center Core -->
        <div style="position: relative; width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, var(--color-primary), var(--color-cyan)); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 15px rgba(6, 182, 212, 0.6);">
          <svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3" style="width: 14px; height: 14px;"><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
        </div>
      </div>
      
      <!-- Text content -->
      <div style="text-align: left;">
        <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; color: var(--text-main); font-weight: 700; display: flex; align-items: center; gap: 8px;">
          AI Lead Scout Active
          <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
        </h4>
        <p style="margin: 0; font-size: 0.75rem; color: var(--text-muted); line-height: 1.4; max-width: 420px;">
          All follow-up tasks completed! The AI agent is actively listening to your telephony lines. New leads and callbacks will appear here in real-time.
        </p>
      </div>
    </div>
  `;
}
window.normalizePhoneKey = function(phoneStr) {
  if (!phoneStr) return '';
  let digits = String(phoneStr).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.substring(2);
  } else if (digits.length > 10) {
    digits = digits.slice(-10);
  }
  return digits;
};
function normalizePhoneKey(phoneStr) {
  return window.normalizePhoneKey(phoneStr);
}

window.getContactNameForPhone = function(phoneStr) {
  if (!phoneStr) return null;
  const normKey = normalizePhoneKey(phoneStr);
  if (!normKey) return null;

  if (typeof window.getAllContactsList === 'function') {
    const list = window.getAllContactsList();
    if (Array.isArray(list)) {
      const match = list.find(c => c && c.phone && normalizePhoneKey(c.phone) === normKey && c.name);
      if (match && match.name && match.name.trim() !== '' && normalizePhoneKey(match.name) !== normKey) {
        return match.name.trim();
      }
    }
  }

  if (typeof contactsCache !== 'undefined' && Array.isArray(contactsCache)) {
    const match = contactsCache.find(c => c && c.phone && normalizePhoneKey(c.phone) === normKey && c.name);
    if (match && match.name && match.name.trim() !== '' && normalizePhoneKey(match.name) !== normKey) {
      return match.name.trim();
    }
  }

  return null;
};

// Convert actual calls to action cards
window.populateAIActionPlanner = function() {
  const container = document.getElementById('ai-action-cards-container');
  if (!container) return;
  
  const cardsData = [];
  
  // Helper: detect virtual/system numbers that should NOT appear as customer contacts
  function isSystemNumber(phone) {
    if (!phone) return true;
    const cleaned = String(phone).replace(/\D/g, '');
    if (!cleaned || cleaned.length < 8) return true;
    const systemNumbers = ['917971442441', '7971442441', '971442441'];
    return systemNumbers.some(n => cleaned === n || cleaned.endsWith(n) || n.endsWith(cleaned));
  }

  // Helper: normalize phone number for unique lead grouping
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

  // Group calls by unique customer phone number (Unified Lead Architecture)
  if (typeof callsCache !== 'undefined' && callsCache && callsCache.length > 0) {
    const validCalls = callsCache.filter(call => {
      const candidatePhone = call.customerNumber || call.phone || call.to || call.from;
      return candidatePhone && !isSystemNumber(candidatePhone);
    });

    // Sort calls newest first
    const sortedValidCalls = [...validCalls].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const leadMap = new Map(); // normPhone -> Lead object

    sortedValidCalls.forEach(call => {
      const bestPhone = [call.customerNumber, call.phone, call.to, call.from]
        .find(p => p && !isSystemNumber(p)) || '+91 XXXXXXXXXX';
      const normKey = normalizePhoneKey(bestPhone) || bestPhone;

      const parsed = parseCallSummary(call.summary);

      let urgency = 'Medium';
      let urgencyColor = '#eab308';
      let urgencyBg = 'rgba(234, 179, 8, 0.15)';
      let urgencyBorder = 'rgba(234, 179, 8, 0.25)';
      
      let sentiment = parsed.verdict || 'Neutral';
      let sentimentColor = '#94a3b8';
      let sentimentBg = 'rgba(255, 255, 255, 0.05)';
      let sentimentBorder = 'rgba(255, 255, 255, 0.15)';
      let actionText = 'Call Back';
      
      if (call.sentiment || parsed.verdict) {
        const s = (call.sentiment || parsed.verdict || '').toLowerCase();
        if (s.includes('positive') || s.includes('interest')) {
          sentiment = 'Interested';
          sentimentColor = '#10b981';
          sentimentBg = 'rgba(16, 185, 129, 0.12)';
          sentimentBorder = 'rgba(16, 185, 129, 0.3)';
          urgency = 'Urgent';
          urgencyColor = '#ef4444';
          urgencyBg = 'rgba(239, 68, 68, 0.15)';
          urgencyBorder = 'rgba(239, 68, 68, 0.25)';
          actionText = 'Call Back';
        } else if (s.includes('not interested') || s.includes('negative') || s.includes('angry') || s.includes('frust')) {
          sentiment = s.includes('not interested') ? 'Not Interested' : 'Frustrated';
          sentimentColor = '#ef4444';
          sentimentBg = 'rgba(239, 68, 68, 0.12)';
          sentimentBorder = 'rgba(239, 68, 68, 0.3)';
          urgency = 'Medium';
          urgencyColor = '#eab308';
          urgencyBg = 'rgba(234, 179, 8, 0.15)';
          urgencyBorder = 'rgba(234, 179, 8, 0.25)';
          actionText = 'Call Back';
        }
      }
      
      let summaryText = parsed.cleanSummary;
      if (!summaryText) {
        if (call.status === 'no-answer' || call.status === 'busy') {
          summaryText = 'Call was not answered. Customer was busy or did not pick up.';
          sentiment = 'No Answer';
          actionText = 'Retry Call';
        } else if (call.status === 'completed') {
          summaryText = `Call completed (Duration: ${typeof formatDuration === 'function' ? formatDuration(call.duration || 0) : (call.duration || 0) + 's'}).`;
          actionText = 'Follow Up';
        } else {
          summaryText = `Call ended with status: ${call.status || 'ended'}.`;
        }
      }
      
      const actionToTake = call.action_to_take || parsed.actionToTake || 'Follow up with lead';

      const callHistoryItem = {
        id: call.callSid || call.sid || call.id || `call_${Date.now()}`,
        direction: call.direction || 'outbound',
        status: call.status || 'ended',
        duration: call.duration || 0,
        createdAt: call.createdAt || new Date().toISOString(),
        summary: summaryText,
        sentiment,
        urgency,
        actionToTake
      };

      const cName = call.customerName || call.contactName || call.name || (typeof window.getContactNameForPhone === 'function' ? window.getContactNameForPhone(bestPhone) : null);

      if (!leadMap.has(normKey)) {
        leadMap.set(normKey, {
          id: `lead_${normKey}`,
          phone: bestPhone,
          contactName: cName || null,
          normKey,
          urgency,
          sentiment,
          color: sentimentColor,
          sentimentBg,
          sentimentBorder,
          urgencyColor,
          urgencyBg,
          urgencyBorder,
          summary: summaryText,
          actionToTake,
          actionText,
          totalCalls: 1,
          calls: [callHistoryItem]
        });
      } else {
        const lead = leadMap.get(normKey);
        if (!lead.contactName && cName) {
          lead.contactName = cName;
        }
        lead.totalCalls += 1;
        lead.calls.push(callHistoryItem);
        // Elevate sentiment if interested
        if (sentiment === 'Interested' && lead.sentiment !== 'Interested') {
          lead.sentiment = 'Interested';
          lead.color = sentimentColor;
          lead.sentimentBg = sentimentBg;
          lead.sentimentBorder = sentimentBorder;
          lead.urgency = 'Urgent';
          lead.urgencyColor = urgencyColor;
          lead.urgencyBg = urgencyBg;
          lead.urgencyBorder = urgencyBorder;
        }
        // Retain most descriptive summary & latest action
        if (actionToTake && actionToTake !== 'Follow up with lead') {
          lead.actionToTake = actionToTake;
        }
        if (summaryText && !summaryText.toLowerCase().includes('failed') && summaryText.length > (lead.summary || '').length) {
          lead.summary = summaryText;
        }
      }
    });

    cardsData.push(...Array.from(leadMap.values()));
  }

  
  // Store all active cards globally for modal view
  window.allActiveActionCards = cardsData;

  // Load dismissed leads from localStorage (User Isolated)
  const storageKey = typeof loggedInUser !== 'undefined' && loggedInUser 
    ? `dismissed_leads_${loggedInUser.id || loggedInUser.username || 'default'}` 
    : 'dismissed_leads';
    
  let dismissed = [];
  try {
    dismissed = JSON.parse(localStorage.getItem(storageKey) || '[]');
  } catch (e) {
    dismissed = [];
  }
  
  // Filter out dismissed cards & ignore corrupted call_undefined IDs
  let activeCards = cardsData.filter(c => c && c.id && c.id !== 'call_undefined' && !dismissed.includes(c.id));
  
  if (activeCards.length === 0) {
    activeCards = mockLeads;
  }
  
  // Limit display to MAX 7 CARDS on the top Dashboard area
  const top7Cards = activeCards.slice(0, 7);

  container.innerHTML = '';
  top7Cards.forEach(card => {
    const cardEl = createActionCardElement(card);
    container.appendChild(cardEl);
  });

  // Append See All card as the 8th item
  const seeAllCardEl = document.createElement('div');
  seeAllCardEl.className = 'action-lead-card see-all-card';
  seeAllCardEl.onclick = () => window.openAllActionCardsModal();
  seeAllCardEl.style.cssText = 'flex: 0 0 220px; background: linear-gradient(135deg, rgba(6, 182, 212, 0.08), rgba(124, 58, 237, 0.08)); border: 1px dashed rgba(6, 182, 212, 0.4); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; cursor: pointer; transition: all 0.25s ease; box-sizing: border-box; height: 100%;';
  
  seeAllCardEl.onmouseover = () => {
    seeAllCardEl.style.borderColor = 'var(--color-cyan)';
    seeAllCardEl.style.transform = 'translateY(-3px)';
    seeAllCardEl.style.boxShadow = '0 10px 30px 0 rgba(6, 182, 212, 0.2)';
  };
  seeAllCardEl.onmouseout = () => {
    seeAllCardEl.style.borderColor = 'rgba(6, 182, 212, 0.4)';
    seeAllCardEl.style.transform = 'none';
    seeAllCardEl.style.boxShadow = 'none';
  };

  seeAllCardEl.innerHTML = `
    <div style="width: 38px; height: 38px; border-radius: 50%; background: rgba(6, 182, 212, 0.15); display: flex; align-items: center; justify-content: center; margin-bottom: 8px; color: var(--color-cyan);">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 20px; height: 20px;"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </div>
    <span style="font-weight: 800; font-size: 0.9rem; color: var(--text-main); margin-bottom: 4px;">See All Cards</span>
    <span style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 10px;">${activeCards.length} action leads total</span>
    <button class="btn btn-primary" style="padding: 4px 12px; font-size: 0.72rem; border-radius: 8px; background: var(--color-cyan); border-color: var(--color-cyan); color: #000; font-weight: 800; pointer-events: none;">Explore All (${activeCards.length}) →</button>
  `;
  container.appendChild(seeAllCardEl);
};

function parseCallSummary(summaryRaw) {
  if (!summaryRaw) {
    return { cleanSummary: '', verdict: '', actionToTake: '', keyPoints: [] };
  }

  const raw = String(summaryRaw);

  let verdict = '';
  const verdictMatch = raw.match(/\*\*(?:VERDICT|Verdict):\*\*\s*([^\n\*]+)/i) || raw.match(/(?:VERDICT|Verdict):\s*([^\n\*]+)/i);
  if (verdictMatch) {
    verdict = verdictMatch[1].trim().replace(/\*\*/g, '');
  }

  let actionToTake = '';
  const actionMatch = raw.match(/\*\*(?:Next Action|Action to Take|Key Action|Next Steps):\*\*\s*([^\n]+)/i) 
                   || raw.match(/(?:Next Action|Action to Take|Key Action|Next Steps):\s*([^\n]+)/i);
  if (actionMatch) {
    actionToTake = actionMatch[1].trim().replace(/\*\*/g, '');
  }

  let cleanSummary = raw;
  cleanSummary = cleanSummary.replace(/\*\*(?:VERDICT|Verdict):\*\*\s*[^\n]*/gi, '');
  cleanSummary = cleanSummary.replace(/\*\*(?:Next Action|Action to Take|Key Action|Next Steps):\*\*\s*[^\n]*/gi, '');
  cleanSummary = cleanSummary.replace(/\*\*(?:Key Points|Key Details):\*\*/gi, '');
  cleanSummary = cleanSummary.replace(/\*\*/g, '');
  cleanSummary = cleanSummary.replace(/[\-\•]/g, ' ');
  cleanSummary = cleanSummary.replace(/[\r\n]+/g, ' ');
  cleanSummary = cleanSummary.replace(/\s+/g, ' ').trim();

  return { cleanSummary, verdict, actionToTake };
}

function createActionCardElement(card, isModal = false) {
  const cardEl = document.createElement('div');
  cardEl.className = 'action-lead-card';
  cardEl.dataset.id = card.id;

  const flexBasis = isModal ? '100%' : '0 0 310px';
  const widthConstraint = isModal ? '' : 'min-width: 300px; max-width: 340px;';
  cardEl.style.cssText = `flex: ${flexBasis}; ${widthConstraint} border-radius: 18px; padding: 12px 14px; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; height: 205px; max-height: 205px; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); position: relative; backdrop-filter: blur(16px); cursor: pointer; user-select: none; overflow: hidden;`;

  cardEl.onclick = (e) => {
    // If user clicks on button or inside a button, don't trigger modal
    if (e.target.closest('button')) return;
    window.openLeadDetailModal(card.id, card);
  };

  cardEl.onmouseover = () => {
    cardEl.style.transform = 'translateY(-3px)';
  };
  cardEl.onmouseout = () => {
    cardEl.style.transform = 'none';
  };

  const defaultAction = card.actionToTake || 'Follow up with lead';
  const actionToTakeHtml = `
    <div class="action-box" style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 4px 8px; font-size: 0.73rem; font-weight: 600; text-align: left; display: flex; align-items: center; gap: 6px; line-height: 1.3; margin-top: 3px; color: #d97706;" title="Action to Take">
      <span style="font-size: 0.8rem; line-height: 1; flex-shrink: 0;">⚡</span>
      <span style="overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical;"><strong>Action:</strong> ${defaultAction}</span>
    </div>
  `;

  const titleText = card.contactName ? card.contactName : card.phone;

  cardEl.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-shrink: 0; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0; overflow: hidden;">
        <span style="color: var(--color-primary, #ff5f52); font-size: 0.88rem;">📞</span>
        <span style="font-size: 0.90rem; font-weight: 800; color: var(--text-main); font-family: var(--font-mono, monospace); letter-spacing: -0.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;" title="${titleText}">${titleText}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
        <span style="font-size: 0.58rem; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 9999px; background: ${card.sentimentBg}; color: ${card.color}; border: 1px solid ${card.sentimentBorder}; letter-spacing: 0.3px; white-space: nowrap;">
          ${card.sentiment}
        </span>
        <span style="font-size: 0.56rem; font-weight: 700; text-transform: uppercase; padding: 2px 5px; border-radius: 9999px; background: ${card.urgencyBg}; color: ${card.urgencyColor}; border: 1px solid ${card.urgencyBorder}; letter-spacing: 0.3px; white-space: nowrap;">${card.urgency}</span>
      </div>
    </div>
    
    <div style="flex-grow: 1; display: flex; flex-direction: column; justify-content: center; gap: 4px; margin-bottom: 6px; text-align: left; overflow: hidden;">
      <div style="font-size: 0.76rem; color: var(--text-main); line-height: 1.38; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;" title="${card.summary}">
        ${card.summary}
      </div>
      ${actionToTakeHtml}
    </div>
    
    <div style="display: flex; gap: 8px; margin-top: auto; flex-shrink: 0;">
      <button class="btn btn-primary" onclick="window.triggerCallBackWithAgent('${card.phone}'); event.stopPropagation();" style="flex: 1; height: 32px; border-radius: 8px; background: linear-gradient(135deg, var(--color-primary, #ff5f52), #e11d48); border: none; color: #ffffff; font-weight: 700; font-size: 0.76rem; display: inline-flex; align-items: center; justify-content: center; gap: 5px; cursor: pointer; box-shadow: 0 4px 12px rgba(225, 29, 72, 0.25); transition: all 0.2s;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 12px; height: 12px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        ${card.actionText}
      </button>
      <button class="btn btn-secondary btn-done" onclick="window.dismissLeadCardById('${card.id}'); event.stopPropagation();" style="height: 32px; border-radius: 8px; background: rgba(255,255,255,0.06); border: 1px solid var(--border-color); color: var(--text-muted); font-weight: 600; font-size: 0.76rem; padding: 0 12px; cursor: pointer; transition: all 0.2s;">
        Done
      </button>
    </div>
  `;
  return cardEl;
}

window.openLeadDetailModal = function(cardId, cardFallback = null) {
  let card = (window.allActiveActionCards || []).find(c => c && String(c.id) === String(cardId));
  if (!card && cardFallback) card = cardFallback;
  if (card && cardFallback) {
    if (!card.contactName && cardFallback.contactName) {
      card.contactName = cardFallback.contactName;
    }
  }
  if (!card) return;

  let modal = document.getElementById('lead-card-detail-modal');
  if (modal && modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'lead-card-detail-modal';
    modal.style.cssText = 'display:none; position:fixed !important; top:0 !important; left:0 !important; width:100vw !important; height:100vh !important; background:rgba(0,0,0,0.85) !important; z-index:99999999 !important; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(8px);';
    modal.onclick = function(e) { if (e.target === modal) window.closeLeadDetailModal(); };
    modal.innerHTML = `
      <div style="background:var(--bg-surface, #18181b); border:1px solid var(--border-color, #27272a); border-radius:24px; width:640px; max-width:94vw; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 25px 60px rgba(0,0,0,0.7); overflow:hidden; position:relative;">
        <div style="padding:20px 24px 16px 24px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border-color, #27272a); flex-shrink:0; background:rgba(255,255,255,0.02);">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:42px; height:42px; border-radius:12px; background:rgba(6,182,212,0.15); color:var(--color-cyan, #06b6d4); display:flex; align-items:center; justify-content:center; font-size:1.2rem; flex-shrink:0;">🎯</div>
            <div>
              <div id="lead-detail-phone" style="font-size:1.25rem; font-weight:800; color:var(--text-main, #ffffff); font-family:var(--font-mono, monospace);">+91 XXXXXXXXXX</div>
              <div id="lead-detail-subtitle" style="font-size:0.8rem; color:var(--text-muted, #a1a1aa); margin-top:2px;">Unified Lead Timeline & Call History Log</div>
            </div>
          </div>
          <button onclick="event.preventDefault(); event.stopPropagation(); window.closeLeadDetailModal();" style="background:rgba(255,255,255,0.06); border:1px solid var(--border-color, #27272a); color:var(--text-muted, #a1a1aa); width:34px; height:34px; border-radius:10px; cursor:pointer; font-size:1.1rem; display:flex; align-items:center; justify-content:center;">✕</button>
        </div>

        <div style="padding:20px 24px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:16px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span id="lead-detail-sentiment" style="padding:4px 12px; border-radius:9999px; font-weight:800; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px;">INTERESTED</span>
            <span id="lead-detail-urgency" style="padding:4px 10px; border-radius:9999px; font-weight:800; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.5px;">URGENT</span>
            <span id="lead-detail-call-count" style="padding:4px 10px; border-radius:9999px; font-weight:800; font-size:0.72rem; text-transform:uppercase; background:rgba(6,182,212,0.12); color:#06b6d4; border:1px solid rgba(6,182,212,0.3); letter-spacing:0.5px;">1 CALL</span>
          </div>

          <div style="background:linear-gradient(135deg, rgba(6, 182, 212, 0.08), rgba(6, 182, 212, 0.02)); border:1px solid rgba(6, 182, 212, 0.25); border-radius:14px; padding:14px 16px;">
            <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--color-cyan, #06b6d4); letter-spacing:0.5px; margin-bottom:6px; display:flex; align-items:center; gap:6px;">
              <span>⚡</span> Recommended Action
            </div>
            <div id="lead-detail-action-text" style="font-size:0.92rem; font-weight:700; color:var(--text-main, #ffffff); line-height:1.4;">Follow up with lead</div>
          </div>

          <div>
            <div style="font-size:0.78rem; font-weight:700; text-transform:uppercase; color:var(--text-muted, #a1a1aa); letter-spacing:0.5px; margin-bottom:8px;">Current Lead Summary</div>
            <div id="lead-detail-summary" style="font-size:0.86rem; color:var(--text-main, #ffffff); line-height:1.6; background:rgba(0,0,0,0.2); border:1px solid var(--border-color, #27272a); border-radius:12px; padding:14px 16px;">
              Call details loading...
            </div>
          </div>

          <!-- Chronological Call History Timeline Section -->
          <div>
            <div style="font-size:0.78rem; font-weight:700; text-transform:uppercase; color:var(--text-muted, #a1a1aa); letter-spacing:0.5px; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
              <span>📜</span> Call Activity & Conversation History
            </div>
            <div id="lead-detail-timeline-container" style="display:flex; flex-direction:column; gap:10px;">
              <!-- Dynamically populated timeline -->
            </div>
          </div>
        </div>

        <div style="padding:16px 24px; border-top:1px solid var(--border-color, #27272a); display:flex; gap:12px; justify-content:flex-end; flex-shrink:0; background:rgba(0,0,0,0.2);">
          <button id="btn-lead-detail-done" style="padding:10px 20px; border-radius:10px; font-weight:700; cursor:pointer; font-size:0.85rem; background:rgba(255,255,255,0.06); border:1px solid var(--border-color, #27272a); color:var(--text-muted, #a1a1aa);">Mark Done</button>
          <button id="btn-lead-detail-call" style="padding:10px 24px; border-radius:10px; font-weight:800; cursor:pointer; font-size:0.85rem; background:linear-gradient(135deg, var(--color-primary, #ff5f52), #e11d48); border:none; color:white; display:flex; align-items:center; gap:8px; box-shadow:0 4px 15px rgba(225,29,72,0.3);">
            <span>📞</span> Call Back Now
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const phoneEl = document.getElementById('lead-detail-phone');
  const subtitleEl = document.getElementById('lead-detail-subtitle');
  const sentimentEl = document.getElementById('lead-detail-sentiment');
  const urgencyEl = document.getElementById('lead-detail-urgency');
  const callCountEl = document.getElementById('lead-detail-call-count');
  const actionTextEl = document.getElementById('lead-detail-action-text');
  const summaryEl = document.getElementById('lead-detail-summary');
  const timelineContainer = document.getElementById('lead-detail-timeline-container');
  const btnCall = document.getElementById('btn-lead-detail-call');
  const btnDone = document.getElementById('btn-lead-detail-done');

  let activeName = card.contactName || 
                   card.name || 
                   card.customerName || 
                   (cardFallback && (cardFallback.contactName || cardFallback.name || cardFallback.customerName)) ||
                   (card.calls && Array.isArray(card.calls) && card.calls.find(c => c && (c.customerName || c.name))?.customerName) ||
                   (typeof window.getContactNameForPhone === 'function' ? window.getContactNameForPhone(card.phone) : null);

  // Display BOTH Name and Phone Number inside the Modal Header (Name on top line, Phone number underneath)
  if (phoneEl) {
    phoneEl.style.webkitTextFillColor = 'initial';
    phoneEl.style.color = 'var(--text-main, #ffffff)';
    phoneEl.style.background = 'none';
    phoneEl.style.display = 'block';
    phoneEl.innerText = activeName ? activeName : card.phone;
  }
  if (subtitleEl) {
    subtitleEl.innerHTML = `<span style="color:var(--color-cyan, #06b6d4); font-weight:700;">📞 ${card.phone}</span> • Unified Lead Timeline & Call History Log`;
  }

  // Fallback async API fetch to /api/contacts if name is missing in local memory
  if (!activeName && card.phone) {
    fetch('/api/contacts')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.contacts)) {
          const normKey = window.normalizePhoneKey ? window.normalizePhoneKey(card.phone) : card.phone.replace(/\D/g, '');
          const match = data.contacts.find(c => c && c.phone && (window.normalizePhoneKey ? window.normalizePhoneKey(c.phone) : c.phone.replace(/\D/g, '')) === normKey && c.name);
          if (match && match.name && match.name.trim() !== '') {
            const fetchedName = match.name.trim();
            card.contactName = fetchedName;
            if (phoneEl) phoneEl.innerText = fetchedName;
          }
        }
      })
      .catch(() => {});
  }

  if (sentimentEl) {
    sentimentEl.innerText = card.sentiment;
    sentimentEl.style.background = card.sentimentBg || 'rgba(16, 185, 129, 0.12)';
    sentimentEl.style.color = card.color || '#10b981';
    sentimentEl.style.border = `1px solid ${card.sentimentBorder || 'rgba(16, 185, 129, 0.3)'}`;
  }

  if (urgencyEl) {
    urgencyEl.innerText = card.urgency;
    urgencyEl.style.background = card.urgencyBg;
    urgencyEl.style.color = card.urgencyColor;
    urgencyEl.style.border = `1px solid ${card.urgencyBorder}`;
  }

  if (callCountEl) {
    const count = card.totalCalls || (card.calls ? card.calls.length : 1);
    callCountEl.innerText = `${count} CALL${count > 1 ? 'S' : ''}`;
  }

  if (actionTextEl) {
    actionTextEl.innerText = card.actionToTake || 'Follow up with lead';
  }

  if (summaryEl) {
    summaryEl.innerText = card.summary || 'No detailed summary available.';
  }

  // Populate Call History Timeline
  if (timelineContainer) {
    const callLogs = card.calls || [];
    if (callLogs.length > 0) {
      timelineContainer.innerHTML = callLogs.map((cLog, idx) => {
        const cDate = new Date(cLog.createdAt);
        const dateFormatted = isNaN(cDate.getTime()) ? '-' : cDate.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const isInc = cLog.direction === 'incoming';
        const dirBadge = isInc 
          ? `<span style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); padding: 3px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 700;">⬇ Incoming Call</span>`
          : `<span style="background: rgba(6,182,212,0.15); color: #06b6d4; border: 1px solid rgba(6,182,212,0.3); padding: 3px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 700;">⬆ Outbound Call</span>`;
        
        let durText = '0s';
        if (cLog.duration !== undefined && cLog.duration !== null && !isNaN(cLog.duration) && Number(cLog.duration) > 0) {
          const dSec = Math.round(Number(cLog.duration));
          durText = dSec >= 60 ? `${Math.floor(dSec / 60)}m ${dSec % 60}s` : `${dSec}s`;
        } else if (cLog.startedAt && cLog.endedAt) {
          const dSec = Math.max(0, Math.round((new Date(cLog.endedAt).getTime() - new Date(cLog.startedAt).getTime()) / 1000));
          durText = dSec >= 60 ? `${Math.floor(dSec / 60)}m ${dSec % 60}s` : `${dSec}s`;
        } else {
          durText = 'Recorded';
        }
        
        return `
          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color, #27272a); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 8px;">
                ${dirBadge}
                <span style="font-size: 0.78rem; color: var(--text-muted, #a1a1aa); font-weight: 600;">${dateFormatted}</span>
              </div>
              <span style="font-size: 0.72rem; color: var(--text-muted, #a1a1aa); font-family: var(--font-mono, monospace);">Duration: ${durText} • Status: ${cLog.status}</span>
            </div>
            <div style="font-size: 0.84rem; color: var(--text-main, #ffffff); line-height: 1.45; margin-top: 2px;">
              ${cLog.summary}
            </div>
            ${cLog.actionToTake ? `<div style="font-size: 0.76rem; color: #f59e0b; font-weight: 600; margin-top: 2px;">⚡ Action: ${cLog.actionToTake}</div>` : ''}
          </div>
        `;
      }).join('');
    } else {
      timelineContainer.innerHTML = `<div style="font-size: 0.82rem; color: var(--text-muted); padding: 10px;">No prior call history logged for this number.</div>`;
    }
  }

  if (actionTextEl) {
    actionTextEl.innerText = card.actionToTake || 'Follow up with lead';
  }

  if (summaryEl) {
    summaryEl.innerText = card.summary || 'No detailed summary available.';
  }

  if (btnCall) {
    btnCall.onclick = () => {
      window.closeLeadDetailModal();
      window.triggerCallBackWithAgent(card.phone);
    };
  }

  if (btnDone) {
    btnDone.onclick = () => {
      window.closeLeadDetailModal();
      window.dismissLeadCardById(cardId);
    };
  }

  modal.style.setProperty('position', 'fixed', 'important');
  modal.style.setProperty('top', '0px', 'important');
  modal.style.setProperty('left', '0px', 'important');
  modal.style.setProperty('width', '100vw', 'important');
  modal.style.setProperty('height', '100vh', 'important');
  modal.style.setProperty('z-index', '99999999', 'important');
  modal.style.setProperty('display', 'flex', 'important');
  modal.style.setProperty('visibility', 'visible', 'important');
  modal.style.setProperty('opacity', '1', 'important');
};

window.closeLeadDetailModal = function() {
  const modals = document.querySelectorAll('#lead-card-detail-modal');
  modals.forEach(modal => {
    modal.style.display = 'none';
  });
};

window.actionCardsFilter = 'all';

window.openAllActionCardsModal = function() {
  let modal = document.getElementById('all-action-cards-modal');
  if (modal && modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'all-action-cards-modal';
    modal.style.cssText = 'display:none; position:fixed !important; top:0 !important; left:0 !important; width:100vw !important; height:100vh !important; background:rgba(0,0,0,0.85) !important; z-index:99999999 !important; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(8px);';
    modal.onclick = function(e) { if (e.target === modal) window.closeAllActionCardsModal(); };
    modal.innerHTML = `
      <div style="background:var(--bg-surface, #18181b); border:1px solid var(--border-color, #27272a); border-radius:24px; width:900px; max-width:95vw; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 25px 60px rgba(0,0,0,0.7); overflow:hidden;">
        <div style="padding:20px 26px 16px 26px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border-color, #27272a); flex-shrink:0;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:40px; height:40px; border-radius:12px; background:rgba(6,182,212,0.15); color:var(--color-cyan, #06b6d4); display:flex; align-items:center; justify-content:center; font-size:1.2rem;">📋</div>
            <div>
              <div style="font-size:1.15rem; font-weight:800; color:var(--text-main, #ffffff);">All AI Lead Scout Action Cards</div>
              <div style="font-size:0.78rem; color:var(--text-muted, #a1a1aa);">Filter & explore all prioritized follow-up leads</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <span id="all-action-cards-count" style="font-size:0.78rem; font-weight:800; color:var(--color-cyan, #06b6d4); background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.3); padding:4px 12px; border-radius:100px;">0 Leads</span>
            <button onclick="event.preventDefault(); event.stopPropagation(); window.closeAllActionCardsModal();" style="background:rgba(255,255,255,0.06); border:1px solid var(--border-color, #27272a); color:var(--text-muted, #a1a1aa); width:34px; height:34px; border-radius:10px; cursor:pointer; font-size:1.1rem; display:flex; align-items:center; justify-content:center;">✕</button>
          </div>
        </div>

        <div style="padding:14px 26px; border-bottom:1px solid var(--border-color, #27272a); flex-shrink:0; display:flex; gap:12px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
          <input id="action-cards-search-input" type="text" placeholder="🔍 Search leads by phone or notes..." oninput="window.renderAllActionCardsModalGrid()" style="background:rgba(255,255,255,0.04); border:1px solid var(--border-color, #27272a); color:var(--text-main, #ffffff); border-radius:10px; padding:8px 14px; font-size:0.85rem; width:260px; outline:none;" />
          <div id="action-cards-filter-buttons" style="display:flex; gap:8px;">
            <button onclick="window.filterActionCards('all', this)" class="btn-filter-action active" style="padding:6px 14px; border-radius:8px; font-size:0.78rem; font-weight:700; background:rgba(6,182,212,0.15); border:1px solid var(--color-cyan, #06b6d4); color:var(--color-cyan, #06b6d4); cursor:pointer;">All Leads</button>
            <button onclick="window.filterActionCards('interested', this)" class="btn-filter-action" style="padding:6px 14px; border-radius:8px; font-size:0.78rem; font-weight:600; background:rgba(255,255,255,0.03); border:1px solid var(--border-color, #27272a); color:var(--text-muted, #a1a1aa); cursor:pointer;">Interested</button>
            <button onclick="window.filterActionCards('not-interested', this)" class="btn-filter-action" style="padding:6px 14px; border-radius:8px; font-size:0.78rem; font-weight:600; background:rgba(255,255,255,0.03); border:1px solid var(--border-color, #27272a); color:var(--text-muted, #a1a1aa); cursor:pointer;">Not Interested</button>
          </div>
        </div>

        <div id="all-action-cards-grid" style="padding:20px 26px; overflow-y:auto; flex:1; display:grid; grid-template-columns:repeat(auto-fill, minmax(270px, 1fr)); gap:16px;">
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  modal.style.setProperty('position', 'fixed', 'important');
  modal.style.setProperty('top', '0px', 'important');
  modal.style.setProperty('left', '0px', 'important');
  modal.style.setProperty('width', '100vw', 'important');
  modal.style.setProperty('height', '100vh', 'important');
  modal.style.setProperty('z-index', '99999999', 'important');
  modal.style.setProperty('display', 'flex', 'important');
  modal.style.setProperty('visibility', 'visible', 'important');
  modal.style.setProperty('opacity', '1', 'important');

  window.renderAllActionCardsModalGrid();
};

window.closeAllActionCardsModal = function() {
  const modals = document.querySelectorAll('#all-action-cards-modal');
  modals.forEach(modal => {
    modal.style.display = 'none';
  });
};

window.currentMetricModalType = 'failed';

window.openMetricDetailsModal = function(type) {
  console.log('[openMetricDetailsModal] Triggered with type:', type);
  window.currentMetricModalType = type || 'total';
  let modal = document.getElementById('dashboard-metric-detail-modal');
  
  if (modal && modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dashboard-metric-detail-modal';
    modal.style.cssText = 'display:none; position:fixed !important; top:0 !important; left:0 !important; width:100vw !important; height:100vh !important; background:rgba(0,0,0,0.85) !important; z-index:99999999 !important; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(8px);';
    modal.onclick = function(e) { if (e.target === modal) window.closeMetricDetailsModal(); };
    modal.innerHTML = `
      <div style="background:var(--bg-surface, #18181b); border:1px solid var(--border-color, #27272a); border-radius:20px; width:760px; max-width:95vw; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 25px 60px rgba(0,0,0,0.7); overflow:hidden;">
        <div style="padding:20px 24px 16px 24px; display:flex; align-items:center; gap:14px; flex-shrink:0; border-bottom:1px solid var(--border-color, #27272a);">
          <div id="metric-modal-icon" style="width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:1.3rem; background:rgba(6,182,212,0.15); color:var(--color-cyan, #06b6d4); flex-shrink:0;">📞</div>
          <div style="flex:1; min-width:0;">
            <div id="metric-modal-title" style="font-size:1.15rem; font-weight:800; color:var(--text-main, #ffffff); margin-bottom:2px;">Call Details</div>
            <div id="metric-modal-subtitle" style="font-size:0.78rem; color:var(--text-muted, #a1a1aa); line-height:1.4;">Detailed call breakdown</div>
          </div>
          <span id="metric-modal-badge" style="background:rgba(6,182,212,0.1); color:var(--color-cyan, #06b6d4); border:1px solid rgba(6,182,212,0.3); padding:4px 12px; border-radius:100px; font-size:0.75rem; font-weight:700; white-space:nowrap;">Count: 0</span>
          <button onclick="event.preventDefault(); event.stopPropagation(); window.closeMetricDetailsModal();" style="background:rgba(255,255,255,0.06); border:1px solid var(--border-color, #27272a); color:var(--text-muted, #a1a1aa); width:32px; height:32px; border-radius:8px; cursor:pointer; font-size:1rem; display:flex; align-items:center; justify-content:center; flex-shrink:0;">✕</button>
        </div>
        <div style="padding:14px 24px 0 24px; flex-shrink:0;">
          <input id="metric-modal-search" type="text" placeholder="🔍 Search by phone number or summary..." oninput="window.renderMetricDetailsModalContent()" style="width:100%; background:rgba(255,255,255,0.04); border:1px solid var(--border-color, #27272a); color:var(--text-main, #ffffff); border-radius:10px; padding:10px 14px; font-size:0.85rem; box-sizing:border-box; outline:none;" />
        </div>
        <div id="metric-modal-body" style="flex:1; overflow-y:auto; padding:14px 24px 20px 24px; display:flex; flex-direction:column; gap:10px; min-height:200px;">
          <div style="text-align:center; padding:40px; color:var(--text-muted, #a1a1aa);">Loading...</div>
        </div>
        <div style="padding:14px 24px; border-top:1px solid var(--border-color, #27272a); display:flex; align-items:center; justify-content:space-between; flex-shrink:0; background:rgba(0,0,0,0.2); gap:10px; flex-wrap:wrap;">
          <span style="font-size:0.78rem; color:var(--text-muted, #a1a1aa);">Click "Re-call Now" to quickly start a call</span>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button id="metric-modal-broadcast-btn" onclick="event.preventDefault(); event.stopPropagation(); window.broadcastFilteredMetricContacts();" style="display:none; background:linear-gradient(135deg,#7c3aed,#4f46e5); color:white; border:none; padding:8px 18px; border-radius:10px; font-weight:700; cursor:pointer; font-size:0.82rem; align-items:center; gap:6px;">📣 Broadcast to These Contacts</button>
            <button onclick="event.preventDefault(); event.stopPropagation(); window.closeMetricDetailsModal();" style="background:linear-gradient(135deg,var(--color-primary, #ea580c),#ae3115); color:white; border:none; padding:8px 22px; border-radius:10px; font-weight:700; cursor:pointer; font-size:0.85rem;">Close</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  
  modal.style.setProperty('position', 'fixed', 'important');
  modal.style.setProperty('top', '0px', 'important');
  modal.style.setProperty('left', '0px', 'important');
  modal.style.setProperty('width', '100vw', 'important');
  modal.style.setProperty('height', '100vh', 'important');
  modal.style.setProperty('z-index', '99999999', 'important');
  modal.style.setProperty('display', 'flex', 'important');
  modal.style.setProperty('visibility', 'visible', 'important');
  modal.style.setProperty('opacity', '1', 'important');
  
  const searchInput = document.getElementById('metric-modal-search');
  if (searchInput) searchInput.value = '';
  
  window.renderMetricDetailsModalContent();
};

window.closeMetricDetailsModal = function() {
  const modals = document.querySelectorAll('#dashboard-metric-detail-modal');
  modals.forEach(modal => {
    modal.style.setProperty('display', 'none', 'important');
    modal.style.setProperty('visibility', 'hidden', 'important');
    modal.style.setProperty('opacity', '0', 'important');
  });
};

window.triggerLeadCall = function(phone) {
  window.navigateToCallingsPage();
  const phoneInput = document.getElementById('phone-number') || document.getElementById('dial-phone-input') || document.querySelector('input[type="tel"]');
  if (phoneInput) {
    phoneInput.value = phone;
    phoneInput.focus();
  }
};

window.renderMetricDetailsModalContent = function() {
  const type = window.currentMetricModalType;
  const iconEl = document.getElementById('metric-modal-icon');
  const titleEl = document.getElementById('metric-modal-title');
  const subtitleEl = document.getElementById('metric-modal-subtitle');
  const badgeEl = document.getElementById('metric-modal-badge');
  const bodyEl = document.getElementById('metric-modal-body');
  const searchInput = document.getElementById('metric-modal-search');

  if (!bodyEl) return;

  const searchQuery = (searchInput ? searchInput.value.toLowerCase().trim() : '');

  // 1. Resolve Header Metadata FIRST based on modal type
  let headerTitle = 'All Calls Made Log';
  let headerSubtitle = 'Complete log of all tracked calls across all statuses.';
  let headerIcon = '📞';
  let headerBg = 'rgba(167, 139, 250, 0.15)';
  let headerColor = '#a78bfa';

  if (type === 'failed') {
    headerIcon = '❌';
    headerBg = 'rgba(239, 68, 68, 0.15)';
    headerColor = '#ef4444';
    headerTitle = 'Failed & Rejected Calls Overview';
    headerSubtitle = 'Detailed list of missed or failed calls. See failure reasons and re-dial directly.';
  } else if (type === 'completed') {
    headerIcon = '✅';
    headerBg = 'rgba(6, 182, 212, 0.15)';
    headerColor = '#06b6d4';
    headerTitle = 'Completed Calls Log';
    headerSubtitle = 'Successfully finished calls with AI conversation summaries and call duration.';
  } else if (type === 'active') {
    headerIcon = '⚡';
    headerBg = 'rgba(245, 158, 11, 0.15)';
    headerColor = '#f59e0b';
    headerTitle = 'Active & Ongoing Call Sessions';
    headerSubtitle = 'Live calls currently ringing or in active voice conversation.';
  } else if (type === 'pickup') {
    headerIcon = '📈';
    headerBg = 'rgba(16, 185, 129, 0.15)';
    headerColor = '#10b981';
    headerTitle = 'Call Pickup & Success Analytics';
    headerSubtitle = 'Pickup rate statistics and call outcome distributions.';
  } else if (type === 'interested') {
    headerIcon = '🔥';
    headerBg = 'rgba(236, 72, 153, 0.15)';
    headerColor = '#ec4899';
    headerTitle = 'AI-Identified Interested Leads';
    headerSubtitle = 'High intent prospects identified by AI during conversation calls.';
  }

  // Update header text & colors immediately so the modal header reflects the clicked card
  if (iconEl) {
    iconEl.innerText = headerIcon;
    iconEl.style.background = headerBg;
    iconEl.style.color = headerColor;
  }
  if (titleEl) titleEl.innerText = headerTitle;
  if (subtitleEl) subtitleEl.innerText = headerSubtitle;
  
  // 2. Resolve calls array from all possible global cache sources
  let calls = [];
  if (Array.isArray(window.lastDashboardCalls) && window.lastDashboardCalls.length > 0) {
    calls = window.lastDashboardCalls;
  } else if (Array.isArray(window.callsCache) && window.callsCache.length > 0) {
    calls = window.callsCache;
  } else if (Array.isArray(callsCache) && callsCache.length > 0) {
    calls = callsCache;
  } else {
    try {
      const stored = localStorage.getItem('callio_calls_cache');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          calls = parsed;
          window.lastDashboardCalls = parsed;
          window.callsCache = parsed;
          callsCache = parsed;
        }
      }
    } catch(e) {}
  }

  // 3. If calls data is currently empty, display loading state and auto-fetch from server
  if (calls.length === 0) {
    bodyEl.innerHTML = `
      <div style="text-align: center; padding: 50px 20px; color: var(--text-muted);">
        <div style="font-size: 2rem; margin-bottom: 12px; display: inline-block;">⏳</div>
        <div style="font-weight: 700; color: var(--text-main, #ffffff); font-size: 1.05rem; margin-bottom: 4px;">Loading Call Records...</div>
        <div style="font-size: 0.8rem; color: var(--text-muted, #a1a1aa);">Fetching recent call history from server, please wait.</div>
      </div>
    `;

    if (!window._fetchingModalCalls) {
      window._fetchingModalCalls = true;
      const u = (typeof loggedInUser !== 'undefined' && loggedInUser) ? loggedInUser : null;
      const clientId = u ? (u.id || u._id || u.email || '') : '';
      fetch(`/calls?clientId=${clientId}`)
        .then(res => res.json())
        .then(data => {
          window._fetchingModalCalls = false;
          const callArray = Array.isArray(data) ? data : (data && Array.isArray(data.calls) ? data.calls : []);
          if (callArray.length > 0) {
            window.callsCache = callArray;
            window.lastDashboardCalls = callArray;
            callsCache = callArray;
            try { localStorage.setItem('callio_calls_cache', JSON.stringify(callArray)); } catch(e){}
            window.renderMetricDetailsModalContent();
          } else {
            const bodyEl = document.getElementById('metric-modal-body');
            if (bodyEl) {
              bodyEl.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">No records found.</div>`;
            }
          }
        })
        .catch(e => { window._fetchingModalCalls = false; });
    }
    return;
  }

  // 4. Filter calls by type
  let filteredCalls = [];
  if (type === 'failed') {
    filteredCalls = calls.filter(c => {
      const st = String(c.status || '').toLowerCase();
      const err = String(c.error || c.failureReason || '').toLowerCase();
      return st === 'failed' || st === 'busy' || st === 'no-answer' || st === 'voicemail' || st === 'canceled' || st === 'rejected' || err.length > 0;
    });
  } else if (type === 'completed') {
    filteredCalls = calls.filter(c => {
      const st = String(c.status || '').toLowerCase();
      return st === 'completed' || st === 'answered' || st === 'ended' || st === 'finished';
    });
  } else if (type === 'active') {
    filteredCalls = calls.filter(c => {
      const st = String(c.status || '').toLowerCase();
      return st === 'active' || st === 'calling' || st === 'in-progress' || st === 'ringing' || st === 'queued' || st === 'initiated';
    });
  } else if (type === 'pickup') {
    filteredCalls = calls;
  } else if (type === 'interested') {
    filteredCalls = calls.filter(c => {
      const sum = String(c.summary || c.ai_verdict || '').toLowerCase();
      return (sum.includes('interested') && !sum.includes('not interested') && !sum.includes('not_interested')) || sum.includes('verdict:** interested');
    });
  } else {
    filteredCalls = calls;
  }

  // Filter by search query if any
  if (searchQuery) {
    filteredCalls = filteredCalls.filter(c => {
      const phone = String(c.phone || c.to || c.from || '').toLowerCase();
      const sum = String(c.summary || c.error || c.failureReason || '').toLowerCase();
      return phone.includes(searchQuery) || sum.includes(searchQuery);
    });
  }

  if (badgeEl) {
    const showCount = Math.min(filteredCalls.length, 50);
    badgeEl.innerText = `Count: ${showCount} (of ${filteredCalls.length})`;
    badgeEl.style.background = headerBg;
    badgeEl.style.color = headerColor;
    badgeEl.style.borderColor = headerColor;
  }

  // Handle Pickup Rate Analytics Special View
  if (type === 'pickup') {
    const total = calls.length;
    const completed = calls.filter(c => String(c.status).toLowerCase() === 'completed').length;
    const active = calls.filter(c => ['active', 'calling', 'in-progress', 'ringing', 'queued'].includes(String(c.status).toLowerCase())).length;
    const failed = calls.filter(c => ['failed', 'busy', 'no-answer', 'voicemail', 'canceled', 'rejected'].includes(String(c.status).toLowerCase())).length;
    const rate = total > 0 ? Math.round(((completed + active) / total) * 100) : 0;

    bodyEl.innerHTML = `
      <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 14px; padding: 20px; text-align: center; margin-bottom: 12px;">
        <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Overall Pickup & Success Rate</div>
        <div style="font-size: 3rem; font-weight: 900; color: #10b981; font-family: var(--font-mono);">${rate}%</div>
        <div style="width: 100%; background: rgba(255,255,255,0.08); height: 10px; border-radius: 10px; margin: 14px 0 8px 0; overflow: hidden;">
          <div style="width: ${rate}%; background: linear-gradient(90deg, #10b981, #06b6d4); height: 100%; border-radius: 10px; transition: width 0.5s ease;"></div>
        </div>
        <div style="font-size: 0.78rem; color: var(--text-muted);">${completed + active} Answered / Active calls out of ${total} total call attempts</div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
        <div style="background: var(--bg-surface); border: 1px solid rgba(16,185,129,0.3); border-radius: 12px; padding: 14px; text-align: center;">
          <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">ANSWERED & COMPLETED</div>
          <div style="font-size: 1.6rem; font-weight: 800; color: #10b981; margin-top: 4px;">${completed}</div>
        </div>
        <div style="background: var(--bg-surface); border: 1px solid rgba(245,158,11,0.3); border-radius: 12px; padding: 14px; text-align: center;">
          <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">LIVE / ONGOING</div>
          <div style="font-size: 1.6rem; font-weight: 800; color: #f59e0b; margin-top: 4px;">${active}</div>
        </div>
        <div style="background: var(--bg-surface); border: 1px solid rgba(239,68,68,0.3); border-radius: 12px; padding: 14px; text-align: center;">
          <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">MISSED / FAILED</div>
          <div style="font-size: 1.6rem; font-weight: 800; color: #ef4444; margin-top: 4px;">${failed}</div>
        </div>
      </div>
    `;
    return;
  }

  // Render list of calls for other types
  if (filteredCalls.length === 0) {
    let emptyIcon = '📭';
    let emptyTitle = `No ${headerTitle} Found`;
    let emptyDesc = 'All call sessions and real-time status updates are tracked automatically in your account dashboard.';
    let actionBtn = '';

    if (type === 'active') {
      emptyIcon = '⚡';
      emptyTitle = 'No Live Calls Active Right Now';
      emptyDesc = 'There are currently 0 active voice call sessions ringing or in progress.';
      actionBtn = `
        <button onclick="window.closeMetricDetailsModal(); window.navigateToCallingsPage();" style="margin-top: 16px; background: linear-gradient(135deg, var(--color-primary, #ea580c), #ae3115); color: white; border: none; padding: 10px 24px; border-radius: 10px; font-weight: 700; cursor: pointer; font-size: 0.88rem; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 15px rgba(234, 88, 12, 0.3);">
          <span>📞</span> Start a Call Now
        </button>
      `;
    } else if (type === 'failed') {
      emptyIcon = '🎉';
      emptyTitle = 'Zero Failed Calls';
      emptyDesc = 'Great news! All attempted calls were processed successfully with no rejections.';
    } else if (type === 'interested') {
      emptyIcon = '🎯';
      emptyTitle = 'No Interested Leads Identified Yet';
      emptyDesc = 'Complete more calls to let AI identify high-intent prospects automatically.';
    }

    bodyEl.innerHTML = `
      <div style="background: rgba(255,255,255,0.02); border: 1px dashed var(--border-color, #27272a); border-radius: 16px; padding: 40px 20px; text-align: center; margin: 10px 0;">
        <div style="font-size: 2.8rem; margin-bottom: 12px;">${emptyIcon}</div>
        <div style="font-size: 1.05rem; font-weight: 800; color: var(--text-main, #ffffff); margin-bottom: 6px;">${emptyTitle}</div>
        <div style="font-size: 0.82rem; color: var(--text-muted, #a1a1aa); max-width: 420px; margin: 0 auto; line-height: 1.5;">${emptyDesc}</div>
        ${actionBtn}
      </div>
    `;
    return;
  }

  let html = '';
  filteredCalls.slice(0, 50).forEach(c => {
    const phone = c.phone || c.to || c.from || 'Unknown Number';
    const dateStr = c.startedAt || c.createdAt ? new Date(c.startedAt || c.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : 'Recent';
    const durationSec = c.duration || c.duration_seconds || 0;
    const durFormatted = durationSec > 0 ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : (c.status === 'completed' ? '1m 00s' : '0s');

    // Failure reason determination
    let failureReasonText = '';
    let statusPillBg = 'rgba(239, 68, 68, 0.15)';
    let statusPillColor = '#ef4444';
    let statusPillBorder = 'rgba(239, 68, 68, 0.3)';
    let statusPillLabel = String(c.status || 'failed').toUpperCase();

    if (c.status === 'busy') {
      failureReasonText = 'User Busy / Declined Call';
      statusPillLabel = 'BUSY';
    } else if (c.status === 'no-answer') {
      failureReasonText = 'No Answer / Ring Timeout';
      statusPillLabel = 'NO ANSWER';
    } else if (c.status === 'voicemail') {
      failureReasonText = 'Answered by Voicemail';
      statusPillLabel = 'VOICEMAIL';
    } else if (c.status === 'canceled') {
      failureReasonText = 'Call Cancelled by User';
      statusPillLabel = 'CANCELLED';
    } else if (c.status === 'completed') {
      statusPillBg = 'rgba(6, 182, 212, 0.15)';
      statusPillColor = '#06b6d4';
      statusPillBorder = 'rgba(6, 182, 212, 0.3)';
      statusPillLabel = 'COMPLETED';
    } else if (['active', 'calling', 'in-progress', 'ringing', 'queued'].includes(String(c.status).toLowerCase())) {
      statusPillBg = 'rgba(245, 158, 11, 0.15)';
      statusPillColor = '#f59e0b';
      statusPillBorder = 'rgba(245, 158, 11, 0.3)';
      statusPillLabel = String(c.status).toUpperCase();
    } else {
      failureReasonText = c.failureReason || c.error || 'Network Error / Carrier Failure';
      statusPillLabel = 'FAILED';
    }

    const cleanSummaryText = c.summary ? c.summary.replace(/\*\*(?:VERDICT|Verdict):\*\*\s*[^\n]*/gi, '').replace(/\*\*/g, '').trim() : '';

    html += `
      <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; transition: border-color 0.2s;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1rem; font-weight: 800; color: var(--text-main); font-family: var(--font-mono);">${phone}</span>
            <span style="font-size: 0.65rem; font-weight: 800; padding: 3px 8px; border-radius: 4px; background: ${statusPillBg}; color: ${statusPillColor}; border: 1px solid ${statusPillBorder}; letter-spacing: 0.5px;">${statusPillLabel}</span>
          </div>
          <span style="font-size: 0.74rem; color: var(--text-muted);">${dateStr} • ⏱️ ${durFormatted}</span>
        </div>

        ${failureReasonText ? `
          <div style="background: rgba(239, 68, 68, 0.08); border: 1px dashed rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 6px 10px; font-size: 0.78rem; color: #ef4444; font-weight: 600; display: flex; align-items: center; gap: 6px;">
            <span>❌ <strong>Failure Reason:</strong> ${failureReasonText}</span>
          </div>
        ` : ''}

        ${cleanSummaryText ? `
          <div style="font-size: 0.78rem; color: var(--text-muted); line-height: 1.45; max-height: 50px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
            💬 ${cleanSummaryText}
          </div>
        ` : ''}

        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; flex-wrap: wrap;">
          <button onclick="window.showQuickTagPicker('${phone}', this)" style="padding: 6px 12px; font-size: 0.78rem; border-radius: 8px; background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.3); color: #06b6d4; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 5px;">
            🏷️ Tag
          </button>
          ${type === 'interested' ? `<button onclick="window.updateContactTagByPhone('${phone}', 'Interested', this)" style="padding: 6px 12px; font-size: 0.78rem; border-radius: 8px; background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); color: #10b981; font-weight: 800; cursor: pointer;">✅ Mark as Interested</button>` : ''}
          <button onclick="window.closeMetricDetailsModal(); window.triggerLeadCall('${phone}');" style="padding: 6px 14px; font-size: 0.78rem; border-radius: 8px; background: var(--color-cyan); border: none; color: #000; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 12px; height: 12px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            ⚡ Re-call Now
          </button>
        </div>
      </div>
    `;
  });

  bodyEl.innerHTML = html;

  // Extract unique phones from filtered calls
  const uniquePhones = Array.from(new Set(filteredCalls.map(c => c.phone || c.to || c.from || '').filter(p => p && String(p).trim().length > 0)));
  window._metricModalFilteredPhones = uniquePhones.slice(0, 100);

  // Show/hide broadcast buttons (header & footer) for all call list types
  const broadcastBtn = document.getElementById('metric-modal-broadcast-btn');
  const headerBroadcastBtn = document.getElementById('metric-modal-header-broadcast-btn');

  if (uniquePhones.length > 0) {
    if (broadcastBtn) {
      broadcastBtn.style.display = 'flex';
      broadcastBtn.innerHTML = `📣 Broadcast to These Contacts (${uniquePhones.length})`;
      broadcastBtn.title = `Start broadcast call to ${uniquePhones.length} contacts`;
    }
    if (headerBroadcastBtn) {
      headerBroadcastBtn.style.display = 'flex';
      headerBroadcastBtn.innerHTML = `📣 Broadcast (${uniquePhones.length})`;
      headerBroadcastBtn.title = `Start broadcast call to ${uniquePhones.length} contacts`;
    }
  } else {
    if (broadcastBtn) broadcastBtn.style.display = 'none';
    if (headerBroadcastBtn) headerBroadcastBtn.style.display = 'none';
  }
};

window.broadcastTodayCallsPageContacts = function() {
  let phones = [];
  if (Array.isArray(window._todayCallsPageFilteredPhones) && window._todayCallsPageFilteredPhones.length > 0) {
    phones = window._todayCallsPageFilteredPhones;
  } else if (Array.isArray(window.lastDashboardCalls)) {
    phones = Array.from(new Set(window.lastDashboardCalls.map(c => c.phone || c.to || c.from || '').filter(p => p && String(p).trim().length > 0)));
  } else if (Array.isArray(window.callsCache)) {
    phones = Array.from(new Set(window.callsCache.map(c => c.phone || c.to || c.from || '').filter(p => p && String(p).trim().length > 0)));
  }

  if (!phones.length) {
    alert('No call records found to broadcast.');
    return;
  }

  window.broadcastFilteredMetricContacts(phones, 'Call History Contacts');
};

// Broadcast all contacts shown in the metric modal or custom list
window.broadcastFilteredMetricContacts = async function(customPhoneList = null, customLabel = null) {
  const phones = customPhoneList || window._metricModalFilteredPhones || [];
  if (!phones.length) { alert('No contacts found to broadcast.'); return; }

  // Build label based on modal type or customLabel
  const type = window.currentMetricModalType || 'contacts';
  let label = customLabel || 'Re-broadcast Calls';
  if (!customLabel) {
    if (type === 'failed') label = 'Failed/Rejected Contacts Re-broadcast';
    else if (type === 'completed') label = 'Completed Contacts Re-broadcast';
    else if (type === 'interested') label = 'Interested Leads Re-broadcast';
    else if (type === 'total') label = 'Total Calls Re-broadcast';
  }

  let popup = document.getElementById('broadcast-agent-quick-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'broadcast-agent-quick-popup';
    popup.style.cssText = 'display:none; position:fixed !important; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999999999; align-items:center; justify-content:center; backdrop-filter:blur(6px);';
    popup.innerHTML = `
      <div style="background:var(--bg-surface,#18181b); border:1px solid var(--border-color,#27272a); border-radius:20px; padding:28px 28px 22px; width:380px; max-width:94vw; box-shadow:0 24px 60px rgba(0,0,0,0.7);">
        <div style="font-size:1.05rem; font-weight:800; color:var(--text-main,#fff); margin-bottom:4px;">📣 Broadcast to Contacts</div>
        <div id="baq-subtitle" style="font-size:0.82rem; color:var(--text-muted,#a1a1aa); margin-bottom:18px;"></div>
        <label style="font-size:0.78rem; color:var(--text-muted,#a1a1aa); font-weight:700; text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Select AI Agent</label>
        <select id="baq-agent-select" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid var(--border-color,#27272a); color:var(--text-main,#fff); border-radius:10px; padding:10px 12px; font-size:0.88rem; box-sizing:border-box; outline:none; cursor:pointer; margin-bottom:18px;">
          <option value="">-- Loading agents... --</option>
        </select>
        <div style="display:flex; gap:10px;">
          <button onclick="document.getElementById('broadcast-agent-quick-popup').style.display='none';" style="flex:1; padding:10px; border-radius:10px; background:rgba(255,255,255,0.06); border:1px solid var(--border-color,#27272a); color:var(--text-muted,#a1a1aa); font-weight:700; cursor:pointer; font-size:0.85rem;">Cancel</button>
          <button id="baq-start-btn" style="flex:2; padding:10px; border-radius:10px; background:linear-gradient(135deg,#7c3aed,#4f46e5); border:none; color:#fff; font-weight:800; cursor:pointer; font-size:0.85rem;">📣 Start Broadcast</button>
        </div>
      </div>
    `;
    popup.onclick = function(e) { if (e.target === popup) popup.style.display = 'none'; };
    document.body.appendChild(popup);
  }

  const subtitleEl = popup.querySelector('#baq-subtitle');
  if (subtitleEl) subtitleEl.innerText = `${phones.length} contacts · ${label}`;

  const agentSel = popup.querySelector('#baq-agent-select');
  if (agentSel) {
    agentSel.innerHTML = '<option value="">-- Loading... --</option>';
    const clientId = (typeof loggedInUser !== 'undefined' && loggedInUser) ? (loggedInUser.id || '') : '';
    fetch(`/api/agents?clientId=${clientId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.agents && d.agents.length > 0) {
          agentSel.innerHTML = '<option value="">-- Select Agent --</option>' +
            d.agents.map(a => `<option value="${a.id}">${a.name} (${a.voice || 'Default'})</option>`).join('');
          if (d.agents.length === 1) agentSel.value = d.agents[0].id;
        } else {
          agentSel.innerHTML = '<option value="">No agents found</option>';
        }
      })
      .catch(() => { agentSel.innerHTML = '<option value="">Failed to load agents</option>'; });
  }

  const startBtn = popup.querySelector('#baq-start-btn');
  if (startBtn) {
    startBtn.onclick = async function() {
      const agentId = agentSel ? agentSel.value : '';
      if (!agentId) { alert('Please select an agent first.'); return; }
      if (!confirm(`Start broadcast to ${phones.length} contacts?`)) return;
      startBtn.disabled = true;
      startBtn.innerText = '⏳ Starting...';
      try {
        const publicUrl = document.getElementById('public-url')?.value || '';
        const payload = {
          agentId,
          targetType: 'custom',
          targetLabel: label,
          mode: 'now',
          publicUrl,
          clientId: (typeof loggedInUser !== 'undefined' && loggedInUser) ? loggedInUser.id : null,
          customPhones: phones
        };
        const res = await fetch('/api/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        popup.style.display = 'none';
        window.closeMetricDetailsModal();
        if (data.success) {
          alert(`✅ Broadcast started for ${phones.length} contacts!`);
          if (typeof window.fetchRecentBroadcasts === 'function') window.fetchRecentBroadcasts();
        } else {
          alert('Failed to start broadcast: ' + (data.error || 'Unknown error'));
        }
      } catch(e) {
        alert('Network error: ' + e.message);
      } finally {
        startBtn.disabled = false;
        startBtn.innerText = '📣 Start Broadcast';
      }
    };
  }

  popup.style.display = 'flex';
};

window.filterActionCardsModal = function(filter, btnEl) {
  window.actionCardsFilter = filter;
  const buttons = document.querySelectorAll('#action-cards-filter-buttons .btn-filter-card');
  buttons.forEach(btn => {
    btn.style.borderColor = 'var(--border-color)';
    btn.style.background = 'var(--bg-surface)';
    btn.style.color = 'var(--text-muted)';
    btn.style.fontWeight = '600';
  });
  if (btnEl) {
    btnEl.style.borderColor = 'var(--color-cyan)';
    btnEl.style.background = 'rgba(6, 182, 212, 0.15)';
    btnEl.style.color = 'var(--color-cyan)';
    btnEl.style.fontWeight = '700';
  }

  window.renderAllActionCardsModalGrid();
};

window.renderAllActionCardsModalGrid = function() {
  const grid = document.getElementById('all-action-cards-grid');
  const searchInput = document.getElementById('action-cards-search-input');
  const countEl = document.getElementById('all-action-cards-count');
  if (!grid) return;

  const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const filter = window.actionCardsFilter || 'all';

  const cards = window.allActiveActionCards || [];
  grid.innerHTML = '';

  const filtered = cards.filter(card => {
    if (!card) return false;
    const matchesSearch = !searchTerm || card.phone.toLowerCase().includes(searchTerm) || card.summary.toLowerCase().includes(searchTerm) || (card.actionToTake && card.actionToTake.toLowerCase().includes(searchTerm));
    
    if (!matchesSearch) return false;

    if (filter === 'interested') return card.sentiment.toLowerCase().includes('interest');
    if (filter === 'not-interested') return card.sentiment.toLowerCase().includes('not interested') || card.sentiment.toLowerCase().includes('frust');
    if (filter === 'no-answer') return card.sentiment.toLowerCase().includes('no answer');

    return true;
  });

  if (countEl) {
    countEl.innerText = `${filtered.length} Lead${filtered.length === 1 ? '' : 's'}`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
        <p style="font-size: 0.95rem; margin: 0;">No matching action cards found.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(card => {
    const cardEl = createActionCardElement(card, true);
    grid.appendChild(cardEl);
  });
};

function updateLiveMonitor(state) {
  const badge = document.getElementById('monitor-status-badge');
  const wave = document.querySelector('.monitor-wave-container');
  const waveText = document.getElementById('monitor-wave-text');
  const transBox = document.getElementById('monitor-transcript-box');
  
  const plannerView = document.getElementById('ai-action-planner-view');
  const monitorView = document.getElementById('live-call-monitor-view');
  
  if (!badge || !wave || !waveText || !transBox) return;
  
  if (state === 'active' || state === 'connecting') {
    if (plannerView) plannerView.style.display = 'none';
    if (monitorView) monitorView.style.display = 'flex';
    
    badge.innerText = state === 'active' ? 'Active' : 'Connecting';
    if (state === 'active') {
      badge.style.background = 'rgba(16, 185, 129, 0.15)';
      badge.style.color = 'var(--color-green)';
      badge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      wave.classList.add('active');
      waveText.style.display = 'none';
    } else {
      badge.style.background = 'rgba(245, 158, 11, 0.15)';
      badge.style.color = '#ff9800';
      badge.style.borderColor = 'rgba(245, 158, 11, 0.2)';
      wave.classList.add('active');
      waveText.innerText = 'Establishing secure connection...';
      waveText.style.display = 'block';
    }
  } else {
    if (plannerView) plannerView.style.display = 'flex';
    if (monitorView) monitorView.style.display = 'none';
    
    window.populateAIActionPlanner();
    
    badge.innerText = 'Idle';
    badge.style.background = 'rgba(255, 255, 255, 0.05)';
    badge.style.color = 'var(--text-muted)';
    badge.style.borderColor = 'rgba(255, 255, 255, 0.1)';
    wave.classList.remove('active');
    waveText.innerText = 'Waiting for call...';
    waveText.style.display = 'block';
    transBox.innerHTML = 'No active conversation.';
  }
}

function appendMonitorTranscript(sender, text) {
  const transBox = document.getElementById('monitor-transcript-box');
  if (!transBox) return;
  
  if (transBox.innerHTML.includes('No active conversation.')) {
    transBox.innerHTML = '';
  }
  
  const p = document.createElement('p');
  p.style.margin = '4px 0';
  const speaker = sender === 'user' ? 'You' : 'Gemini';
  const color = sender === 'user' ? '#06b6d4' : '#a78bfa';
  p.innerHTML = `<strong style="color: ${color};">${speaker}:</strong> ${text}`;
  
  transBox.appendChild(p);
  transBox.scrollTop = transBox.scrollHeight;
}

// --- Transcript Feed Helpers ---
function clearTranscript() {
  elTranscriptContainer.innerHTML = '';
  const transBox = document.getElementById('monitor-transcript-box');
  if (transBox) transBox.innerHTML = 'No active conversation.';
}

function appendSpeechBubble(sender, text) {
  // Check if the last bubble is from the same speaker, if so we can just update/append text,
  // but to keep it simple, we create a new bubble.
  const bubble = document.createElement('div');
  bubble.className = `speech-bubble bubble-${sender}`;
  
  const label = document.createElement('span');
  label.className = 'speaker-label';
  label.innerText = sender === 'user' ? 'You' : 'Gemini';
  
  const content = document.createElement('span');
  content.innerText = text;
  
  bubble.appendChild(label);
  bubble.appendChild(content);
  elTranscriptContainer.appendChild(bubble);
  elTranscriptContainer.scrollTop = elTranscriptContainer.scrollHeight;
  
  // Update Live Call Monitor
  appendMonitorTranscript(sender, text);
  
  // Highlight/open the transcript tab automatically
  elTabTranscript.click();
}

// --- Interactive Calling Orb Visualizer Setup ---
function setOrbState(state) {
  elCallingOrb.className = 'orb';
  if (state === 'idle') {
    elCallingOrb.classList.add('orb-idle');
    elCallStatus.innerText = 'Ready to Start';
    updateLiveMonitor('idle');
  } else if (state === 'connecting') {
    elCallingOrb.classList.add('orb-connecting');
    elCallStatus.innerText = 'Connecting...';
    updateLiveMonitor('connecting');
  } else if (state === 'active') {
    elCallingOrb.classList.add('orb-active');
    elCallStatus.innerText = 'Call Active - Speak Now';
    updateLiveMonitor('active');
  }
}

// --- Removed Canvas Soundwave Visualizer ---

// --- Start/End Call Management ---
elBtnToggleCall.addEventListener('click', () => {
  if (isConnected || isConnecting) {
    endCall();
  } else {
    startCall();
  }
});

elCallingOrb.addEventListener('click', () => {
  if (isConnected || isConnecting) {
    endCall();
  } else {
    startCall();
  }
});

// --- Mute Microphone Button ---
elBtnMute.addEventListener('click', () => {
  isMuted = !isMuted;
  if (isMuted) {
    elBtnMute.classList.add('btn-danger');
    elBtnMute.classList.remove('btn-secondary');
    elBtnMute.querySelector('.btn-text').innerText = 'Unmute';
    logWarn('Microphone muted.');
    if (micStream) {
      micStream.getAudioTracks().forEach(track => track.enabled = false);
    }
  } else {
    elBtnMute.classList.remove('btn-danger');
    elBtnMute.classList.add('btn-secondary');
    elBtnMute.querySelector('.btn-text').innerText = 'Mute';
    logInfo('Microphone active.');
    if (micStream) {
      micStream.getAudioTracks().forEach(track => track.enabled = true);
    }
  }
});

// --- Call Timer Update ---
function startTimer() {
  callStartTime = Date.now();
  elCallTimer.innerText = '00:00';
  
  callTimerInterval = setInterval(() => {
    const elapsed = Date.now() - callStartTime;
    const secTotal = Math.floor(elapsed / 1000);
    const min = String(Math.floor(secTotal / 60)).padStart(2, '0');
    const sec = String(secTotal % 60).padStart(2, '0');
    elCallTimer.innerText = `${min}:${sec}`;
  }, 1000);
}

function stopTimer() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  elCallTimer.innerText = '00:00';
}

// --- Start the Call Session ---
async function startCall() {
  const apiKey = elApiKey.value.trim();
  if (!apiKey) {
    logError('Please enter a valid Gemini API Key first.');
    alert('Please enter a valid Gemini API Key.');
    return;
  }
  
  // Store Key in localStorage for convenience
  localStorage.setItem('gemini_api_key', apiKey);
  
  isConnecting = true;
  isConnected = false;
  setOrbState('connecting');
  elBtnToggleCall.innerText = 'Connecting...';
  elBtnToggleCall.className = 'btn btn-secondary';
  elBtnMute.disabled = true;
  
  document.getElementById('transcript-drawer')?.classList.add('active');
  clearTranscript();
  logInfo(`Connecting to Live API model: ${elModelName.value}...`);
  
  // Create AudioContext (must be created from user gesture)
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Setup Analysers
    userAnalyser = audioContext.createAnalyser();
    userAnalyser.fftSize = 256;
    userBufferLength = userAnalyser.frequencyBinCount;
    userDataArray = new Uint8Array(userBufferLength);
    
    agentAnalyser = audioContext.createAnalyser();
    agentAnalyser.fftSize = 256;
    agentBufferLength = agentAnalyser.frequencyBinCount;
    agentDataArray = new Uint8Array(agentBufferLength);
    
    // Connect agent playback visualizer node to destination
    playOutNode = audioContext.createGain();
    playOutNode.connect(agentAnalyser);
    agentAnalyser.connect(audioContext.destination);
    
  } catch (err) {
    logError(`Failed to initialize Web Audio: ${err.message}`);
    endCall();
    return;
  }

  // Open WebSocket connection
  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
  
  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    logError(`Failed to create WebSocket: ${err.message}`);
    endCall();
    return;
  }
  
  ws.onopen = () => {
    logSuccess('WebSocket connection established.');
    if (elConnectionBadge) {
      elConnectionBadge.innerText = 'Connected';
      elConnectionBadge.className = 'badge badge-connected';
    }
    sendSetupMessage();
  };
  
  ws.onmessage = async (event) => {
    try {
      let text;
      if (event.data instanceof Blob) {
        text = await event.data.text();
      } else if (typeof event.data === 'string') {
        text = event.data;
      } else {
        const decoder = new TextDecoder('utf-8');
        text = decoder.decode(event.data);
      }
      const data = JSON.parse(text);
      handleServerMessage(data);
    } catch (err) {
      logError(`Error parsing server message: ${err.message}`);
    }
  };
  
  ws.onerror = (err) => {
    logError(`WebSocket error: ${err.message || 'Check your API key or internet connection.'}`);
    if (elConnectionBadge) {
      elConnectionBadge.innerText = 'Disconnected';
      elConnectionBadge.className = 'badge badge-disconnected';
    }
  };
  
  ws.onclose = (event) => {
    logWarn(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason || 'None'}`);
    if (elConnectionBadge) {
      elConnectionBadge.innerText = 'Disconnected';
      elConnectionBadge.className = 'badge badge-disconnected';
    }
    endCall();
  };
}

// --- Send setup configuration as first message ---
function sendSetupMessage() {
  const voice = elVoiceName.value;
  const sysInstruction = elSystemInstruction.value;
  
  const femaleVoices = ['Aoede', 'Kore', 'Puck', 'Leda', 'Callirrhoe', 'Autonoe', 'Despina', 'Erinome', 'Laomedeia', 'Achernar', 'Pulcherrima', 'Vindemiatrix', 'Sulafat'];
  const isFemale = femaleVoices.includes(voice);
  const genderRule = isFemale
    ? "You have a female voice. In Hindi/Hinglish, you must ALWAYS use feminine verb inflections (e.g., 'bol rahi hoon', 'kar rahi hoon', 'samajh rahi hoon', 'sun rahi hoon') and NEVER use masculine verb inflections like 'raha'."
    : "You have a male voice. In Hindi/Hinglish, you must ALWAYS use masculine verb inflections (e.g., 'bol raha hoon', 'kar raha hoon', 'samajh raha hoon', 'sun raha hoon') and NEVER use feminine verb inflections like 'rahi'.";
    
  const finalInstruction = `${sysInstruction}\n\n[CRITICAL GRAMMAR RULE]: ${genderRule}`;
  
  const setupMessage = {
    setup: {
      model: `models/${elModelName.value}`,
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
        parts: [
          {
            text: finalInstruction
          }
        ]
      }
    }
  };
  
  logInfo(`Sending setup config with voice "${voice}"...`);
  ws.send(JSON.stringify(setupMessage));
}

// --- Handle Server Messages ---
function handleServerMessage(message) {
  // If setup is confirmed, start microphone streaming
  if (message.setupComplete) {
    logSuccess('Setup completed successfully. Gemini is ready.');
    isConnected = true;
    isConnecting = false;
    setOrbState('active');
    
    elBtnToggleCall.innerText = 'End Call';
    elBtnToggleCall.className = 'btn btn-danger';
    elBtnMute.disabled = false;
    
    document.getElementById('transcript-drawer')?.classList.add('active');
    startTimer();
    startMicrophone();
    return;
  }
  
  // Process incoming content
  if (message.serverContent) {
    const content = message.serverContent;
    
    // Play received audio output
    if (content.modelTurn?.parts) {
      for (const part of content.modelTurn.parts) {
        if (part.inlineData && part.inlineData.data) {
          const base64Audio = part.inlineData.data;
          const arrayBuffer = base64ToArrayBuffer(base64Audio);
          const float32Data = pcmToFloat32(arrayBuffer);
          playPCMChunk(float32Data);
        }
      }
    }
    
    // Live transcribing User speech
    if (content.inputTranscription && content.inputTranscription.text) {
      appendSpeechBubble('user', content.inputTranscription.text);
      logInfo(`[User transcription]: ${content.inputTranscription.text}`);
    }
    
    // Live transcribing Gemini speech
    if (content.outputTranscription && content.outputTranscription.text) {
      appendSpeechBubble('agent', content.outputTranscription.text);
      logInfo(`[Gemini transcription]: ${content.outputTranscription.text}`);
    }
    
    // Handle turns and interrupts
    if (content.interrupted) {
      logWarn('Gemini was interrupted by user voice.');
      clearPlaybackQueue();
    }
  }
  
  // Handle server errors
  if (message.error) {
    logError(`Server Error: ${message.error.message} (Code: ${message.error.code})`);
    alert(`Gemini Error: ${message.error.message}`);
    endCall();
  }
}

// --- Base64 to ArrayBuffer helper ---
function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- Convert Int16 PCM to Float32 ---
function pcmToFloat32(arrayBuffer) {
  const int16 = new Int16Array(arrayBuffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

// --- Convert Float32 to Int16 PCM ---
function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

// --- Downsample mono buffer to 16kHz ---
function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }
  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = accum / (count || 1);
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

// --- Int16 Array to Base64 helper ---
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// --- Dynamic scheduling of incoming audio chunks ---
function playPCMChunk(float32Data) {
  if (!audioContext || audioContext.state === 'suspended') return;
  
  // Gemini returns mono audio at 24000Hz PCM
  const audioBuffer = audioContext.createBuffer(1, float32Data.length, 24000);
  audioBuffer.getChannelData(0).set(float32Data);
  
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  
  // Route playback through the agent voice analyser node
  source.connect(playOutNode);
  
  const now = audioContext.currentTime;
  if (nextPlayTime < now) {
    nextPlayTime = now;
  }
  source.start(nextPlayTime);
  nextPlayTime += audioBuffer.duration;
}

function clearPlaybackQueue() {
  // Reset playback scheduling timeline
  if (audioContext) {
    nextPlayTime = audioContext.currentTime;
  }
}

// --- Start Microphone Capture ---
async function startMicrophone() {
  logInfo('Requesting microphone access...');
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1
      }
    });
    logSuccess('Microphone access granted.');
    
    // Connect microphone stream to context
    micSourceNode = audioContext.createMediaStreamSource(micStream);
    
    // Connect user mic source node to user visualizer analyser node
    micSourceNode.connect(userAnalyser);
    
    // Setup capture processor node (ScriptProcessor)
    // 2048 is optimal for real-time streaming latency
    processorNode = audioContext.createScriptProcessor(2048, 1, 1);
    micSourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination); // Required to trigger onprocess
    
    processorNode.onaudioprocess = (e) => {
      if (!isConnected || isMuted) return;
      
      const inputBuffer = e.inputBuffer.getChannelData(0);
      
      // Downsample input data from host rate (e.g. 48kHz) to 16kHz
      const downsampled = downsampleBuffer(inputBuffer, audioContext.sampleRate, 16000);
      
      // Convert to Int16 PCM array buffer
      const pcmBuffer = floatTo16BitPCM(downsampled);
      
      // Convert to base64
      const base64Data = arrayBufferToBase64(pcmBuffer);
      
      // Send chunk over WebSocket
      const audioMessage = {
        realtimeInput: {
          audio: {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Data
          }
        }
      };
      
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(audioMessage));
      }
    };
    
  } catch (err) {
    logError(`Failed to get microphone: ${err.message}`);
    alert(`Failed to access microphone. Please check system permissions.`);
    endCall();
  }
}

// --- Stop Call and Clean Up Resources ---
function endCall() {
  logInfo('Ending call and freeing resources...');
  
  isConnected = false;
  isConnecting = false;
  
  if (elConnectionBadge) {
    elConnectionBadge.innerText = 'Disconnected';
    elConnectionBadge.className = 'badge badge-disconnected';
  }
  
  // Close WebSocket
  if (ws) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = null;
  }
  
  // Stop Microphone tracks
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  
  // Disconnect Audio Nodes
  if (processorNode) {
    processorNode.onaudioprocess = null;
    try { processorNode.disconnect(); } catch(e){}
    processorNode = null;
  }
  if (micSourceNode) {
    try { micSourceNode.disconnect(); } catch(e){}
    micSourceNode = null;
  }
  if (playOutNode) {
    try { playOutNode.disconnect(); } catch(e){}
    playOutNode = null;
  }
  
  // Close AudioContext
  if (audioContext) {
    audioContext.close().catch(err => logWarn(`Error closing AudioContext: ${err.message}`));
    audioContext = null;
  }
  
  userAnalyser = null;
  agentAnalyser = null;
  
  stopTimer();
  setOrbState('idle');
  
  elBtnToggleCall.innerText = 'Start Call';
  elBtnToggleCall.className = 'btn btn-primary';
  elBtnMute.disabled = true;
  
  logInfo('Call session ended.');
}

// --- App Initialization ---
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-toggle-theme')?.addEventListener('click', toggleTheme);
  const elTranscriptDrawer = document.getElementById('transcript-drawer');
  
  document.getElementById('btn-toggle-settings')?.addEventListener('click', () => {
    document.getElementById('nav-settings')?.click();
  });

  // Profile Account Settings Event Listeners
  document.getElementById('btn-toggle-profile-password')?.addEventListener('click', () => {
    const passInput = document.getElementById('profile-password');
    if (passInput) {
      passInput.type = passInput.type === 'password' ? 'text' : 'password';
    }
  });

  document.getElementById('btn-toggle-login-password')?.addEventListener('click', () => {
    const passInput = document.getElementById('login-password');
    if (passInput) {
      passInput.type = passInput.type === 'password' ? 'text' : 'password';
    }
  });

  document.getElementById('btn-toggle-signup-password')?.addEventListener('click', () => {
    const passInput = document.getElementById('signup-password');
    if (passInput) {
      passInput.type = passInput.type === 'password' ? 'text' : 'password';
    }
  });

  document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
    if (!loggedInUser) return;
    const nameInput = document.getElementById('profile-name');
    const emailInput = document.getElementById('profile-email');
    const passInput = document.getElementById('profile-password');
    const gstinInput = document.getElementById('profile-gstin');
    
    const name = nameInput ? nameInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passInput ? passInput.value.trim() : '';
    const gstin = gstinInput ? gstinInput.value.trim().toUpperCase() : '';

    if (!name || !email) {
      alert('Name and Email are required.');
      return;
    }

    const btn = document.getElementById('btn-save-profile');
    const originalText = btn.innerText;
    btn.innerText = '⏳ Saving...';
    btn.disabled = true;

    try {
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: loggedInUser.id, name, email, password, gstin })
      });
      const data = res.ok ? await res.json() : null;
      if (data && data.success) {
        loggedInUser = { ...loggedInUser, ...data.user };
        localStorage.setItem('user_session', JSON.stringify(loggedInUser));
        
        // Sync with Admin Invoices GSTIN and Quick Recharge GSTIN
        if (loggedInUser.role === 'admin' || loggedInUser.role === 'reseller') {
          window._domainGstin = gstin;
          const adminGstinInput = document.getElementById('admin-gstin-input');
          if (adminGstinInput) adminGstinInput.value = gstin;
        }
        const rechargeGstinInput = document.getElementById('user-gstin-input');
        if (rechargeGstinInput) rechargeGstinInput.value = gstin;

        alert('✅ Profile details & GSTIN updated successfully!');
        if (passInput) passInput.value = '';
        
        // Populate inputs again with updated session values
        populateProfileSettings(loggedInUser);
      } else {
        alert(data && data.error ? data.error : 'Failed to update profile settings.');
      }
    } catch (err) {
      console.error(err);
      alert('Network error while updating profile settings.');
    } finally {
      btn.innerText = originalText;
      btn.disabled = false;
    }
  });
  document.getElementById('btn-toggle-transcript')?.addEventListener('click', () => {
    elTranscriptDrawer.classList.toggle('active');
  });
  document.getElementById('btn-close-transcript')?.addEventListener('click', () => {
    elTranscriptDrawer.classList.remove('active');
  });
  
  // XAGENT nav link triggers
  document.getElementById('nav-trigger-settings')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('nav-settings')?.click();
  });
  document.getElementById('nav-trigger-transcript')?.addEventListener('click', (e) => {
    e.preventDefault();
    elTranscriptDrawer.classList.toggle('active');
  });

  // Apply saved theme on load
  applyTheme(getSavedTheme());

  logInfo('Ready to call. Add your API key and press "Start Call".');
  
  // Load Server Callback URL (default to live domain if cached value is empty or an old ngrok link)
  const elPub = document.getElementById('public-url');
  if (elPub) {
    const cachedUrl = localStorage.getItem('gemini_public_url');
    if (cachedUrl && !cachedUrl.includes('ngrok')) {
      elPub.value = cachedUrl;
    } else {
      elPub.value = window.location.origin;
    }
  }
  
  if (localStorage.getItem('gemini_record_call') === 'true') {
    if (elRecordCall) elRecordCall.checked = true;
  }

  // Load trial limit toggle state
  const trialLimitToggle = document.getElementById('trial-limit-toggle');
  if (trialLimitToggle) {
    trialLimitToggle.checked = localStorage.getItem('trial_limit_enabled') === 'true';
  }

  // Load Exotel values from local cache
  if (localStorage.getItem('exotel_provider')) {
    elTelephonyProvider.value = localStorage.getItem('exotel_provider');
  }
  if (localStorage.getItem('exotel_api_key')) {
    elExotelApiKey.value = localStorage.getItem('exotel_api_key');
  }
  if (localStorage.getItem('exotel_api_token')) {
    elExotelApiToken.value = localStorage.getItem('exotel_api_token');
  }
  if (localStorage.getItem('exotel_account_sid')) {
    elExotelAccountSid.value = localStorage.getItem('exotel_account_sid');
  }
  if (localStorage.getItem('exotel_subdomain')) {
    elExotelSubdomain.value = localStorage.getItem('exotel_subdomain');
  }
  if (localStorage.getItem('exotel_caller_id')) {
    elExotelCallerId.value = localStorage.getItem('exotel_caller_id');
  }

  // Load Vobiz values from local cache
  if (localStorage.getItem('vobiz_auth_id')) {
    elVobizAuthId.value = localStorage.getItem('vobiz_auth_id');
  }
  if (localStorage.getItem('vobiz_auth_token')) {
    elVobizAuthToken.value = localStorage.getItem('vobiz_auth_token');
  }
  if (localStorage.getItem('vobiz_caller_id')) {
    elVobizCallerId.value = localStorage.getItem('vobiz_caller_id');
  }
  
  // Toggle visibility of Exotel and Vobiz config containers
  const toggleTelephonyConfigs = () => {
    localStorage.setItem('exotel_provider', elTelephonyProvider.value);
    if (elTelephonyProvider.value === 'exotel') {
      elExotelConfigContainer.style.display = 'block';
      elVobizConfigContainer.style.display = 'none';
    } else if (elTelephonyProvider.value === 'vobiz') {
      elExotelConfigContainer.style.display = 'none';
      elVobizConfigContainer.style.display = 'block';
    } else {
      elExotelConfigContainer.style.display = 'none';
      elVobizConfigContainer.style.display = 'none';
    }
  };
  
  elTelephonyProvider.addEventListener('change', toggleTelephonyConfigs);
  toggleTelephonyConfigs(); // Initial check

  // Voice sample player trigger
  document.getElementById('btn-play-agent-voice-sample')?.addEventListener('click', (e) => {
    e.preventDefault();
    const voiceVal = document.getElementById('agent-voice').value;
    playVoiceSample(voiceVal, e.currentTarget);
  });

  document.getElementById('btn-play-settings-voice-sample')?.addEventListener('click', (e) => {
    e.preventDefault();
    const voiceVal = document.getElementById('voice-name').value;
    playVoiceSample(voiceVal, e.currentTarget);
  });

  // Fetch initial API & sharing settings on startup
  fetchSharingConfig();
  fetchAgentsForDropdowns();
  });

async function playVoiceSample(voiceName, buttonEl) {
  const originalText = buttonEl.innerText;
  buttonEl.innerText = "⏳...";
  buttonEl.disabled = true;

  try {
    let base64Audio = null;
    let sampleRate = 24000;
    const userApiKey = localStorage.getItem('gemini_api_key') || document.getElementById('api-key')?.value.trim() || document.getElementById('gemini-api-key')?.value.trim() || '';

    let backendErr = null;
    try {
      const backendRes = await fetch('/api/voice-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceName: voiceName,
          text: "Hello! Main ready hoon aapki help karne ke liye.",
          apiKey: userApiKey
        })
      });

      const data = await backendRes.json().catch(() => ({}));
      if (backendRes.ok && data.success && data.audioBase64) {
        base64Audio = data.audioBase64;
        if (data.sampleRate) sampleRate = data.sampleRate;
      } else {
        backendErr = data.error || `HTTP ${backendRes.status}`;
      }
    } catch (e) {
      console.warn("Backend voice sample proxy error:", e);
      backendErr = e.message;
    }

    // 2. Fallback: Direct Google API fetch using valid client apiKey if backend failed but user provided apiKey
    if (!base64Audio) {
      const apiKey = userApiKey || (typeof elApiKey !== 'undefined' && elApiKey ? elApiKey.value.trim() : '');
      if (!apiKey || apiKey.startsWith('AQ.')) {
        throw new Error(backendErr || "Gemini API key is not configured. Please enter a valid Gemini API key in Settings.");
      }

      const prompt = "Hello! Main ready hoon.";
      const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName }
            }
          }
        }
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    }

    if (base64Audio) {
      const arrayBuffer = base64ToArrayBuffer(base64Audio);
      const float32Data = pcmToFloat32(arrayBuffer);
      
      const sampleCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = sampleCtx.createBuffer(1, float32Data.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32Data);
      
      const source = sampleCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(sampleCtx.destination);
      source.start(0);
      
      source.onended = () => {
        setTimeout(() => sampleCtx.close(), 1000);
      };
    } else {
      throw new Error("No audio data returned in the response.");
    }
  } catch (err) {
    if (err.message.includes("quota") || err.message.includes("Quota") || err.message.includes("rate-limit") || err.message.includes("429") || err.message.includes("limit")) {
      alert("⚠️ Gemini API Rate Limit Exceeded!\n\nAapki API Key Free Tier par chal rahi hai, jiske karan 1 minute me max 10 voice test requests hi allowed hain. Kripya 1 minute baad firse try karein.");
    } else {
      alert(`Failed to play voice sample: ${err.message}`);
    }
    console.error(err);
  } finally {
    buttonEl.innerText = originalText;
    buttonEl.disabled = false;
  }
}

// --- Save Prompt Button Handler ---
if (elBtnSavePrompt) {
  elBtnSavePrompt.addEventListener('click', () => {
    const publicUrlVal = document.getElementById('public-url')?.value.trim() || '';
    
    localStorage.setItem('gemini_system_instruction', elSystemInstruction.value);
    localStorage.setItem('gemini_agent_voice', elVoiceName.value);
    localStorage.setItem('exotel_provider', elTelephonyProvider.value);
    localStorage.setItem('gemini_record_call', elRecordCall.checked ? 'true' : 'false');
    localStorage.setItem('gemini_public_url', publicUrlVal);
    
    const incomingAgentVal = document.getElementById('incoming-agent-select')?.value || '';
    localStorage.setItem('gemini_incoming_agent_id', incomingAgentVal);

    if (elTelephonyProvider.value === 'exotel') {
      localStorage.setItem('exotel_api_key', elExotelApiKey.value.trim());
      localStorage.setItem('exotel_api_token', elExotelApiToken.value.trim());
      localStorage.setItem('exotel_account_sid', elExotelAccountSid.value.trim());
      localStorage.setItem('exotel_subdomain', elExotelSubdomain.value.trim());
      localStorage.setItem('exotel_caller_id', elExotelCallerId.value.trim());
    } else if (elTelephonyProvider.value === 'vobiz') {
      localStorage.setItem('vobiz_auth_id', elVobizAuthId.value.trim());
      localStorage.setItem('vobiz_auth_token', elVobizAuthToken.value.trim());
      localStorage.setItem('vobiz_caller_id', elVobizCallerId.value.trim());
    }
    
    const trialLimitEnabled = document.getElementById('trial-limit-toggle')?.checked || false;
    localStorage.setItem('trial_limit_enabled', trialLimitEnabled ? 'true' : 'false');

    const syncPayload = {
      voice: elVoiceName.value,
      systemInstruction: elSystemInstruction.value,
      publicUrl: publicUrlVal,
      telephonyProvider: elTelephonyProvider.value,
      gemini_record_call: elRecordCall.checked ? 'true' : 'false',
      trialLimitEnabled: trialLimitEnabled,
      exotelApiKey: elExotelApiKey.value.trim(),
      exotelApiToken: elExotelApiToken.value.trim(),
      exotelAccountSid: elExotelAccountSid.value.trim(),
      exotelSubdomain: elExotelSubdomain.value.trim(),
      exotelCallerId: elExotelCallerId.value.trim(),
      vobizAuthId: elVobizAuthId.value.trim(),
      vobizAuthToken: elVobizAuthToken.value.trim(),
      vobizCallerId: elVobizCallerId.value.trim(),
      incomingAgentId: incomingAgentVal
    };
    
    // Dynamically sync config defaults to server so incoming calls and webhooks use them
    fetch('/save-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(syncPayload)
    }).then(res => {
      if (res.ok) {
        logSuccess('Configuration successfully synchronized with backend server persistently.');
      } else {
        logWarn('Config saved locally but server failed to update default configs.');
      }
    }).catch(err => {
      console.error('Failed to sync config to backend:', err);
    });

    logSuccess('Configuration settings (voice, public URL, and credentials) saved locally to browser cache.');
    alert('Settings saved and synced successfully!');
  });
}


// --- Call Logging, Summarization, and Rec tab handlers ---
function getUserCallsCacheKey() {
  if (typeof loggedInUser !== 'undefined' && loggedInUser && loggedInUser.id) {
    return 'callio_calls_cache_' + loggedInUser.id;
  }
  return null;
}

let selectedCallSid = null;
let callsCache = [];
try {
  localStorage.removeItem('callio_calls_cache'); // Purge legacy un-scoped cache key
  const session = localStorage.getItem('user_session');
  if (session) {
    const u = JSON.parse(session);
    if (u && u.id) {
      const localCachedCalls = localStorage.getItem('callio_calls_cache_' + u.id);
      if (localCachedCalls) {
        callsCache = JSON.parse(localCachedCalls);
        window.callsCache = callsCache;
        window.lastDashboardCalls = callsCache;
      }
    }
  }
} catch (e) {}

function showListView() {
  const elListView = document.getElementById('summary-list-view');
  const elDetailsView = document.getElementById('summary-details-view');
  if (elListView && elDetailsView) {
    elListView.style.display = 'block';
    elDetailsView.style.display = 'none';
  }
}

function showDetailsView() {
  const elListView = document.getElementById('summary-list-view');
  const elDetailsView = document.getElementById('summary-details-view');
  if (elListView && elDetailsView) {
    elListView.style.display = 'none';
    elDetailsView.style.display = 'block';
  }
}

// Back to calls button handler
const elBtnBackToCalls = document.getElementById('btn-back-to-calls');
if (elBtnBackToCalls) {
  elBtnBackToCalls.addEventListener('click', () => {
    selectedCallSid = null;
    // Remove active class from list items
    document.querySelectorAll('.call-list-item').forEach(el => el.classList.remove('active'));
    showListView();
  });
}

async function refreshCallsList() {
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/calls?clientId=${clientId}`);
    const data = await res.json();
    const fetchedCalls = Array.isArray(data) ? data : (data && Array.isArray(data.calls) ? data.calls : []);
    callsCache = fetchedCalls;
    window.callsCache = callsCache; // expose globally for metric modals
    window.lastDashboardCalls = callsCache;
    const cacheKey = getUserCallsCacheKey();
    if (cacheKey) {
      if (fetchedCalls.length > 0) {
        try { localStorage.setItem(cacheKey, JSON.stringify(callsCache.slice(0, 100))); } catch (e) {}
      } else {
        localStorage.removeItem(cacheKey);
      }
    }
    
    if (typeof updateDashboardWithClientCalls === 'function') {
      updateDashboardWithClientCalls(callsCache);
    }
      
      const activeTab = localStorage.getItem('activeTab') || 'tab-dashboard';
      if (activeTab === 'tab-dashboard') {
        renderCallsSidebar();
        renderDashboard();
        updateVobizMetrics();
        if (selectedCallSid) {
          renderCallDetails(selectedCallSid);
        }
        if (typeof window.populateAIActionPlanner === 'function') window.populateAIActionPlanner();
        if (typeof refreshCallbacksList === 'function') refreshCallbacksList();
      }
      
      if (activeTab === 'tab-call-history' || activeTab === 'tab-quick-call') {
        renderHistoryList();
        if (historySelectedSid) {
          renderHistoryDetail(historySelectedSid);
        }
      }
  } catch (err) {
    console.error('[Calls List Fetch Error] Failed:', err);
  }
}


function renderDashboard() {
  const elDashTotal = document.getElementById('dash-total');
  const elDashInterested = document.getElementById('dash-interested');
  const elDashNotInterested = document.getElementById('dash-not-interested');
  const elDashActive = document.getElementById('dash-active');
  const elDashInsightsFeed = document.getElementById('dash-insights-feed');

  if (!elDashTotal) return;

  const total = callsCache.length;
  let interestedCount = 0;
  let notInterestedCount = 0;
  let activeCount = 0;

  const insightsHtml = [];

  callsCache.forEach(call => {
    if (call.status === 'active' || call.status === 'calling' || call.status === 'failed') {
      activeCount++;
    }

    let verdict = 'none';
    let action = 'Waiting for call to complete...';
    let rawVerdict = '';

    if (call.summary) {
      // Parse Verdict
      const verdictMatch = call.summary.match(/\*\*(?:VERDICT|Verdict):\*\*\s*([A-Za-z\s]+)/);
      if (verdictMatch && verdictMatch[1]) {
        rawVerdict = verdictMatch[1].trim().toUpperCase();
        if (rawVerdict.includes('NOT INTERESTED')) {
          verdict = 'not-interested';
          notInterestedCount++;
        } else if (rawVerdict.includes('INTERESTED')) {
          verdict = 'interested';
          interestedCount++;
        } else {
          verdict = 'undecided';
        }
      }

      // Parse Next Action
      const actionMatch = call.summary.match(/\*\*(?:Next Action|Key Action|Next Actions):\*\*\s*([^\n]+)/i);
      if (actionMatch && actionMatch[1]) {
        action = actionMatch[1].trim();
      } else {
        action = "Details logged in full summary.";
      }
    }

    if (call.status === 'completed') {
      insightsHtml.push(`
        <div class="insight-item">
          <div class="insight-header">
            <span class="insight-phone">${call.name ? call.name + ' (' + call.to + ')' : call.to}</span>
            <span class="insight-verdict ${verdict}">${rawVerdict || 'COMPLETED'}</span>
          </div>
          <div class="insight-action">
            <strong>Action:</strong> ${action}
          </div>
        </div>
      `);
    }
  });

  elDashTotal.innerText = total;
  elDashInterested.innerText = interestedCount;
  elDashNotInterested.innerText = notInterestedCount;
  elDashActive.innerText = activeCount;

  if (insightsHtml.length > 0) {
    // Show most recent first
    elDashInsightsFeed.innerHTML = insightsHtml.reverse().join('');
  } else {
    elDashInsightsFeed.innerHTML = '<div class="system-msg">No insights yet. Complete a call first.</div>';
  }
}

window.refreshCallsList = refreshCallsList; // expose helper for external trigger if needed

function renderCallsSidebar() {
  if (!elCallsListFeed) return;

  if (callsCache.length === 0) {
    const emptyEl = elCallsListFeed.querySelector('.system-msg');
    if (!emptyEl) elCallsListFeed.innerHTML = '<div class="system-msg">No calls dialed yet.</div>';
    const statsRow = document.getElementById('calls-stats-row');
    if (statsRow) statsRow.style.display = 'none';
    return;
  }

  // Compute stats
  const total = callsCache.length;
  const activeCount = callsCache.filter(c => c.status === 'active' || c.status === 'calling').length;
  const completedCount = callsCache.filter(c => c.status === 'completed').length;
  const failedCount = callsCache.filter(c => c.status === 'failed' || c.status === 'voicemail').length;

  // Stats row — patch in place or create once
  let statsRow = document.getElementById('calls-stats-row');
  if (!statsRow) {
    statsRow = document.createElement('div');
    statsRow.id = 'calls-stats-row';
    statsRow.className = 'calls-stats-row';
    statsRow.innerHTML = `
      <div class="calls-stat-chip chip-total"><span class="calls-stat-num">${total}</span><span class="calls-stat-label">Total</span></div>
      <div class="calls-stat-chip chip-active"><span class="calls-stat-num">${activeCount}</span><span class="calls-stat-label">Active</span></div>
      <div class="calls-stat-chip chip-completed"><span class="calls-stat-num">${completedCount}</span><span class="calls-stat-label">Done</span></div>
      <div class="calls-stat-chip chip-failed"><span class="calls-stat-num">${failedCount}</span><span class="calls-stat-label">Failed</span></div>
    `;
    elCallsListFeed.parentNode.insertBefore(statsRow, elCallsListFeed);
  } else {
    // Patch only numbers in place
    const nums = [total, activeCount, completedCount, failedCount];
    statsRow.querySelectorAll('.calls-stat-num').forEach((el, i) => {
      if (el.textContent !== String(nums[i])) el.textContent = nums[i];
    });
  }
  statsRow.style.display = 'flex';

  // Remove any empty-state message
  const systemMsg = elCallsListFeed.querySelector('.system-msg');
  if (systemMsg) systemMsg.remove();

  // Smart DOM diff for call list items
  const existingItems = new Map();
  elCallsListFeed.querySelectorAll('.call-list-item[data-sid]').forEach(el => {
    existingItems.set(el.dataset.sid, el);
  });

  const currentSids = new Set(callsCache.map(c => c.callSid));

  // Remove stale items
  existingItems.forEach((el, sid) => {
    if (!currentSids.has(sid)) el.remove();
  });

  // Add or update items
  callsCache.forEach(call => {
    const titleText = call.name ? `${call.name} (${call.to})` : call.to;
    let div = existingItems.get(call.callSid);

    if (!div) {
      // Create new item
      div = document.createElement('div');
      div.dataset.sid = call.callSid;

      const dot = document.createElement('div');
      dot.className = 'call-list-status-dot';

      const body = document.createElement('div');
      body.className = 'call-list-item-body';

      const title = document.createElement('div');
      title.className = 'call-list-item-title';
      title.innerText = titleText;

      const sub = document.createElement('div');
      sub.className = 'call-list-item-sub';

      const badge = document.createElement('span');
      badge.className = `status-badge badge-${call.status} cli-badge`;
      badge.innerText = call.status;

      sub.appendChild(badge);
      body.appendChild(title);
      body.appendChild(sub);

      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      arrow.setAttribute('class', 'call-list-arrow');
      arrow.setAttribute('viewBox', '0 0 24 24');
      arrow.setAttribute('fill', 'none');
      arrow.setAttribute('stroke', 'currentColor');
      arrow.setAttribute('stroke-width', '2');
      arrow.setAttribute('width', '14');
      arrow.setAttribute('height', '14');
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', '9 18 15 12 9 6');
      arrow.appendChild(polyline);

      div.appendChild(dot);
      div.appendChild(body);
      div.appendChild(arrow);

      div.addEventListener('click', () => {
        selectedCallSid = call.callSid;
        document.querySelectorAll('.call-list-item').forEach(el => el.classList.remove('active'));
        div.classList.add('active');
        renderCallDetails(call.callSid);
        showDetailsView();
      });

      elCallsListFeed.appendChild(div);
    } else {
      // Patch only changed values
      const titleEl = div.querySelector('.call-list-item-title');
      if (titleEl && titleEl.innerText !== titleText) titleEl.innerText = titleText;
      const badgeEl = div.querySelector('.cli-badge');
      if (badgeEl) {
        if (badgeEl.innerText !== call.status) badgeEl.innerText = call.status;
        badgeEl.className = `status-badge badge-${call.status} cli-badge`;
      }
    }

    // Always sync class
    div.className = `call-list-item status-${call.status} ${selectedCallSid === call.callSid ? 'active' : ''}`;
  });
}

function renderCallDetails(callSid) {
  const call = callsCache.find(c => c.callSid === callSid);
  if (!call) return;

  if (elCallDetailsEmpty) elCallDetailsEmpty.style.display = 'none';
  if (elCallDetailsPanel) elCallDetailsPanel.style.display = 'block';

  // Build premium header
  if (elDetailsPhone) {
    elDetailsPhone.innerHTML = `<span class="details-phone-icon">📞</span>${call.name ? `${call.name}<br><small style="font-weight:400;font-size:0.8rem;color:var(--text-muted)">${call.to}</small>` : call.to}`;
  }
  if (elDetailsStatusBadge) {
    elDetailsStatusBadge.className = `status-badge badge-${call.status}`;
    elDetailsStatusBadge.innerText = call.status;
  }

  // Update meta info in the header-left wrapper
  const headerEl = elCallDetailsPanel ? elCallDetailsPanel.querySelector('.details-header') : null;
  if (headerEl) {
    const headerLeft = headerEl.querySelector('.details-header-left');
    if (headerLeft) {
      // Update or create meta row
      let meta = headerLeft.querySelector('.details-header-meta');
      if (!meta) {
        meta = document.createElement('div');
        meta.className = 'details-header-meta';
        headerLeft.appendChild(meta);
      }
      const callDate = call.startedAt ? new Date(call.startedAt).toLocaleString() : 'Just now';
      meta.innerText = callDate;
    }
  }

  // Render Recording URL
  if (elDetailsRecordingBox) {
    let newRecHtml = '';
    if (!call.recordCall) {
      newRecHtml = `
        <div class="recording-status">
          <span class="recording-dot dot-disabled"></span>
          Recording disabled for this call.
        </div>`;
    } else if (call.recordingStatus === 'none' || call.recordingStatus === 'recording') {
      newRecHtml = `
        <div class="recording-status">
          <span class="recording-dot"></span>
          Recording in progress...
        </div>`;
    } else if (call.recordingStatus === 'fetching') {
      newRecHtml = `
        <div class="recording-status">
          <span class="recording-dot"></span>
          Fetching recording file...
        </div>`;
    } else if (call.recordingStatus === 'ready' && call.recordingUrl) {
      const proxyUrl = `/recording-proxy/${call.callSid}${loggedInUser && loggedInUser.id ? '?clientId=' + encodeURIComponent(loggedInUser.id) : ''}`;
      newRecHtml = `
        <div class="recording-status">
          <span class="recording-dot dot-ready"></span>
          Recording ready
        </div>
        <audio controls class="hd-audio-player" src="${proxyUrl}" preload="metadata" style="margin-top:0.5rem;"></audio>
        <a href="${proxyUrl}" download="recording-${call.callSid.substring(0,8)}.mp3" class="btn-download-rec" style="margin-top:0.5rem;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          Download
        </a>`;
    } else {
      newRecHtml = `
        <div class="recording-status">
          <span class="recording-dot dot-disabled"></span>
          Recording unavailable.
        </div>`;
    }
    
    // Use dataset to prevent re-rendering identical states, avoiding audio playback interruption
    const recStateKey = `${call.callSid}-${call.recordingStatus}`;
    if (elDetailsRecordingBox.dataset.renderedState !== recStateKey) {
      elDetailsRecordingBox.innerHTML = newRecHtml;
      elDetailsRecordingBox.dataset.renderedState = recStateKey;
    }
  }

  // Render Summary and Transcript
  if (elCallSummaryBox) {
    let newSumHtml = '';
    let summaryHtml = '';
    if (call.summary) {
      summaryHtml = `<div class="summary-text">${formatMarkdown(call.summary)}</div>`;
    } else if (call.status === 'completed') {
      summaryHtml = '<span class="summary-status">⏳ Generating summary...</span>';
    } else {
      summaryHtml = '<span class="summary-status">💬 Summary will be generated once the call ends.</span>';
    }

    newSumHtml += summaryHtml;

    if (call.transcript && call.transcript.length > 0) {
      newSumHtml += `
        <h4 class="details-section-title" style="margin-top: 1.25rem;">
          <span class="details-section-title-icon">💬</span> Call Transcript
        </h4>
        <div class="details-transcript-container">
          ${call.transcript.map(turn => `
            <div class="details-transcript-row row-${turn.role === 'user' ? 'user' : 'agent'}">
               <span class="transcript-speaker">${turn.role === 'user' ? 'You' : 'Gemini'}</span>
               <span class="transcript-text">${escapeHtml(turn.text)}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    const sumStateKey = `${call.callSid}-${call.status}-${call.summary ? 'has_sum' : 'no_sum'}`;
    if (elCallSummaryBox.dataset.renderedState !== sumStateKey || elCallSummaryBox.dataset.renderedTransLen !== String(call.transcript?.length || 0)) {
      elCallSummaryBox.innerHTML = newSumHtml;
      elCallSummaryBox.dataset.renderedState = sumStateKey;
      elCallSummaryBox.dataset.renderedTransLen = String(call.transcript?.length || 0);
    }
  }
}

function formatMarkdown(text) {
  let formatted = text
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^- (.*?)(?:<br>|$)/gm, '<li>$1</li>');
  if (formatted.includes('<li>')) {
    formatted = `<ul>${formatted}</ul>`;
  }
  return formatted;
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Start periodic polling for calls list (every 3 seconds for fast real-time UI updates)
refreshCallsList();
setInterval(() => {
  refreshCallsList();
  refreshHistoryIfOpen();
}, 3000);

// Clean up animations on page unload
window.addEventListener('beforeunload', () => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  endCall();
});

// ====================================================
// MULTI-TAB LOGIC (Agents, Contacts, Broadcast)
// ====================================================

// --- 1. AGENTS ---
let localAgentsCache = [];
let editingAgentId = null;

async function fetchAgents() {
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/api/agents?clientId=${clientId}`);
    const data = await res.json();
    if (data.success) {
      localAgentsCache = data.agents;
      renderAgentsTable(data.agents);
    }
  } catch (e) {
    console.error("Failed to fetch agents", e);
  }
}

function renderAgentsTable(agents) {
  const container = document.querySelector('#agents-container-grid');
  if (!container) return;
  container.innerHTML = '';
  
  if (agents.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 4rem 2rem;">
        <div class="empty-state-icon" style="display: flex; align-items: center; justify-content: center;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; color: var(--text-muted); opacity: 0.4;"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>
        </div>
        <h4 class="empty-state-title">No Agents Created</h4>
        <p class="empty-state-desc">Create your first AI agent profile on the left to get started.</p>
      </div>
    `;
    return;
  }
  
  agents.forEach(agent => {
    const card = document.createElement('div');
    card.className = 'agent-card';
    const initials = agent.name.split(/\s+/).filter(Boolean).map(n => n[0]).join('').substring(0, 2);
    const moodClass = 'mood-' + agent.mood.toLowerCase();
    const promptPreview = agent.systemInstruction ? escapeHtml(agent.systemInstruction) : 'No instructions provided.';
    
    card.innerHTML = `
      <div class="agent-card-header">
        <div class="agent-avatar-circle ${moodClass}">${initials}</div>
        <div class="agent-card-info">
          <h4 class="agent-card-name">${escapeHtml(agent.name)}</h4>
          <div class="agent-card-meta">
            <span class="agent-badge">${escapeHtml(agent.voice)}</span>
            <span class="agent-badge">${escapeHtml(agent.mood)}</span>
          </div>
        </div>
      </div>
      <p class="agent-card-body">${promptPreview}</p>
      <div class="agent-card-footer">
        <button class="btn btn-secondary btn-icon" onclick="editAgent('${agent.id}')" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-secondary btn-icon" onclick="deleteAgent('${agent.id}')" title="Delete" style="color: var(--color-red); border-color: rgba(239, 68, 68, 0.15);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.editAgent = function(id) {
  const agent = localAgentsCache.find(a => a.id === id);
  if (!agent) return;
  
  editingAgentId = id;
  document.getElementById('agent-name').value = agent.name;
  document.getElementById('agent-voice').value = agent.voice;
  document.getElementById('agent-mood').value = agent.mood;
  document.getElementById('agent-prompt').value = agent.systemInstruction || '';
  
  const saveBtn = document.getElementById('btn-save-agent');
  const btnContainer = document.getElementById('agent-form-buttons-container') || saveBtn?.parentNode;
  if (saveBtn) {
    saveBtn.innerText = 'Update Agent';
    saveBtn.style.flex = '2';
    
    // Create/toggle Cancel button if it doesn't exist
    let cancelBtn = document.getElementById('btn-cancel-agent-edit');
    if (!cancelBtn) {
      cancelBtn = document.createElement('button');
      cancelBtn.id = 'btn-cancel-agent-edit';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.innerText = 'Cancel';
      cancelBtn.style.cssText = 'flex: 1; height: 46px; font-weight: 700; border-radius: 12px; font-size: 0.9rem; border: 1px solid var(--border-color); background: rgba(255, 255, 255, 0.08); color: var(--text-main); cursor: pointer; transition: all 0.2s ease; margin: 0;';
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        clearAgentForm();
      });
      if (btnContainer) btnContainer.appendChild(cancelBtn);
    }
  }
};

window.clearAgentForm = function() {
  editingAgentId = null;
  document.getElementById('agent-name').value = '';
  document.getElementById('agent-prompt').value = '';
  
  const saveBtn = document.getElementById('btn-save-agent');
  if (saveBtn) {
    saveBtn.innerText = 'Save Agent';
    saveBtn.style.flex = '1';
  }
  const cancelBtn = document.getElementById('btn-cancel-agent-edit');
  if (cancelBtn) {
    cancelBtn.remove();
  }
};

document.getElementById('btn-save-agent')?.addEventListener('click', async () => {
  const name = document.getElementById('agent-name').value.trim();
  const voice = document.getElementById('agent-voice').value;
  const mood = document.getElementById('agent-mood').value;
  const systemInstruction = document.getElementById('agent-prompt').value.trim();
  
  if (!name || !voice) {
    alert("Please provide an Agent Name and select a Voice.");
    return;
  }
  
  const payload = { name, voice, mood, systemInstruction, clientId: loggedInUser ? loggedInUser.id : null };
  if (editingAgentId) {
    payload.id = editingAgentId;
  }
  
  try {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert(editingAgentId ? "Agent updated successfully!" : "Agent saved successfully!");
      clearAgentForm();
      fetchAgents();
    } else {
      if (data.error && (data.error.includes("upgrade your plan") || data.error.includes("allows creating up to") || data.error.includes("limit"))) {
        window.showPlanUpgradeModal(data.error);
      } else {
        alert("Error saving agent: " + data.error);
      }
    }
  } catch (e) {
    alert("Network error saving agent.");
  }
});

window.deleteAgent = async function(id) {
  if (!confirm("Are you sure you want to delete this agent?")) return;
  try {
    const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) fetchAgents();
  } catch (e) {
    alert("Failed to delete agent");
  }
}

// Populate Agent Voice Dropdown
function populateAgentVoiceDropdown() {
  const voiceSelect = document.getElementById('agent-voice');
  if (voiceSelect) {
    // Clone options from the settings drawer voice select
    const options = Array.from(document.getElementById('voice-name').options);
    voiceSelect.innerHTML = '';
    options.forEach(opt => {
      const newOpt = document.createElement('option');
      newOpt.value = opt.value;
      newOpt.text = opt.text;
      voiceSelect.appendChild(newOpt);
    });
  }
}
populateAgentVoiceDropdown();

// --- 2. CONTACTS ---
let localGroupsCache = [];

async function fetchGroups() {
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/api/groups?clientId=${clientId}`);
    const data = await res.json();
    if (data.success) {
      localGroupsCache = data.groups;
      renderGroupsTable(data.groups);
      renderAllContactsTable();
      populateSingleContactGroups(data.groups);
    }
  } catch (e) {
    console.error("Failed to fetch groups", e);
  }
}

window.contactsSelectedTag = 'all';

window.downloadSampleContactsCsv = function() {
  const csvContent = "Name,Phone,Tag\nRahul Sharma,9876543210,VIP\nPriya Singh,9123456789,Hot Leads\nAmit Verma,9988776655,Followup\nVikram Gupta,9898989898,Testing\n";
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "sample_contacts.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

window.exportContactsCsv = function() {
  const contacts = window.getFilteredContactsList();
  if (contacts.length === 0) {
    alert("No contacts available to export.");
    return;
  }

  let csvContent = "Name,Phone,Tag,Added Date\n";
  contacts.forEach(c => {
    const name = `"${(c.name || '').replace(/"/g, '""')}"`;
    const phone = `"${(c.phone || '').replace(/"/g, '""')}"`;
    const tag = `"${(c.tag || 'Default').replace(/"/g, '""')}"`;
    const dateStr = c.createdAt ? new Date(c.createdAt).toLocaleString() : '';
    csvContent += `${name},${phone},${tag},"${dateStr}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const dateTag = new Date().toISOString().slice(0, 10);
  link.setAttribute("download", `contacts_export_${dateTag}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

window.getAllContactsList = function() {
  const all = [];
  (localGroupsCache || []).forEach(g => {
    if (g.contacts && Array.isArray(g.contacts)) {
      g.contacts.forEach(c => {
        all.push({
          ...c,
          tag: c.tag || g.name || 'Default',
          groupId: g.id,
          groupName: g.name
        });
      });
    }
  });
  return all;
};

window.getFilteredContactsList = function() {
  const all = window.getAllContactsList();
  const filterTag = window.contactsSelectedTag || 'all';
  const searchInput = document.getElementById('contacts-search-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let list = all;
  if (filterTag !== 'all') {
    list = list.filter(c => String(c.tag || '').toLowerCase() === filterTag.toLowerCase());
  }

  if (query) {
    list = list.filter(c => {
      const name = String(c.name || '').toLowerCase();
      const phone = String(c.phone || '').toLowerCase();
      const tag = String(c.tag || '').toLowerCase();
      return name.includes(query) || phone.includes(query) || tag.includes(query);
    });
  }

  return list;
};

window.filterContactsByTag = function(tag, btnEl) {
  window.contactsSelectedTag = tag;
  const buttons = document.querySelectorAll('#contacts-tag-filters .btn-tag-filter');
  buttons.forEach(btn => {
    btn.style.borderColor = 'var(--border-color)';
    btn.style.background = 'var(--bg-surface)';
    btn.style.color = 'var(--text-muted)';
    btn.style.fontWeight = '600';
  });
  if (btnEl) {
    btnEl.style.borderColor = 'var(--color-cyan)';
    btnEl.style.background = 'rgba(6, 182, 212, 0.15)';
    btnEl.style.color = 'var(--color-cyan)';
    btnEl.style.fontWeight = '700';
  }
  window.renderAllContactsTable();
};

window.renderAllContactsTable = function() {
  const tbody = document.getElementById('all-contacts-table-body');
  if (!tbody) return;

  const allContacts = window.getAllContactsList();

  // Total badge
  const totalBadge = document.getElementById('total-contacts-count-badge');
  if (totalBadge) totalBadge.innerText = allContacts.length;

  // Build Tag Filter Pills
  const tagFiltersContainer = document.getElementById('contacts-tag-filters');
  if (tagFiltersContainer) {
    const uniqueTags = Array.from(new Set(allContacts.map(c => c.tag || 'Default'))).filter(Boolean);
    let tagHtml = `
      <button class="btn-tag-filter ${window.contactsSelectedTag === 'all' ? 'active' : ''}" onclick="window.filterContactsByTag('all', this)" style="padding: 6px 14px; font-size: 0.78rem; border-radius: 20px; cursor: pointer; ${window.contactsSelectedTag === 'all' ? 'border: 1px solid var(--color-cyan); background: rgba(6, 182, 212, 0.15); color: var(--color-cyan); font-weight: 700;' : 'border: 1px solid var(--border-color); background: var(--bg-surface); color: var(--text-muted); font-weight: 600;'}">
        All (${allContacts.length})
      </button>
    `;
    uniqueTags.forEach(t => {
      const count = allContacts.filter(c => (c.tag || 'Default') === t).length;
      const isActive = (window.contactsSelectedTag || '').toLowerCase() === t.toLowerCase();
      tagHtml += `
        <button class="btn-tag-filter ${isActive ? 'active' : ''}" onclick="window.filterContactsByTag('${escapeHtml(t)}', this)" style="padding: 6px 14px; font-size: 0.78rem; border-radius: 20px; cursor: pointer; ${isActive ? 'border: 1px solid var(--color-cyan); background: rgba(6, 182, 212, 0.15); color: var(--color-cyan); font-weight: 700;' : 'border: 1px solid var(--border-color); background: var(--bg-surface); color: var(--text-muted); font-weight: 600;'}">
          🏷️ ${escapeHtml(t)} (${count})
        </button>
      `;
    });
    tagFiltersContainer.innerHTML = tagHtml;
  }

  const list = window.getFilteredContactsList();

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 3.5rem 1.5rem; color: var(--text-muted);">
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem 0;">
            <div style="width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, rgba(6, 182, 212, 0.12), rgba(59, 130, 246, 0.12)); border: 1px solid rgba(6, 182, 212, 0.25); display: flex; align-items: center; justify-content: center; margin-bottom: 12px; box-shadow: 0 4px 20px rgba(6, 182, 212, 0.15);">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-cyan)" stroke-width="2" style="width: 26px; height: 26px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <h4 style="color: var(--text-main); font-size: 1.05rem; font-weight: 700; margin: 0 0 4px 0;">No Contacts Found</h4>
            <p style="font-size: 0.82rem; color: var(--text-muted); margin: 0 0 16px 0; max-width: 340px; line-height: 1.5;">Import a CSV / Excel file or add a single contact from the left panel to populate your audience list.</p>
            <button onclick="window.openAddSingleContactModal()" class="btn btn-secondary" style="padding: 7px 16px; font-size: 0.8rem; border-radius: 10px; font-weight: 600; border: 1px solid var(--color-cyan); color: var(--color-cyan); background: rgba(6,182,212,0.08); cursor: pointer;">➕ Add First Contact</button>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  let html = '';
  list.forEach(c => {
    const dateStr = c.createdAt ? new Date(c.createdAt).toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' }) : '—';
    const tagLabel = c.tag || 'Default';

    html += `
      <tr>
        <td style="font-weight: 600; color: var(--text-main); font-size: 0.9rem;">${escapeHtml(c.name || 'N/A')}</td>
        <td style="font-family: var(--font-mono); color: var(--color-cyan); font-weight: 600; font-size: 0.88rem;">${escapeHtml(c.phone || 'N/A')}</td>
        <td>
          <span id="tag-badge-${c.id}" style="background: rgba(6,182,212,0.12); color: var(--color-cyan); font-size: 0.72rem; padding: 3px 10px; border-radius: 12px; font-weight: 700; border: 1px solid rgba(6,182,212,0.3); text-transform: uppercase; letter-spacing: 0.3px; cursor:pointer;" onclick="window.inlineEditContactTag('${c.id}', '${escapeHtml(tagLabel)}', this)" title="Click to edit tag">🏷️ ${escapeHtml(tagLabel)}</span>
        </td>
        <td style="color: var(--text-muted); font-size: 0.82rem;">${dateStr}</td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-icon" onclick="window.inlineEditContactTag('${c.id}', '${escapeHtml(tagLabel)}', document.getElementById('tag-badge-${c.id}'))" title="Edit Tag" style="padding: 4px 8px; color: var(--color-cyan); border-color: rgba(6,182,212,0.2); background: rgba(6,182,212,0.08); border-radius: 6px; cursor: pointer; margin-right: 4px;">
            ✏️
          </button>
          <button class="btn btn-secondary btn-icon" onclick="window.deleteSingleContactDirect('${c.id}', '${c.groupId}')" title="Delete Contact" style="padding: 4px 8px; color: var(--color-red); border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.08); border-radius: 6px; cursor: pointer;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
};

// Inline tag editor for contact in the main contacts table
window.inlineEditContactTag = function(contactId, currentTag, triggerEl) {
  // Remove any existing tag editor popups
  document.querySelectorAll('.inline-tag-editor').forEach(el => el.remove());

  const popup = document.createElement('div');
  popup.className = 'inline-tag-editor';
  popup.style.cssText = 'position:fixed; z-index:99999; background:var(--bg-surface,#18181b); border:1px solid var(--border-color,#27272a); border-radius:12px; padding:14px 16px; box-shadow:0 12px 40px rgba(0,0,0,0.6); min-width:240px;';

  // Position near trigger element
  const rect = triggerEl ? triggerEl.getBoundingClientRect() : { top: 200, left: 200, bottom: 220 };
  const top = Math.min(rect.bottom + 6, window.innerHeight - 160);
  const left = Math.min(rect.left, window.innerWidth - 260);
  popup.style.top = top + 'px';
  popup.style.left = left + 'px';

  // Fetch available tags from current contacts
  const allContacts = window.getAllContactsList ? window.getAllContactsList() : [];
  const uniqueTags = Array.from(new Set(allContacts.map(c => c.tag || 'Default'))).filter(Boolean);

  popup.innerHTML = `
    <div style="font-size:0.78rem; font-weight:800; color:var(--text-main,#fff); margin-bottom:10px;">🏷️ Edit Tag</div>
    <input type="text" id="inline-tag-input" value="${escapeHtml(currentTag)}" placeholder="Enter or type tag name..." 
      style="width:100%; background:rgba(255,255,255,0.05); border:1px solid var(--color-cyan,#06b6d4); color:var(--text-main,#fff); border-radius:8px; padding:7px 10px; font-size:0.85rem; box-sizing:border-box; outline:none; margin-bottom:8px;">
    <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:10px;">
      ${uniqueTags.map(t => `<span onclick="document.getElementById('inline-tag-input').value='${escapeHtml(t)}'" style="background:rgba(6,182,212,0.12); color:var(--color-cyan,#06b6d4); font-size:0.7rem; padding:3px 9px; border-radius:10px; cursor:pointer; border:1px solid rgba(6,182,212,0.3); font-weight:700;">${escapeHtml(t)}</span>`).join('')}
      <span onclick="document.getElementById('inline-tag-input').value='Interested'" style="background:rgba(16,185,129,0.12); color:#10b981; font-size:0.7rem; padding:3px 9px; border-radius:10px; cursor:pointer; border:1px solid rgba(16,185,129,0.3); font-weight:700;">✅ Interested</span>
      <span onclick="document.getElementById('inline-tag-input').value='Not Interested'" style="background:rgba(239,68,68,0.12); color:#ef4444; font-size:0.7rem; padding:3px 9px; border-radius:10px; cursor:pointer; border:1px solid rgba(239,68,68,0.3); font-weight:700;">❌ Not Interested</span>
    </div>
    <div style="display:flex; gap:7px;">
      <button onclick="document.querySelector('.inline-tag-editor').remove()" style="flex:1; padding:7px; border-radius:8px; background:rgba(255,255,255,0.06); border:1px solid var(--border-color,#27272a); color:var(--text-muted,#a1a1aa); font-weight:700; cursor:pointer; font-size:0.8rem;">Cancel</button>
      <button id="inline-tag-save-btn" style="flex:2; padding:7px; border-radius:8px; background:linear-gradient(135deg,var(--color-cyan,#06b6d4),#0891b2); border:none; color:#000; font-weight:800; cursor:pointer; font-size:0.8rem;">Save Tag</button>
    </div>
  `;

  document.body.appendChild(popup);
  document.getElementById('inline-tag-input').focus();

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closeHandler(e) {
      if (!popup.contains(e.target) && e.target !== triggerEl) {
        popup.remove();
        document.removeEventListener('click', closeHandler);
      }
    });
  }, 50);

  // Save handler
  document.getElementById('inline-tag-save-btn').onclick = async function() {
    const newTag = document.getElementById('inline-tag-input').value.trim();
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: newTag })
      });
      const data = await res.json();
      if (data.success) {
        popup.remove();
        // Update local cache and re-render
        for (const g of (localGroupsCache || [])) {
          const c = (g.contacts || []).find(c => c.id === contactId);
          if (c) { c.tag = newTag; break; }
        }
        window.renderAllContactsTable();
      } else {
        alert('Failed to update tag: ' + (data.error || 'Unknown'));
      }
    } catch(e) {
      alert('Network error: ' + e.message);
    }
  };
  // Also save on Enter key
  document.getElementById('inline-tag-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('inline-tag-save-btn').click();
  });
};

// Update a contact's tag by phone number (from call logs)
window.updateContactTagByPhone = async function(phone, tag, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.innerText = '⏳ Saving...'; }
  try {
    const res = await fetch('/api/contacts/by-phone', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, tag })
    });
    const data = await res.json();
    if (data.success) {
      if (btnEl) {
        btnEl.innerText = '✅ Tagged!';
        btnEl.style.background = 'rgba(16,185,129,0.15)';
        btnEl.style.color = '#10b981';
        btnEl.style.borderColor = 'rgba(16,185,129,0.3)';
        setTimeout(() => {
          if (btnEl.parentElement) { btnEl.innerText = `🏷️ ${tag}`; }
        }, 1500);
      }
      // Refresh contacts table if visible
      if (typeof fetchGroups === 'function') fetchGroups();
    } else {
      if (btnEl) { btnEl.disabled = false; btnEl.innerText = '🏷️ Tag'; }
      alert('Failed: ' + (data.error || 'Unknown error'));
    }
  } catch(e) {
    if (btnEl) { btnEl.disabled = false; btnEl.innerText = '🏷️ Tag'; }
    alert('Network error: ' + e.message);
  }
};

// Show a quick tag picker popup anchored to a button element (used from call log modals)
window.showQuickTagPicker = function(phone, anchorEl) {
  document.querySelectorAll('.quick-tag-picker').forEach(el => el.remove());

  const allContacts = window.getAllContactsList ? window.getAllContactsList() : [];
  const uniqueTags = Array.from(new Set(allContacts.map(c => c.tag || 'Default'))).filter(Boolean);

  const popup = document.createElement('div');
  popup.className = 'quick-tag-picker';
  const rect = anchorEl.getBoundingClientRect();
  const top = Math.max(rect.top - 180, 10);
  const left = Math.min(rect.left, window.innerWidth - 240);
  popup.style.cssText = `position:fixed; z-index:999999999; background:var(--bg-surface,#18181b); border:1px solid var(--border-color,#27272a); border-radius:12px; padding:12px 14px; box-shadow:0 12px 40px rgba(0,0,0,0.7); min-width:220px; top:${top}px; left:${left}px;`;

  popup.innerHTML = `
    <div style="font-size:0.76rem; font-weight:800; color:var(--text-muted,#a1a1aa); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">🏷️ Tag Contact: ${phone}</div>
    <div style="display:flex; flex-direction:column; gap:5px;">
      <span onclick="window.updateContactTagByPhone('${phone}', 'Interested', this); document.querySelector('.quick-tag-picker').remove();" style="background:rgba(16,185,129,0.12); color:#10b981; font-size:0.78rem; padding:7px 12px; border-radius:8px; cursor:pointer; border:1px solid rgba(16,185,129,0.3); font-weight:700;">✅ Interested</span>
      <span onclick="window.updateContactTagByPhone('${phone}', 'Not Interested', this); document.querySelector('.quick-tag-picker').remove();" style="background:rgba(239,68,68,0.12); color:#ef4444; font-size:0.78rem; padding:7px 12px; border-radius:8px; cursor:pointer; border:1px solid rgba(239,68,68,0.3); font-weight:700;">❌ Not Interested</span>
      <span onclick="window.updateContactTagByPhone('${phone}', 'Follow Up', this); document.querySelector('.quick-tag-picker').remove();" style="background:rgba(245,158,11,0.12); color:#f59e0b; font-size:0.78rem; padding:7px 12px; border-radius:8px; cursor:pointer; border:1px solid rgba(245,158,11,0.3); font-weight:700;">🔄 Follow Up</span>
      ${uniqueTags.map(t => `<span onclick="window.updateContactTagByPhone('${phone}', '${t.replace(/'/g, "\\'")}'  , this); document.querySelector('.quick-tag-picker').remove();" style="background:rgba(6,182,212,0.08); color:var(--color-cyan,#06b6d4); font-size:0.78rem; padding:7px 12px; border-radius:8px; cursor:pointer; border:1px solid rgba(6,182,212,0.2); font-weight:600;">🏷️ ${escapeHtml(t)}</span>`).join('')}
    </div>
    <div style="margin-top:10px; display:flex; gap:6px;">
      <input id="qtp-custom-input" type="text" placeholder="Custom tag..." style="flex:1; background:rgba(255,255,255,0.05); border:1px solid var(--border-color,#27272a); color:var(--text-main,#fff); border-radius:7px; padding:6px 9px; font-size:0.8rem; outline:none;">
      <button onclick="const v=document.getElementById('qtp-custom-input').value.trim(); if(v){window.updateContactTagByPhone('${phone}',v,this);document.querySelector('.quick-tag-picker').remove();}" style="padding:6px 10px; border-radius:7px; background:var(--color-cyan,#06b6d4); border:none; color:#000; font-weight:800; cursor:pointer; font-size:0.8rem;">+</button>
    </div>
  `;

  document.body.appendChild(popup);
  setTimeout(() => {
    document.addEventListener('click', function closeQTP(e) {
      if (!popup.contains(e.target) && e.target !== anchorEl) {
        popup.remove();
        document.removeEventListener('click', closeQTP);
      }
    });
  }, 50);
};

window.deleteSingleContactDirect = async function(contactId, groupId) {
  if (!confirm("Are you sure you want to delete this contact?")) return;
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/api/groups/${groupId}/contacts/${contactId}?clientId=${clientId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      fetchGroups();
    } else {
      alert("Failed to delete contact: " + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert("Error deleting contact: " + err.message);
  }
};

function renderGroupsTable(groups) {
  renderAllContactsTable();
}

window.viewGroupContacts = function(groupId) {
  const group = localGroupsCache.find(g => g.id === groupId);
  if (!group) return;
  
  const modal = document.getElementById('contacts-modal');
  if (modal) modal.dataset.groupId = groupId;
  
  const title = document.getElementById('contacts-modal-title');
  if (title) title.innerText = `Contacts in "${group.name}"`;
  
  renderModalContactsList(group);
  
  if (modal) modal.classList.add('active');
};

function renderModalContactsList(group) {
  const tbody = document.querySelector('#modal-contacts-table tbody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  if (group.contacts && group.contacts.length > 0) {
    group.contacts.forEach(c => {
      const tr = document.createElement('tr');
      tr.dataset.contactId = c.id;
      const tagDisplay = c.tag ? `<span style="background: rgba(6,182,212,0.12); color: var(--color-cyan); font-size: 0.75rem; padding: 2px 8px; border-radius: 20px; font-weight: 600; border: 1px solid rgba(6,182,212,0.3);">${escapeHtml(c.tag)}</span>` : `<span style="color: var(--text-muted); font-size: 0.75rem;">—</span>`;
      tr.innerHTML = `
        <td class="col-name">${escapeHtml(c.name || 'N/A')}</td>
        <td class="col-phone"><strong>${escapeHtml(c.phone || 'N/A')}</strong></td>
        <td class="col-tag">${tagDisplay}</td>
        <td style="text-align: right; width: 100px;">
          <button class="btn btn-secondary btn-icon" onclick="editContactInline('${c.id}', this)" title="Edit" style="padding: 4px 8px; margin-right: 4px;">✏️</button>
          <button class="btn btn-secondary btn-icon" onclick="deleteContactFromGroup('${c.id}')" title="Delete" style="padding: 4px 8px;">❌</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } else {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">No contacts in this group.</td></tr>';
  }
}

window.editContactInline = function(contactId, buttonEl) {
  const tr = buttonEl.closest('tr');
  const nameTd = tr.querySelector('.col-name');
  const phoneTd = tr.querySelector('.col-phone');
  const tagTd = tr.querySelector('.col-tag');
  
  const currentName = nameTd.textContent === 'N/A' ? '' : nameTd.textContent;
  const currentPhone = phoneTd.textContent === 'N/A' ? '' : phoneTd.textContent;
  
  let currentTag = '';
  const badge = tagTd.querySelector('span');
  if (badge) {
    currentTag = badge.textContent === '—' ? '' : badge.textContent.trim();
  } else {
    currentTag = tagTd.textContent === '—' ? '' : tagTd.textContent.trim();
  }
  
  nameTd.innerHTML = `<input type="text" class="edit-c-name" value="${escapeHtml(currentName)}" style="width: 100%; padding: 4px 8px; background: var(--bg-primary); border: 1px solid var(--color-cyan); color: var(--text-main); border-radius: 4px;">`;
  phoneTd.innerHTML = `<input type="text" class="edit-c-phone" value="${escapeHtml(currentPhone)}" style="width: 100%; padding: 4px 8px; background: var(--bg-primary); border: 1px solid var(--color-cyan); color: var(--text-main); border-radius: 4px; font-weight: bold;">`;
  tagTd.innerHTML = `<input type="text" class="edit-c-tag" value="${escapeHtml(currentTag)}" placeholder="e.g. sales" style="width: 100%; padding: 4px 8px; background: var(--bg-primary); border: 1px solid var(--color-cyan); color: var(--text-main); border-radius: 4px;">`;
  
  const actionTd = tr.querySelector('td:last-child');
  actionTd.innerHTML = `
    <button class="btn btn-secondary btn-icon" onclick="saveContactEdit('${contactId}', this)" title="Save" style="padding: 4px 8px; margin-right: 4px; color: var(--color-green);">💾</button>
    <button class="btn btn-secondary btn-icon" onclick="cancelContactEdit('${contactId}', this)" title="Cancel" style="padding: 4px 8px; color: var(--color-red);">❌</button>
  `;
};

window.cancelContactEdit = function(contactId, buttonEl) {
  const modal = document.getElementById('contacts-modal');
  const groupId = modal.dataset.groupId;
  const group = localGroupsCache.find(g => g.id === groupId);
  if (group) renderModalContactsList(group);
};

window.saveContactEdit = async function(contactId, buttonEl) {
  const tr = buttonEl.closest('tr');
  const nameInput = tr.querySelector('.edit-c-name');
  const phoneInput = tr.querySelector('.edit-c-phone');
  const tagInput = tr.querySelector('.edit-c-tag');
  
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const tag = tagInput ? tagInput.value.trim() : '';
  
  if (!phone) {
    alert("Phone number is required.");
    return;
  }
  
  try {
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, tag })
    });
    const data = await res.json();
    if (data.success) {
      // Update local cache
      const modal = document.getElementById('contacts-modal');
      const groupId = modal.dataset.groupId;
      const group = localGroupsCache.find(g => g.id === groupId);
      if (group) {
        const contact = group.contacts.find(c => c.id === contactId);
        if (contact) {
          contact.name = name;
          contact.phone = phone;
          contact.tag = tag;
        }
        renderModalContactsList(group);
      }
      fetchGroups(); // refresh main table count
    } else {
      alert("Error saving contact: " + data.error);
    }
  } catch (e) {
    alert("Network error updating contact.");
  }
};

window.deleteContactFromGroup = async function(contactId) {
  if (!confirm("Are you sure you want to delete this contact?")) return;
  
  try {
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      const modal = document.getElementById('contacts-modal');
      const groupId = modal.dataset.groupId;
      const group = localGroupsCache.find(g => g.id === groupId);
      if (group) {
        group.contacts = group.contacts.filter(c => c.id !== contactId);
        renderModalContactsList(group);
      }
      fetchGroups(); // refresh main table count
    } else {
      alert("Failed to delete contact.");
    }
  } catch (e) {
    alert("Error deleting contact.");
  }
};

window.addNewContactToGroup = async function() {
  const modal = document.getElementById('contacts-modal');
  const groupId = modal.dataset.groupId;
  if (!groupId) return;
  
  const nameInput = document.getElementById('new-contact-name');
  const phoneInput = document.getElementById('new-contact-phone');
  const tagInput = document.getElementById('new-contact-tag');
  
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const tag = tagInput ? tagInput.value.trim() : '';
  
  if (!phone) {
    alert("Please provide a Phone Number.");
    return;
  }
  
  try {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, name, phone, tag })
    });
    const data = await res.json();
    if (data.success) {
      nameInput.value = '';
      phoneInput.value = '';
      if (tagInput) tagInput.value = '';
      
      const group = localGroupsCache.find(g => g.id === groupId);
      if (group) {
        if (!group.contacts) group.contacts = [];
        group.contacts.push(data.contact);
        renderModalContactsList(group);
      }
      fetchGroups(); // refresh main table count
    } else {
      alert("Error adding contact: " + data.error);
    }
  } catch (e) {
    alert("Error adding contact.");
  }
};

window.populateSingleContactGroups = function(groups) {
  const select = document.getElementById('single-contact-group-select');
  if (!select) return;
  
  let html = '';
  if (groups.length > 0) {
    groups.forEach(g => {
      html += `<option value="${g.id}">${escapeHtml(g.name)}</option>`;
    });
  }
  html += `<option value="new_group">+ Create New Group...</option>`;
  select.innerHTML = html;
  
  // Toggle new group input visibility
  toggleNewGroupInput();
};

window.toggleNewGroupInput = function() {
  const select = document.getElementById('single-contact-group-select');
  const wrapper = document.getElementById('new-group-input-wrapper');
  if (!select || !wrapper) return;
  
  if (select.value === 'new_group') {
    wrapper.style.display = 'block';
  } else {
    wrapper.style.display = 'none';
  }
};

window.addSingleContactFromSidebar = async function() {
  const nameInput = document.getElementById('single-contact-name');
  const phoneInput = document.getElementById('single-contact-phone');
  const tagInput = document.getElementById('single-contact-tag');
  
  if (!nameInput || !phoneInput) return false;
  
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  let tag = tagInput ? tagInput.value.trim() : 'Default';
  if (!tag) tag = 'Default';
  
  if (!phone) {
    alert("Phone number is required.");
    return false;
  }
  
  try {
    const clientId = (loggedInUser && loggedInUser.id) ? loggedInUser.id : (window.CurrentClient?.id || (JSON.parse(localStorage.getItem('user_session') || '{}').id || ''));

    const res = await fetch('/api/contacts/single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, tag, clientId })
    });
    const data = await res.json();
    if (data.success) {
      nameInput.value = '';
      phoneInput.value = '';
      if (tagInput) tagInput.value = '';
      if (typeof fetchGroups === 'function') fetchGroups();
      alert("✅ Contact added successfully!");
      return true;
    } else {
      alert("Error adding contact: " + (data.error || 'Failed to save contact'));
      return false;
    }
  } catch (e) {
    console.error("Add single contact exception:", e);
    alert("Error adding contact: " + e.message);
    return false;
  }
};

// ─── Single Contact Modal V2 Event Handlers & Delegation ─────────────────────
window.openSingleContactModalV2 = function() {
  console.log('[Single Contact Modal V2] Opening modal...');
  const modal = document.getElementById('new-single-contact-modal');
  if (!modal) {
    console.error('[Single Contact Modal V2] Error: Element #new-single-contact-modal not found in DOM!');
    return;
  }
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  modal.style.setProperty('display', 'flex', 'important');
  modal.style.setProperty('opacity', '1', 'important');
  modal.style.setProperty('visibility', 'visible', 'important');
  modal.style.setProperty('z-index', '99999999', 'important');

  const n = document.getElementById('v2-contact-name');
  const p = document.getElementById('v2-contact-phone');
  const t = document.getElementById('v2-contact-tag');
  if (n) n.value = '';
  if (p) p.value = '';
  if (t) t.value = '';
  setTimeout(() => { if (n) n.focus(); }, 100);
};

window.closeSingleContactModalV2 = function() {
  const modal = document.getElementById('new-single-contact-modal');
  if (modal) {
    modal.style.setProperty('display', 'none', 'important');
  }
};

// Aliases for legacy button callers across app.js
window.openAddSingleContactModal = function() {
  window.openSingleContactModalV2();
};
window.closeAddSingleContactModal = function() {
  window.closeSingleContactModalV2();
};
window.submitSingleContactFromModal = function() {
  const form = document.getElementById('form-new-single-contact');
  if (form) form.requestSubmit();
};

// Global Event Delegation for V2 Single Contact Button & Modal Triggers
document.addEventListener('click', function(e) {
  const btnOpen = e.target.closest('#btn-open-single-contact-modal-v2') || e.target.closest('[onclick*="AddSingleContact"]');
  if (btnOpen) {
    e.preventDefault();
    e.stopPropagation();
    window.openSingleContactModalV2();
    return;
  }

  const btnClose = e.target.closest('#btn-close-single-contact-modal-v2') || e.target.closest('#btn-cancel-single-contact-v2');
  if (btnClose) {
    e.preventDefault();
    window.closeSingleContactModalV2();
    return;
  }

  const modalOverlay = document.getElementById('new-single-contact-modal');
  if (modalOverlay && e.target === modalOverlay) {
    window.closeSingleContactModalV2();
  }
});

// Form Submit Handler for V2 Single Contact Modal
document.addEventListener('submit', async function(e) {
  if (e.target && e.target.id === 'form-new-single-contact') {
    e.preventDefault();
    e.stopPropagation();

    const btnSubmit = document.getElementById('btn-save-single-contact-v2');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerText = '💾 Saving...';
    }

    const name = (document.getElementById('v2-contact-name')?.value || '').trim();
    const phone = (document.getElementById('v2-contact-phone')?.value || '').trim();
    let tag = (document.getElementById('v2-contact-tag')?.value || '').trim();
    if (!tag) tag = 'Default';

    if (!phone) {
      alert("Phone number is required.");
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerText = '💾 Save Contact';
      }
      return;
    }

    try {
      const clientId = (loggedInUser && loggedInUser.id) ? loggedInUser.id : (window.CurrentClient?.id || (JSON.parse(localStorage.getItem('user_session') || '{}').id || ''));

      const res = await fetch('/api/contacts/single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, tag, clientId })
      });

      const data = await res.json();

      if (data.success) {
        window.closeSingleContactModalV2();
        if (typeof fetchGroups === 'function') fetchGroups();
        alert("✅ Contact added successfully!");
      } else {
        alert("Error adding contact: " + (data.error || 'Failed to save contact'));
      }
    } catch(err) {
      console.error("Save Single Contact V2 Error:", err);
      alert("Error adding contact: " + err.message);
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerText = '💾 Save Contact';
      }
    }
  }
});

// Event listener to close modal
document.getElementById('btn-close-contacts-modal')?.addEventListener('click', () => {
  document.getElementById('contacts-modal')?.classList.remove('active');
});

// Close modal on clicking outside the content area
document.getElementById('contacts-modal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    e.target.classList.remove('active');
  }
});

window.deleteGroup = async function(id) {
  if (!confirm("Are you sure you want to delete this group? All contacts within it will be removed.")) return;
  try {
    const res = await fetch(`/api/groups/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) fetchGroups();
  } catch (e) {
    alert("Failed to delete group");
  }
}

let pendingContacts = [];

// Redefine File Upload behavior to extract CSV/Excel only
document.getElementById('campaign-file-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const uploadStatus = document.getElementById('upload-status');
  if (!file) return;

  pendingContacts = [];
  uploadStatus.innerText = "Processing...";
  document.getElementById('btn-save-contacts').disabled = true;

  if (file.name.endsWith('.csv')) {
    // Read CSV
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const rows = text.split('\n');
      const headers = rows[0].split(',').map(h => h.trim().toLowerCase());
      const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('number') || h.includes('mobile') || h.includes('contact'));
      const nameIdx = headers.findIndex(h => h.includes('name'));

      if (phoneIdx === -1 && rows.length > 1) {
        // Fallback: Check columns
        rows.forEach((r, idx) => {
          if (idx === 0 && (r.toLowerCase().includes('name') || r.toLowerCase().includes('phone'))) return;
          const cols = r.split(',');
          let p = cols[0] ? cols[0].trim() : '';
          let n = cols[1] ? cols[1].trim() : '';
          if (/[a-zA-Z]/.test(p) && /^[\d\s\-\(\)\+]+$/.test(n)) {
            const tmp = p; p = n; n = tmp;
          }
          if (p && p.length >= 7) {
            pendingContacts.push({ phone: p, name: n });
          }
        });
      } else {
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i].split(',');
          if (cols[phoneIdx] && cols[phoneIdx].trim()) {
            let p = cols[phoneIdx].trim();
            let n = nameIdx !== -1 && cols[nameIdx] ? cols[nameIdx].trim() : '';
            if (/[a-zA-Z]/.test(p) && /^[\d\s\-\(\)\+]+$/.test(n)) {
              const tmp = p; p = n; n = tmp;
            }
            pendingContacts.push({ phone: p, name: n });
          }
        }
      }
      
      uploadStatus.innerText = `Ready to save: Found ${pendingContacts.length} valid contacts.`;
      if (pendingContacts.length > 0) document.getElementById('btn-save-contacts').disabled = false;
    };
    reader.readAsText(file);
  } else {
    uploadStatus.innerText = "Error: Only .csv files are supported in this demo.";
  }
});

document.getElementById('btn-save-contacts')?.addEventListener('click', async () => {
  const groupName = document.getElementById('contact-group-name').value.trim();
  if (!groupName) {
    alert("Please provide a Group Name.");
    return;
  }
  
  if (pendingContacts.length === 0) {
    alert("No valid contacts found in file.");
    return;
  }
  
  document.getElementById('btn-save-contacts').disabled = true;
  document.getElementById('btn-save-contacts').innerText = "Uploading...";
  
  try {
    // 1. Create Group
    const clientId = (loggedInUser && loggedInUser.id) ? loggedInUser.id : (window.CurrentClient?.id || (JSON.parse(localStorage.getItem('user_session') || '{}').id || ''));
    const grpRes = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: groupName, clientId })
    });
    const grpData = await grpRes.json();
    
    if (grpData.success) {
      // 2. Upload Contacts
      const contactRes = await fetch('/api/contacts/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: grpData.group.id, contacts: pendingContacts })
      });
      const contactData = await contactRes.json();
      if (contactData.success) {
        alert(`Successfully saved ${contactData.added} contacts to group "${groupName}".`);
        document.getElementById('contact-group-name').value = '';
        document.getElementById('campaign-file-input').value = '';
        document.getElementById('upload-status').innerText = '';
        fetchGroups();
      }
    }
  } catch(e) {
    alert("Error uploading contacts.");
  } finally {
    document.getElementById('btn-save-contacts').innerText = "Upload & Save Group";
  }
});

// --- 3. DROPDOWNS FOR BROADCAST & QUICK CALL ---
async function fetchAgentsForDropdowns() {
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/api/agents?clientId=${clientId}`);
    const data = await res.json();
    if (data.success) {
      const qSelect = document.getElementById('quick-agent-select');
      const bSelect = document.getElementById('broadcast-agent-select');
      const iSelect = document.getElementById('incoming-agent-select');
      const routingDefault = document.getElementById('incoming-routing-default-agent');
      const newTagAgent = document.getElementById('new-tag-rule-agent');

      let opts = '<option value="">-- Choose Agent --</option>';
      data.agents.forEach(a => {
        opts += `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.voice)})</option>`;
      });

      if (qSelect) qSelect.innerHTML = opts;
      if (bSelect) bSelect.innerHTML = opts;
      if (newTagAgent) newTagAgent.innerHTML = opts;

      if (iSelect) {
        let incomingOpts = '<option value="">-- Use Default Settings Below --</option>';
        data.agents.forEach(a => {
          incomingOpts += `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.voice)})</option>`;
        });
        iSelect.innerHTML = incomingOpts;
        const cachedVal = localStorage.getItem('gemini_incoming_agent_id');
        if (cachedVal) iSelect.value = cachedVal;
      }

      // Populate routing default agent dropdown
      if (routingDefault) {
        let defOpts = '<option value="">-- No default agent --</option>';
        data.agents.forEach(a => {
          defOpts += `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.voice)})</option>`;
        });
        routingDefault.innerHTML = defOpts;

        // Load current default from server config
        try {
          const cfgRes = await fetch('/api/routing-config');
          const cfgData = await cfgRes.json();
          if (cfgData.success) {
            routingDefault.value = cfgData.incomingAgentId || '';
            renderTagRoutingRules(cfgData.tagRules || [], data.agents);
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
}

// ─── INCOMING CALL ROUTING MANAGEMENT ─────────────────────────────────────────

let _routingAgentsList = []; // local cache of agents for rule rendering

async function loadRoutingConfig() {
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const [agentsRes, cfgRes] = await Promise.all([
      fetch(`/api/agents?clientId=${clientId}`),
      fetch(`/api/routing-config?client_id=${clientId}`)
    ]);
    const agentsData = await agentsRes.json();
    const cfgData = await cfgRes.json();
    if (agentsData.success) _routingAgentsList = agentsData.agents;
    if (cfgData.success) {
      const sel = document.getElementById('incoming-routing-default-agent');
      if (sel) sel.value = cfgData.incomingAgentId || '';
      renderTagRoutingRules(cfgData.tagRules || [], _routingAgentsList);
    }
  } catch(e) {}
}

function renderTagRoutingRules(rules, agents) {
  _routingAgentsList = agents || _routingAgentsList;
  const tbody = document.getElementById('tag-routing-rules-body');
  if (!tbody) return;
  const emptyRow = document.getElementById('tag-rules-empty-row');

  if (!rules || rules.length === 0) {
    tbody.innerHTML = '<tr id="tag-rules-empty-row"><td colspan="3" style="text-align:center;padding:18px;color:var(--text-muted);font-size:0.82rem;font-style:italic;">No rules yet — add one above.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  rules.forEach((rule, i) => {
    const agentObj = _routingAgentsList.find(a => a.id === rule.agentId);
    const agentLabel = agentObj ? `${escapeHtml(agentObj.name)} <span style="color:var(--text-muted);font-size:0.75rem;">(${escapeHtml(agentObj.voice)})</span>` : `<span style="color:var(--text-muted);">${escapeHtml(rule.agentId)}</span>`;
    const tr = document.createElement('tr');
    tr.style.borderTop = '1px solid var(--border-color)';
    tr.innerHTML = `
      <td style="padding:10px 12px;">
        <span style="background:rgba(6,182,212,0.12);color:var(--color-cyan);font-size:0.78rem;padding:3px 10px;border-radius:20px;font-weight:600;border:1px solid rgba(6,182,212,0.3);">${escapeHtml(rule.tag)}</span>
      </td>
      <td style="padding:10px 12px;font-size:0.85rem;color:var(--text-main);">${agentLabel}</td>
      <td style="padding:10px 12px;text-align:center;">
        <button onclick="window.removeTagRoutingRule(${i})" title="Remove rule" style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:0.8rem;transition:all .2s;" onmouseover="this.style.background='rgba(239,68,68,0.25)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.addTagRoutingRule = async function() {
  const tagInput = document.getElementById('new-tag-rule-tag');
  const agentSel = document.getElementById('new-tag-rule-agent');
  if (!tagInput || !agentSel) return;

  const tag = tagInput.value.trim().toLowerCase();
  const agentId = agentSel.value;
  if (!tag) { alert('Please enter a tag name.'); return; }
  if (!agentId) { alert('Please select an agent.'); return; }

  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const cfgRes = await fetch(`/api/routing-config?client_id=${clientId}`);
    const cfgData = await cfgRes.json();
    const rules = cfgData.success ? (cfgData.tagRules || []) : [];

    // Prevent duplicate tag
    if (rules.find(r => r.tag === tag)) {
      alert(`A rule for tag "${tag}" already exists. Remove it first.`);
      return;
    }

    rules.push({ tag, agentId });

    const saveRes = await fetch(`/api/routing-config?client_id=${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, tagRules: rules })
    });
    const saveData = await saveRes.json();
    if (saveData.success) {
      tagInput.value = '';
      agentSel.value = '';
      renderTagRoutingRules(rules, _routingAgentsList);
    } else {
      alert('Error saving rule.');
    }
  } catch(e) {
    alert('Error adding rule.');
  }
};

window.removeTagRoutingRule = async function(index) {
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const cfgRes = await fetch(`/api/routing-config?client_id=${clientId}`);
    const cfgData = await cfgRes.json();
    const rules = cfgData.success ? (cfgData.tagRules || []) : [];
    rules.splice(index, 1);
    const saveRes = await fetch(`/api/routing-config?client_id=${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, tagRules: rules })
    });
    const saveData = await saveRes.json();
    if (saveData.success) renderTagRoutingRules(rules, _routingAgentsList);
  } catch(e) {
    alert('Error removing rule.');
  }
};

document.getElementById('btn-save-default-incoming-agent')?.addEventListener('click', async () => {
  const sel = document.getElementById('incoming-routing-default-agent');
  const agentId = sel ? sel.value : '';
  const statusEl = document.getElementById('default-agent-save-status');
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/api/routing-config?client_id=${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, incomingAgentId: agentId })
    });
    const data = await res.json();
    if (data.success) {
      if (statusEl) {
        statusEl.style.display = 'block';
        setTimeout(() => { statusEl.style.display = 'none'; }, 2500);
      }
    } else {
      alert('Error saving default agent.');
    }
  } catch(e) {
    alert('Error saving default agent.');
  }
});

// ──────────────────────────────────────────────────────────────────────────────

window.broadcastMode = 'now';

window.setBroadcastMode = function(mode) {
  window.broadcastMode = mode;
  const btnNow = document.getElementById('btn-mode-now');
  const btnSchedule = document.getElementById('btn-mode-schedule');
  const wrapper = document.getElementById('broadcast-schedule-wrapper');

  if (mode === 'now') {
    if (btnNow) {
      btnNow.style.borderColor = 'var(--color-cyan)';
      btnNow.style.background = 'rgba(6, 182, 212, 0.15)';
      btnNow.style.color = 'var(--color-cyan)';
      btnNow.style.fontWeight = '700';
    }
    if (btnSchedule) {
      btnSchedule.style.borderColor = 'var(--border-color)';
      btnSchedule.style.background = 'var(--bg-surface)';
      btnSchedule.style.color = 'var(--text-muted)';
      btnSchedule.style.fontWeight = '600';
    }
    if (wrapper) wrapper.style.display = 'none';
  } else {
    if (btnSchedule) {
      btnSchedule.style.borderColor = 'var(--color-cyan)';
      btnSchedule.style.background = 'rgba(6, 182, 212, 0.15)';
      btnSchedule.style.color = 'var(--color-cyan)';
      btnSchedule.style.fontWeight = '700';
    }
    if (btnNow) {
      btnNow.style.borderColor = 'var(--border-color)';
      btnNow.style.background = 'var(--bg-surface)';
      btnNow.style.color = 'var(--text-muted)';
      btnNow.style.fontWeight = '600';
    }
    if (wrapper) wrapper.style.display = 'block';
  }
};

window.updateBroadcastAudienceBadge = function() {
  const select = document.getElementById('broadcast-group-select');
  const countEl = document.getElementById('broadcast-target-count');
  if (!select || !countEl) return;

  const targetVal = select.value;
  const allContacts = window.getAllContactsList ? window.getAllContactsList() : [];

  if (targetVal === 'all') {
    countEl.innerText = allContacts.length;
  } else if (targetVal.startsWith('tag_')) {
    const tagName = targetVal.replace('tag_', '');
    const count = allContacts.filter(c => (c.tag || 'Default').toLowerCase() === tagName.toLowerCase()).length;
    countEl.innerText = count;
  } else {
    const group = (localGroupsCache || []).find(g => g.id === targetVal);
    countEl.innerText = group && group.contacts ? group.contacts.length : 0;
  }
};

async function fetchGroupsForDropdowns() {
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/api/groups?clientId=${clientId}`);
    const data = await res.json();
    if (data.success) {
      localGroupsCache = data.groups;
      const bSelect = document.getElementById('broadcast-group-select');
      const allContacts = window.getAllContactsList ? window.getAllContactsList() : [];

      let opts = `<option value="all" selected>👥 All Contacts (${allContacts.length} total)</option>`;

      const uniqueTags = Array.from(new Set(allContacts.map(c => c.tag || 'Default'))).filter(Boolean);
      uniqueTags.forEach(t => {
        const count = allContacts.filter(c => (c.tag || 'Default') === t).length;
        opts += `<option value="tag_${escapeHtml(t)}">🏷️ Tag: ${escapeHtml(t)} (${count} contacts)</option>`;
      });

      if (bSelect) {
        bSelect.innerHTML = opts;
        window.updateBroadcastAudienceBadge();
      }
    }
  } catch (e) {}
}

window.handleStartBroadcastClick = async function() {
  const agentId = document.getElementById('broadcast-agent-select').value;
  const targetVal = document.getElementById('broadcast-group-select').value;
  const publicUrl = document.getElementById('public-url')?.value || '';
  const mode = window.broadcastMode || 'now';
  const scheduleTime = document.getElementById('broadcast-schedule-time')?.value || '';

  if (!agentId) {
    alert("Please select an AI Agent.");
    return;
  }

  if (mode === 'schedule' && !scheduleTime) {
    alert("Please select a valid Date & Time for scheduled broadcast.");
    return;
  }

  const allContacts = window.getAllContactsList ? window.getAllContactsList() : [];
  let targetContacts = allContacts;
  let targetLabel = "All Contacts";

  if (targetVal.startsWith('tag_')) {
    const tagName = targetVal.replace('tag_', '');
    targetContacts = allContacts.filter(c => (c.tag || 'Default').toLowerCase() === tagName.toLowerCase());
    targetLabel = `Tag: ${tagName}`;
  } else if (targetVal !== 'all') {
    const group = (localGroupsCache || []).find(g => g.id === targetVal);
    if (group) {
      targetContacts = group.contacts || [];
      targetLabel = `Group: ${group.name}`;
    }
  }

  if (targetContacts.length === 0) {
    alert("No contacts found in selected audience target.");
    return;
  }

  const actionMsg = mode === 'schedule' 
    ? `Schedule broadcast for ${targetContacts.length} contacts on ${new Date(scheduleTime).toLocaleString()}?`
    : `Start bulk calling ${targetContacts.length} contacts right now?`;

  if (!confirm(actionMsg)) return;

  const payload = {
    agentId,
    targetType: targetVal,
    targetLabel,
    mode,
    scheduledAt: mode === 'schedule' ? scheduleTime : null,
    publicUrl,
    clientId: loggedInUser ? loggedInUser.id : null,
    exotelApiKey: elExotelApiKey?.value || '',
    exotelApiToken: elExotelApiToken?.value || '',
    exotelAccountSid: elExotelAccountSid?.value || '',
    exotelSubdomain: elExotelSubdomain?.value || '',
    exotelCallerId: elExotelCallerId?.value || '',
    vobizAuthId: elVobizAuthId?.value || '',
    vobizAuthToken: elVobizAuthToken?.value || '',
    vobizCallerId: elVobizCallerId?.value || ''
  };

  try {
    const res = await fetch('/api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message || (mode === 'schedule' ? '✅ Broadcast Scheduled Successfully!' : '⚡ Broadcast Started Successfully!'));
      window.fetchRecentBroadcasts();
    } else {
      alert("Failed to start broadcast: " + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert("Error starting broadcast: " + err.message);
  }
};

window.fetchRecentBroadcasts = async function() {
  try {
    let clientId = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.id || currentUser.email) : '';
    if (!clientId && typeof loggedInUser !== 'undefined' && loggedInUser) {
      clientId = loggedInUser.id;
    }
    const res = await fetch(`/api/broadcasts?clientId=${encodeURIComponent(clientId || '')}`);
    const data = await res.json();
    if (data.success) {
      window.renderRecentBroadcastsTable(data.broadcasts || []);
    }
  } catch (e) {
    console.error("Failed to fetch recent broadcasts", e);
  }
};

window.renderRecentBroadcastsTable = function(broadcasts) {
  const tbody = document.getElementById('recent-broadcasts-table-body');
  if (!tbody) return;

  if (!broadcasts || broadcasts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 3.5rem 1.5rem; color: var(--text-muted);">
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1.5rem 0;">
            <div style="width: 54px; height: 54px; border-radius: 16px; background: linear-gradient(135deg, rgba(139, 92, 246, 0.12), rgba(6, 182, 212, 0.12)); border: 1px solid rgba(139, 92, 246, 0.25); display: flex; align-items: center; justify-content: center; margin-bottom: 12px; box-shadow: 0 4px 20px rgba(139, 92, 246, 0.15);">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-violet)" stroke-width="2" style="width: 24px; height: 24px;"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9c3.9 3.9 3.9 10.3 0 14.2"/></svg>
            </div>
            <h4 style="color: var(--text-main); font-size: 1rem; font-weight: 700; margin: 0 0 4px 0;">No Broadcast Campaigns Yet</h4>
            <p style="font-size: 0.82rem; color: var(--text-muted); margin: 0; max-width: 320px; line-height: 1.5;">Select an AI agent & target audience on the left to launch your first automated voice broadcast campaign.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  let html = '';
  broadcasts.forEach(b => {
    const dateStr = b.scheduledAt ? new Date(b.scheduledAt).toLocaleString() : new Date(b.createdAt).toLocaleString();
    let statusPill = '';
    if (b.status === 'running') {
      statusPill = `<span style="background: rgba(6,182,212,0.15); color: var(--color-cyan); font-size: 0.72rem; padding: 3px 8px; border-radius: 10px; font-weight: 700; border: 1px solid var(--color-cyan);">RUNNING</span>`;
    } else if (b.status === 'scheduled') {
      statusPill = `<span style="background: rgba(234,179,8,0.15); color: #eab308; font-size: 0.72rem; padding: 3px 8px; border-radius: 10px; font-weight: 700; border: 1px solid #eab308;">SCHEDULED</span>`;
    } else if (b.status === 'completed') {
      statusPill = `<span style="background: rgba(16,185,129,0.15); color: #10b981; font-size: 0.72rem; padding: 3px 8px; border-radius: 10px; font-weight: 700; border: 1px solid #10b981;">COMPLETED</span>`;
    } else {
      statusPill = `<span style="background: rgba(239,68,68,0.15); color: #ef4444; font-size: 0.72rem; padding: 3px 8px; border-radius: 10px; font-weight: 700; border: 1px solid #ef4444;">${escapeHtml((b.status || '').toUpperCase())}</span>`;
    }

    html += `
      <tr>
        <td style="font-weight: 600; color: var(--text-main); font-size: 0.88rem;">
          <div>${escapeHtml(b.agentName || 'AI Agent')}</div>
          <div style="font-size: 0.75rem; color: var(--color-cyan); font-weight: 500; margin-top: 2px;">Target: ${escapeHtml(b.targetLabel || 'All Contacts')}</div>
        </td>
        <td style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">
          ${b.mode === 'schedule' ? '📅 Scheduled' : '⚡ Instant'}
        </td>
        <td>
          <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-main);">${b.dialedCount || 0} / ${b.totalContacts || 0}</span>
        </td>
        <td style="color: var(--text-muted); font-size: 0.8rem;">${dateStr}</td>
        <td>${statusPill}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button onclick="window.viewBroadcastCallLogs('${b.id}')" title="View Call Logs & Recordings" style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); color: #10b981; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; cursor: pointer; margin-right: 6px;">
            🎙 Call Logs & Recordings
          </button>
          <button onclick="window.deleteBroadcastDirect('${b.id}')" title="Cancel/Delete" style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; cursor: pointer;">
            Delete
          </button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
};

window.viewBroadcastCallLogs = function(bId) {
  // Navigate to Callings tab to listen to call recordings and view full AI analysis
  const callingsTabBtn = document.querySelector('[data-tab="callings"]') || document.querySelector('button[onclick*="callings"]');
  if (callingsTabBtn) {
    callingsTabBtn.click();
  } else if (typeof window.switchTab === 'function') {
    window.switchTab('callings');
  }
};

window.deleteBroadcastDirect = async function(id) {
  if (!confirm("Are you sure you want to delete this broadcast campaign record?")) return;
  try {
    const res = await fetch(`/api/broadcasts/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      window.fetchRecentBroadcasts();
    } else {
      alert("Failed to delete broadcast: " + data.error);
    }
  } catch (err) {
    alert("Error deleting broadcast: " + err.message);
  }
};

// --- 5. QUICK CALL ACTION ---
document.getElementById('btn-dial-phone')?.addEventListener('click', async () => {
  const number = document.getElementById('telephony-number').value.trim();
  const agentId = document.getElementById('quick-agent-select').value;
  const provider = document.getElementById('telephony-provider').value;
  const publicUrl = (document.getElementById('public-url') && document.getElementById('public-url').value.trim()) || window.location.origin;
  
  if (!number) {
    alert("Please enter a destination phone number.");
    return;
  }
  
  if (!agentId) {
    alert("Please select an Agent for this call.");
    return;
  }
  
  // We need to fetch the specific agent's config to pass it
  let agentConfig = null;
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/api/agents?clientId=${clientId}`);
    const data = await res.json();
    agentConfig = data.agents.find(a => a.id === agentId);
  } catch(e) {}
  
  if (!agentConfig) {
    alert("Failed to load agent profile.");
    return;
  }

  let finalInstruction = agentConfig.systemInstruction;
  if (agentConfig.name) {
    finalInstruction = `[IDENTITY DIRECTIVE: Your name is "${agentConfig.name}". You must introduce yourself as "${agentConfig.name}" and identify as "${agentConfig.name}" if asked for your name. In Hindi/Hinglish, you can say "Mera naam ${agentConfig.name} hai".]\n\n` + finalInstruction;
  }
  if (agentConfig.mood && agentConfig.mood !== 'Professional') {
    finalInstruction = `[MOOD DIRECTIVE: You must act and speak in a ${agentConfig.mood.toUpperCase()} mood at all times.]\n\n` + finalInstruction;
  }

  const payload = {
    provider: provider,
    to: number,
    publicUrl: publicUrl,
    voice: agentConfig.voice,
    systemInstruction: finalInstruction,
    recordCall: elRecordCall.checked,
    
    exotelApiKey: elExotelApiKey.value,
    exotelApiToken: elExotelApiToken.value,
    exotelAccountSid: elExotelAccountSid.value,
    exotelSubdomain: elExotelSubdomain.value,
    exotelCallerId: elExotelCallerId.value,
    
    vobizAuthId: document.getElementById('calling-vobiz-auth-id').value || elVobizAuthId.value,
    vobizAuthToken: document.getElementById('calling-vobiz-auth-token').value || elVobizAuthToken.value,
    vobizCallerId: document.getElementById('calling-vobiz-caller-id').value || elVobizCallerId.value,
    clientId: loggedInUser ? loggedInUser.id : null
  };

  try {
    const response = await fetch('/make-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.success) {
      alert("Call initiated successfully!");
      // Switch to dashboard tab
      document.querySelector('.glass-navbar .nav-btn[data-tab="tab-recordings"]').click();
    } else {
      alert("Failed to initiate call: " + data.error);
    }
  } catch (error) {
    alert("Network error: " + error.message);
  }
});


// ================================================================
// FULL-PAGE CALL HISTORY OVERLAY
// ================================================================
const elHistoryOverlay  = document.getElementById('history-overlay');
const elBtnToggleHistory= document.getElementById('btn-toggle-history');
const elBtnCloseHistory = document.getElementById('btn-close-history');
const elHistoryCallsList= document.getElementById('history-calls-list');
const elHistoryStatsBar = document.getElementById('history-stats-bar');
const elHistorySearch   = document.getElementById('history-search');
const elHdDetailEmpty   = document.getElementById('history-detail-empty');
const elHdDetailPanel   = document.getElementById('history-detail-panel');
const elHdAvatar        = document.getElementById('hd-avatar');
const elHdName          = document.getElementById('hd-name');
const elHdPhone         = document.getElementById('hd-phone');
const elHdProvider      = document.getElementById('hd-provider');
const elHdDate          = document.getElementById('hd-date');
const elHdDuration      = document.getElementById('hd-duration');
const elHdStatus        = document.getElementById('hd-status');
const elHdRecording     = document.getElementById('hd-recording');
const elHdSummary       = document.getElementById('hd-summary');
const elHdTranscriptSec = document.getElementById('hd-transcript-section');
const elHdTranscript    = document.getElementById('hd-transcript');
const elHdTranscriptBtn = document.getElementById('hd-transcript-toggle');

let historySelectedSid  = null;
let historySearchQuery  = '';

function openHistoryOverlay() {
  document.querySelectorAll('.glass-navbar .nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  
  const pane = document.getElementById('tab-call-history');
  if (pane) pane.classList.add('active');
  
  localStorage.setItem('activeTab', 'tab-call-history');
  document.documentElement.setAttribute('data-active-tab', 'tab-call-history');
  
  renderHistoryList();
}

function closeHistoryOverlay() {
  document.querySelectorAll('.glass-navbar .nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  
  const dashBtn = document.getElementById('nav-dashboard');
  if (dashBtn) dashBtn.classList.add('active');
  const pane = document.getElementById('tab-recordings');
  if (pane) pane.classList.add('active');
  
  localStorage.setItem('activeTab', 'tab-recordings');
  document.documentElement.setAttribute('data-active-tab', 'tab-recordings');
}

function refreshHistoryIfOpen() {
  const tab = document.getElementById('tab-call-history');
  if (tab && tab.classList.contains('active')) {
    renderHistoryList();
    if (historySelectedSid) renderHistoryDetail(historySelectedSid);
  }
  // Update header button indicator
  if (elBtnToggleHistory) {
    if (callsCache.length > 0) {
      elBtnToggleHistory.classList.add('has-calls');
    } else {
      elBtnToggleHistory.classList.remove('has-calls');
    }
  }
}

function getInitials(name, phone) {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]) : parts[0].substring(0, 2);
  }
  return phone ? phone.replace(/\D/g, '').slice(-2) : '??';
}

function isCallTrulyActive(call) {
  if (!call) return false;
  const status = (call.status || '').toLowerCase();
  if (status !== 'active' && status !== 'calling' && status !== 'in-progress' && status !== 'ringing') return false;
  const startStr = call.startedAt || call.createdAt;
  if (!startStr) return false;
  const start = new Date(startStr).getTime();
  if (isNaN(start)) return false;
  // If call started > 15 minutes ago, it is a stale/ghost call
  if ((Date.now() - start) > 15 * 60 * 1000) return false;
  return true;
}

function formatDuration(call) {
  const startStr = call.startedAt || call.createdAt;
  if (!startStr || call.status === 'calling') return '—';
  const start = new Date(startStr);
  let end = new Date();
  
  const isStale = (Date.now() - start.getTime()) > (15 * 60 * 1000);
  
  // If call is completed/failed or stale (>15m old), calculate cleanly without running clock
  if (call.status === 'completed' || call.status === 'failed' || isStale) {
    const endStr = call.endedAt || call.updatedAt;
    if (endStr && !isStale) {
      end = new Date(endStr);
    } else {
      return '—';
    }
  }

  // Ensure end is not before start
  if (end < start) end = start;

  let seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds > 900) seconds = 900;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

window.terminateHistoryCall = async function(callSid) {
  if (!confirm('Are you sure you want to end this active call?')) return;
  try {
    const res = await fetch(`/api/calls/${callSid}/end`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      // The websocket disconnect will naturally update the state to completed eventually.
      // Let's do a fast local update for immediate feedback
      const call = callsCache.find(c => c.callSid === callSid);
      if (call) call.status = 'completed';
      refreshHistoryIfOpen();
    } else {
      alert('Failed to end call: ' + data.error);
    }
  } catch (err) {
    alert('Network error: ' + err.message);
  }
}

window.deleteCall = async function(callSid) {
  if (!confirm('Are you sure you want to delete this call from history?')) return;
  try {
    const res = await fetch(`/api/calls/${callSid}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      // Remove from local cache
      callsCache = callsCache.filter(c => c.callSid !== callSid);
      
      // Update the left list
      renderHistoryList();
      
      // If the currently open detail panel has no more calls for that number, close it or re-render
      if (historySelectedSid) {
        const remainingForGroup = callsCache.filter(c => c.to === historySelectedSid);
        if (remainingForGroup.length === 0) {
          if (elHdDetailEmpty) elHdDetailEmpty.style.display = 'flex';
          if (elHdDetailPanel) elHdDetailPanel.style.display = 'none';
        } else {
          renderHistoryDetail(historySelectedSid);
        }
      }
    } else {
      alert('Failed to delete call: ' + data.error);
    }
  } catch (err) {
    alert('Network error: ' + err.message);
  }
}

window.deleteHistoryGroup = async function(event, phone) {
  event.stopPropagation();
  if (!confirm('Are you sure you want to delete ALL calls for this number?')) return;
  try {
    const res = await fetch('/api/calls/group/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (data.success) {
      // Remove from local cache
      callsCache = callsCache.filter(c => c.to !== phone);
      
      renderHistoryList();
      
      // If we just deleted the group we are currently viewing, clear the right panel
      if (historySelectedSid === phone) {
        if (elHdDetailEmpty) elHdDetailEmpty.style.display = 'flex';
        if (elHdDetailPanel) elHdDetailPanel.style.display = 'none';
        historySelectedSid = null;
      }
    } else {
      alert('Failed to delete calls: ' + data.error);
    }
  } catch (err) {
    alert('Network error: ' + err.message);
  }
}

function getCallCustomerNumber(call) {
  if (!call) return 'Unknown';
  if (call.customerNumber) return String(call.customerNumber).trim();
  if (call.direction === 'incoming') {
    return String(call.from || call.to || 'Unknown').trim();
  }
  return String(call.to || call.from || 'Unknown').trim();
}

function renderHistoryList() {
  if (!elHistoryCallsList) return;

  const filtered = callsCache.filter(c => {
    if (!historySearchQuery) return true;
    const q = historySearchQuery.toLowerCase();
    const custNum = getCallCustomerNumber(c);
    return (c.name || '').toLowerCase().includes(q) || (c.to || '').includes(q) || (c.from || '').includes(q) || custNum.includes(q) || (c.provider || '').includes(q);
  });

  // Group by phone number
  const groups = new Map();
  filtered.forEach(call => {
    const key = getCallCustomerNumber(call);
    if (!groups.has(key)) {
      groups.set(key, { to: key, name: call.name || '', calls: [] });
    }
    // Update name if we found a non-empty name
    if (call.name && !groups.get(key).name) {
      groups.get(key).name = call.name;
    }
    groups.get(key).calls.push(call);
  });

  const groupedArray = Array.from(groups.values());
  groupedArray.forEach(g => {
    g.calls.sort((a,b) => new Date(b.createdAt || b.startedAt || 0) - new Date(a.createdAt || a.startedAt || 0));
    g.latestCall = g.calls[0];
    g.latestDate = new Date(g.latestCall.createdAt || g.latestCall.startedAt || 0);
  });
  groupedArray.sort((a,b) => b.latestDate - a.latestDate);

  // Stats
  if (elHistoryStatsBar) {
    const total = callsCache.length;
    const active = callsCache.filter(c => c.status === 'active' || c.status === 'calling').length;
    const completed = callsCache.filter(c => c.status === 'completed').length;
    const failed = callsCache.filter(c => c.status === 'failed' || c.status === 'voicemail').length;
    const nums = [total, active, completed, failed];
    const existing = elHistoryStatsBar.querySelectorAll('.ch-stat-val');
    if (existing.length === 4) {
      nums.forEach((n, i) => { if (existing[i].textContent !== String(n)) existing[i].textContent = n; });
    } else {
      elHistoryStatsBar.innerHTML = `
        <div class="ch-stat-pill total">
          <span class="ch-stat-icon">📊</span>
          <div class="ch-stat-details">
            <span class="ch-stat-val">${total}</span>
            <span class="ch-stat-lbl">Total</span>
          </div>
        </div>
        <div class="ch-stat-pill active">
          <span class="ch-stat-icon" style="color: var(--color-green);">🟢</span>
          <div class="ch-stat-details">
            <span class="ch-stat-val" style="color: var(--color-green);">${active}</span>
            <span class="ch-stat-lbl">Live</span>
          </div>
        </div>
        <div class="ch-stat-pill completed">
          <span class="ch-stat-icon" style="color: var(--color-cyan);">🔵</span>
          <div class="ch-stat-details">
            <span class="ch-stat-val" style="color: var(--color-cyan);">${completed}</span>
            <span class="ch-stat-lbl">Done</span>
          </div>
        </div>
        <div class="ch-stat-pill failed">
          <span class="ch-stat-icon" style="color: var(--color-red);">🔴</span>
          <div class="ch-stat-details">
            <span class="ch-stat-val" style="color: var(--color-red);">${failed}</span>
            <span class="ch-stat-lbl">Failed</span>
          </div>
        </div>
      `;
    }
  }

  if (groupedArray.length === 0) {
    elHistoryCallsList.innerHTML = `
      <div class="history-empty-state">
        <div class="history-empty-icon">📞</div>
        <p>${callsCache.length === 0 ? 'No calls yet' : 'No results'}</p>
        <span>${callsCache.length === 0 ? 'Place a call to see history here' : 'Try a different search term'}</span>
      </div>`;
    return;
  }

  const emptyEl = elHistoryCallsList.querySelector('.history-empty-state');
  if (emptyEl) emptyEl.remove();

  const existingCards = new Map();
  elHistoryCallsList.querySelectorAll('.hc-card[data-phone]').forEach(el => {
    existingCards.set(el.dataset.phone, el);
  });

  const filteredPhones = new Set(groupedArray.map(g => g.to));

  existingCards.forEach((el, phone) => {
    if (!filteredPhones.has(phone)) el.remove();
  });

  groupedArray.forEach((group) => {
    const initials = getInitials(group.name, group.to);
    const displayName = group.name || group.to;
    const latestStatus = group.latestCall.status;
    const callCount = group.calls.length;
    const dateStr = group.latestCall.startedAt
      ? new Date(group.latestCall.startedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
      : (group.latestCall.createdAt ? new Date(group.latestCall.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '');

    let card = existingCards.get(group.to);

    if (!card) {
      card = document.createElement('div');
      card.dataset.phone = group.to;
      card.innerHTML = `
        <div class="hc-avatar-mini">${initials}</div>
        <div class="hc-body">
          <div class="hc-name">${displayName} <span style="font-size: 0.75rem; color: #888;">(${callCount} call${callCount>1?'s':''})</span></div>
          <div class="hc-meta">
            <span class="hc-date">${dateStr}</span>
            <span class="hc-dot-sep">·</span>
            <span class="hc-badge status-badge badge-${latestStatus}">${latestStatus}</span>
          </div>
        </div>
        <button class="hd-btn-delete" style="background:transparent;border:none;cursor:pointer;padding:4px;font-size:1.1rem;opacity:0.8;display:flex;align-items:center;" onclick="deleteHistoryGroup(event, '${group.to}')" title="Delete All Calls for this number">🗑</button>
      `;
      card.addEventListener('click', () => {
        historySelectedSid = group.to; // We use to as the selector now
        document.querySelectorAll('.hc-card').forEach(el => el.classList.remove('selected'));
        card.classList.add('selected');
        renderHistoryDetail(group.to);
      });
      elHistoryCallsList.appendChild(card);
    } else {
      const nameEl = card.querySelector('.hc-name');
      if (nameEl) nameEl.innerHTML = `${displayName} <span style="font-size: 0.75rem; color: #888;">(${callCount} call${callCount>1?'s':''})</span>`;
      const badgeEl = card.querySelector('.hc-badge');
      if (badgeEl) {
        if (badgeEl.textContent !== latestStatus) badgeEl.textContent = latestStatus;
        badgeEl.className = `hc-badge status-badge badge-${latestStatus}`;
      }
    }
    card.className = `hc-card s-${latestStatus} ${historySelectedSid === group.to ? 'selected' : ''}`;
  });

  // Auto-select first contact if none selected
  if (!historySelectedSid && groupedArray.length > 0) {
    const firstGroup = groupedArray[0];
    historySelectedSid = firstGroup.to;
    const firstCard = elHistoryCallsList.querySelector(`.hc-card[data-phone="${firstGroup.to}"]`);
    if (firstCard) firstCard.classList.add('selected');
    renderHistoryDetail(firstGroup.to);
  }
}

let lastRenderedHistorySid = null;

function renderHistoryDetail(phone) {
  const groupCalls = callsCache.filter(c => getCallCustomerNumber(c) === phone || c.to === phone || c.from === phone);
  if (groupCalls.length === 0) return;
  
  // Sort desc
  groupCalls.sort((a,b) => new Date(b.createdAt || b.startedAt || 0) - new Date(a.createdAt || a.startedAt || 0));
  const latestCall = groupCalls[0];

  if (elHdDetailEmpty) elHdDetailEmpty.style.display = 'none';
  if (elHdDetailPanel) {
    elHdDetailPanel.style.display = 'flex';
  }

  const initials = getInitials(latestCall.name, latestCall.to);
  if (elHdAvatar) elHdAvatar.textContent = initials;
  if (elHdName) elHdName.textContent = latestCall.name || latestCall.to;
  if (elHdPhone) elHdPhone.textContent = latestCall.name ? latestCall.to : '';
  
  const totalEl = document.getElementById('hd-total-calls');
  if (totalEl) totalEl.textContent = `${groupCalls.length} Call${groupCalls.length>1?'s':''} History`;

  const container = document.getElementById('hd-calls-container');
  if (!container) return;
  
  const hasActiveCall = groupCalls.some(isCallTrulyActive);
  const groupStateKey = groupCalls.map(c => `${c.callSid}-${c.status}-${c.recordingStatus}-${c.transcript?.length || 0}-${c.summary ? '1' : '0'}`).join('|');
  
  if (!hasActiveCall && container.dataset.renderedState === groupStateKey) {
    return;
  }
  container.dataset.renderedState = groupStateKey;
  
  container.innerHTML = ''; // Clear container

  groupCalls.forEach(call => {
    const isTrulyActive = isCallTrulyActive(call);
    const effectiveStatus = isTrulyActive ? call.status : ((call.status === 'active' || call.status === 'calling') ? 'failed' : call.status);
    const callBlock = document.createElement('div');
    callBlock.className = `hd-call-card status-${effectiveStatus}`;

    const callDate = call.startedAt ? new Date(call.startedAt).toLocaleString() : (call.createdAt ? new Date(call.createdAt).toLocaleString() : 'Unknown');
    const duration = call.startedAt ? formatDuration(call) : '—';
    
    const isIncomingCall = call.direction ? (call.direction === 'incoming') : (loggedInUser && (call.to === loggedInUser.phone_number || (loggedInUser.phone_number && loggedInUser.phone_number.includes(call.to))));
    
    // Header
    const headerHtml = `
      <div class="hd-call-header">
        <div class="hd-call-status" style="display: flex; gap: 6px; align-items: center;">
          <span class="status-badge badge-${effectiveStatus}">${effectiveStatus.toUpperCase()}</span>
          ${isIncomingCall 
            ? `<span class="status-badge" style="background: rgba(16, 185, 129, 0.1); color: var(--color-green); border: 1px solid rgba(16, 185, 129, 0.2); text-transform: uppercase;">⬇ Incoming</span>`
            : `<span class="status-badge" style="background: rgba(6, 182, 212, 0.1); color: var(--color-cyan); border: 1px solid rgba(6, 182, 212, 0.2); text-transform: uppercase;">⬆ Outgoing</span>`}
        </div>
        <div class="hd-call-time">
          <span>${callDate}</span>
          <span class="hd-call-duration">${duration}</span>
          ${isTrulyActive 
            ? `<button class="hd-btn hd-btn-end" onclick="terminateHistoryCall('${call.callSid}')" title="End Call">Hang Up</button>` 
            : `<button class="hd-btn hd-btn-delete" onclick="deleteCall('${call.callSid}')" title="Delete Call">🗑</button>`}
        </div>
      </div>
    `;
    
    // Recording
    let recHtml = '';
    if (!call.recordCall) {
      recHtml = `<div class="hd-call-recording"><span class="hd-rec-dot dot-off"></span> <span style="color:#aaa; font-size:0.9rem;">Recording not enabled</span></div>`;
    } else if (call.recordingStatus === 'ready' && call.recordingUrl) {
      const proxyUrl = `/recording-proxy/${call.callSid}${loggedInUser && loggedInUser.id ? '?clientId=' + encodeURIComponent(loggedInUser.id) : ''}`;
      recHtml = `
        <div class="hd-call-recording">
          <span class="hd-section-icon rec-icon">⏺</span>
          <audio controls class="hd-audio-player" src="${proxyUrl}" preload="metadata" style="flex:1; height: 35px;"></audio>
          <a href="${proxyUrl}" download="recording-${call.callSid.substring(0,8)}.mp3" class="hd-download-btn">Download</a>
        </div>`;
    } else if (call.recordingStatus === 'none' || call.recordingStatus === 'recording') {
      recHtml = `<div class="hd-call-recording"><span class="hd-rec-dot dot-live"></span> <span style="color:#aaa; font-size:0.9rem;">Recording in progress...</span></div>`;
    } else if (call.recordingStatus === 'fetching') {
      recHtml = `<div class="hd-call-recording"><span class="hd-rec-dot dot-live"></span> <span style="color:#aaa; font-size:0.9rem;">Fetching recording...</span></div>`;
    } else {
      recHtml = `<div class="hd-call-recording"><span class="hd-rec-dot dot-off"></span> <span style="color:#aaa; font-size:0.9rem;">Recording unavailable</span></div>`;
    }

    // AI Summary
    let sumHtml = '';
    if (call.summary) {
      sumHtml = `
        <div class="hd-call-analysis">
          <div class="hd-section-label"><span class="hd-section-icon">✦</span> AI Analysis</div>
          <div class="hd-analysis-content">${formatMarkdown(call.summary)}</div>
        </div>`;
    } else if (call.status === 'completed') {
      sumHtml = `
        <div class="hd-call-analysis" style="opacity: 0.7;">
          <div class="hd-section-label"><span class="hd-section-icon">✦</span> AI Analysis</div>
          <div class="hd-analysis-content">⏳ Generating AI summary...</div>
        </div>`;
    } else if (call.transcript && call.transcript.length > 0) {
      sumHtml = `
        <div class="hd-call-analysis" style="opacity: 0.7;">
          <div class="hd-section-label"><span class="hd-section-icon">✦</span> AI Analysis</div>
          <div class="hd-analysis-content">💬 Summary will appear once the call ends.</div>
        </div>`;
    } else {
      sumHtml = `
        <div class="hd-call-analysis" style="opacity: 0.7;">
          <div class="hd-section-label"><span class="hd-section-icon">✦</span> AI Analysis</div>
          <div class="hd-analysis-content">📞 Call in progress — no summary yet.</div>
        </div>`;
    }

    // Transcript
    let transHtml = '';
    if (call.transcript && call.transcript.length > 0) {
      transHtml = `
        <div class="hd-call-transcript">
          <div class="hd-section-label" style="cursor:pointer;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'flex' : 'none';">
            <span class="hd-section-icon">💬</span> Conversation Transcript <span style="font-size:0.7rem; color:#666; margin-left:10px;">(Click to toggle)</span>
          </div>
          <div class="hd-transcript-content custom-scroll" style="display:none;">
            ${call.transcript.map(turn => `
              <div class="hd-bubble ${turn.role === 'user' ? 'b-user' : 'b-agent'}">
                <span class="hd-bubble-speaker">${turn.role === 'user' ? 'You' : 'Agent'}</span>
                <span>${escapeHtml(turn.text)}</span>
              </div>
            `).join('')}
          </div>
        </div>`;
    }

    callBlock.innerHTML = headerHtml + recHtml + sumHtml + transHtml;
    container.appendChild(callBlock);
  });
}

// Toggle history overlay (also wired via onclick on dashboard button)
if (elBtnToggleHistory) {
  elBtnToggleHistory.addEventListener('click', () => {
    openHistoryOverlay();
  });
}

// Search filter
if (elHistorySearch) {
  elHistorySearch.addEventListener('input', (e) => {
    historySearchQuery = e.target.value.trim();
    renderHistoryList();
  });
}

// Transcript toggle
if (elHdTranscriptBtn) {
  elHdTranscriptBtn.addEventListener('click', () => {
    const isVisible = elHdTranscript.style.display !== 'none';
    elHdTranscript.style.display = isVisible ? 'none' : 'flex';
    elHdTranscriptBtn.textContent = isVisible ? 'Show' : 'Hide';
  });
}

// Expose openHistoryOverlay for external use
window.openHistoryOverlay = openHistoryOverlay;

// ================================================================
// THEME MANAGEMENT SYSTEM
// ================================================================
function getSavedTheme() {
  return localStorage.getItem('callio-theme') || 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('callio-theme', theme);
  updateChartsTheme(theme);
}

function initTheme() {
  const theme = getSavedTheme();
  document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
  const currentTheme = getSavedTheme();
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
}

function updateChartsTheme(theme) {
  if (typeof ApexCharts === 'undefined') return;
  const isDark = theme === 'dark';
  const gridColor = isDark ? '#222' : '#e2e8f0';
  
  if (usageChart) {
    usageChart.updateOptions({
      theme: { mode: theme },
      grid: { borderColor: gridColor }
    });
  }
  if (costChart) {
    costChart.updateOptions({
      theme: { mode: theme },
      grid: { borderColor: gridColor }
    });
  }
  if (inboundChart) {
    inboundChart.updateOptions({
      theme: { mode: theme },
      grid: { borderColor: gridColor }
    });
  }
}

// Initialize theme immediately on script load to prevent flash
initTheme();

// ================================================================
// VOBIZ EXACT DASHBOARD LOGIC
// ================================================================
let vobizChartsRendered = false;
let usageChart, costChart, inboundChart;

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (!vobizChartsRendered) {
      initVobizCharts();
      vobizChartsRendered = true;
    }
    updateVobizMetrics();
  }, 1000);
});

function updateVobizMetrics() {
  const totalCalls = callsCache.length;
  
  const completedCalls = callsCache.filter(c => c.status === 'completed').length;
  const activeCalls = callsCache.filter(c => c.status === 'active' || c.status === 'calling' || c.status === 'in-progress' || c.status === 'ringing' || c.status === 'queued' || c.status === 'initiated').length;
  const failedCalls = callsCache.filter(c => c.status === 'failed' || c.status === 'busy' || c.status === 'no-answer' || c.status === 'voicemail').length;
  
  // Calculate Interest (parsing summary)
  let interestedCount = 0;
  callsCache.forEach(c => {
    if (c.summary && c.summary.toLowerCase().includes('**verdict:** interested')) {
      interestedCount++;
    }
  });

  const pickupRate = totalCalls > 0 ? Math.round(((completedCalls + activeCalls) / totalCalls) * 100) : 0;
  
  const elCallsMade = document.getElementById('vb-calls-made');
  const elPickupRate = document.getElementById('vb-pickup-rate');
  const elActiveCalls = document.getElementById('vb-active-calls');
  const elCompletedCalls = document.getElementById('vb-completed-calls');
  const elFailedCalls = document.getElementById('vb-failed-calls');
  const elInterestedCalls = document.getElementById('vb-interested-calls');
  
  if (elCallsMade) elCallsMade.innerText = totalCalls;
  if (elPickupRate) elPickupRate.innerText = pickupRate + '%';
  if (elActiveCalls) elActiveCalls.innerText = activeCalls;
  if (elCompletedCalls) elCompletedCalls.innerText = completedCalls;
  if (elFailedCalls) elFailedCalls.innerText = failedCalls;
  if (elInterestedCalls) elInterestedCalls.innerText = interestedCount;

  // Real data charts logic
  if (usageChart && costChart && inboundChart) {
    const categories = [];
    const totalData = [];
    const completedData = [];
    const intData = [];
    const notIntData = [];
    const outData = [];
    const inData = [];
    const failedData = [];

    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      categories.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
      totalData.push(0); completedData.push(0); intData.push(0); notIntData.push(0); outData.push(0); inData.push(0); failedData.push(0);
    }

    callsCache.forEach(c => {
      const callDate = new Date(c.startedAt || c.createdAt || Date.now());
      const dayStr = callDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const idx = categories.indexOf(dayStr);
      if (idx !== -1) {
        totalData[idx]++;
        outData[idx]++;
        if (c.status === 'completed') completedData[idx]++;
        if (c.status === 'failed' || c.status === 'voicemail') failedData[idx]++;
        if (c.summary && c.summary.toLowerCase().includes('**verdict:** interested')) intData[idx]++;
        if (c.summary && c.summary.toLowerCase().includes('**verdict:** not interested')) notIntData[idx]++;
      }
    });

    usageChart.updateSeries([{ name: 'Total Calls', data: totalData }, { name: 'Completed', data: completedData }, { name: 'Failed', data: failedData }]);
    usageChart.updateOptions({ xaxis: { categories } });

    costChart.updateSeries([{ name: 'Interested', data: intData }, { name: 'Not Interested', data: notIntData }]);
    costChart.updateOptions({ xaxis: { categories } });

    inboundChart.updateSeries([{ name: 'Inbound', data: inData }, { name: 'Outbound', data: outData }]);
    inboundChart.updateOptions({ xaxis: { categories } });
  }
}

function initVobizCharts() {
  if (typeof ApexCharts === 'undefined') return;

  const isMobile = window.innerWidth < 600;
  const lineChartHeight = isMobile ? 160 : 250;
  const barChartHeight = isMobile ? 120 : 160;
  
  const theme = getSavedTheme();
  const isDark = theme === 'dark';
  const gridColor = isDark ? '#222' : '#e2e8f0';

  const usageOptions = {
    chart: { type: 'line', width: '100%', height: lineChartHeight, toolbar: { show: false }, background: 'transparent', redrawOnParentResize: true, redrawOnWindowResize: true, animations: { enabled: true, dynamicAnimation: { speed: 1000 } } },
    series: [ { name: 'Total Calls', data: [] }, { name: 'Completed', data: [] }, { name: 'Failed', data: [] } ],
    colors: ['#00ff66', '#ff9900', '#ff3b3b'],
    stroke: { curve: 'smooth', width: 2 },
    xaxis: { categories: [], labels: { style: { colors: '#888' } } },
    yaxis: { labels: { style: { colors: '#888' } } },
    grid: { borderColor: gridColor, strokeDashArray: 4 },
    theme: { mode: theme },
    legend: { show: false }
  };
  usageChart = new ApexCharts(document.querySelector("#vb-chart-usage"), usageOptions);
  usageChart.render();

  const costOptions = {
    chart: { type: 'line', width: '100%', height: lineChartHeight, toolbar: { show: false }, background: 'transparent', redrawOnParentResize: true, redrawOnWindowResize: true, animations: { enabled: true } },
    series: [ { name: 'Interested', data: [] }, { name: 'Not Interested', data: [] } ],
    colors: ['#a64dff', '#ff4444'],
    stroke: { curve: 'straight', width: 2 },
    xaxis: { categories: [], labels: { style: { colors: '#888' } } },
    yaxis: { labels: { style: { colors: '#888' } } },
    grid: { borderColor: gridColor, strokeDashArray: 4 },
    theme: { mode: theme },
    legend: { show: false }
  };
  costChart = new ApexCharts(document.querySelector("#vb-chart-cost"), costOptions);
  costChart.render();

  const inboundOptions = {
    chart: { type: 'bar', width: '100%', height: barChartHeight, stacked: true, toolbar: { show: false }, background: 'transparent', redrawOnParentResize: true, redrawOnWindowResize: true, animations: { enabled: true } },
    series: [ { name: 'Inbound', data: [] }, { name: 'Outbound', data: [] } ],
    colors: ['#00ff66', '#ff9900'],
    plotOptions: { bar: { columnWidth: '20%', borderRadius: 2 } },
    xaxis: { categories: [], labels: { style: { colors: '#888' } } },
    yaxis: { labels: { style: { colors: '#888' } } },
    grid: { borderColor: gridColor, strokeDashArray: 4, position: 'back' },
    theme: { mode: theme },
    dataLabels: { enabled: false },
    legend: { show: false }
  };
  inboundChart = new ApexCharts(document.querySelector("#vb-chart-inbound"), inboundOptions);
  inboundChart.render();

  window.addEventListener('resize', () => {
    try {
      if (usageChart) usageChart.windowResizeHandler();
      if (costChart) costChart.windowResizeHandler();
      if (inboundChart) inboundChart.windowResizeHandler();
    } catch(e) {}
  });
}

// ====================================================
// CRM WEBHOOK AUTOMATION TAB LOGIC
// ====================================================

async function fetchCrmRulesAndAgents() {
  try {
    // 1. Fetch Agents for Rule dropdown
    const clientId = loggedInUser ? loggedInUser.id : '';
    const agentRes = await fetch(`/api/agents?clientId=${clientId}`);
    const agentData = await agentRes.json();
    if (agentData.success) {
      const select = document.getElementById('crm-agent-select');
      if (select) {
        let opts = '<option value="">-- Choose Agent --</option>';
        agentData.agents.forEach(a => {
          opts += `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.voice)})</option>`;
        });
        select.innerHTML = opts;
      }
    }

    // 2. Fetch CRM Rule
    const ruleRes = await fetch(`/api/crm-rules?clientId=${clientId}`);
    const ruleData = await ruleRes.json();
    if (ruleData.success && ruleData.rules.length > 0) {
      const rule = ruleData.rules[0]; // default_rule
      const enabledCb = document.getElementById('crm-rule-enabled');
      const fromInput = document.getElementById('crm-from-stage');
      const toInput = document.getElementById('crm-to-stage');
      const agentSelect = document.getElementById('crm-agent-select');
      const providerSelect = document.getElementById('crm-provider-select');

      if (enabledCb) enabledCb.checked = rule.enabled;
      if (fromInput) fromInput.value = rule.fromStage || 'new';
      if (toInput) toInput.value = rule.toStage || 'qualified';
      if (agentSelect) agentSelect.value = rule.agentId || '';
      if (providerSelect) providerSelect.value = rule.provider || 'vobiz';
    }
    
    updateCrmWebhookUrlDisplay();
  } catch (e) {
    console.error("Error loading CRM rule config", e);
  }
}

function updateCrmWebhookUrlDisplay() {
  const webhookUrlInput = document.getElementById('crm-webhook-url');
  if (webhookUrlInput) {
    const publicUrlVal = document.getElementById('public-url')?.value.trim() || window.location.host;
    let cleanUrl = publicUrlVal;
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
    }
    webhookUrlInput.value = `${cleanUrl}/api/webhooks/crm-lead-stage-change?clientId=${loggedInUser ? loggedInUser.id : ''}`;
  }
}

async function fetchCrmLogs() {
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/api/crm-logs?clientId=${clientId}`);
    const data = await res.json();
    if (data.success) {
      renderCrmLogsTable(data.logs);
    }
  } catch (e) {
    console.error("Failed to fetch CRM automation logs", e);
  }
}

function renderCrmLogsTable(logs) {
  const tbody = document.querySelector('#crm-logs-table tbody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  const displayLogs = (logs || []).slice(0, 50);
  if (displayLogs.length > 0) {
    displayLogs.forEach(log => {
      const tr = document.createElement('tr');
      const d = new Date(log.timestamp).toLocaleString();
      
      let statusClass = '';
      if (log.status.includes('Initiated') || log.status.includes('Call Initiated')) statusClass = 'status-active';
      else if (log.status.includes('Skipped')) statusClass = 'status-calling';
      else if (log.status.includes('Failed') || log.status.includes('Error')) statusClass = 'status-failed';
      
      tr.innerHTML = `
        <td style="color: var(--text-muted); font-size: 0.8rem;">${d}</td>
        <td><strong>${escapeHtml(log.leadName)}</strong></td>
        <td>${escapeHtml(log.leadPhone)}</td>
        <td><span class="chip-total" style="padding: 2px 8px; border-radius: 6px; font-size: 0.8rem; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color);">${escapeHtml(log.transition)}</span></td>
        <td>${escapeHtml(log.agentName)}</td>
        <td><span class="${statusClass}" style="font-size: 0.85rem; font-weight: 600;">${escapeHtml(log.status)}</span></td>
        <td><code style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(log.callSid || 'N/A')}</code></td>
      `;
      tbody.appendChild(tr);
    });
  } else {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No webhook event logs captured yet.</td></tr>';
  }
}

// Wire up events
document.getElementById('btn-save-crm-rule')?.addEventListener('click', async () => {
  const enabled = document.getElementById('crm-rule-enabled').checked;
  const fromStage = document.getElementById('crm-from-stage').value.trim();
  const toStage = document.getElementById('crm-to-stage').value.trim();
  const agentId = document.getElementById('crm-agent-select').value;
  const provider = document.getElementById('crm-provider-select').value;

  if (!agentId) {
    alert("Please select an Agent to execute the calling automation.");
    return;
  }

  const payload = { enabled, fromStage, toStage, agentId, provider, clientId: loggedInUser ? loggedInUser.id : null };
  
  try {
    const res = await fetch('/api/crm-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert("CRM automation rule saved successfully!");
    } else {
      alert("Error saving rule: " + data.error);
    }
  } catch (e) {
    alert("Network error saving CRM rule config.");
  }
});

document.getElementById('btn-copy-webhook-url')?.addEventListener('click', () => {
  const webhookUrlInput = document.getElementById('crm-webhook-url');
  if (webhookUrlInput) {
    webhookUrlInput.select();
    document.execCommand('copy');
    alert("Webhook URL copied to clipboard!");
  }
});

document.getElementById('btn-refresh-crm-logs')?.addEventListener('click', () => {
  fetchCrmLogs();
});

document.getElementById('btn-simulate-crm-webhook')?.addEventListener('click', async () => {
  const leadName = document.getElementById('sim-lead-name').value.trim();
  const leadPhone = document.getElementById('sim-lead-phone').value.trim();
  const previousStage = document.getElementById('sim-prev-stage').value.trim();
  const currentStage = document.getElementById('sim-curr-stage').value.trim();

  if (!leadPhone) {
    alert("Please enter a destination phone number to test.");
    return;
  }

  const payload = { leadName, leadPhone, previousStage, currentStage };

  const btnSim = document.getElementById('btn-simulate-crm-webhook');
  const originalText = btnSim.innerText;
  btnSim.innerText = "⏳ Simulating...";
  btnSim.disabled = true;

  try {
    // 1. Sync config drawer settings to server first so it has the current ngrok publicUrl and API keys
    const syncPayload = {
      publicUrl: document.getElementById('public-url').value.trim(),
      telephonyProvider: document.getElementById('telephony-provider').value,
      gemini_record_call: localStorage.getItem('gemini_record_call') || 'true',
      exotelApiKey: document.getElementById('exotel-api-key')?.value.trim() || '',
      exotelApiToken: document.getElementById('exotel-api-token')?.value.trim() || '',
      exotelAccountSid: document.getElementById('exotel-account-sid')?.value.trim() || '',
      exotelSubdomain: document.getElementById('exotel-subdomain')?.value.trim() || 'api.exotel.com',
      exotelCallerId: document.getElementById('exotel-caller-id')?.value.trim() || '',
      vobizAuthId: document.getElementById('vobiz-auth-id')?.value.trim() || '',
      vobizAuthToken: document.getElementById('vobiz-auth-token')?.value.trim() || '',
      vobizCallerId: document.getElementById('vobiz-caller-id')?.value.trim() || '',
      incomingAgentId: localStorage.getItem('gemini_incoming_agent_id') || ''
    };

    await fetch('/save-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(syncPayload)
    });

    // 2. Trigger Simulated Webhook Post
    const res = await fetch('/api/webhooks/crm-lead-stage-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (data.success) {
      const msg = data.log.status.includes('Call Initiated')
        ? "✅ Simulation successful! Automation triggered outbound call."
        : `⚠️ Simulation complete: ${data.log.status}`;
      alert(msg);
      fetchCrmLogs();
    } else {
      alert(`❌ Simulation failed: ${data.error || 'Unknown error'}`);
      fetchCrmLogs();
    }
  } catch (e) {
    alert("Error sending simulation request.");
  } finally {
    btnSim.innerText = originalText;
    btnSim.disabled = false;
  }
});

// ================================================================
// API AUTHORIZATION & DATA SHARING TAB LOGIC
// ================================================================

async function fetchSharingConfig() {
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/api/config?clientId=${clientId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        updateSharingUI(data);
      }
    }
  } catch (err) {
    console.error('Failed to fetch sharing config:', err);
  }
}

function updateSharingUI(config) {
  const sharedClientIdInput = document.getElementById('shared-client-id-input');
  if (sharedClientIdInput) {
    sharedClientIdInput.value = loggedInUser ? loggedInUser.id : '';
  }

  const apiEndpointUrl = document.getElementById('api-endpoint-url');
  if (apiEndpointUrl) {
    apiEndpointUrl.textContent = window.location.origin + '/make-call';
  }

  if (config.apiKey) {
    elSharedApiKeyInput.value = config.apiKey;
    elBtnDeleteApiKey.style.display = 'block';
    elBtnGenerateApiKey.innerText = 'Regenerate Key';
    elBtnGenerateApiKey.style.background = 'var(--border-color)';
    elBtnGenerateApiKey.style.color = 'var(--text-main)';
  } else {
    elSharedApiKeyInput.value = '';
    elBtnDeleteApiKey.style.display = 'none';
    elBtnGenerateApiKey.innerText = 'Generate Key';
    elBtnGenerateApiKey.style.background = 'var(--grad-cyan-violet)';
    elBtnGenerateApiKey.style.color = '#000';
  }
  
  elShareAgentsCheckbox.checked = config.shareAgents !== false;
  elShareContactsCheckbox.checked = config.shareContacts !== false;
  elShareCallsCheckbox.checked = config.shareCalls !== false;

  updateApiCodeSnippet();
}

async function saveSharingConfig(apiKeyToSave = null) {
  const currentKey = apiKeyToSave !== null ? apiKeyToSave : elSharedApiKeyInput.value.trim();
  const clientId = loggedInUser ? loggedInUser.id : '';
  
  const payload = {
    clientId: clientId,
    apiKey: currentKey,
    shareAgents: elShareAgentsCheckbox.checked,
    shareContacts: elShareContactsCheckbox.checked,
    shareCalls: elShareCallsCheckbox.checked
  };
  
  try {
    const res = await fetch('/save-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      logSuccess('API key and data sharing settings successfully saved on the server.');
      alert('Sharing settings saved successfully!');
      fetchSharingConfig();
      return true;
    } else {
      logWarn('Server failed to save sharing configurations.');
      alert('Failed to save sharing settings.');
      return false;
    }
  } catch (err) {
    console.error('Failed to save sharing config:', err);
    alert('Error saving sharing settings.');
    return false;
  }
}

function generateSecureApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'ca_';
  const randomValues = new Uint32Array(32);
  window.crypto.getRandomValues(randomValues);
  for (let i = 0; i < 32; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

// Bind event listeners for API & Sharing tab elements
elBtnGenerateApiKey?.addEventListener('click', async (e) => {
  e.preventDefault();
  const confirmMsg = elSharedApiKeyInput.value ? 'Are you sure you want to regenerate the API key? This will invalidate the previous key.' : 'Generate a new API key for SaaS integration?';
  if (confirm(confirmMsg)) {
    const newKey = generateSecureApiKey();
    await saveSharingConfig(newKey);
  }
});

elBtnDeleteApiKey?.addEventListener('click', async (e) => {
  e.preventDefault();
  if (confirm('Are you sure you want to revoke/delete the API key? The SaaS platform will no longer be able to connect.')) {
    await saveSharingConfig('');
  }
});

elBtnToggleSharedKeyVisibility?.addEventListener('click', (e) => {
  e.preventDefault();
  if (elSharedApiKeyInput.type === 'password') {
    elSharedApiKeyInput.type = 'text';
    elBtnToggleSharedKeyVisibility.innerHTML = '🙈 Hide';
  } else {
    elSharedApiKeyInput.type = 'password';
    elBtnToggleSharedKeyVisibility.innerHTML = '👁️ Show';
  }
});

elBtnCopySharedKey?.addEventListener('click', (e) => {
  e.preventDefault();
  if (!elSharedApiKeyInput.value) {
    alert('Please generate an API key first.');
    return;
  }
  navigator.clipboard.writeText(elSharedApiKeyInput.value).then(() => {
    const originalText = elBtnCopySharedKey.innerHTML;
    elBtnCopySharedKey.innerHTML = '✅ Copied!';
    setTimeout(() => {
      elBtnCopySharedKey.innerHTML = originalText;
    }, 2000);
  }).catch(err => {
    console.error('Clipboard copy failed:', err);
    alert('Failed to copy key automatically. Please select and copy manually.');
  });
});

// Copy Client ID
document.getElementById('btn-copy-client-id')?.addEventListener('click', (e) => {
  e.preventDefault();
  const input = document.getElementById('shared-client-id-input');
  const btn = document.getElementById('btn-copy-client-id');
  if (input && input.value) {
    navigator.clipboard.writeText(input.value).then(() => {
      const originalText = btn.innerHTML;
      btn.innerHTML = '✅ Copied!';
      setTimeout(() => { btn.innerHTML = originalText; }, 2000);
    });
  }
});

// Copy Code Snippet
document.getElementById('btn-copy-code-snippet')?.addEventListener('click', (e) => {
  e.preventDefault();
  const codeEl = document.getElementById('api-code-snippet');
  const btn = document.getElementById('btn-copy-code-snippet');
  if (codeEl && codeEl.textContent) {
    navigator.clipboard.writeText(codeEl.textContent).then(() => {
      const originalText = btn.innerText;
      btn.innerText = '✅';
      setTimeout(() => { btn.innerText = originalText; }, 2000);
    });
  }
});

// API Documentation Tab switching logic
let currentApiDocTab = 'curl';

window.switchApiDocTab = function(tab) {
  currentApiDocTab = tab;
  
  // Highlight active tab button
  document.querySelectorAll('[id^="api-tab-"]').forEach(btn => {
    btn.style.color = 'var(--text-muted)';
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(`api-tab-${tab}`);
  if (activeBtn) {
    activeBtn.style.color = 'var(--text-main)';
    activeBtn.classList.add('active');
  }

  updateApiCodeSnippet();
};

function updateApiCodeSnippet() {
  const codeEl = document.getElementById('api-code-snippet');
  if (!codeEl) return;

  const origin = window.location.origin;
  const clientId = loggedInUser ? loggedInUser.id : 'YOUR_CLIENT_AUTH_ID';
  const apiToken = elSharedApiKeyInput.value || 'YOUR_CALLIO_AUTH_TOKEN';
  const assignedPhone = (loggedInUser && loggedInUser.phone_number) ? loggedInUser.phone_number : '+91XXXXXXXXXX';

  let codeText = '';
  if (currentApiDocTab === 'curl') {
    codeText = `curl -X POST "${origin}/make-call" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+919876543210",
    "clientId": "${clientId}",
    "authToken": "${apiToken}",
    "callerId": "${assignedPhone}"
  }'`;
  } else if (currentApiDocTab === 'js') {
    codeText = `fetch("${origin}/make-call", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    to: "+919876543210",
    clientId: "${clientId}",
    authToken: "${apiToken}",
    callerId: "${assignedPhone}"
  })
})
.then(res => res.json())
.then(data => console.log(data))
.catch(err => console.error(err));`;
  } else if (currentApiDocTab === 'python') {
    codeText = `import requests

url = "${origin}/make-call"
payload = {
    "to": "+919876543210",
    "clientId": "${clientId}",
    "authToken": "${apiToken}",
    "callerId": "${assignedPhone}"
}

response = requests.post(url, json=payload)
print(response.json())`;
  }

  codeEl.textContent = codeText;
}

// Save Sharing Settings
elBtnSaveSharingSettings?.addEventListener('click', async (e) => {
  e.preventDefault();
  await saveSharingConfig();
});

// ==========================================
// CLIENTS / MULTI-TENANT FRONTEND LOGIC
// ==========================================

// Global state (declared at top)

// Auth Modal Toggling
const elAuthOverlay = document.getElementById('auth-overlay');
const elLoginFormContainer = document.getElementById('login-form-container');
const elSignupFormContainer = document.getElementById('signup-form-container');
const elLinkGotoSignup = document.getElementById('link-goto-signup');
const elLinkGotoLogin = document.getElementById('link-goto-login');

const elAuthSubtitleText = document.getElementById('auth-subtitle-text');

elLinkGotoSignup?.addEventListener('click', (e) => {
  e.preventDefault();
  elLoginFormContainer.style.display = 'none';
  elSignupFormContainer.style.display = 'block';
  if (elAuthSubtitleText) {
    elAuthSubtitleText.textContent = 'Create your account to start calling';
  }
});

elLinkGotoLogin?.addEventListener('click', (e) => {
  e.preventDefault();
  elLoginFormContainer.style.display = 'block';
  elSignupFormContainer.style.display = 'none';
  if (elAuthSubtitleText) {
    elAuthSubtitleText.textContent = 'Connect your live AI voice agents';
  }
});

// Initial Auth Check
async function checkAuth() {
  const session = localStorage.getItem('user_session');
  if (session) {
    try {
      const user = JSON.parse(session);
      // Validate session with server for portal domain isolation
      const verifyRes = await fetch('/api/auth/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, role: user.role })
      });
      const verifyData = await verifyRes.json();
      if (verifyData.success) {
        loggedInUser = user;
        applyUserRole(loggedInUser);
        return;
      }
    } catch (e) {
      console.warn('Session verification failed:', e);
    }
    // Session is invalid for this portal domain! Clear and show auth modal
    localStorage.removeItem('user_session');
    loggedInUser = null;
    showAuthModal();
  } else {
    showAuthModal();
  }
}

function showAuthModal() {
  const flashStyle = document.getElementById('auth-hide-flash-style');
  if (flashStyle) flashStyle.remove();
  if (elAuthOverlay) elAuthOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  // Hide main nav buttons
  document.querySelectorAll('.glass-navbar .nav-btn').forEach(btn => btn.style.display = 'none');
}

function hideAuthModal() {
  const flashStyle = document.getElementById('auth-hide-flash-style');
  if (flashStyle) flashStyle.remove();
  if (elAuthOverlay) elAuthOverlay.classList.remove('active');
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
}

// Global logout function
window.logout = function() {
  const cacheKey = getUserCallsCacheKey();
  if (cacheKey) localStorage.removeItem(cacheKey);
  localStorage.removeItem('callio_calls_cache');
  localStorage.removeItem('user_session');
  window.callsCache = [];
  callsCache = [];
  window.lastDashboardCalls = [];
  loggedInUser = null;
  location.reload();
};
function logout() {
  window.logout();
}

function renderClientPricingCards(currentPlanId) {
  const container = document.getElementById('pricing-cards-container');
  if (!container) return;
  container.innerHTML = '';

  (window.activePlans || []).forEach(p => {
    const isCurrent = p.id.toLowerCase() === currentPlanId.toLowerCase();
    const isPro = p.price_per_month > 0;
    const card = document.createElement('div');
    card.style.cssText = 'background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; display: flex; flex-direction: column;';
    
    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = `
      <h3 style="margin: 0 0 10px 0; font-size: 1.1rem; color: var(--text-main);">${p.name}</h3>
      <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-main); margin-bottom: 20px;">
        ${p.price_per_month === 0 ? 'Free' : '₹' + p.price_per_month}<span style="font-size: 0.9rem; font-weight: 400; color: var(--text-muted);">/mo</span>
      </div>
      
      <ul style="list-style: none; padding: 0; margin: 0 0 20px 0; display: flex; flex-direction: column; gap: 10px; font-size: 0.85rem;">
        <li style="display: flex; align-items: center; gap: 8px;"><span style="color: var(--color-green);">✓</span> 1 Indian Virtual Mobile Number</li>
        <li style="display: flex; align-items: center; gap: 8px;"><span style="color: var(--color-green);">✓</span> ${p.max_minutes >= 99999 ? 'Unlimited' : p.max_minutes} Outbound Call Minutes</li>
        <li style="display: flex; align-items: center; gap: 8px;"><span style="color: var(--color-green);">✓</span> Up to ${p.max_agents >= 99999 ? 'Unlimited' : p.max_agents} AI Voice Agents</li>
        <li style="display: flex; align-items: center; gap: 8px; ${p.id === 'basic' ? 'color: var(--text-muted); opacity: 0.5;' : ''}"><span style="${p.id === 'basic' ? 'color: var(--color-red);' : 'color: var(--color-green);'}">${p.id === 'basic' ? '✗' : '✓'}</span> Custom Agent Mood</li>
        <li style="display: flex; align-items: center; gap: 8px; ${!p.crm_integration ? 'color: var(--text-muted); opacity: 0.5;' : ''}"><span style="${!p.crm_integration ? 'color: var(--color-red);' : 'color: var(--color-green);'}">${!p.crm_integration ? '✗' : '✓'}</span> CRM Integrations</li>
        <li style="display: flex; align-items: center; gap: 8px; ${!p.api_sharing ? 'color: var(--text-muted); opacity: 0.5;' : ''}"><span style="${!p.api_sharing ? 'color: var(--color-red);' : 'color: var(--color-green);'}">${!p.api_sharing ? '✗' : '✓'}</span> Developer API Token</li>
      </ul>
    `;
    card.appendChild(contentDiv);

    const actionBtn = document.createElement('button');
    actionBtn.id = `btn-subscribe-${p.id}`;

    // Enterprise / Custom plan → show Contact Sales instead of Subscribe
    const isCustomPlan = p.id === 'custom' || p.id === 'enterprise' || (p.name || '').toLowerCase().includes('enterprise') || (p.name || '').toLowerCase().includes('custom');

    if (isCurrent) {
      actionBtn.textContent = 'Active Plan';
      actionBtn.disabled = true;
      actionBtn.className = 'btn btn-secondary';
      actionBtn.style.cssText = 'width: 100%; font-weight: 600; padding: 10px; border-radius: 8px; justify-content: center; height: 38px; opacity: 0.7; cursor: not-allowed;';
    } else if (isCustomPlan) {
      actionBtn.textContent = '🏢 Contact Sales';
      actionBtn.disabled = false;
      actionBtn.className = 'btn';
      actionBtn.style.cssText = 'width: 100%; background: linear-gradient(135deg, #1e293b, #334155); color: #fff; font-weight: 700; border: 1px solid rgba(255,255,255,0.12); padding: 10px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; height: 38px;';
      actionBtn.onclick = () => { if (typeof window.openEnterpriseModal === 'function') window.openEnterpriseModal(); };
    } else {
      const isUpgrade = p.price_per_month > 0;
      actionBtn.textContent = isUpgrade ? `Subscribe ${p.name.replace(' Plan', '')}` : 'Subscribe';
      actionBtn.disabled = false;
      if (isPro) {
        actionBtn.className = 'btn';
        actionBtn.style.cssText = 'width: 100%; background: linear-gradient(135deg, #06b6d4, #8b5cf6); color: #fff; font-weight: 700; border: none; padding: 10px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; height: 38px;';
      } else {
        actionBtn.className = 'btn btn-secondary';
        actionBtn.style.cssText = 'width: 100%; font-weight: 600; padding: 10px; border-radius: 8px; justify-content: center; height: 38px;';
      }
      actionBtn.onclick = () => {
        window.subscribePlan(p.id, p.price_per_month || 0);
      };
    }
    card.appendChild(actionBtn);
    container.appendChild(card);
  });
}

// Plan limits and feature locks enforcement helper
function applyUserPlanAndLimits(user) {
  const crmOverlay = document.getElementById('crm-locked-overlay');
  const crmContent = document.getElementById('crm-unlocked-content');
  const apiOverlay = document.getElementById('api-locked-overlay');
  const apiContent = document.getElementById('api-unlocked-content');
  
  const navCrm = document.getElementById('nav-crm-automation');
  const navApi = document.getElementById('nav-api-sharing');
  
  const moodSelect = document.getElementById('agent-mood');
  const moodLabel = moodSelect?.previousElementSibling;

  if (user.role === 'client') {
    const rawPlan = (user.plan || 'none').toLowerCase();
    const isNoPlan = (!rawPlan || rawPlan === 'none' || rawPlan === 'no_plan' || rawPlan === 'inactive');
    const plan = isNoPlan ? 'none' : rawPlan;
    
    // Find active plan details
    const planDetails = (window.activePlans || []).find(p => p.id.toLowerCase() === plan.toLowerCase()) || (isNoPlan ? {
      id: 'none',
      name: 'No Active Subscription',
      max_minutes: 0,
      max_agents: 0,
      rate_per_minute: 0,
      crm_integration: false,
      api_sharing: false
    } : {
      id: 'basic',
      name: 'Basic Plan',
      max_minutes: 100,
      max_agents: 2,
      rate_per_minute: 5,
      crm_integration: false,
      api_sharing: false
    });

    // Update active plan UI elements
    const planBadge = document.getElementById('active-plan-badge');
    if (planBadge) {
      if (isNoPlan) {
        planBadge.textContent = 'NO ACTIVE PLAN';
        planBadge.style.background = 'rgba(239, 68, 68, 0.12)';
        planBadge.style.color = '#ef4444';
        planBadge.style.borderColor = 'rgba(239, 68, 68, 0.25)';
      } else {
        planBadge.textContent = `${planDetails.name.toUpperCase()}`;
        if (planDetails.id === 'basic') {
          planBadge.style.background = 'rgba(255, 152, 0, 0.12)';
          planBadge.style.color = '#ff9800';
          planBadge.style.borderColor = 'rgba(255, 152, 0, 0.25)';
        } else {
          planBadge.style.background = 'rgba(76, 175, 80, 0.12)';
          planBadge.style.color = '#4caf50';
          planBadge.style.borderColor = 'rgba(76, 175, 80, 0.25)';
        }
      }
    }
    
    const minutesStatus = document.getElementById('plan-minutes-status');
    const minutesProgress = document.getElementById('plan-minutes-progress');
    const agentsLimit = document.getElementById('plan-agents-limit');
    const durationLimit = document.getElementById('plan-duration-limit');
    const integrationsStatus = document.getElementById('plan-integrations-status');
    
    const usedMins = user.used_minutes || 0;
    const maxMins = planDetails.max_minutes;
    
    if (minutesStatus) minutesStatus.textContent = `${usedMins.toFixed(1)} / ${maxMins >= 99999 ? 'Unlimited' : maxMins} mins`;
    if (minutesProgress) {
      const pct = maxMins >= 99999 ? 0 : Math.min(100, Math.max(0, (usedMins / maxMins) * 100));
      minutesProgress.style.width = `${pct}%`;
    }
    if (agentsLimit) agentsLimit.textContent = planDetails.max_agents >= 99999 ? 'Unlimited Agents' : `${planDetails.max_agents} Agents max`;
    if (durationLimit) durationLimit.textContent = `₹${(planDetails.rate_per_minute || 5).toFixed(2)} / min`;
    
    if (integrationsStatus) {
      if (planDetails.crm_integration && planDetails.api_sharing) {
        integrationsStatus.textContent = '✓ Unlocked';
        integrationsStatus.style.color = 'var(--color-green)';
      } else {
        integrationsStatus.textContent = '🔒 Locked';
        integrationsStatus.style.color = 'var(--color-red)';
      }
    }
    
    // Toggle overlays
    const crmTabTitle = document.getElementById('crm-tab-title');
    if (!planDetails.crm_integration) {
      if (crmOverlay) crmOverlay.style.display = 'flex';
      if (crmContent) crmContent.style.display = 'none';
      if (crmTabTitle) crmTabTitle.style.display = 'none';
      
      // Add lock badge to nav tabs
      if (navCrm && !navCrm.querySelector('.nav-lock-badge')) {
        const crmSpan = navCrm.querySelector('span');
        if (crmSpan && !crmSpan.querySelector('.nav-lock-badge')) {
          const badge = document.createElement('span');
          badge.className = 'nav-lock-badge';
          badge.style.cssText = 'font-size:0.65rem;background:rgba(255,152,0,0.15);color:#f59e0b;border:1px solid rgba(255,152,0,0.3);border-radius:4px;padding:1px 5px;margin-left:5px;font-weight:700;vertical-align:middle;letter-spacing:0;';
          badge.textContent = '🔒';
          crmSpan.appendChild(badge);
        }
      }
    } else {
      if (crmOverlay) crmOverlay.style.display = 'none';
      if (crmContent) crmContent.style.display = 'grid';
      if (crmTabTitle) crmTabTitle.style.display = '';
      if (navCrm) { const b = navCrm.querySelector('.nav-lock-badge'); if (b) b.remove(); }
    }

    const authIdGroup = document.getElementById('calling-credentials-auth-id-group');
    const authTokenGroup = document.getElementById('calling-credentials-auth-token-group');
    const accordionTitle = document.getElementById('calling-credentials-accordion-title');

    if (!planDetails.api_sharing) {
      if (apiOverlay) apiOverlay.style.display = 'flex';
      if (apiContent) apiContent.style.display = 'none';
      if (authIdGroup) authIdGroup.style.display = 'none';
      if (authTokenGroup) authTokenGroup.style.display = 'none';
      if (accordionTitle) accordionTitle.textContent = '⚙️ Your Callio Number';
      
      if (navApi && !navApi.querySelector('.nav-lock-badge')) {
        const apiSpan = navApi.querySelector('span');
        if (apiSpan && !apiSpan.querySelector('.nav-lock-badge')) {
          const badge = document.createElement('span');
          badge.className = 'nav-lock-badge';
          badge.style.cssText = 'font-size:0.65rem;background:rgba(255,152,0,0.15);color:#f59e0b;border:1px solid rgba(255,152,0,0.3);border-radius:4px;padding:1px 5px;margin-left:5px;font-weight:700;vertical-align:middle;letter-spacing:0;';
          badge.textContent = '🔒';
          apiSpan.appendChild(badge);
        }
      }
    } else {
      if (apiOverlay) apiOverlay.style.display = 'none';
      if (apiContent) apiContent.style.display = 'block';
      if (authIdGroup) authIdGroup.style.display = 'block';
      if (authTokenGroup) authTokenGroup.style.display = 'block';
      if (accordionTitle) accordionTitle.textContent = '⚙️ Telephony Credentials & Number';
      if (navApi) { const b = navApi.querySelector('.nav-lock-badge'); if (b) b.remove(); }
    }

    // Mood selector lock
    if (planDetails.id === 'basic') {
      if (moodSelect) {
        moodSelect.disabled = true;
        moodSelect.value = 'Professional';
        if (moodLabel && !moodLabel.innerHTML.includes('🔒')) {
          moodLabel.innerHTML = 'Agent Mood <span style="font-size: 0.75rem; color: #ff9800; font-weight: bold; margin-left: 6px;">🔒 Basic Lock (Pro Feature)</span>';
        }
      }
    } else {
      if (moodSelect) {
        moodSelect.disabled = false;
        if (moodLabel) moodLabel.innerHTML = 'Agent Mood';
      }
    }

    // Render Dynamic Pricing Card Upgrade Panel
    renderClientPricingCards(planDetails.id);
    
    // Hide admin card
    const adminBillingCard = document.getElementById('admin-billing-card');
    if (adminBillingCard) adminBillingCard.style.display = 'none';
  } else {
    // Admin user role: unlock everything
    if (crmOverlay) crmOverlay.style.display = 'none';
    if (crmContent) crmContent.style.display = 'grid';
    if (apiOverlay) apiOverlay.style.display = 'none';
    if (apiContent) apiContent.style.display = 'block';
    
    // Ensure all fields and full title show up for Admin
    const authIdGroup = document.getElementById('calling-credentials-auth-id-group');
    const authTokenGroup = document.getElementById('calling-credentials-auth-token-group');
    const accordionTitle = document.getElementById('calling-credentials-accordion-title');
    if (authIdGroup) authIdGroup.style.display = 'block';
    if (authTokenGroup) authTokenGroup.style.display = 'block';
    if (accordionTitle) accordionTitle.textContent = '⚙️ Telephony Credentials & Number';

    if (moodSelect) {
      moodSelect.disabled = false;
      if (moodLabel) moodLabel.innerHTML = 'Agent Mood';
    }
    
    // Show admin card
    const adminBillingCard = document.getElementById('admin-billing-card');
    if (adminBillingCard) adminBillingCard.style.display = 'flex';
  }
}

// Role-based UI rendering
function populateProfileSettings(user) {
  if (!user) return;
  const nameInput = document.getElementById('profile-name');
  const emailInput = document.getElementById('profile-email');
  const passInput = document.getElementById('profile-password');
  const gstinInput = document.getElementById('profile-gstin');
  const rechargeGstinInput = document.getElementById('user-gstin-input');

  if (nameInput) nameInput.value = user.name || '';
  if (emailInput) emailInput.value = user.email || '';
  if (passInput) passInput.value = '';

  const resolvedGstin = user.gstin || (user.role === 'admin' || user.role === 'reseller' ? window._domainGstin : '') || '';
  if (gstinInput) gstinInput.value = resolvedGstin;
  if (rechargeGstinInput && !rechargeGstinInput.value) rechargeGstinInput.value = resolvedGstin;
}

function applyUserRole(user) {
  hideAuthModal();
  
  if (user) {
    document.documentElement.setAttribute('data-user-role', user.role || 'client');
    // Auto-fill client assigned number in Calling tab
    if (user.phone_number) {
      const callerIdInput = document.getElementById('calling-vobiz-caller-id');
      if (callerIdInput) callerIdInput.value = user.phone_number;
    }
  } else {
    document.documentElement.setAttribute('data-user-role', 'guest');
    const brandingCard = document.getElementById('admin-branding-settings');
    if (brandingCard) brandingCard.style.display = 'none';
  }

  // Handle Admin Plan Configurator & CRM Simulator visibility
  const adminBillingCard = document.getElementById('admin-billing-card');
  if (adminBillingCard) {
    adminBillingCard.style.display = (user && user.role === 'admin') ? 'flex' : 'none';
  }

  const crmSimCard = document.getElementById('crm-simulator-card');
  if (crmSimCard) {
    crmSimCard.style.display = (user && (user.role === 'admin' || user.role === 'reseller')) ? 'block' : 'none';
  }

  // Whitelabel vs Super Admin specific Admin Panel controls
  const isWL = typeof window.isWhitelabelDomain === 'function' ? window.isWhitelabelDomain() : false;
  const isSuperAdmin = (user && user.role === 'admin' && !isWL);

  // 1. Whitelabel Billing & Reseller Commission Console (Visible for Resellers)
  const resellerCommissionCard = document.getElementById('reseller-wallet-commission-card');
  if (resellerCommissionCard) {
    resellerCommissionCard.style.display = (!isSuperAdmin || (user && user.role === 'reseller')) ? 'block' : 'none';
  }

  // 1b. Super Admin Wholesale Rates Console (Super Admin only)
  const saPricingConsoleCard = document.getElementById('superadmin-pricing-console-card');
  if (saPricingConsoleCard) {
    saPricingConsoleCard.style.display = isSuperAdmin ? 'block' : 'none';
    if (isSuperAdmin) {
      window.initSuperAdminPricingConsole();
    }
  }

  // 2. Create Base Plan button (Super Admin only)
  const createBasePlanBtn = document.getElementById('btn-create-new-plan-admin');
  if (createBasePlanBtn) {
    createBasePlanBtn.style.display = isSuperAdmin ? 'inline-flex' : 'none';
  }

  // 3. Admin Subtab: Trial Leads (Visible for all Admins & Whitelabel Reseller Admins)
  const trialLeadsTab = document.getElementById('admin-subtab-trial-leads');
  if (trialLeadsTab) {
    trialLeadsTab.style.display = 'inline-block';
  }

  // 3b. Admin Subtab: Enterprise Inquiries (Visible for all Admins & Whitelabel Reseller Admins)
  const enterpriseInqTab = document.getElementById('admin-subtab-enterprise-inquiries');
  if (enterpriseInqTab) {
    enterpriseInqTab.style.display = 'inline-block';
  }

  // 4. Admin Subtab: Whitelabel Resellers (Super Admin only)
  const resellersTab = document.getElementById('admin-subtab-resellers');
  if (resellersTab) {
    resellersTab.style.display = isSuperAdmin ? 'inline-block' : 'none';
  }

  // Populate CRM Telephony Credentials fields from local storage / user
  const cAuthId = document.getElementById('calling-vobiz-auth-id');
  const cAuthToken = document.getElementById('calling-vobiz-auth-token');
  const cCallerId = document.getElementById('calling-vobiz-caller-id');
  if (cAuthId && localStorage.getItem('vobiz_auth_id')) cAuthId.value = localStorage.getItem('vobiz_auth_id');
  if (cAuthToken && localStorage.getItem('vobiz_auth_token')) cAuthToken.value = localStorage.getItem('vobiz_auth_token');
  if (cCallerId) cCallerId.value = localStorage.getItem('vobiz_caller_id') || (user && user.phone_number ? user.phone_number : '');
  
  // Handle Impersonation Banner visibility
  const impersonationBanner = document.getElementById('impersonation-banner');
  const impersonatedUserName = document.getElementById('impersonated-user-name');
  if (impersonationBanner && impersonatedUserName) {
    if (localStorage.getItem('is_impersonating') === 'true') {
      impersonatedUserName.innerText = user.name;
      impersonationBanner.style.display = 'flex';
    } else {
      impersonationBanner.style.display = 'none';
    }
  }
  
  // Handle wallet indicator visibility (Hidden per user design preference)
  const walletIndicator = document.getElementById('wallet-balance-indicator');
  const headerWalletBalance = document.getElementById('header-wallet-balance');
  if (walletIndicator && headerWalletBalance) {
    walletIndicator.style.display = 'none';
    const bal = user.balance !== undefined ? user.balance : 0;
    const remaining = bal >= 99999 ? '∞' : Math.max(0, bal).toFixed(1);
    headerWalletBalance.textContent = `${remaining}`;
  }

  // Populate profile settings inputs
  populateProfileSettings(user);

  // Apply pricing plans features locking and details UI
  applyUserPlanAndLimits(user);

  // Reset all nav buttons inline display styles so CSS role-rules can govern cleanly
  document.querySelectorAll('.glass-navbar .nav-btn').forEach(btn => btn.style.display = '');
  
  const role = user ? (user.role || 'client') : 'guest';
  if (role === 'admin' || role === 'reseller') {
    // Admin & Reseller access
    ['nav-dashboard', 'nav-agents', 'nav-contacts', 'nav-broadcast', 'nav-quick-call', 'nav-crm-automation', 'nav-api-sharing', 'nav-admin-panel'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = 'inline-flex';
    });
    const navBilling = document.getElementById('nav-billing');
    if (navBilling) navBilling.style.display = 'none';
    
    // Populate branding settings form for admin/reseller
    if (typeof window.loadBrandingToForm === 'function') window.loadBrandingToForm();
    
    // Show provider selection ONLY for Super Admin (callio.in main admin)
    const isWL = typeof window.isWhitelabelDomain === 'function' ? window.isWhitelabelDomain() : false;
    const isSuperAdmin = (user && user.role === 'admin' && !isWL);
    const providerGroup = document.getElementById('quick-call-provider-group');
    if (providerGroup) providerGroup.style.display = isSuperAdmin ? 'block' : 'none';

    // Set 2 columns layout for settings tab
    const settingsLayout = document.querySelector('#tab-settings .premium-split-layout');
    if (settingsLayout) {
      settingsLayout.style.gridTemplateColumns = '1fr 1fr';
      settingsLayout.style.maxWidth = 'none';
      settingsLayout.style.margin = '0';
    }
    
    // Show client onboarding panel on dashboard
    const panel = document.getElementById('client-onboarding-panel');
    if (panel) panel.style.display = 'flex';
    
    // Restore active tab or default to dashboard
    let savedTab = localStorage.getItem('activeTab');
    if (!savedTab || savedTab === 'tab-dashboard') savedTab = 'tab-recordings';
    const targetNavBtn = document.querySelector(`.glass-navbar .nav-btn[data-tab="${savedTab}"]`);
    if (targetNavBtn && targetNavBtn.style.display !== 'none') {
      targetNavBtn.click();
    } else {
      const dashBtn = document.getElementById('nav-dashboard');
      if (dashBtn) dashBtn.click();
    }
    
    // Fetch Admin data
    if (typeof fetchAdminRequests === 'function') fetchAdminRequests();
    if (typeof fetchAdminClients === 'function') fetchAdminClients();
    if (typeof fetchAdminTransactions === 'function') fetchAdminTransactions();
    fetchClientDashboardData();
  } else {
    // Client has access to all standard tabs except Admin Panel
    ['nav-dashboard', 'nav-agents', 'nav-contacts', 'nav-broadcast', 'nav-quick-call', 'nav-crm-automation', 'nav-api-sharing', 'nav-billing'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = 'inline-flex';
    });
    const navAdmin = document.getElementById('nav-admin-panel');
    if (navAdmin) navAdmin.style.display = 'none';
    
    // Show settings for client but hide admin-only config panels
    const settingsBtn = document.getElementById('btn-toggle-settings');
    if (settingsBtn) settingsBtn.style.display = 'flex';
    const adminSettingsOnly = document.getElementById('admin-settings-only');
    if (adminSettingsOnly) adminSettingsOnly.style.display = 'none';
    const providerGroup = document.getElementById('quick-call-provider-group');
    if (providerGroup) providerGroup.style.display = 'none';

    // Set single column centered layout for settings tab
    const settingsLayout = document.querySelector('#tab-settings .premium-split-layout');
    if (settingsLayout) {
      settingsLayout.style.gridTemplateColumns = '1fr';
      settingsLayout.style.maxWidth = '600px';
      settingsLayout.style.margin = '0 auto';
    }
    
    // Show client onboarding panel on dashboard
    const panel = document.getElementById('client-onboarding-panel');
    if (panel) panel.style.display = 'flex';
    
    // Restore active tab or default to dashboard
    let savedTab = localStorage.getItem('activeTab');
    if (!savedTab || savedTab === 'tab-dashboard') savedTab = 'tab-recordings';
    const targetNavBtn = document.querySelector(`.glass-navbar .nav-btn[data-tab="${savedTab}"]`);
    if (targetNavBtn && targetNavBtn.style.display !== 'none') {
      targetNavBtn.click();
    } else {
      const dashBtn = document.getElementById('nav-dashboard');
      if (dashBtn) dashBtn.click();
    }
    
    // Fetch Client data
    fetchClientDashboardData();
  }
  
  // Immediately refresh calls list and AI Action Planner for the logged-in user
  refreshCallsList();
}

// 1. Signup Action
let isSigningUp = false;
document.getElementById('btn-signup-submit')?.addEventListener('click', async () => {
  if (isSigningUp) return;

  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const phone = document.getElementById('signup-phone').value.trim();
  const password = document.getElementById('signup-password').value;

  if (!name || !email || !phone || !password) {
    alert('Please fill in all fields.');
    return;
  }

  const btn = document.getElementById('btn-signup-submit');

  try {
    isSigningUp = true;
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.style.cursor = 'not-allowed';
    }

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': window.BrandingContext ? window.BrandingContext.id : '' },
      body: JSON.stringify({ name, email, phone, password })
    });
    const data = await res.json();
    if (data.success) {
      alert('Account created successfully! Auto-logging you in.');
      // Auto login
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': window.BrandingContext ? window.BrandingContext.id : '' },
        body: JSON.stringify({ email, password })
      });
      const loginData = await loginRes.json();
      if (loginData.success) {
        localStorage.removeItem('callio_calls_cache');
        window.callsCache = [];
        callsCache = [];
        window.lastDashboardCalls = [];
        localStorage.setItem('user_session', JSON.stringify(loginData.user));
        localStorage.setItem('activeTab', 'tab-recordings');
        loggedInUser = loginData.user;
        applyUserRole(loggedInUser);
        if (typeof updateDashboardWithClientCalls === 'function') updateDashboardWithClientCalls([]);
      }
    } else {
      alert(data.error || 'Signup failed.');
    }
  } catch (err) {
    console.error('Signup error:', err);
    alert('Signup failed. Please try again.');
  } finally {
    isSigningUp = false;
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }
  }
});

// 2. Login Action
document.getElementById('btn-login-submit')?.addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    alert('Please enter email and password.');
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': window.BrandingContext ? window.BrandingContext.id : '' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.success) {
      localStorage.removeItem('callio_calls_cache');
      window.callsCache = [];
      callsCache = [];
      window.lastDashboardCalls = [];
      localStorage.setItem('user_session', JSON.stringify(data.user));
      localStorage.setItem('activeTab', 'tab-recordings');
      loggedInUser = data.user;
      applyUserRole(loggedInUser);
      if (typeof updateDashboardWithClientCalls === 'function') updateDashboardWithClientCalls([]);
    } else {
      alert(data.error || 'Login failed.');
    }
  } catch (err) {
    console.error('Login error:', err);
    alert('Login failed. Please try again.');
  }
});

// --- Keyboard Usability for Auth Forms ---
// Trigger login on Enter keypress
['login-email', 'login-password'].forEach(id => {
  document.getElementById(id)?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('btn-login-submit')?.click();
    }
  });
});

// Trigger signup on Enter keypress
['signup-name', 'signup-email', 'signup-phone', 'signup-password'].forEach(id => {
  document.getElementById(id)?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('btn-signup-submit')?.click();
    }
  });
});

window.showDashboardSkeletons = function() {
  const container = document.getElementById('ai-action-cards-container');
  if (container && (!container.children.length || container.querySelector('.skeleton-card'))) {
    container.innerHTML = `
      <div class="skeleton-card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div class="skeleton-box" style="width: 120px; height: 18px;"></div>
          <div class="skeleton-box" style="width: 65px; height: 18px; border-radius: 999px;"></div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px; margin: 12px 0;">
          <div class="skeleton-box" style="width: 100%; height: 12px;"></div>
          <div class="skeleton-box" style="width: 80%; height: 12px;"></div>
        </div>
        <div style="display: flex; gap: 8px;">
          <div class="skeleton-box" style="flex: 1; height: 32px;"></div>
          <div class="skeleton-box" style="width: 55px; height: 32px;"></div>
        </div>
      </div>
    `.repeat(3);
  }
};

// 3. Client Dashboard Data Fetch
async function fetchClientDashboardData() {
  if (!loggedInUser) return;
  if (!callsCache || callsCache.length === 0) {
    if (typeof window.showDashboardSkeletons === 'function') window.showDashboardSkeletons();
  }
  
  // Instant render from local cache if available (0ms delay)
  if (Array.isArray(callsCache) && callsCache.length > 0) {
    if (typeof updateDashboardWithClientCalls === 'function') updateDashboardWithClientCalls(callsCache);
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof updateVobizMetrics === 'function') updateVobizMetrics();
  }
  
  try {
    const [plansRes, dashDataRes, callsDataRes, callbacksDataRes] = await Promise.all([
      fetchPlans().catch(() => {}),
      fetch(`/api/client/dashboard-data?clientId=${loggedInUser.id}`).then(r => r.json()).catch(() => null),
      refreshCallsListForDashboard().catch(() => {}),
      typeof refreshCallbacksList === 'function' ? refreshCallbacksList().catch(() => {}) : null
    ]);

    if (dashDataRes && dashDataRes.success) {
      loggedInUser = { ...loggedInUser, ...dashDataRes.client };
      localStorage.setItem('user_session', JSON.stringify(loggedInUser));
      applyUserPlanAndLimits(loggedInUser);
      if (typeof renderClientNumberStatus === 'function') renderClientNumberStatus(dashDataRes.client);
      if (typeof renderClientAgentConfig === 'function') renderClientAgentConfig(dashDataRes.client.agent_config);
      
      const activeSnapshot = dashDataRes.calls || [];
      if (activeSnapshot.length > 0 && Array.isArray(callsCache)) {
        activeSnapshot.forEach(activeCall => {
          const sid = activeCall.callSid || activeCall.sid;
          const idx = callsCache.findIndex(c => (c.callSid || c.sid) === sid);
          if (idx !== -1) {
            callsCache[idx] = { ...callsCache[idx], ...activeCall };
          } else {
            callsCache.unshift(activeCall);
          }
        });
        updateDashboardWithClientCalls(callsCache);
      }
      
      if (typeof window.populateAIActionPlanner === 'function') window.populateAIActionPlanner();
    }
  } catch (err) {
    console.error('Failed to fetch client dashboard:', err);
  }
}

// Fetches full call history and updates dashboard boxes (used by whitelabel clients)
async function refreshCallsListForDashboard() {
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/calls?clientId=${clientId}`);
    const data = await res.json();
    if (data.success) {
      callsCache = data.calls;
      window.callsCache = callsCache; // expose globally for metric modals
      // Re-render dashboard with full history
      updateDashboardWithClientCalls(callsCache);
      renderCallsSidebar();
      if (typeof window.populateAIActionPlanner === 'function') window.populateAIActionPlanner();
    }
  } catch (err) {
    console.error('[refreshCallsListForDashboard] Failed:', err);
  }
}

function updateDashboardWithClientCalls(calls) {
  const safeCalls = Array.isArray(calls) ? calls : [];
  callsCache = safeCalls;
  window.callsCache = safeCalls;
  window.lastDashboardCalls = safeCalls;

  const cacheKey = getUserCallsCacheKey();
  if (cacheKey) {
    if (safeCalls.length > 0) {
      try { localStorage.setItem(cacheKey, JSON.stringify(safeCalls.slice(0, 100))); } catch(e){}
    } else {
      localStorage.removeItem(cacheKey);
    }
  }

  const totalCalls = safeCalls.length;
  const activeCalls = safeCalls.filter(c => c.status === 'active' || c.status === 'calling' || c.status === 'in-progress' || c.status === 'ringing' || c.status === 'queued' || c.status === 'initiated').length;
  const completedCalls = safeCalls.filter(c => c.status === 'completed').length;
  const failedCalls = safeCalls.filter(c => c.status === 'failed' || c.status === 'no-answer' || c.status === 'busy' || c.status === 'voicemail').length;
  const interestedCalls = safeCalls.filter(c => c.summary?.toLowerCase().includes('interested') && !c.summary?.toLowerCase().includes('not interested')).length;
  const pickupRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;

  const elCallsMade = document.getElementById('vb-calls-made');
  const elActiveCalls = document.getElementById('vb-active-calls');
  const elPickupRate = document.getElementById('vb-pickup-rate');
  const elCompletedCalls = document.getElementById('vb-completed-calls');
  const elFailedCalls = document.getElementById('vb-failed-calls');
  const elInterestedCalls = document.getElementById('vb-interested-calls');

  if (elCallsMade) elCallsMade.innerText = totalCalls;
  if (elActiveCalls) elActiveCalls.innerText = activeCalls;
  if (elPickupRate) elPickupRate.innerText = pickupRate + '%';
  if (elCompletedCalls) elCompletedCalls.innerText = completedCalls;
  if (elFailedCalls) elFailedCalls.innerText = failedCalls;
  if (elInterestedCalls) elInterestedCalls.innerText = interestedCalls;

  // Populate dashboard boxes with the full calls list
  populateDashboardBoxes(safeCalls);

  // Update ApexCharts (Call Volume Timeline, AI Sentiments, Recent Call Activity)
  if (typeof updateVobizMetrics === 'function') {
    updateVobizMetrics();
  }
}

function populateDashboardBoxes(calls) {
  if (!Array.isArray(calls)) return;
  // Cache the calls globally for the modal to use across all tabs
  window.lastDashboardCalls = calls;
  window.callsCache = calls;
  callsCache = calls;
  const cacheKey = getUserCallsCacheKey();
  if (cacheKey) {
    if (calls.length > 0) {
      try { localStorage.setItem(cacheKey, JSON.stringify(calls.slice(0, 100))); } catch(e){}
    } else {
      localStorage.removeItem(cacheKey);
    }
  }

  // Re-render modal automatically if currently open
  const modal = document.getElementById('dashboard-metric-detail-modal');
  if (modal && modal.style.display !== 'none' && modal.style.visibility !== 'hidden') {
    window.renderMetricDetailsModalContent();
  }

  // 1. Recent Call Connections (up to 4 calls)
  const lastCallBox = document.getElementById('dashboard-last-call-box');
  if (lastCallBox) {
    if (calls && calls.length > 0) {
      // Filter out calls where 'to' is a virtual/system number (e.g. 917971442441)
      const SYSTEM_NUMBERS = ['917971442441', '7971442441', '971442441'];
      function isDashboardSystemNum(ph) {
        if (!ph) return true;
        const c = String(ph).replace(/\D/g, '');
        return !c || c.length < 7 || SYSTEM_NUMBERS.some(n => c === n || c.endsWith(n) || n.endsWith(c));
      }

      const validCalls = calls.filter(call => {
        // For outgoing: to should be customer, not virtual
        // For incoming: from should be customer, not virtual
        const customerPhone = call.customerNumber || (call.direction === 'incoming' ? call.from : call.to) || call.to;
        return !isDashboardSystemNum(customerPhone);
      });

      const sortedCalls = [...validCalls].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      lastCallBox.innerHTML = '';
      
      if (sortedCalls.length === 0) {
        lastCallBox.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding-top: 30px; font-size: 0.85rem;">No calls yet</div>';
      } else {
      sortedCalls.slice(0, 4).forEach(lastCall => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'space-between';
        div.style.padding = '8px';
        div.style.background = 'rgba(255,255,255,0.01)';
        div.style.border = '1px solid rgba(255,255,255,0.03)';
        div.style.borderRadius = '8px';
        
        const isIncoming = lastCall.direction ? (lastCall.direction === 'incoming') : (loggedInUser && (lastCall.to === loggedInUser.phone_number || (loggedInUser.phone_number && loggedInUser.phone_number.includes(lastCall.to))));
        const icon = isIncoming ? 
          `<span style="color: var(--color-green); font-weight: bold; margin-right: 6px;">⬇</span>` : 
          `<span style="color: var(--color-cyan); font-weight: bold; margin-right: 6px;">⬆</span>`;
        
        // Show best customer-facing number (not the virtual number)
        const customerNum = lastCall.customerNumber
          || (!isDashboardSystemNum(lastCall.to) ? lastCall.to : null)
          || (!isDashboardSystemNum(lastCall.from) ? lastCall.from : null)
          || 'Unknown';
        const partiesText = isIncoming ? `Incoming ➔ You` : `You ➔ ${customerNum}`;
        
        const callDate = new Date(lastCall.createdAt);
        const timeText = isNaN(callDate.getTime()) ? '-' : callDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let badgeStyle = 'background: rgba(239, 68, 68, 0.1); color: var(--color-red); border: 1px solid rgba(239, 68, 68, 0.2);';
        if (lastCall.status === 'completed') {
          badgeStyle = 'background: rgba(16, 185, 129, 0.1); color: var(--color-green); border: 1px solid rgba(16, 185, 129, 0.2);';
        }
        
        div.innerHTML = `
          <div style="display: flex; align-items: center; gap: 4px;">
            ${icon}
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 0.85rem; color: var(--text-main); font-weight: 500;">${partiesText}</span>
              <span style="font-size: 0.72rem; color: var(--text-muted);">${timeText}</span>
            </div>
          </div>
          <span class="badge" style="margin: 0; padding: 2px 6px; font-size: 0.7rem; ${badgeStyle}">${lastCall.status}</span>
        `;
        lastCallBox.appendChild(div);
      });
      }
    } else {
      lastCallBox.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding-top: 30px; font-size: 0.85rem;">No calls yet</div>';
    }
  }

  // 2. Today's Traffic (Circular Donut Gauge)
  const today = new Date().toDateString();
  const todayCalls = calls ? calls.filter(c => c.createdAt && new Date(c.createdAt).toDateString() === today) : [];
  const incomingCount = todayCalls.filter(c => c.direction ? (c.direction === 'incoming') : (loggedInUser && (c.to === loggedInUser.phone_number || (loggedInUser.phone_number && loggedInUser.phone_number.includes(c.to))))).length;
  const outgoingCount = todayCalls.length - incomingCount;
  const totalToday = incomingCount + outgoingCount;
  
  const incEl = document.getElementById('traffic-incoming-count');
  const outEl = document.getElementById('traffic-outgoing-count');
  const totalEl = document.getElementById('traffic-total-count');
  const ratioEl = document.getElementById('traffic-ratio-text');
  const incBar = document.getElementById('traffic-incoming-bar');
  const outBar = document.getElementById('traffic-outgoing-bar');
  
  if (incEl) incEl.innerText = incomingCount;
  if (outEl) outEl.innerText = outgoingCount;
  if (totalEl) totalEl.innerText = totalToday;
  
  if (totalToday > 0) {
    const incPct = Math.round((incomingCount / totalToday) * 100);
    const outPct = 100 - incPct;

    if (incBar) incBar.style.width = `${incPct}%`;
    if (outBar) outBar.style.width = `${outPct}%`;

    if (ratioEl) {
      if (outPct > incPct) {
        ratioEl.innerText = `${outPct}% Outbound Dialing Ratio`;
        ratioEl.style.color = 'var(--color-cyan)';
      } else if (incPct > outPct) {
        ratioEl.innerText = `${incPct}% Inbound Dialing Ratio`;
        ratioEl.style.color = 'var(--color-green)';
      } else {
        ratioEl.innerText = '50% Inbound / 50% Outbound (Balanced)';
        ratioEl.style.color = '#f59e0b';
      }
    }
  } else {
    if (incBar) incBar.style.width = '50%';
    if (outBar) outBar.style.width = '50%';
    if (ratioEl) {
      ratioEl.innerText = 'No Traffic Today';
      ratioEl.style.color = 'var(--text-muted)';
    }
  }

  // 3. Recent AI Summaries
function formatParsedSummaryHTML(summaryRaw, compact = false) {
  if (!summaryRaw) return '<span style="color: var(--text-muted); font-size: 0.8rem;">No AI analysis available</span>';
  
  const parsed = parseCallSummary(summaryRaw);
  
  let verdictText = parsed.verdict || '';
  if (!verdictText) {
    const isInt = summaryRaw.toLowerCase().includes('interested') && !summaryRaw.toLowerCase().includes('not interested');
    verdictText = isInt ? 'INTERESTED' : 'NOT INTERESTED / UNREACHABLE';
  }

  const isInterested = verdictText.toLowerCase().includes('interested') && !verdictText.toLowerCase().includes('not');
  const vBg = isInterested ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)';
  const vColor = isInterested ? '#10b981' : '#ef4444';
  const vBorder = isInterested ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)';
  const verdictBadge = `<span style="padding: 3px 10px; border-radius: 6px; font-weight: 800; font-size: 0.72rem; text-transform: uppercase; background: ${vBg}; color: ${vColor}; border: 1px solid ${vBorder}; letter-spacing: 0.5px; display: inline-block;">VERDICT: ${escapeHtml(verdictText.toUpperCase())}</span>`;

  const cleanText = parsed.cleanSummary || summaryRaw.replace(/\*\*/g, '').trim();

  if (compact) {
    return `
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div>${verdictBadge}</div>
        <div style="color: var(--text-muted); font-size: 0.76rem; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">${escapeHtml(cleanText)}</div>
      </div>
    `;
  }

  const summaryBody = cleanText ? `<div style="font-size: 0.82rem; color: var(--text-main); line-height: 1.5; margin-top: 6px; background: rgba(0,0,0,0.15); padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.04);">${escapeHtml(cleanText)}</div>` : '';

  let actionBox = '';
  if (parsed.actionToTake) {
    actionBox = `
      <div style="margin-top: 8px; padding: 8px 12px; background: rgba(6, 182, 212, 0.08); border: 1px dashed rgba(6, 182, 212, 0.3); border-radius: 8px; font-size: 0.78rem; color: var(--color-cyan); font-weight: 600; display: flex; align-items: center; gap: 6px;">
        <span>⚡ <strong>Recommended Action:</strong> ${escapeHtml(parsed.actionToTake)}</span>
      </div>
    `;
  }

  return `
    <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
      <div style="display: flex; align-items: center; gap: 6px;">${verdictBadge}</div>
      ${summaryBody}
      ${actionBox}
    </div>
  `;
}

window.navigateToSummariesPage = function() {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  const target = document.getElementById('tab-ai-summaries');
  if (target) target.style.display = 'block';
  window.renderAISummariesPageTable();
};

window.summariesPageFilter = 'all';

window.filterSummariesPage = function(filter, btnEl) {
  window.summariesPageFilter = filter;
  const buttons = document.querySelectorAll('#page-sum-filter-buttons .btn-filter-sum');
  buttons.forEach(btn => {
    btn.style.borderColor = 'var(--border-color)';
    btn.style.background = 'var(--bg-surface)';
    btn.style.color = 'var(--text-muted)';
    btn.style.fontWeight = '600';
  });
  if (btnEl) {
    btnEl.style.borderColor = 'var(--color-cyan)';
    btnEl.style.background = 'rgba(6, 182, 212, 0.15)';
    btnEl.style.color = 'var(--color-cyan)';
    btnEl.style.fontWeight = '700';
  }
  window.renderAISummariesPageTable();
};

window.renderAISummariesPageTable = function() {
  const container = document.getElementById('page-summaries-list-container');
  if (!container) return;

  const calls = Array.isArray(window.lastDashboardCalls || window.callsCache) ? (window.lastDashboardCalls || window.callsCache) : [];
  const callsWithSummary = calls.filter(c => c.summary && c.summary.trim() !== '');

  // Counters
  const totalCount = callsWithSummary.length;
  const interestedCount = callsWithSummary.filter(c => {
    const parsed = parseCallSummary(c.summary);
    return parsed.verdict.toLowerCase().includes('interested') && !parsed.verdict.toLowerCase().includes('not');
  }).length;
  const notInterestedCount = totalCount - interestedCount;

  const elTotal = document.getElementById('page-sum-total-count');
  const elInterested = document.getElementById('page-sum-interested-count');
  const elNotInterested = document.getElementById('page-sum-notinterested-count');

  if (elTotal) elTotal.innerText = totalCount;
  if (elInterested) elInterested.innerText = interestedCount;
  if (elNotInterested) elNotInterested.innerText = notInterestedCount;

  // Filtering
  const filter = window.summariesPageFilter || 'all';
  const searchInput = document.getElementById('page-sum-search-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let list = callsWithSummary;
  if (filter === 'interested') {
    list = list.filter(c => {
      const parsed = parseCallSummary(c.summary);
      return parsed.verdict.toLowerCase().includes('interested') && !parsed.verdict.toLowerCase().includes('not');
    });
  } else if (filter === 'not_interested') {
    list = list.filter(c => {
      const parsed = parseCallSummary(c.summary);
      return !parsed.verdict.toLowerCase().includes('interested') || parsed.verdict.toLowerCase().includes('not');
    });
  }

  if (query) {
    list = list.filter(c => {
      const sum = String(c.summary || '').toLowerCase();
      const phone = String(c.to || c.from || '').toLowerCase();
      return sum.includes(query) || phone.includes(query);
    });
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 50px 20px; color: var(--text-muted); font-size: 0.95rem;">
        <div style="font-size: 2.5rem; margin-bottom: 10px;">🤖</div>
        No AI call summaries match the selected criteria.
      </div>
    `;
    return;
  }

  let html = '';
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach(c => {
    const isIncoming = c.direction ? (c.direction === 'incoming') : (loggedInUser && (c.to === loggedInUser.phone_number || (loggedInUser.phone_number && loggedInUser.phone_number.includes(c.to))));
    const directionIcon = isIncoming ? 
      `<span style="color: var(--color-green); font-weight: bold;">⬇ Incoming</span>` : 
      `<span style="color: var(--color-cyan); font-weight: bold;">⬆ Outgoing</span>`;

    const toNum = c.to || 'Unknown';
    const partiesText = isIncoming ? `Caller ➔ You` : `You ➔ ${toNum}`;

    const callDate = new Date(c.createdAt);
    const timeText = isNaN(callDate.getTime()) ? '' : callDate.toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

    // Calculate duration using fallbacks
    const end = c.endedAt || c.updatedAt;
    const start = c.startedAt || c.createdAt;
    const durationSecs = end && start ? Math.round((new Date(end) - new Date(start)) / 1000) : null;
    const durationText = durationSecs !== null && durationSecs >= 0 ? durationSecs + 's' : '-';

    const formattedSummary = formatParsedSummaryHTML(c.summary, false);

    html += `
      <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 10px; transition: border-color 0.2s;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 10px; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            ${directionIcon}
            <strong style="color: var(--text-main); font-size: 1rem; font-family: var(--font-mono);">${partiesText}</strong>
          </div>
          <div style="display: flex; align-items: center; gap: 12px; font-size: 0.8rem; color: var(--text-muted);">
            <span>🕒 ${timeText}</span>
            <span>Duration: <strong style="color: var(--text-main);">${durationText}</strong></span>
          </div>
        </div>
        ${formattedSummary}
      </div>
    `;
  });

  container.innerHTML = html;
};

  const summariesList = document.getElementById('dashboard-summaries-list');
  if (summariesList) {
    if (calls && calls.length > 0) {
      const callsWithSummary = calls
        .filter(c => c.summary && c.summary.trim() !== '')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
      if (callsWithSummary.length > 0) {
        summariesList.innerHTML = '';
        callsWithSummary.slice(0, 3).forEach(c => {
          const div = document.createElement('div');
          div.style.padding = '10px 12px';
          div.style.background = 'rgba(255,255,255,0.02)';
          div.style.border = '1px solid var(--border-color)';
          div.style.borderRadius = '10px';
          div.style.marginBottom = '6px';
          
          const isIncoming = c.direction ? (c.direction === 'incoming') : (loggedInUser && (c.to === loggedInUser.phone_number || (loggedInUser.phone_number && loggedInUser.phone_number.includes(c.to))));
          const parsed = parseCallSummary(c.summary);
          const cleanText = parsed.cleanSummary || c.summary.replace(/\*\*/g, '').trim();
          const isInterested = parsed.verdict.toLowerCase().includes('interested') && !parsed.verdict.toLowerCase().includes('not');
          const badgeColor = isInterested ? 'var(--color-green)' : 'var(--color-red)';
          const badgeText = isInterested ? 'Interested' : 'No Interest';

          div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 600; margin-bottom: 4px; font-size: 0.78rem;">
              <span style="color: var(--text-main);">${isIncoming ? 'Incoming ➔ You' : `You ➔ ${c.to || 'Unknown'}`}</span>
              <span style="font-size: 0.72rem; font-weight: 700; color: ${badgeColor}; display: flex; align-items: center; gap: 5px;">
                <span style="width: 7px; height: 7px; border-radius: 50%; background: ${badgeColor}; display: inline-block;"></span>
                ${badgeText}
              </span>
            </div>
            <div style="color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.35;" title="${escapeHtml(cleanText)}">${escapeHtml(cleanText)}</div>
          `;
          summariesList.appendChild(div);
        });
      } else {
        summariesList.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding-top: 30px; font-size: 0.85rem;">No summaries available</div>';
      }
    } else {
      summariesList.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding-top: 30px; font-size: 0.85rem;">No summaries available</div>';
    }
  }
}

async function refreshCallbacksList() {
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/api/callbacks?clientId=${clientId}`);
    const data = await res.json();
    if (data.success) {
      let callbacks = data.callbacks || [];
      if (loggedInUser && loggedInUser.role !== 'admin') {
        const clientAgentIds = localAgentsCache.map(a => a.id);
        callbacks = callbacks.filter(cb => 
          cb.clientId === loggedInUser.id || 
          clientAgentIds.includes(cb.agentId)
        );
      }
      // Save globally
      window.lastDashboardCallbacks = callbacks;
      renderDashboardCallbacks(callbacks);
      
      // Auto-refresh full page tab
      window.renderScheduledCallbacksPageTable();

      // Auto-refresh the modal if it's currently open
      const modal = document.getElementById('callbacks-modal');
      if (modal && modal.style.display === 'flex') {
        renderCallbacksModalContent();
      }
    }
  } catch (err) {
    console.error('[Callbacks Fetch Error] Failed:', err);
  }
}

window.fetchCallbacksList = refreshCallbacksList;

window.switchFullPageTab = function(targetTabId) {
  document.querySelectorAll('.glass-navbar .nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });

  const targetPane = document.getElementById(targetTabId);
  if (targetPane) {
    targetPane.classList.add('active');
    targetPane.style.display = 'block';
  }

  localStorage.setItem('activeTab', targetTabId);
  document.documentElement.setAttribute('data-active-tab', targetTabId);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.navigateToCallbacksPage = function() {
  window.switchFullPageTab('tab-callbacks');
  if (typeof refreshCallbacksList === 'function') refreshCallbacksList();
  window.renderScheduledCallbacksPageTable();
};

window.navigateToTodayCallsPage = function() {
  window.switchFullPageTab('tab-today-calls');
  window.renderTodayCallsPageTable();
};

window.openMetricDetailsModal = function(filterType) {
  window.navigateToTodayCallsPage();
  if (filterType && typeof window.filterTodayCallsPage === 'function') {
    const filterMap = {
      'total': 'all',
      'completed': 'completed',
      'failed': 'failed',
      'interested': 'all',
      'pickup': 'all',
      'active': 'all'
    };
    const targetFilter = filterMap[filterType] || 'all';
    const btn = document.querySelector(`.btn-filter-calls[onclick*="${targetFilter}"]`);
    window.filterTodayCallsPage(targetFilter, btn);
  }
};

window.navigateToAISummariesPage = function() {
  window.switchFullPageTab('tab-ai-summaries');
  window.renderAISummariesPageTable();
};

function renderDashboardCallbacks(callbacks) {
  const callbacksList = document.getElementById('dashboard-callbacks-list');
  if (!callbacksList) return;

  if (callbacks.length > 0) {
    callbacksList.innerHTML = '';
    // Show top 5 callbacks
    callbacks.slice(0, 5).forEach(cb => {
      const div = document.createElement('div');
      div.className = 'callback-item';
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.justifyContent = 'space-between';
      div.style.padding = '8px 12px';
      div.style.background = 'rgba(255,255,255,0.02)';
      div.style.border = '1px solid var(--border-color)';
      div.style.borderRadius = '10px';

      const cbDate = new Date(cb.scheduledAt);
      const timeText = isNaN(cbDate.getTime()) 
        ? cb.requestedTime 
        : cbDate.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

      const nameOrPhone = cb.name || cb.phone || 'Unknown';
      let statusBadgeColor = 'var(--color-orange)';
      let statusText = String(cb.status || 'pending').toUpperCase();

      if (cb.status === 'dialed' || cb.status === 'completed') {
        statusBadgeColor = 'var(--color-green)';
      } else if (cb.status === 'dialing' || cb.status === 'in-progress') {
        statusBadgeColor = 'var(--color-cyan)';
      } else if (cb.status === 'failed') {
        statusBadgeColor = 'var(--color-red)';
      }

      div.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; color: ${statusBadgeColor};"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          <div style="display: flex; flex-direction: column;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 0.82rem; color: var(--text-main); font-weight: 600;">${nameOrPhone}</span>
              <span style="font-size: 0.6rem; padding: 1px 5px; border-radius: 4px; color: ${statusBadgeColor}; border: 1px solid ${statusBadgeColor}; font-weight: 700;">${statusText}</span>
            </div>
            <span style="font-size: 0.7rem; color: var(--text-muted);">${timeText} (${cb.requestedTime})</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button onclick="window.triggerCallbackCallDirect('${cb.id}')" class="btn btn-primary" style="padding: 3px 8px; font-size: 0.68rem; background: var(--color-cyan); border: none; border-radius: 6px; color: #000; font-weight: 800; cursor: pointer;">Call Now</button>
          <button onclick="window.deleteCallbackDirect('${cb.id}')" style="background: transparent; border: none; color: var(--color-red); cursor: pointer; padding: 2px; display: flex; align-items: center;" title="Cancel callback">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      `;
      callbacksList.appendChild(div);
    });
  } else {
    callbacksList.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding-top: 30px; font-size: 0.85rem;">No callbacks scheduled</div>';
  }
}

// 1. TODAY'S CALLS HISTORY PAGE (Full Page with 50-item Pagination & Search)
window.todayCallsPageFilter = 'all';
window.todayCallsPageNumber = 1;

window.filterTodayCallsPage = function(filter, btnEl) {
  window.todayCallsPageFilter = filter;
  window.todayCallsPageNumber = 1;
  const buttons = document.querySelectorAll('#page-calls-filter-buttons .btn-filter-calls');
  buttons.forEach(btn => {
    btn.style.borderColor = 'var(--border-color)';
    btn.style.background = 'var(--bg-surface)';
    btn.style.color = 'var(--text-muted)';
    btn.style.fontWeight = '600';
  });
  if (btnEl) {
    btnEl.style.borderColor = 'var(--color-cyan)';
    btnEl.style.background = 'rgba(6, 182, 212, 0.15)';
    btnEl.style.color = 'var(--color-cyan)';
    btnEl.style.fontWeight = '700';
  }
  window.renderTodayCallsPageTable();
};

window.renderTodayCallsPageTable = function() {
  const container = document.getElementById('page-today-calls-list-container');
  if (!container) return;

  const calls = Array.isArray(window.callsCache) ? window.callsCache : [];

  const totalCount = calls.length;
  const completedCount = calls.filter(c => c.status === 'completed').length;
  const failedCount = calls.filter(c => c.status === 'failed' || c.status === 'no-answer' || c.status === 'busy').length;

  const elTotal = document.getElementById('page-calls-total-count');
  const elCompleted = document.getElementById('page-calls-completed-count');
  const elFailed = document.getElementById('page-calls-failed-count');

  if (elTotal) elTotal.innerText = totalCount;
  if (elCompleted) elCompleted.innerText = completedCount;
  if (elFailed) elFailed.innerText = failedCount;

  const filter = window.todayCallsPageFilter || 'all';
  const searchInput = document.getElementById('page-calls-search-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let list = calls;
  if (filter === 'completed') {
    list = list.filter(c => c.status === 'completed');
  } else if (filter === 'failed') {
    list = list.filter(c => c.status === 'failed' || c.status === 'no-answer' || c.status === 'busy');
  }

  if (query) {
    list = list.filter(c => {
      const phone = String(c.to || c.from || c.phone || '').toLowerCase();
      const status = String(c.status || '').toLowerCase();
      const direction = String(c.direction || '').toLowerCase();
      return phone.includes(query) || status.includes(query) || direction.includes(query);
    });
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 50px 20px; color: var(--text-muted); font-size: 0.95rem;">
        <div style="font-size: 2.5rem; margin-bottom: 10px;">📞</div>
        No call records match the selected criteria.
      </div>
    `;
    const pagContainer = document.getElementById('page-today-calls-pagination');
    if (pagContainer) pagContainer.innerHTML = '';
    return;
  }

  const itemsPerPage = 50;
  const totalPages = Math.ceil(list.length / itemsPerPage);
  if (window.todayCallsPageNumber < 1) window.todayCallsPageNumber = 1;
  if (window.todayCallsPageNumber > totalPages) window.todayCallsPageNumber = totalPages;

  const startIndex = (window.todayCallsPageNumber - 1) * itemsPerPage;
  const pageItems = list.slice(startIndex, startIndex + itemsPerPage);

  let html = '';
  pageItems.forEach(call => {
    const isOut = call.direction === 'outgoing' || call.direction === 'outbound';
    const arrow = isOut ? '⬆ Outgoing' : '⬇ Incoming';
    const arrowColor = isOut ? 'var(--color-cyan)' : 'var(--color-green)';
    const phone = call.to || call.from || call.phone || 'Unknown Number';
    const duration = call.duration ? `${call.duration}s` : 'N/A';
    const timeText = call.timestamp || call.createdAt ? new Date(call.timestamp || call.createdAt).toLocaleString() : 'Recent';

    let statusStyle = 'background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);';
    if (call.status === 'failed' || call.status === 'no-answer' || call.status === 'busy') {
      statusStyle = 'background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);';
    } else if (call.status === 'active' || call.status === 'in-progress' || call.status === 'calling') {
      statusStyle = 'background: rgba(6, 182, 212, 0.15); color: #06b6d4; border: 1px solid rgba(6, 182, 212, 0.3);';
    }

    html += `
      <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 14px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 220px;">
          <div style="font-size: 1.1rem; color: ${arrowColor}; font-weight: 800;">${arrow.startsWith('⬆') ? '⬆' : '⬇'}</div>
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <strong style="font-size: 1.05rem; color: var(--text-main); font-family: var(--font-mono);">${phone}</strong>
              <span style="padding: 2px 8px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; ${statusStyle}">${call.status || 'completed'}</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
              ${timeText} • Duration: <strong>${duration}</strong> • Direction: <span style="color:${arrowColor}; font-weight:700;">${arrow}</span>
            </div>
          </div>
        </div>
        <div>
          <button onclick="window.triggerLeadCall('${phone}')" class="btn btn-primary" style="padding: 6px 14px; font-size: 0.78rem; border-radius: 8px; background: linear-gradient(135deg, var(--color-primary, #ea580c), #ae3115); border: none; color: #fff; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px;">
            📞 Redial
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  const pagContainer = document.getElementById('page-today-calls-pagination');
  if (pagContainer) {
    const endIndex = Math.min(startIndex + itemsPerPage, list.length);
    pagContainer.innerHTML = `
      <div style="font-size: 0.82rem; color: var(--text-muted);">
        Showing <strong>${startIndex + 1}–${endIndex}</strong> of <strong>${list.length}</strong> calls
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button onclick="window.changeTodayCallsPage(-1)" ${window.todayCallsPageNumber <= 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} style="padding: 6px 12px; font-size: 0.8rem; border-radius: 8px; background: var(--bg-surface); border: 1px solid var(--border-color); color: var(--text-main); cursor: pointer;">Prev</button>
        <span style="font-size: 0.82rem; color: var(--text-main); font-weight: 700;">Page ${window.todayCallsPageNumber} of ${totalPages}</span>
        <button onclick="window.changeTodayCallsPage(1)" ${window.todayCallsPageNumber >= totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} style="padding: 6px 12px; font-size: 0.8rem; border-radius: 8px; background: var(--bg-surface); border: 1px solid var(--border-color); color: var(--text-main); cursor: pointer;">Next</button>
      </div>
    `;
  }
};

window.changeTodayCallsPage = function(delta) {
  window.todayCallsPageNumber = (window.todayCallsPageNumber || 1) + delta;
  window.renderTodayCallsPageTable();
};

// 2. SCHEDULED CALLBACKS PAGE (Full Page with 50-item Pagination & Search)
window.callbacksPageFilter = 'all';
window.callbacksPageNumber = 1;

window.filterCallbacksPage = function(filter, btnEl) {
  window.callbacksPageFilter = filter;
  window.callbacksPageNumber = 1;
  const buttons = document.querySelectorAll('#page-cb-filter-buttons .btn-filter-cb');
  buttons.forEach(btn => {
    btn.style.borderColor = 'var(--border-color)';
    btn.style.background = 'var(--bg-surface)';
    btn.style.color = 'var(--text-muted)';
    btn.style.fontWeight = '600';
  });
  if (btnEl) {
    btnEl.style.borderColor = 'var(--color-cyan)';
    btnEl.style.background = 'rgba(6, 182, 212, 0.15)';
    btnEl.style.color = 'var(--color-cyan)';
    btnEl.style.fontWeight = '700';
  }
  window.renderScheduledCallbacksPageTable();
};

window.renderScheduledCallbacksPageTable = function() {
  const container = document.getElementById('page-callbacks-list-container');
  if (!container) return;

  const callbacks = Array.isArray(window.lastDashboardCallbacks) ? window.lastDashboardCallbacks : [];

  const totalCount = callbacks.length;
  const pendingCount = callbacks.filter(c => c.status === 'pending' || c.status === 'dialing').length;
  const dialedCount = callbacks.filter(c => c.status === 'dialed' || c.status === 'completed').length;
  const failedCount = callbacks.filter(c => c.status === 'failed').length;

  const elTotal = document.getElementById('page-cb-total-count');
  const elPending = document.getElementById('page-cb-pending-count');
  const elDialed = document.getElementById('page-cb-dialed-count');
  const elFailed = document.getElementById('page-cb-failed-count');

  if (elTotal) elTotal.innerText = totalCount;
  if (elPending) elPending.innerText = pendingCount;
  if (elDialed) elDialed.innerText = dialedCount;
  if (elFailed) elFailed.innerText = failedCount;

  const filter = window.callbacksPageFilter || 'all';
  const searchInput = document.getElementById('page-cb-search-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let list = callbacks;
  if (filter === 'pending') {
    list = list.filter(c => c.status === 'pending' || c.status === 'dialing');
  } else if (filter === 'dialed') {
    list = list.filter(c => c.status === 'dialed' || c.status === 'completed');
  } else if (filter === 'failed') {
    list = list.filter(c => c.status === 'failed');
  }

  if (query) {
    list = list.filter(c => {
      const name = String(c.name || '').toLowerCase();
      const phone = String(c.phone || '').toLowerCase();
      const notes = String(c.notes || '').toLowerCase();
      return name.includes(query) || phone.includes(query) || notes.includes(query);
    });
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 50px 20px; color: var(--text-muted); font-size: 0.95rem;">
        <div style="font-size: 2.5rem; margin-bottom: 10px;">📅</div>
        No scheduled callbacks match the selected criteria.
      </div>
    `;
    const pagContainer = document.getElementById('page-callbacks-pagination');
    if (pagContainer) pagContainer.innerHTML = '';
    return;
  }

  const itemsPerPage = 50;
  const totalPages = Math.ceil(list.length / itemsPerPage);
  if (window.callbacksPageNumber < 1) window.callbacksPageNumber = 1;
  if (window.callbacksPageNumber > totalPages) window.callbacksPageNumber = totalPages;

  const startIndex = (window.callbacksPageNumber - 1) * itemsPerPage;
  const pageItems = list.slice(startIndex, startIndex + itemsPerPage);

  let html = '';
  pageItems.forEach(cb => {
    const cbDate = new Date(cb.scheduledAt);
    const timeText = isNaN(cbDate.getTime()) 
      ? cb.requestedTime 
      : cbDate.toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

    let statusStyle = 'background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);';
    if (cb.status === 'dialed' || cb.status === 'completed') {
      statusStyle = 'background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);';
    } else if (cb.status === 'dialing') {
      statusStyle = 'background: rgba(6, 182, 212, 0.15); color: #06b6d4; border: 1px solid rgba(6, 182, 212, 0.3);';
    } else if (cb.status === 'failed') {
      statusStyle = 'background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);';
    }

    html += `
      <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 14px; padding: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; transition: border-color 0.2s;">
        <div style="display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 240px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <strong style="font-size: 1.05rem; color: var(--text-main); font-family: var(--font-mono);">${cb.name || cb.phone || 'Unknown'}</strong>
            <span style="padding: 2px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; ${statusStyle}">${cb.status}</span>
          </div>
          <div style="font-size: 0.82rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
            <span>🕒 ${timeText}</span>
            <span style="opacity: 0.6;">• Offset: ${cb.requestedTime}</span>
          </div>
          ${cb.notes ? `<div style="font-size: 0.8rem; color: #a78bfa; font-style: italic; margin-top: 2px;">💬 Note: ${cb.notes}</div>` : ''}
          ${cb.error ? `<div style="font-size: 0.78rem; color: #ef4444; margin-top: 2px;">❌ Error: ${cb.error}</div>` : ''}
        </div>

        <div style="display: flex; gap: 10px; align-items: center;">
          ${cb.status !== 'dialed' && cb.status !== 'dialing' ? `
            <button onclick="window.triggerCallbackCallDirect('${cb.id}')" class="btn btn-primary" style="padding: 8px 16px; font-size: 0.8rem; background: var(--color-cyan); border: none; border-radius: 8px; color: #000; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              ⚡ Call Now
            </button>
            <button onclick="window.rescheduleCallbackDirect('${cb.id}')" class="btn btn-secondary" style="padding: 8px 14px; font-size: 0.8rem; border-radius: 8px; cursor: pointer; color: var(--text-main); background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); font-weight: 600;">Reschedule</button>
          ` : ''}
          <button onclick="window.deleteCallbackDirect('${cb.id}')" class="btn btn-danger" style="padding: 8px 14px; font-size: 0.8rem; border-radius: 8px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-weight: 700; cursor: pointer;">Cancel</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  const pagContainer = document.getElementById('page-callbacks-pagination');
  if (pagContainer) {
    const endIndex = Math.min(startIndex + itemsPerPage, list.length);
    pagContainer.innerHTML = `
      <div style="font-size: 0.82rem; color: var(--text-muted);">
        Showing <strong>${startIndex + 1}–${endIndex}</strong> of <strong>${list.length}</strong> callbacks
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button onclick="window.changeCallbacksPage(-1)" ${window.callbacksPageNumber <= 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} style="padding: 6px 12px; font-size: 0.8rem; border-radius: 8px; background: var(--bg-surface); border: 1px solid var(--border-color); color: var(--text-main); cursor: pointer;">Prev</button>
        <span style="font-size: 0.82rem; color: var(--text-main); font-weight: 700;">Page ${window.callbacksPageNumber} of ${totalPages}</span>
        <button onclick="window.changeCallbacksPage(1)" ${window.callbacksPageNumber >= totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} style="padding: 6px 12px; font-size: 0.8rem; border-radius: 8px; background: var(--bg-surface); border: 1px solid var(--border-color); color: var(--text-main); cursor: pointer;">Next</button>
      </div>
    `;
  }
};

window.changeCallbacksPage = function(delta) {
  window.callbacksPageNumber = (window.callbacksPageNumber || 1) + delta;
  window.renderScheduledCallbacksPageTable();
};

// 3. AI SUMMARIES PAGE (Full Page with 50-item Pagination & Search)
window.summariesPageFilter = 'all';
window.summariesPageNumber = 1;

window.filterSummariesPage = function(filter, btnEl) {
  window.summariesPageFilter = filter;
  window.summariesPageNumber = 1;
  const buttons = document.querySelectorAll('#page-sum-filter-buttons .btn-filter-sum');
  buttons.forEach(btn => {
    btn.style.borderColor = 'var(--border-color)';
    btn.style.background = 'var(--bg-surface)';
    btn.style.color = 'var(--text-muted)';
    btn.style.fontWeight = '600';
  });
  if (btnEl) {
    btnEl.style.borderColor = 'var(--color-cyan)';
    btnEl.style.background = 'rgba(6, 182, 212, 0.15)';
    btnEl.style.color = 'var(--color-cyan)';
    btnEl.style.fontWeight = '700';
  }
  window.renderAISummariesPageTable();
};

window.renderAISummariesPageTable = function() {
  const container = document.getElementById('page-summaries-list-container');
  if (!container) return;

  const calls = Array.isArray(window.callsCache) ? window.callsCache : [];
  const callsWithSummary = calls.filter(c => c.summary || c.insights);

  const totalCount = callsWithSummary.length;
  const interestedCount = callsWithSummary.filter(c => String(c.summary || '').toLowerCase().includes('interested') && !String(c.summary || '').toLowerCase().includes('not interested')).length;
  const notInterestedCount = totalCount - interestedCount;

  const elTotal = document.getElementById('page-sum-total-count');
  const elInterested = document.getElementById('page-sum-interested-count');
  const elNotInterested = document.getElementById('page-sum-notinterested-count');

  if (elTotal) elTotal.innerText = totalCount;
  if (elInterested) elInterested.innerText = interestedCount;
  if (elNotInterested) elNotInterested.innerText = notInterestedCount;

  const filter = window.summariesPageFilter || 'all';
  const searchInput = document.getElementById('page-sum-search-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let list = callsWithSummary;
  if (filter === 'interested') {
    list = list.filter(c => String(c.summary || '').toLowerCase().includes('interested') && !String(c.summary || '').toLowerCase().includes('not interested'));
  } else if (filter === 'not_interested') {
    list = list.filter(c => String(c.summary || '').toLowerCase().includes('not interested') || !String(c.summary || '').toLowerCase().includes('interested'));
  }

  if (query) {
    list = list.filter(c => {
      const phone = String(c.to || c.from || c.phone || '').toLowerCase();
      const summary = String(c.summary || '').toLowerCase();
      const action = String(c.actionToTake || '').toLowerCase();
      return phone.includes(query) || summary.includes(query) || action.includes(query);
    });
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 50px 20px; color: var(--text-muted); font-size: 0.95rem;">
        <div style="font-size: 2.5rem; margin-bottom: 10px;">🤖</div>
        No AI summaries match the selected criteria.
      </div>
    `;
    const pagContainer = document.getElementById('page-summaries-pagination');
    if (pagContainer) pagContainer.innerHTML = '';
    return;
  }

  const itemsPerPage = 50;
  const totalPages = Math.ceil(list.length / itemsPerPage);
  if (window.summariesPageNumber < 1) window.summariesPageNumber = 1;
  if (window.summariesPageNumber > totalPages) window.summariesPageNumber = totalPages;

  const startIndex = (window.summariesPageNumber - 1) * itemsPerPage;
  const pageItems = list.slice(startIndex, startIndex + itemsPerPage);

  let html = '';
  pageItems.forEach(call => {
    const phone = call.to || call.from || call.phone || 'Unknown';
    const summary = call.summary || 'No summary text available.';
    const action = call.actionToTake || 'Follow up with lead';
    const timeText = call.timestamp || call.createdAt ? new Date(call.timestamp || call.createdAt).toLocaleString() : 'Recent';
    const isInterested = String(summary).toLowerCase().includes('interested') && !String(summary).toLowerCase().includes('not interested');

    const badgeBg = isInterested ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    const badgeColor = isInterested ? '#10b981' : '#ef4444';
    const badgeBorder = isInterested ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)';
    const verdictText = isInterested ? 'INTERESTED' : 'NEUTRAL / UNREACHABLE';

    html += `
      <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.1rem; color: var(--color-cyan);">📞</span>
            <strong style="font-size: 1.05rem; color: var(--text-main); font-family: var(--font-mono);">${phone}</strong>
            <span style="padding: 2px 10px; border-radius: 20px; font-size: 0.68rem; font-weight: 800; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder};">${verdictText}</span>
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">🕒 ${timeText}</div>
        </div>

        <div style="font-size: 0.85rem; color: var(--text-main); line-height: 1.5; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px;">
          ${summary}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div style="font-size: 0.78rem; color: var(--color-cyan); font-weight: 700; display: flex; align-items: center; gap: 6px;">
            <span>⚡ Recommended Action:</span> ${action}
          </div>
          <button onclick="window.triggerLeadCall('${phone}')" class="btn btn-primary" style="padding: 6px 14px; font-size: 0.78rem; border-radius: 8px; background: linear-gradient(135deg, var(--color-primary, #ea580c), #ae3115); border: none; color: #fff; font-weight: 700; cursor: pointer;">
            Call Back Lead
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  const pagContainer = document.getElementById('page-summaries-pagination');
  if (pagContainer) {
    const endIndex = Math.min(startIndex + itemsPerPage, list.length);
    pagContainer.innerHTML = `
      <div style="font-size: 0.82rem; color: var(--text-muted);">
        Showing <strong>${startIndex + 1}–${endIndex}</strong> of <strong>${list.length}</strong> summaries
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button onclick="window.changeSummariesPage(-1)" ${window.summariesPageNumber <= 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} style="padding: 6px 12px; font-size: 0.8rem; border-radius: 8px; background: var(--bg-surface); border: 1px solid var(--border-color); color: var(--text-main); cursor: pointer;">Prev</button>
        <span style="font-size: 0.82rem; color: var(--text-main); font-weight: 700;">Page ${window.summariesPageNumber} of ${totalPages}</span>
        <button onclick="window.changeSummariesPage(1)" ${window.summariesPageNumber >= totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} style="padding: 6px 12px; font-size: 0.8rem; border-radius: 8px; background: var(--bg-surface); border: 1px solid var(--border-color); color: var(--text-main); cursor: pointer;">Next</button>
      </div>
    `;
  }
};

window.changeSummariesPage = function(delta) {
  window.summariesPageNumber = (window.summariesPageNumber || 1) + delta;
  window.renderAISummariesPageTable();
};

window.openCallbacksModal = function(event) {
  if (event) event.preventDefault();
  let modal = document.getElementById('callbacks-modal');
  if (modal) {
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    modal.style.setProperty('position', 'fixed', 'important');
    modal.style.setProperty('top', '0px', 'important');
    modal.style.setProperty('left', '0px', 'important');
    modal.style.setProperty('width', '100vw', 'important');
    modal.style.setProperty('height', '100vh', 'important');
    modal.style.setProperty('z-index', '99999999', 'important');
    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('visibility', 'visible', 'important');
    modal.style.setProperty('opacity', '1', 'important');
    renderCallbacksModalContent();
  } else {
    window.navigateToCallbacksPage();
  }
};

window.closeCallbacksModal = function() {
  const modals = document.querySelectorAll('#callbacks-modal');
  modals.forEach(modal => {
    modal.style.display = 'none';
  });
};

function renderCallbacksModalContent() {
  const listEl = document.getElementById('modal-callbacks-list');
  if (!listEl) return;

  const callbacks = window.lastDashboardCallbacks || [];

  listEl.innerHTML = '';
  if (callbacks.length > 0) {
    callbacks.forEach(cb => {
      const div = document.createElement('div');
      div.style.padding = '12px 15px';
      div.style.background = 'rgba(255,255,255,0.02)';
      div.style.border = '1px solid var(--border-color)';
      div.style.borderRadius = '12px';
      div.style.display = 'flex';
      div.style.justifyContent = 'space-between';
      div.style.alignItems = 'center';
      div.style.marginBottom = '10px';

      const cbDate = new Date(cb.scheduledAt);
      const timeText = isNaN(cbDate.getTime()) 
        ? cb.requestedTime 
        : cbDate.toLocaleString([], { weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

      let statusStyle = 'background: rgba(245, 158, 11, 0.1); color: var(--color-orange); border: 1px solid rgba(245, 158, 11, 0.2);';
      if (cb.status === 'dialed') {
        statusStyle = 'background: rgba(16, 185, 129, 0.1); color: var(--color-green); border: 1px solid rgba(16, 185, 129, 0.2);';
      } else if (cb.status === 'dialing') {
        statusStyle = 'background: rgba(6, 182, 212, 0.1); color: var(--color-cyan); border: 1px solid rgba(6, 182, 212, 0.2);';
      } else if (cb.status === 'failed') {
        statusStyle = 'background: rgba(239, 68, 68, 0.1); color: var(--color-red); border: 1px solid rgba(239, 68, 68, 0.2);';
      }

      div.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <strong style="font-size: 0.95rem; color: var(--text-main);">${cb.name || cb.phone}</strong>
            <span class="badge" style="margin: 0; padding: 2px 6px; font-size: 0.65rem; ${statusStyle}">${cb.status}</span>
          </div>
          <span style="font-size: 0.8rem; color: var(--text-muted);">${timeText} (Offset: ${cb.requestedTime})</span>
          ${cb.notes ? `<span style="font-size: 0.75rem; color: #a78bfa; font-style: italic;">Note: ${cb.notes}</span>` : ''}
          ${cb.error ? `<span style="font-size: 0.72rem; color: var(--color-red);">Error: ${cb.error}</span>` : ''}
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          ${cb.status !== 'dialed' && cb.status !== 'dialing' ? `
            <button onclick="window.triggerCallbackCallDirect('${cb.id}')" class="btn btn-primary" style="padding: 6px 12px; font-size: 0.75rem; background: var(--color-cyan); border: none; border-radius: 6px; color: #000; font-weight: 600; cursor: pointer;">Call Now</button>
            <button onclick="window.rescheduleCallbackDirect('${cb.id}')" class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.75rem; border-radius: 6px; cursor: pointer; color: var(--text-main); background: rgba(255,255,255,0.05); border: 1px solid var(--border-color);">Reschedule</button>
          ` : ''}
          <button onclick="window.deleteCallbackDirect('${cb.id}')" class="btn btn-danger" style="padding: 6px 12px; font-size: 0.75rem; border-radius: 6px; background: rgba(255, 82, 82, 0.1); border: 1px solid rgba(255, 82, 82, 0.2); color: var(--color-red); cursor: pointer;">Cancel</button>
        </div>
      `;
      listEl.appendChild(div);
    });
  } else {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <span style="font-size: 2rem; display: block; margin-bottom: 10px;">📅</span>
        <h4 style="color: var(--text-main); margin-bottom: 5px;">No Callbacks Scheduled</h4>
        <p style="font-size: 0.85rem;">There are no future callbacks scheduled at this moment.</p>
      </div>
    `;
  }
}

window.triggerCallbackCallDirect = async function(id) {
  if (!confirm('Are you sure you want to trigger this callback call immediately?')) return;
  try {
    const res = await fetch(`/api/callbacks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt: new Date().toISOString() }) // set time to now
    });
    const data = await res.json();
    if (data.success) {
      alert('Callback triggered! The dialer will make the call within a minute.');
      refreshCallsList();
      window.closeCallbacksModal();
    } else {
      alert('Error triggering callback: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Failed to trigger callback: ' + err.message);
  }
};

window.deleteCallbackDirect = async function(id) {
  if (!confirm('Are you sure you want to cancel and delete this callback?')) return;
  try {
    const res = await fetch(`/api/callbacks/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      refreshCallsList();
      const modal = document.getElementById('callbacks-modal');
      if (modal && modal.style.display === 'flex') {
        setTimeout(renderCallbacksModalContent, 300);
      }
    } else {
      alert('Error deleting callback: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Failed to delete callback: ' + err.message);
  }
};

window.rescheduleCallbackDirect = async function(id) {
  const newTimeText = prompt('Enter new callback time expression (e.g. "10 minutes", "in 3 hours", or a valid date/time):');
  if (!newTimeText || !newTimeText.trim()) return;
  
  let targetDate = new Date(Date.now() + 60 * 60 * 1000); // Default: 1 hour from now
  const cleanInput = newTimeText.trim().toLowerCase();
  
  // Parse relative terms
  const minMatch = cleanInput.match(/(?:in\s+)?(\d+)\s*(?:minute|minutes|min|mins)/);
  const hourMatch = cleanInput.match(/(?:in\s+)?(\d+)\s*(?:hour|hours|hr|hrs)/);
  const dayMatch = cleanInput.match(/(?:in\s+)?(\d+)\s*(?:day|days)/);
  
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    targetDate = new Date(Date.now() + mins * 60 * 1000);
  } else if (hourMatch) {
    const hrs = parseInt(hourMatch[1], 10);
    targetDate = new Date(Date.now() + hrs * 60 * 60 * 1000);
  } else if (dayMatch) {
    const days = parseInt(dayMatch[1], 10);
    targetDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  } else {
    // Attempt standard JS Date parsing
    const parsed = Date.parse(newTimeText);
    if (!isNaN(parsed)) {
      targetDate = new Date(parsed);
    }
  }

  try {
    const res = await fetch(`/api/callbacks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        requestedTime: newTimeText,
        scheduledAt: targetDate.toISOString()
      })
    });
    const data = await res.json();
    if (data.success) {
      alert('Callback rescheduled successfully!');
      refreshCallsList();
      const modal = document.getElementById('callbacks-modal');
      if (modal && modal.style.display === 'flex') {
        setTimeout(renderCallbacksModalContent, 300);
      }
    } else {
      alert('Error rescheduling: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Failed to reschedule: ' + err.message);
  }
};

function renderClientNumberStatus(client) {
  const textEl = document.getElementById('client-number-text');
  const actionEl = document.getElementById('client-number-action');
  if (!textEl || !actionEl) return;

  if (client.status === 'active' && client.phone_number) {
    textEl.innerHTML = `
      <p style="font-size: 0.96rem; font-weight: 700; color: #fff; margin: 0; font-family: var(--font-mono); letter-spacing: 1px; text-shadow: 0 0 8px rgba(6, 182, 212, 0.2);">${client.phone_number}</p>
    `;
    actionEl.innerHTML = `
      <span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 0.68rem; font-weight: 500; border-radius: 5px; background: rgba(16, 185, 129, 0.08); color: var(--color-green); border: 1px solid rgba(16, 185, 129, 0.15);">
        <span class="pulse-dot"></span> Live &amp; Active
      </span>
    `;
  } else if (client.status === 'number_requested') {
    textEl.innerHTML = `
      <p style="font-size: 0.9rem; font-weight: 700; color: rgba(255,255,255,0.6); margin: 0; font-family: var(--font-mono);">${client.requested_number || 'Requested Number'}</p>
    `;
    actionEl.innerHTML = `
      <span style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 0.8rem; font-weight: 500; border-radius: 8px; background: rgba(245, 158, 11, 0.1); color: #ff9800; border: 1px solid rgba(245, 158, 11, 0.2);">
        <span class="pulse-dot" style="background-color: #ff9800; animation-duration: 2s;"></span> Pending Approval
      </span>
    `;
  } else {
    textEl.innerHTML = `
      <p style="font-size: 0.95rem; color: rgba(255, 255, 255, 0.5); margin: 0;">No active phone number assigned yet.</p>
    `;
    actionEl.innerHTML = `
      <button onclick="window.openNumbersModal()" class="btn btn-primary" style="padding: 8px 16px; font-weight: 600; font-size: 0.85rem; border-radius: 8px; background: var(--grad-cyan-violet); color: #000; border: none;">Get a Number</button>
    `;
  }
}

function renderClientAgentConfig(config) {
  if (!config) return;
  const promptTextarea = document.getElementById('client-agent-prompt');
  const voiceSelect = document.getElementById('client-agent-voice');
  
  if (promptTextarea) promptTextarea.value = config.system_prompt || '';
  if (voiceSelect) voiceSelect.value = config.voice || 'Aoede';
}

function renderClientCalls(calls) {
  const tbody = document.querySelector('#client-calls-table tbody');
  if (!tbody) return;
  
  if (!calls || calls.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #888; padding: 20px;">No calls logged yet.</td></tr>`;
    return;
  }
  
  tbody.innerHTML = '';
  calls.forEach(call => {
    const tr = document.createElement('tr');
    
    // Timestamp
    const tdTime = document.createElement('td');
    tdTime.innerText = new Date(call.createdAt).toLocaleString();
    tr.appendChild(tdTime);
    
    // Connection (To/From)
    const tdConn = document.createElement('td');
    tdConn.innerHTML = `<span style="font-family: monospace; font-weight: 600; color: #fff;">${call.to}</span>`;
    tr.appendChild(tdConn);
    
    // Verdict
    const tdVerdict = document.createElement('td');
    const isInterested = call.summary?.toLowerCase().includes('interested') && !call.summary?.toLowerCase().includes('not interested');
    tdVerdict.innerHTML = isInterested 
      ? `<span style="color: #4caf50; font-weight: 600;">Interested</span>`
      : `<span style="color: #ff5252; font-weight: 600;">Not Interested / Failed</span>`;
    tr.appendChild(tdVerdict);
    
    // Summary
    const tdSummary = document.createElement('td');
    tdSummary.style.maxWidth = '300px';
    tdSummary.style.overflow = 'hidden';
    tdSummary.style.textOverflow = 'ellipsis';
    tdSummary.style.whiteSpace = 'nowrap';
    tdSummary.innerText = call.summary ? call.summary.replace(/\*\*Verdict:\*\*.*|\*\*Reason:\*\*/gi, '').trim() : 'No summary generated.';
    tr.appendChild(tdSummary);
    
    // Actions
    const tdActions = document.createElement('td');
    tdActions.style.textAlign = 'right';
    tdActions.innerHTML = `<button onclick="viewClientCallDetail('${call.callSid}')" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.8rem;">Details</button>`;
    tr.appendChild(tdActions);
    
    tbody.appendChild(tr);
  });
}

// 4. Save Client Agent Config
document.getElementById('btn-save-client-agent')?.addEventListener('click', async () => {
  if (!loggedInUser) return;
  const prompt = document.getElementById('client-agent-prompt').value.trim();
  const voice = document.getElementById('client-agent-voice').value;
  
  if (!prompt) {
    alert('Please enter a system instruction.');
    return;
  }
  
  try {
    const res = await fetch('/api/client/agent-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: loggedInUser.id,
        system_prompt: prompt,
        voice: voice,
        language: 'Hinglish'
      })
    });
    const data = await res.json();
    if (data.success) {
      alert('AI Agent configuration saved successfully!');
      fetchClientDashboardData();
    } else {
      alert('Failed to save config.');
    }
  } catch (err) {
    console.error(err);
    alert('Error saving configuration.');
  }
});

// 5. Open/Close Numbers Modal
window.openNumbersModal = async function() {
  const modal = document.getElementById('numbers-modal');
  if (modal) modal.style.display = 'flex';
  
  // Fetch available numbers
  const tbody = document.querySelector('#available-numbers-table tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">Fetching available numbers...</td></tr>`;
  
  try {
    const res = await fetch('/api/client/available-numbers');
    const data = await res.json();
    if (data.success && tbody) {
      tbody.innerHTML = '';
      data.numbers.forEach(num => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="font-family: monospace; font-weight: 600; font-size: 1rem; color: var(--text-main);">${num.number}</td>
          <td>${num.type}</td>
          <td style="color: var(--color-cyan); font-weight: 600;">${num.price}</td>
          <td style="text-align: right;"><button onclick="window.requestVobizNumber('${num.number}')" class="btn btn-primary" style="padding: 4px 10px; font-size: 0.85rem;">Request</button></td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error(err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ff5252; padding: 20px;">Failed to load numbers.</td></tr>`;
  }
};

window.closeNumbersModal = function() {
  const modal = document.getElementById('numbers-modal');
  if (modal) modal.style.display = 'none';
};

window.requestVobizNumber = async function(number) {
  console.log('window.requestVobizNumber called with:', number);
  console.log('Current loggedInUser:', loggedInUser);

  if (!loggedInUser) {
    alert('Session Error: You are not logged in. Please log out and log back in.');
    return;
  }

  try {
    const res = await fetch('/api/client/request-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: loggedInUser.id, number })
    });
    const data = await res.json();
    if (data.success) {
      closeNumbersModal();
      fetchClientDashboardData();
    } else {
      alert(data.error || 'Failed to request number.');
    }
  } catch (err) {
    console.error(err);
    alert('Error requesting number.');
  }
};

// 6. Admin Panel Fetch Logic
// 6. Admin Panel Fetch Logic
async function fetchAdminRequests() {
  try {
    const res = await fetch('/api/admin/pending-requests');
    const data = await res.json();
    const tbody = document.querySelector('#admin-requests-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (!data.success || !data.requests || data.requests.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: 4rem 2rem;">
            <div class="empty-state" style="border: none; background: transparent; padding: 0;">
              <div class="empty-state-icon" style="display: flex; align-items: center; justify-content: center; margin-bottom: 1rem;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 44px; height: 44px; color: var(--text-muted); opacity: 0.4;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              </div>
              <h4 class="empty-state-title" style="font-size: 1rem; margin-bottom: 0.25rem;">No Pending Requests</h4>
              <p class="empty-state-desc" style="font-size: 0.8rem; max-width: 320px; margin: 0 auto;">All client number requests have been processed.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }
    
    data.requests.forEach(req => {
      const tr = document.createElement('tr');
      const kyc = req.kyc_details || {};
      const compName = kyc.company || req.name || 'Client';
      const personName = kyc.person || req.name || '';
      const emailStr = kyc.email || req.email || '';
      const phoneStr = kyc.phone || req.phone_number || '';
      const numType = kyc.number_type || req.requested_number || 'Virtual Mobile';
      const useCase = kyc.use_case || 'Sales & Support';
      const resellerName = req.reseller_name || kyc.reseller_name || '';
      let docUrls = [];
      if (Array.isArray(kyc.document_urls) && kyc.document_urls.length > 0) {
        docUrls = kyc.document_urls;
      } else if (Array.isArray(kyc.document_url) && kyc.document_url.length > 0) {
        docUrls = kyc.document_url;
      } else if (kyc.document_url && typeof kyc.document_url === 'string') {
        docUrls = [kyc.document_url];
      }

      const docHtml = docUrls.length > 0
        ? docUrls.map((url, idx) => `<a href="${url}" target="_blank" download="KYC_Doc_${idx+1}" class="badge" style="background: rgba(6,182,212,0.15); color: var(--color-cyan); border: 1px solid rgba(6,182,212,0.3); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-right: 4px; display: inline-block; margin-bottom: 4px;">📄 Doc #${idx+1}</a>`).join('')
        : `<span style="color: var(--text-muted); font-size: 0.75rem; font-style: italic;">No Doc Attached</span>`;

      const resellerBadge = resellerName
        ? `<span class="badge" style="background: rgba(192,132,252,0.15); color: #c084fc; border: 1px solid rgba(192,132,252,0.3); font-size: 0.7rem; padding: 3px 8px; border-radius: 6px; font-weight: bold;">🏷️ ${escapeHtml(resellerName)}</span>`
        : `<span class="badge" style="background: rgba(255,107,74,0.1); color: var(--color-coral); border: 1px solid rgba(255,107,74,0.2); font-size: 0.7rem; padding: 3px 8px; border-radius: 6px; font-weight: 500;">🌐 Main Platform</span>`;

      tr.innerHTML = `
        <td>
          <div class="client-meta-details">
            <span class="client-meta-name" style="font-weight: 700; color: var(--text-main); font-size: 0.9rem;">${escapeHtml(compName)}</span>
            <span style="font-size: 0.78rem; color: var(--text-muted);">Contact: ${escapeHtml(personName)}</span>
          </div>
        </td>
        <td>
          <div class="client-meta-details">
            <span style="font-size: 0.82rem; color: var(--color-cyan); font-weight: 600;">${escapeHtml(emailStr)}</span>
            <span style="font-size: 0.78rem; color: var(--text-muted); font-family: monospace;">${escapeHtml(phoneStr)}</span>
          </div>
        </td>
        <td>
          <div class="client-meta-details">
            <span style="font-size: 0.82rem; font-weight: 700; color: var(--text-main);">${escapeHtml(numType)}</span>
            <span style="font-size: 0.75rem; color: var(--color-coral);">${escapeHtml(useCase)}</span>
          </div>
        </td>
        <td>${docHtml}</td>
        <td>${resellerBadge}</td>
        <td>
          <span class="badge" style="background: rgba(255,152,0,0.1); color: #ff9800; border: 1px solid rgba(255,152,0,0.2); margin: 0; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 600;">Pending</span>
        </td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 6px; justify-content: flex-end;">
            <button onclick="window.openAssignNumberModal('${req.id}', '${escapeHtml(compName)}')" class="btn btn-primary" style="padding: 5px 10px; font-size: 0.75rem; background: var(--color-green); border-color: var(--color-green); color: #000; font-weight: 700;">Approve &amp; Assign</button>
            <button onclick="handleAdminDecision('${req.id}', 'reject')" class="btn btn-danger" style="padding: 5px 10px; font-size: 0.75rem; background: var(--color-red); border-color: var(--color-red); color: #fff; font-weight: 600;">Reject</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
  }
}

async function fetchAdminClients() {
  try {
    const res = await fetch('/api/admin/clients');
    const data = await res.json();
    const tbody = document.querySelector('#admin-clients-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!data.success || !data.clients || data.clients.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 4rem 2rem;">
            <div class="empty-state" style="border: none; background: transparent; padding: 0;">
              <div class="empty-state-icon" style="display: flex; align-items: center; justify-content: center; margin-bottom: 1rem;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 44px; height: 44px; color: var(--text-muted); opacity: 0.4;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <h4 class="empty-state-title" style="font-size: 1rem; margin-bottom: 0.25rem;">No Registered Clients</h4>
              <p class="empty-state-desc" style="font-size: 0.8rem; max-width: 320px; margin: 0 auto;">There are no clients registered in the system yet.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }
    
    window.adminClientsCache = data.clients;
    
    data.clients.forEach(client => {
      const tr = document.createElement('tr');
      const initials = client.name.split(/\s+/).filter(Boolean).map(n => n[0]).join('').substring(0, 2);
      const joinedDate = new Date(client.created_at).toLocaleDateString();
      const balanceText = client.balance !== undefined ? client.balance.toFixed(2) : '500.00';
      const rates = client.pricing || { rate_per_minute: 2.00, rate_recording_per_minute: 0.50, rate_per_session: 1.00 };
      const ratesTextHtml = `
        <div style="display: flex; flex-direction: column; gap: 4px; font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; line-height: 1.25;">
          <span style="display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; color: var(--text-muted);">
            <span style="background: rgba(6, 182, 212, 0.1); color: var(--color-cyan); padding: 1px 4px; border-radius: 4px; font-weight: 600; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.3px;">Call</span> ₹${rates.rate_per_minute.toFixed(2)}/m
          </span>
          <span style="display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; color: var(--text-muted);">
            <span style="background: rgba(139, 92, 246, 0.1); color: #c084fc; padding: 1px 4px; border-radius: 4px; font-weight: 600; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.3px;">Rec</span> ₹${rates.rate_recording_per_minute.toFixed(2)}/m
          </span>
          <span style="display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; color: var(--text-muted);">
            <span style="background: rgba(245, 158, 11, 0.1); color: #fbbf24; padding: 1px 4px; border-radius: 4px; font-weight: 600; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.3px;">Sess</span> ₹${rates.rate_per_session.toFixed(2)}/c
          </span>
        </div>
      `;

      const roleBadge = client.role === 'admin' ? 
        `<span class="badge" style="background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); color: #c084fc; text-transform: uppercase; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px;">Admin</span>` :
        `<span class="badge" style="background: rgba(100, 116, 139, 0.15); border: 1px solid rgba(100, 116, 139, 0.3); color: #94a3b8; text-transform: uppercase; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px;">Client</span>`;

      let planBadge = '';
      const planStr = (client.plan || 'basic').toLowerCase();
      if (planStr === 'pro') {
        planBadge = `<span class="badge" style="background: rgba(6, 182, 212, 0.15); border: 1px solid rgba(6, 182, 212, 0.3); color: var(--color-cyan); text-transform: capitalize; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px;">Pro</span>`;
      } else if (planStr === 'custom' || planStr === 'enterprise') {
        planBadge = `<span class="badge" style="background: rgba(236, 72, 153, 0.15); border: 1px solid rgba(236, 72, 153, 0.3); color: #f472b6; text-transform: capitalize; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px;">Custom</span>`;
      } else {
        planBadge = `<span class="badge" style="background: rgba(148, 163, 184, 0.15); border: 1px solid rgba(148, 163, 184, 0.3); color: #94a3b8; text-transform: capitalize; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px;">Basic</span>`;
      }

      const isDeactivated = client.status === 'deactivated';
      const statusActionBtn = isDeactivated ? 
        `<button onclick="window.toggleClientStatus('${client.id}', 'active')" class="admin-action-btn admin-action-btn-status-active">Activate</button>` :
        `<button onclick="window.toggleClientStatus('${client.id}', 'deactivated')" class="admin-action-btn admin-action-btn-status-deactivate">Deactivate</button>`;

      const deleteActionBtn = `<button onclick="window.deleteClient('${client.id}', '${escapeHtml(client.name)}')" class="admin-action-btn admin-action-btn-delete" title="Delete Client">🗑️</button>`;

      const isWL = window.isWhitelabelDomain();
      const customCredsBadge = (!isWL && client.vobiz_sub_auth_id) ? `<br><span style="font-size: 0.65rem; color: var(--color-cyan); background: rgba(6, 182, 212, 0.1); padding: 1px 4px; border-radius: 4px; font-weight: 600; display: inline-block; margin-top: 2px;">🔑 Custom Vobiz</span>` : '';
      const resellerBadge = client.reseller_name ? `<span style="font-size: 0.65rem; color: #c084fc; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); padding: 1px 5px; border-radius: 4px; font-weight: 600; margin-left: 6px; display: inline-block;">🏷️ ${escapeHtml(client.reseller_name)}</span>` : '';
      const assignBtnText = isWL ? '📱 Assign Number' : '📞 Telephony & Credentials';

      tr.innerHTML = `
        <td>
          <div class="client-info-cell">
            <div class="client-avatar-circle">${initials}</div>
            <div class="client-meta-details">
              <span class="client-meta-name">${escapeHtml(client.name)}${resellerBadge}</span>
              <span class="client-meta-email">${escapeHtml(client.email)}</span>
            </div>
          </div>
        </td>
        <td>${roleBadge}</td>
        <td>${planBadge}</td>
        <td class="phone">${escapeHtml(client.phone_number || 'None')}${customCredsBadge}</td>
        <td style="font-family: monospace; font-weight: bold; color: var(--color-cyan);">₹${balanceText}</td>
        <td>${ratesTextHtml}</td>
        <td>
          <span class="badge ${client.status === 'active' ? 'badge-connected' : 'badge-disconnected'}" style="margin: 0; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 500;">${client.status}</span>
        </td>
        <td style="color: var(--text-muted); font-size: 0.85rem;">${joinedDate}</td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 6px; justify-content: flex-end; align-items: center;">
            <button onclick="window.openRechargeModal('${client.id}', '${escapeHtml(client.name)}')" class="admin-action-btn admin-action-btn-recharge">Recharge</button>
            <button onclick="window.openPricingModal('${client.id}', '${escapeHtml(client.name)}', ${rates.rate_per_minute}, ${rates.rate_recording_per_minute}, ${rates.rate_per_session}, '${client.plan || 'basic'}')" class="admin-action-btn admin-action-btn-pricing">Pricing &amp; Plan</button>
            <button onclick="window.openAssignNumberModal('${client.id}', '${escapeHtml(client.name)}', '${escapeHtml(client.phone_number || '')}', '${escapeHtml(client.vobiz_sub_auth_id || '')}', '${escapeHtml(client.vobiz_sub_auth_token || '')}')" class="admin-action-btn" style="background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); color: #c084fc;">${assignBtnText}</button>
            <button onclick="window.adminResetPassword('${client.id}', '${escapeHtml(client.name)}')" class="admin-action-btn" style="background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.3); color: #facc15;">🔑 Password</button>
            <button onclick="impersonateUser('${client.id}')" class="admin-action-btn admin-action-btn-impersonate">Impersonate</button>
            ${statusActionBtn}
            ${deleteActionBtn}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
  }
}
window.fetchAdminClients = fetchAdminClients;

// --- Recharge Modal & Form Handling ---
window.openRechargeModal = function(clientId, clientName) {
  document.getElementById('recharge-client-id').value = clientId;
  document.getElementById('recharge-client-name').value = clientName;
  document.getElementById('recharge-amount').value = '';
  document.getElementById('admin-recharge-modal').style.display = 'flex';
};

window.closeRechargeModal = function() {
  document.getElementById('admin-recharge-modal').style.display = 'none';
};

window.submitRecharge = async function(event) {
  event.preventDefault();
  const clientId = document.getElementById('recharge-client-id').value;
  const amount = document.getElementById('recharge-amount').value;
  
  try {
    const res = await fetch('/api/admin/recharge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, amount })
    });
    const data = await res.json();
    if (data.success) {
      alert('Wallet recharged successfully!');
      window.closeRechargeModal();
      fetchAdminClients(); // Refresh client table in Admin Panel
    } else {
      alert(`Recharge failed: ${data.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
};

window.isMainPlatformHost = function(hostname) {
  const host = (hostname || window.location.hostname || '').toLowerCase();
  const mainPlatformHosts = ['callio.in', 'www.callio.in', 'localhost', '127.0.0.1', '0.0.0.0', 'callingagent.com', 'vobiz.in', 'diginext360.com'];
  if (mainPlatformHosts.includes(host)) return true;

  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(host) || host === '::1' || host.endsWith('.local') || host.endsWith('.localhost')) {
    return true;
  }
  return false;
};

// --- Whitelabel UI Helper & Restrictions ---
window.isWhitelabelDomain = function() {
  if (window.isMainPlatformHost()) {
    return false;
  }
  
  const branding = window.BrandingContext || {};
  if (branding.isReseller === true || (branding.resellerId && branding.resellerId !== 'default')) {
    return true;
  }
  
  const host = window.location.hostname.toLowerCase();
  if (!host.endsWith('.callio.in') && !host.endsWith('.localhost')) {
    return true;
  }
  
  return false;
};

window.applyWhitelabelUiRestrictions = function() {
  const isWL = window.isWhitelabelDomain();
  const branding = window.BrandingContext || {};

  // 1. Admin Panel Header Title
  const adminTitle = document.querySelector('.admin-modern-title');
  if (adminTitle) {
    const name = branding.appName || 'Admin';
    adminTitle.textContent = isWL ? `${name} Admin Panel` : 'Super Admin Panel';
  }

  // 2. System Monitor Bar
  const sysMonitor = document.getElementById('admin-system-monitor-bar');
  if (sysMonitor) {
    sysMonitor.style.display = isWL ? 'none' : 'flex';
  }

  // 3. Reseller Management Tab
  const resellerTab = document.getElementById('admin-subtab-resellers');
  if (resellerTab) {
    resellerTab.style.display = isWL ? 'none' : 'inline-block';
  }

  // 4. Modal Vobiz Credentials Container
  const vobizCredsSection = document.getElementById('assign-number-vobiz-creds-container');
  if (vobizCredsSection) {
    vobizCredsSection.style.display = isWL ? 'none' : 'block';
  }

  // 5. Modal Header Title
  const modalTitle = document.getElementById('assign-number-modal-title');
  if (modalTitle) {
    modalTitle.textContent = isWL ? 'Assign Telephony Number' : 'Client Telephony & Credentials';
  }
};

// --- Assign Number & Telephony Credentials Modal ---
window.openAssignNumberModal = function(clientId, clientName, currentNumber, subAuthId, subAuthToken) {
  window.applyWhitelabelUiRestrictions();
  document.getElementById('assign-number-client-id').value = clientId;
  document.getElementById('assign-number-client-name').value = clientName;
  document.getElementById('assign-number-new-input').value = currentNumber || '';
  document.getElementById('assign-number-quick-select').value = '';
  document.getElementById('assign-number-auth-id').value = subAuthId || '';
  document.getElementById('assign-number-auth-token').value = subAuthToken || '';
  document.getElementById('admin-assign-number-modal').style.display = 'flex';
};


window.closeAssignNumberModal = function() {
  document.getElementById('admin-assign-number-modal').style.display = 'none';
};

window.submitAssignNumberUpdate = async function(event) {
  event.preventDefault();
  const clientId = document.getElementById('assign-number-client-id').value;
  const phoneNumber = document.getElementById('assign-number-new-input').value.trim();
  const vobizSubAuthId = document.getElementById('assign-number-auth-id').value.trim();
  const vobizSubAuthToken = document.getElementById('assign-number-auth-token').value.trim();

  try {
    const res = await fetch('/api/admin/update-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        phone_number: phoneNumber,
        vobiz_sub_auth_id: vobizSubAuthId,
        vobiz_sub_auth_token: vobizSubAuthToken
      })
    });
    const data = await res.json();
    if (data.success) {
      alert('Telephony number and credentials updated successfully!');
      window.closeAssignNumberModal();
      fetchAdminClients(); // Refresh client table in Admin Panel
    } else {
      alert(`Update failed: ${data.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
};

window.removeAssignedNumberFromClient = async function() {
  const clientId = document.getElementById('assign-number-client-id').value;
  const clientName = document.getElementById('assign-number-client-name').value;
  const currentNum = document.getElementById('assign-number-new-input').value.trim();

  if (!currentNum) {
    alert(`No phone number is currently assigned to ${clientName}.`);
    return;
  }

  if (!confirm(`Are you sure you want to remove/revoke the virtual number (${currentNum}) from ${clientName}?`)) {
    return;
  }

  try {
    const res = await fetch('/api/admin/remove-client-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId })
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ Virtual number removed successfully from ${clientName}!`);
      document.getElementById('assign-number-new-input').value = '';
      window.closeAssignNumberModal();
      if (typeof fetchAdminClients === 'function') fetchAdminClients();
    } else {
      alert(`Error: ${data.error || 'Failed to remove number.'}`);
    }
  } catch (err) {
    alert(`Error removing number: ${err.message}`);
  }
};


// --- Pricing Plan Modal & Form Handling ---
window.openPricingModal = function(clientId, clientName, rateMin, rateRec, rateSess, plan) {
  document.getElementById('pricing-client-id').value = clientId;
  document.getElementById('pricing-client-name').value = clientName;
  document.getElementById('pricing-rate-min-input').value = rateMin;
  document.getElementById('pricing-rate-rec-input').value = rateRec;
  document.getElementById('pricing-rate-sess-input').value = rateSess;
  const planInput = document.getElementById('pricing-plan-input');
  if (planInput) {
    planInput.innerHTML = '';
    (window.activePlans || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      opt.style.background = 'var(--bg-surface)';
      opt.style.color = 'var(--text-main)';
      planInput.appendChild(opt);
    });
    planInput.value = plan || 'basic';
  }
  document.getElementById('admin-pricing-modal').style.display = 'flex';
};

window.closePricingModal = function() {
  document.getElementById('admin-pricing-modal').style.display = 'none';
};

window.submitPricingUpdate = async function(event) {
  event.preventDefault();
  const clientId = document.getElementById('pricing-client-id').value;
  const rate_per_minute = document.getElementById('pricing-rate-min-input').value;
  const rate_recording_per_minute = document.getElementById('pricing-rate-rec-input').value;
  const rate_per_session = document.getElementById('pricing-rate-sess-input').value;
  const plan = document.getElementById('pricing-plan-input')?.value || 'basic';
  
  try {
    const resPricing = await fetch('/api/admin/update-pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, rate_per_minute, rate_recording_per_minute, rate_per_session })
    });
    const dataPricing = await resPricing.json();

    const resClient = await fetch('/api/admin/update-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, plan })
    });
    const dataClient = await resClient.json();

    if (dataPricing.success && dataClient.success) {
      alert('Pricing & Plan updated successfully!');
      window.closePricingModal();
      fetchAdminClients(); // Refresh client table in Admin Panel
      
      // Auto-refresh Billing tab client details if it's active
      const tabBilling = document.getElementById('tab-billing');
      if (tabBilling && tabBilling.classList.contains('active') && window.onAdminBillingClientChange) {
        window.onAdminBillingClientChange();
      }
    } else {
      alert(`Update failed: ${dataPricing.error || dataClient.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
};

// --- Client Status & Deletion Helper Functions ---
window.toggleClientStatus = async function(clientId, status) {
  try {
    const res = await fetch('/api/admin/update-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, status })
    });
    const data = await res.json();
    if (data.success) {
      alert(`Client account ${status === 'active' ? 'activated' : 'deactivated'} successfully!`);
      fetchAdminClients();
    } else {
      alert(`Failed: ${data.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
};

window.deleteClient = async function(clientId, clientName) {
  if (!confirm(`Are you absolutely sure you want to permanently delete user "${clientName}"? This action cannot be undone.`)) {
    return;
  }
  try {
    const res = await fetch('/api/admin/delete-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId })
    });
    const data = await res.json();
    if (data.success) {
      alert(`Client "${clientName}" deleted successfully!`);
      fetchAdminClients();
    } else {
      alert(`Failed: ${data.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
};

window.loadBrandingToForm = function() {
  const branding = window.BrandingContext || {};
  document.getElementById('branding-app-name').value = branding.appName || '';
  document.getElementById('branding-tenant-id').value = branding.id || '';
  document.getElementById('branding-custom-domain').value = branding.customDomain || '';
  document.getElementById('branding-subdomain').value = branding.subdomain || '';
  document.getElementById('branding-logo-url').value = branding.logoUrl || '';

  const logoH = branding.logoHeight || branding.logo_height || 36;
  const logoHNum = document.getElementById('branding-logo-height');
  const logoHSlider = document.getElementById('branding-logo-height-slider');
  if (logoHNum) logoHNum.value = logoH;
  if (logoHSlider) logoHSlider.value = logoH;

  document.getElementById('branding-favicon-url').value = branding.faviconUrl || '';
  
  const primaryHex = branding.primaryColor || '#FF6B4A';
  document.getElementById('branding-primary-color').value = primaryHex;
  document.getElementById('branding-primary-color-picker').value = primaryHex;
  
  const secondaryHex = branding.secondaryColor || '#ae3115';
  document.getElementById('branding-secondary-color').value = secondaryHex;
  document.getElementById('branding-secondary-color-picker').value = secondaryHex;
  
  document.getElementById('branding-support-email').value = branding.supportEmail || '';
  document.getElementById('branding-support-phone').value = branding.supportPhone || '';
  document.getElementById('branding-copyright').value = branding.copyrightText || '';
  const demoPromptEl = document.getElementById('branding-demo-prompt');
  if (demoPromptEl) demoPromptEl.value = branding.demoSystemPrompt || '';
};

// --- Admin Panel Sub-tabs Switcher ---
window.switchAdminSubtab = function(tabName) {
  const isWL = typeof window.isWhitelabelDomain === 'function' ? window.isWhitelabelDomain() : false;
  const isSuperAdmin = (typeof loggedInUser !== 'undefined' && loggedInUser && loggedInUser.role === 'admin' && !isWL);
  if (tabName === 'resellers' && !isSuperAdmin) {
    tabName = 'users';
  }
  const sections = {
    'users': 'admin-panel-section-users',
    'requests': 'admin-panel-section-requests',
    'logs': 'admin-panel-section-logs',
    'plans': 'admin-panel-section-plans',
    'invoices': 'admin-panel-section-invoices',
    'razorpay': 'admin-panel-section-razorpay',
    'trial-leads': 'admin-panel-section-trial-leads',
    'enterprise-inquiries': 'admin-panel-section-enterprise-inquiries',
    'branding': 'admin-panel-section-branding',
    'resellers': 'admin-panel-section-resellers'
  };
  const buttons = {
    'users': 'admin-subtab-users',
    'requests': 'admin-subtab-requests',
    'logs': 'admin-subtab-logs',
    'plans': 'admin-subtab-plans',
    'invoices': 'admin-subtab-invoices',
    'razorpay': 'admin-subtab-razorpay',
    'trial-leads': 'admin-subtab-trial-leads',
    'enterprise-inquiries': 'admin-subtab-enterprise-inquiries',
    'branding': 'admin-subtab-branding',
    'resellers': 'admin-subtab-resellers'
  };
  
  Object.keys(sections).forEach(key => {
    const sectionEl = document.getElementById(sections[key]);
    const btnEl = document.getElementById(buttons[key]);
    if (key === tabName) {
      if (sectionEl) sectionEl.style.display = 'block';
      if (btnEl) {
        btnEl.classList.add('active');
      }
      if (key === 'users') {
        if (typeof window.fetchAdminClients === 'function') window.fetchAdminClients();
      }
      if (key === 'plans') {
        window.fetchAdminPlans();
        window.initSuperAdminPricingConsole();
      }
      if (key === 'invoices') {
        window.fetchAdminInvoices();
      }
      if (key === 'razorpay') {
        window.fetchRazorpayConfig();
      }
      if (key === 'trial-leads') {
        window.fetchTrialLeads();
      }
      if (key === 'enterprise-inquiries') {
        window.fetchEnterpriseInquiries();
      }
      if (key === 'branding') {
        window.loadBrandingToForm();
      }
      if (key === 'resellers') {
        window.fetchAdminResellers();
      }
    } else {
      if (sectionEl) sectionEl.style.display = 'none';
      if (btnEl) {
        btnEl.classList.remove('active');
      }
    }
  });
};

// --- Super Admin Reseller Management Functions ---
window.fetchAdminResellers = async function() {
  const tbody = document.getElementById('admin-resellers-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 20px;">Loading resellers...</td></tr>';

  try {
    const adminPass = localStorage.getItem('adminPassword') || 'admin123';
    const res = await fetch(`/api/admin/resellers?admin_password=${encodeURIComponent(adminPass)}`);
    const data = await res.json();

    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #ef4444; padding: 20px;">${data.error || 'Failed to load resellers.'}</td></tr>`;
      return;
    }

    const resellers = data.resellers || [];
    window._cachedResellers = resellers; // cache for permissions lookups
    if (resellers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">No whitelabel resellers created yet. Click "Add New Reseller" to get started.</td></tr>';
      return;
    }

    tbody.innerHTML = resellers.map(r => {
      const packageName = r.package_name || 'Standard';
      const usedMin = r.quota?.used_minutes || 0;
      const totalMin = r.quota?.total_minutes || 0;
      const ratePM = r.quota?.wholesale_rate_per_minute !== undefined ? r.quota.wholesale_rate_per_minute : 2.0;
      const walletBal = r.wallet_balance !== undefined ? r.wallet_balance : 0;
      return `
      <tr>
        <td style="font-weight: 700; color: var(--text-main);">${r.name}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${r.email}</td>
        <td style="font-size: 0.85rem; font-family: monospace; color: var(--color-cyan);">${r.domain || r.subdomain || '—'}</td>
        <td>
          <span style="background: rgba(139,92,246,0.15); color: #a78bfa; border: 1px solid rgba(139,92,246,0.3); padding: 3px 9px; border-radius: 20px; font-size: 0.75rem; font-weight: 700;">${packageName}</span>
        </td>
        <td style="font-size: 0.85rem;">
          <div><strong>${usedMin}</strong> / ${totalMin} min</div>
          <div style="font-size: 0.72rem; color: #10b981; font-weight: 600; margin-top: 2px;">Wallet: ₹${Number(walletBal).toLocaleString()}</div>
          <div style="width: 80px; height: 4px; background: rgba(255,255,255,0.08); border-radius: 4px; margin-top: 4px; overflow: hidden;">
            <div style="width: ${totalMin > 0 ? Math.min(100, Math.round((usedMin/totalMin)*100)) : 0}%; height: 100%; background: linear-gradient(90deg, #06b6d4, #8b5cf6); border-radius: 4px;"></div>
          </div>
        </td>
        <td>
          <span style="color: #06b6d4; font-weight: 800; font-size: 0.88rem;">₹${Number(ratePM).toFixed(2)}</span><span style="font-size: 0.72rem; color: var(--text-muted);">/min</span>
        </td>
        <td style="font-size: 0.85rem;">${r.client_count || 0} clients</td>
        <td>
          <span class="badge ${r.status === 'active' ? 'badge-green' : 'badge-red'}" style="padding: 2px 8px; border-radius: 100px; font-size: 0.75rem; font-weight: 600;">${r.status}</span>
        </td>
        <td style="text-align: right;">
          <button onclick="window.openResellerPackageModal('${r.id}', '${r.name}', ${totalMin}, ${ratePM}, '${packageName}', ${r.permissions?.max_clients || 10}, ${walletBal})" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem; margin-right: 4px; font-weight: 600;">📦 Package & Rate</button>
          <button onclick="window.rechargeResellerWallet('${r.id}', '${r.name}', ${usedMin}, ${totalMin}, ${walletBal})" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem; margin-right: 4px; color: #10b981; border-color: rgba(16,185,129,0.3); font-weight: 600;">💰 Wallet</button>
          <button onclick="window.toggleResellerStatus('${r.id}', '${r.status}')" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem; margin-right: 4px;">${r.status === 'active' ? 'Suspend' : 'Activate'}</button>
          <button onclick="window.deleteReseller('${r.id}', '${r.name}')" class="btn btn-danger" style="padding: 4px 8px; font-size: 0.75rem; background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);">Delete</button>
        </td>
      </tr>
    `;
    }).join('');

    // Also populate Super Admin Pricing Console reseller dropdown if active
    window.initSuperAdminPricingConsole();
  } catch (err) {
    console.error('Fetch resellers error:', err);
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #ef4444; padding: 20px;">Connection error loading resellers.</td></tr>';
  }
};

window.initSuperAdminPricingConsole = async function() {
  const select = document.getElementById('superadmin-pricing-reseller-select');
  if (!select) return;

  try {
    let resellers = window._cachedResellers;
    if (!resellers || resellers.length === 0) {
      const adminPass = localStorage.getItem('adminPassword') || 'admin123';
      const res = await fetch(`/api/admin/resellers?admin_password=${encodeURIComponent(adminPass)}`);
      const data = await res.json();
      if (data.success && data.resellers) {
        resellers = data.resellers;
        window._cachedResellers = resellers;
      }
    }

    resellers = resellers || [];
    let opts = '<option value="default">Default Platform Rates</option>';
    resellers.forEach(r => {
      opts += `<option value="${r.id}">${escapeHtml(r.name)} (${r.domain || r.subdomain || r.email})</option>`;
    });
    select.innerHTML = opts;
  } catch(e) {
    console.error('Failed to populate pricing reseller dropdown:', e);
  }
};

window.onSuperAdminSelectResellerPricing = function(resellerId) {
  const callRateInput = document.getElementById('sa-wholesale-call-rate');
  const basicInput = document.getElementById('sa-plan-basic-rate');
  const proInput = document.getElementById('sa-plan-pro-rate');
  const customInput = document.getElementById('sa-plan-custom-rate');

  if (resellerId === 'default') {
    if (callRateInput) callRateInput.value = '2.0';
    if (basicInput) basicInput.value = '500';
    if (proInput) proInput.value = '1000';
    if (customInput) customInput.value = '3000';
    return;
  }

  const reseller = (window._cachedResellers || []).find(r => r.id === resellerId);
  if (reseller) {
    const callRate = reseller.quota?.wholesale_rate_per_minute !== undefined ? reseller.quota.wholesale_rate_per_minute : 2.0;
    const planRates = reseller.wholesale_plan_rates || {};
    if (callRateInput) callRateInput.value = callRate;
    if (basicInput) basicInput.value = planRates.basic !== undefined ? planRates.basic : 500;
    if (proInput) proInput.value = planRates.pro !== undefined ? planRates.pro : 1000;
    if (customInput) customInput.value = planRates.custom !== undefined ? planRates.custom : 3000;
  }
};

window.saveSuperAdminCustomWholesaleRates = async function() {
  const resellerId = document.getElementById('superadmin-pricing-reseller-select')?.value || 'default';
  const callRate = parseFloat(document.getElementById('sa-wholesale-call-rate')?.value) || 2.0;
  const basicRate = parseFloat(document.getElementById('sa-plan-basic-rate')?.value) || 500;
  const proRate = parseFloat(document.getElementById('sa-plan-pro-rate')?.value) || 1000;
  const customRate = parseFloat(document.getElementById('sa-plan-custom-rate')?.value) || 3000;
  const adminPass = localStorage.getItem('adminPassword') || 'admin123';

  if (resellerId === 'default') {
    alert('Default platform rates updated.');
    return;
  }

  try {
    const res = await fetch(`/api/admin/resellers/${resellerId}/quota`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_password: adminPass,
        wholesale_rate_per_minute: callRate,
        wholesale_plan_rates: {
          basic: basicRate,
          pro: proRate,
          custom: customRate
        }
      })
    });
    const data = await res.json();
    if (data.success) {
      alert('Custom wholesale rates saved successfully for this reseller partner!');
      window.fetchAdminResellers();
    } else {
      alert('Failed to save rates: ' + (data.error || 'Unknown error'));
    }
  } catch(e) {
    alert('Error saving rates: ' + e.message);
  }
};

// Package & Permissions Modal for Reseller
window.openResellerPackageModal = function(id, name, currentTotal, currentRate, currentPackage, currentMaxClients, currentWallet = 0) {
  // Create or reuse modal
  let modal = document.getElementById('reseller-package-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'reseller-package-modal';
    modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:9999; align-items:center; justify-content:center;';
    modal.innerHTML = `
      <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 20px; padding: 28px; width: 520px; max-width: 95vw; max-height: 90vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div>
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-main);">📦 Reseller Package & Pricing Settings</div>
            <div id="rp-reseller-name" style="font-size: 0.82rem; color: var(--text-muted); margin-top: 2px;"></div>
          </div>
          <button onclick="document.getElementById('reseller-package-modal').style.display='none'" style="background: transparent; border: none; color: var(--text-muted); font-size: 1.3rem; cursor: pointer;">✕</button>
        </div>

        <input type="hidden" id="rp-reseller-id">

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px;">
          <div>
            <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 5px;">Package Name</label>
            <input id="rp-package-name" placeholder="e.g. Starter, Pro, Enterprise" style="background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 8px; padding: 8px 12px; font-size: 0.85rem; outline: none; width: 100%;">
          </div>
          <div>
            <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 5px;">Max Clients Allowed</label>
            <input id="rp-max-clients" type="number" min="1" placeholder="e.g. 10" style="background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 8px; padding: 8px 12px; font-size: 0.85rem; outline: none; width: 100%;">
          </div>
          <div>
            <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 5px;">Total Minute Quota</label>
            <input id="rp-total-minutes" type="number" min="0" placeholder="e.g. 1000" style="background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 8px; padding: 8px 12px; font-size: 0.85rem; outline: none; width: 100%;">
          </div>
          <div>
            <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 5px;">Per-Minute Call Price (₹/min)</label>
            <input id="rp-rate" type="number" step="0.1" min="0" placeholder="e.g. 1.80" style="background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 8px; padding: 8px 12px; font-size: 0.85rem; outline: none; width: 100%;">
          </div>
          <div style="grid-column: span 2;">
            <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 5px;">Wallet Credit Balance (₹)</label>
            <input id="rp-wallet-balance" type="number" step="100" min="0" placeholder="e.g. 5000" style="background: var(--bg-primary); border: 1px solid var(--border-color); color: #10b981; font-weight: 700; border-radius: 8px; padding: 8px 12px; font-size: 0.85rem; outline: none; width: 100%;">
          </div>
        </div>

        <div style="border: 1px solid var(--border-color); border-radius: 12px; padding: 14px; margin-bottom: 18px; background: rgba(0,0,0,0.15);">
          <div style="font-size: 0.85rem; font-weight: 700; margin-bottom: 8px; color: #a78bfa;">💳 Wholesale Base Plan Costs (₹/mo)</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
            <div>
              <label style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 4px;">Basic (₹/mo)</label>
              <input id="rp-plan-basic" type="number" step="50" min="0" placeholder="500" style="background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 8px; padding: 6px 10px; font-size: 0.85rem; outline: none; width: 100%;">
            </div>
            <div>
              <label style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 4px;">Pro (₹/mo)</label>
              <input id="rp-plan-pro" type="number" step="100" min="0" placeholder="1000" style="background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 8px; padding: 6px 10px; font-size: 0.85rem; outline: none; width: 100%;">
            </div>
            <div>
              <label style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 4px;">Custom (₹/mo)</label>
              <input id="rp-plan-custom" type="number" step="100" min="0" placeholder="3000" style="background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 8px; padding: 6px 10px; font-size: 0.85rem; outline: none; width: 100%;">
            </div>
          </div>
        </div>

        <div style="border: 1px solid var(--border-color); border-radius: 12px; padding: 14px; margin-bottom: 18px;">
          <div style="font-size: 0.85rem; font-weight: 700; margin-bottom: 12px; color: var(--text-main);">🔒 Feature Permissions</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
              <input type="checkbox" id="rp-perm-crm" style="accent-color: #8b5cf6; width: 14px; height: 14px;"> CRM Integration
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
              <input type="checkbox" id="rp-perm-recording" style="accent-color: #8b5cf6; width: 14px; height: 14px;"> Call Recordings
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
              <input type="checkbox" id="rp-perm-api" style="accent-color: #8b5cf6; width: 14px; height: 14px;"> API Access
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
              <input type="checkbox" id="rp-perm-landing" style="accent-color: #8b5cf6; width: 14px; height: 14px;"> Edit Landing Page
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
              <input type="checkbox" id="rp-perm-custom-domain" style="accent-color: #8b5cf6; width: 14px; height: 14px;"> Custom Domain
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
              <input type="checkbox" id="rp-perm-transcripts" style="accent-color: #8b5cf6; width: 14px; height: 14px;"> View Transcripts
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
              <input type="checkbox" id="rp-perm-pricing" style="accent-color: #8b5cf6; width: 14px; height: 14px;"> Set Client Pricing
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
              <input type="checkbox" id="rp-perm-callio-brand" style="accent-color: #8b5cf6; width: 14px; height: 14px;"> Show Callio Branding
            </label>
          </div>
        </div>

        <div style="display: flex; gap: 10px;">
          <button onclick="window.saveResellerPackage()" style="flex: 2; background: linear-gradient(135deg, #8b5cf6, #06b6d4); color: white; border: none; padding: 10px; border-radius: 10px; font-weight: 700; cursor: pointer; font-size: 0.9rem;">💾 Save Custom Package & Rates</button>
          <button onclick="document.getElementById('reseller-package-modal').style.display='none'" style="flex: 1; background: rgba(255,255,255,0.05); color: var(--text-muted); border: 1px solid var(--border-color); padding: 10px; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 0.85rem;">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // Populate fields
  document.getElementById('rp-reseller-id').value = id;
  document.getElementById('rp-reseller-name').textContent = `Editing: ${name}`;
  document.getElementById('rp-package-name').value = currentPackage || 'Standard';
  document.getElementById('rp-max-clients').value = currentMaxClients || 10;
  document.getElementById('rp-total-minutes').value = currentTotal || 1000;
  document.getElementById('rp-rate').value = currentRate || 2.0;
  document.getElementById('rp-wallet-balance').value = currentWallet || 0;

  // Load current permissions & plan rates from fetched reseller data
  const resellerRow = window._cachedResellers?.find(r => r.id === id);
  const customPlanRates = resellerRow?.wholesale_plan_rates || {};
  document.getElementById('rp-plan-basic').value = customPlanRates.basic !== undefined ? customPlanRates.basic : 500;
  document.getElementById('rp-plan-pro').value = customPlanRates.pro !== undefined ? customPlanRates.pro : 1000;
  document.getElementById('rp-plan-custom').value = customPlanRates.custom !== undefined ? customPlanRates.custom : 3000;

  if (resellerRow?.permissions) {
    const p = resellerRow.permissions;
    document.getElementById('rp-perm-crm').checked = !!p.can_use_crm;
    document.getElementById('rp-perm-recording').checked = !!p.can_use_recording;
    document.getElementById('rp-perm-api').checked = !!p.can_use_api;
    document.getElementById('rp-perm-landing').checked = !!p.can_edit_landing_page;
    document.getElementById('rp-perm-custom-domain').checked = !!p.can_use_custom_domain;
    document.getElementById('rp-perm-transcripts').checked = !!p.can_view_call_transcripts;
    document.getElementById('rp-perm-pricing').checked = !!p.can_set_pricing;
    document.getElementById('rp-perm-callio-brand').checked = !!p.show_callio_branding;
  }

  modal.style.display = 'flex';
};

window.saveResellerPackage = async function() {
  const id = document.getElementById('rp-reseller-id').value;
  const packageName = document.getElementById('rp-package-name').value.trim() || 'Standard';
  const maxClients = parseInt(document.getElementById('rp-max-clients').value) || 10;
  const totalMinutes = parseFloat(document.getElementById('rp-total-minutes').value) || 1000;
  const rate = parseFloat(document.getElementById('rp-rate').value) || 2.0;
  const walletBal = parseFloat(document.getElementById('rp-wallet-balance').value) || 0;
  const planBasic = parseFloat(document.getElementById('rp-plan-basic').value) || 500;
  const planPro = parseFloat(document.getElementById('rp-plan-pro').value) || 1000;
  const planCustom = parseFloat(document.getElementById('rp-plan-custom').value) || 3000;
  const adminPass = localStorage.getItem('adminPassword') || 'admin123';

  const permissions = {
    can_add_clients: true,
    max_clients: maxClients,
    can_set_pricing: document.getElementById('rp-perm-pricing').checked,
    can_use_crm: document.getElementById('rp-perm-crm').checked,
    can_use_recording: document.getElementById('rp-perm-recording').checked,
    can_use_api: document.getElementById('rp-perm-api').checked,
    can_edit_landing_page: document.getElementById('rp-perm-landing').checked,
    can_use_custom_domain: document.getElementById('rp-perm-custom-domain').checked,
    show_callio_branding: document.getElementById('rp-perm-callio-brand').checked,
    can_view_call_transcripts: document.getElementById('rp-perm-transcripts').checked
  };

  try {
    // Update quota + rate + wallet_balance + wholesale_plan_rates
    const rQuota = await fetch(`/api/admin/resellers/${id}/quota`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_password: adminPass,
        total_minutes: totalMinutes,
        wholesale_rate_per_minute: rate,
        wallet_balance: walletBal,
        wholesale_plan_rates: { basic: planBasic, pro: planPro, custom: planCustom }
      })
    });
    // Update permissions + package_name
    const rPerms = await fetch(`/api/admin/resellers/${id}/permissions`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_password: adminPass, permissions, package_name: packageName })
    });
    const d1 = await rQuota.json();
    const d2 = await rPerms.json();
    if (d1.success && d2.success) {
      document.getElementById('reseller-package-modal').style.display = 'none';
      window.fetchAdminResellers();
    } else {
      alert('Error: ' + (d1.error || d2.error || 'Unknown error'));
    }
  } catch(e) { alert('Failed to save package: ' + e.message); }
};

window.rechargeResellerWallet = async function(id, name, usedMin, totalMin) {
  const minStr = prompt(`Reseller Call Minutes Manager: ${name}\n-----------------------------------\nCurrent Minute Quota: ${usedMin} used / ${totalMin} total min\n\nEnter call minutes to add to ${name}'s quota:`, "1000");
  if (!minStr) return;
  const addMins = parseFloat(minStr);
  if (isNaN(addMins) || addMins <= 0) { alert('Please enter valid minutes.'); return; }

  const adminPass = localStorage.getItem('adminPassword') || 'admin123';
  try {
    const res = await fetch(`/api/admin/resellers/${id}/quota`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_password: adminPass, total_minutes: totalMin + addMins })
    });
    const d = await res.json();
    if (d.success) {
      alert(`✅ Added ${addMins} call minutes to ${name}'s quota!\nNew total: ${totalMin + addMins} minutes.`);
      window.fetchAdminResellers();
    } else {
      alert('Error: ' + d.error);
    }
  } catch(e) { alert('Failed to add minutes quota: ' + e.message); }
};

window.openCreateResellerModal = async function() {
  const name = prompt("Reseller Agency / Company Name:");
  if (!name) return;
  const email = prompt("Reseller Admin Email:");
  if (!email) return;
  const password = prompt("Reseller Admin Password:");
  if (!password) return;
  const domain = prompt("Custom Domain (optional, e.g. app.brand.com):", "") || "";

  const adminPass = localStorage.getItem('adminPassword') || 'admin123';
  try {
    const res = await fetch('/api/admin/resellers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_password: adminPass, name, email, password, domain })
    });
    const d = await res.json();
    if (d.success) {
      alert(`Reseller "${name}" created successfully! Login URL: /reseller`);
      window.fetchAdminResellers();
    } else {
      alert("Error: " + d.error);
    }
  } catch (e) { alert("Failed to create reseller."); }
};

window.editResellerQuota = async function(id, currentTotal, currentRate) {
  const newTotal = prompt("Set total minute quota for this reseller:", currentTotal);
  if (newTotal === null) return;
  const newRate = prompt("Set wholesale rate (₹/min) charged to this reseller:", currentRate);
  if (newRate === null) return;

  const adminPass = localStorage.getItem('adminPassword') || 'admin123';
  try {
    const res = await fetch(`/api/admin/resellers/${id}/quota`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_password: adminPass,
        total_minutes: parseFloat(newTotal),
        wholesale_rate_per_minute: parseFloat(newRate)
      })
    });
    const d = await res.json();
    if (d.success) {
      window.fetchAdminResellers();
    } else {
      alert("Error: " + d.error);
    }
  } catch (e) { alert("Failed to update quota."); }
};

window.toggleResellerStatus = async function(id, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
  const adminPass = localStorage.getItem('adminPassword') || 'admin123';
  try {
    const res = await fetch(`/api/admin/resellers/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_password: adminPass, status: newStatus })
    });
    const d = await res.json();
    if (d.success) {
      window.fetchAdminResellers();
    } else {
      alert("Error: " + d.error);
    }
  } catch (e) { alert("Failed to change status."); }
};

window.deleteReseller = async function(id, name) {
  if (!confirm(`Are you sure you want to delete reseller "${name}"?`)) return;
  const adminPass = localStorage.getItem('adminPassword') || 'admin123';
  try {
    const res = await fetch(`/api/admin/resellers/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_password: adminPass })
    });
    const d = await res.json();
    if (d.success) {
      window.fetchAdminResellers();
    } else {
      alert("Error: " + d.error);
    }
  } catch (e) { alert("Failed to delete reseller."); }
};

// Sleek Global Audio Player for Lead Recordings

let currentPlayingBtn = null;
let globalAudio = null;

window.playLeadRecording = function(btn, url) {
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.onended = () => {
      if (currentPlayingBtn) {
        currentPlayingBtn.innerHTML = '▶';
        currentPlayingBtn.style.background = 'var(--grad-coral)';
        currentPlayingBtn.nextElementSibling.innerText = 'Listen';
      }
    };
    globalAudio.ontimeupdate = () => {
      if (currentPlayingBtn) {
        const cur = formatTime(globalAudio.currentTime);
        const hasValidDuration = globalAudio.duration && isFinite(globalAudio.duration) && !isNaN(globalAudio.duration);
        if (hasValidDuration) {
          const dur = formatTime(globalAudio.duration);
          currentPlayingBtn.nextElementSibling.innerText = `${cur} / ${dur}`;
        } else {
          currentPlayingBtn.nextElementSibling.innerText = cur;
        }
      }
    };
  }

  function formatTime(secs) {
    if (isNaN(secs) || !isFinite(secs)) return '0:00';
    const m = Math.floor(secs / 60).toString();
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  if (globalAudio.src.endsWith(url) && !globalAudio.paused) {
    globalAudio.pause();
    btn.innerHTML = '▶';
    btn.style.background = 'var(--grad-coral)';
    btn.nextElementSibling.innerText = 'Paused';
  } else {
    if (currentPlayingBtn && currentPlayingBtn !== btn) {
      currentPlayingBtn.innerHTML = '▶';
      currentPlayingBtn.style.background = 'var(--grad-coral)';
      currentPlayingBtn.nextElementSibling.innerText = 'Listen';
    }
    globalAudio.src = url;
    globalAudio.play().catch(e => console.error('Audio play failed:', e));
    btn.innerHTML = '⏸';
    btn.style.background = '#6b7280'; // neutral gray pause button
    btn.nextElementSibling.innerText = 'Playing...';
    currentPlayingBtn = btn;
  }
};

// --- Invoices & Tax Billing System ---
window._cachedInvoices = [];

window.fetchAdminInvoices = async function() {
  try {
    const tbody = document.getElementById('admin-invoices-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 20px;">Loading invoices...</td></tr>';

    const res = await fetch('/api/admin/invoices');
    const data = await res.json();

    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #ef4444; padding: 20px;">${data.error || 'Failed to load invoices.'}</td></tr>`;
      return;
    }

    window._cachedInvoices = data.invoices || [];
    window.renderAdminInvoicesTable(window._cachedInvoices);
  } catch (err) {
    console.error('Failed to fetch admin invoices:', err);
  }
};

window.renderAdminInvoicesTable = function(invoices) {
  const tbody = document.getElementById('admin-invoices-table-body');
  if (!tbody) return;

  // Calculate summary stats
  let totalCount = invoices.length;
  let paidAmount = 0;
  let pendingAmount = 0;

  invoices.forEach(inv => {
    const amt = Number(inv.totalAmount || inv.subtotal || 0);
    if (inv.status === 'paid') {
      paidAmount += amt;
    } else {
      pendingAmount += amt;
    }
  });

  const totalCountEl = document.getElementById('invoice-stat-total-count');
  const paidAmountEl = document.getElementById('invoice-stat-paid-amount');
  const pendingAmountEl = document.getElementById('invoice-stat-pending-amount');

  if (totalCountEl) totalCountEl.textContent = totalCount;
  if (paidAmountEl) paidAmountEl.textContent = `₹${paidAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  if (pendingAmountEl) pendingAmountEl.textContent = `₹${pendingAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  if (invoices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">No invoices found. Click "Create New Invoice" to issue one.</td></tr>';
    return;
  }

  tbody.innerHTML = invoices.map(inv => {
    const dt = inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : '—';
    const subtotalStr = `₹${Number(inv.subtotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const taxStr = `₹${Number(inv.taxAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const totalStr = `₹${Number(inv.totalAmount || inv.subtotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    const isPaid = inv.status === 'paid';
    const statusBadge = isPaid
      ? `<span class="badge badge-green" style="padding: 3px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700;">✓ PAID</span>`
      : (inv.status === 'pending' 
          ? `<span class="badge" style="background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); padding: 3px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700;">⏳ PENDING</span>`
          : `<span class="badge badge-red" style="padding: 3px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700;">UNPAID</span>`);

    return `
      <tr>
        <td style="font-family: monospace; font-weight: 700; color: var(--color-cyan); font-size: 0.85rem;">${escapeHtml(inv.id)}</td>
        <td>
          <strong style="color: var(--text-main); font-size: 0.85rem;">${escapeHtml(inv.clientName)}</strong>
          ${inv.clientCompany && inv.clientCompany !== inv.clientName ? `<div style="font-size: 0.74rem; color: var(--text-muted);">${escapeHtml(inv.clientCompany)}</div>` : ''}
        </td>
        <td style="font-size: 0.82rem; color: var(--text-main);">${escapeHtml(inv.description || inv.planName || 'AI Service')}</td>
        <td style="font-size: 0.85rem; font-weight: 600;">${subtotalStr}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${taxStr}</td>
        <td style="font-size: 0.9rem; font-weight: 800; color: #10b981;">${totalStr}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${dt}</td>
        <td>${statusBadge}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button onclick="window.openViewInvoiceModal('${inv.id}')" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem; margin-right: 4px; font-weight: 700; background: rgba(6,182,212,0.12); color: #06b6d4; border-color: rgba(6,182,212,0.3);">👁️ View & Print</button>
          <button onclick="window.openEditInvoiceModal('${inv.id}')" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem; margin-right: 4px; font-weight: 700; background: rgba(139,92,246,0.12); color: #a78bfa; border-color: rgba(139,92,246,0.3);">✏️ Edit</button>
          <button onclick="window.toggleInvoiceStatus('${inv.id}', '${inv.status}')" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem; margin-right: 4px;">${isPaid ? 'Mark Unpaid' : 'Mark Paid'}</button>
          <button onclick="window.deleteInvoice('${inv.id}')" class="btn btn-danger" style="padding: 4px 8px; font-size: 0.75rem; background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
};

window.filterAdminInvoices = function() {
  const query = (document.getElementById('admin-invoices-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('admin-invoices-status-filter')?.value || 'all';

  let filtered = [...(window._cachedInvoices || [])];

  if (statusFilter !== 'all') {
    if (statusFilter === 'paid') {
      filtered = filtered.filter(i => i.status === 'paid');
    } else {
      filtered = filtered.filter(i => i.status !== 'paid');
    }
  }

  if (query) {
    filtered = filtered.filter(i => 
      (i.id || '').toLowerCase().includes(query) ||
      (i.clientName || '').toLowerCase().includes(query) ||
      (i.clientEmail || '').toLowerCase().includes(query) ||
      (i.clientCompany || '').toLowerCase().includes(query) ||
      (i.description || '').toLowerCase().includes(query)
    );
  }

  window.renderAdminInvoicesTable(filtered);
};

window.editingInvoiceId = null;

window.openCreateInvoiceModal = async function() {
  window.editingInvoiceId = null;
  const modal = document.getElementById('admin-create-invoice-modal');
  if (!modal) return;

  const select = document.getElementById('ci-client-select');
  if (select) {
    select.innerHTML = '<option value="">Loading clients...</option>';
    try {
      const clients = window.activeClients || [];
      let opts = '<option value="">-- Choose Client --</option>';
      clients.forEach(c => {
        opts += `<option value="${c.id}">${escapeHtml(c.name)} (${c.email || c.phone_number || 'Client'})</option>`;
      });
      select.innerHTML = opts;
    } catch (e) {
      select.innerHTML = '<option value="">-- Choose Client --</option>';
    }
  }

  // Reset form inputs
  document.getElementById('ci-client-name').value = '';
  document.getElementById('ci-client-company').value = '';
  document.getElementById('ci-client-email').value = '';
  document.getElementById('ci-client-phone').value = '';
  document.getElementById('ci-description').value = 'Pro AI Calling Plan - Monthly Subscription (5,000 Mins)';
  document.getElementById('ci-subtotal').value = '1000';
  document.getElementById('ci-tax-rate').value = '18';
  document.getElementById('ci-status').value = 'paid';
  document.getElementById('ci-payment-method').value = 'UPI / Razorpay';
  
  window.calcInvoiceTotals();
  modal.style.display = 'flex';
};

window.openEditInvoiceModal = function(invoiceId) {
  const inv = (window._cachedInvoices || []).find(i => i.id === invoiceId);
  if (!inv) return;

  window.editingInvoiceId = invoiceId;
  const modal = document.getElementById('admin-create-invoice-modal');
  if (!modal) return;

  // Populate client dropdown
  const select = document.getElementById('ci-client-select');
  if (select) {
    const clients = window.activeClients || [];
    let opts = '<option value="">-- Choose Client --</option>';
    clients.forEach(c => {
      const sel = c.id === inv.clientId ? 'selected' : '';
      opts += `<option value="${c.id}" ${sel}>${escapeHtml(c.name)} (${c.email || c.phone_number || 'Client'})</option>`;
    });
    select.innerHTML = opts;
  }

  document.getElementById('ci-client-name').value = inv.clientName || '';
  document.getElementById('ci-client-company').value = inv.clientCompany || '';
  document.getElementById('ci-client-email').value = inv.clientEmail || '';
  document.getElementById('ci-client-phone').value = inv.clientPhone || '';
  document.getElementById('ci-description').value = inv.description || inv.planName || '';
  document.getElementById('ci-subtotal').value = inv.subtotal || 0;
  document.getElementById('ci-tax-rate').value = inv.taxRate !== undefined ? inv.taxRate : 18;
  document.getElementById('ci-status').value = inv.status || 'paid';
  document.getElementById('ci-payment-method').value = inv.paymentMethod || 'UPI / Razorpay';

  window.calcInvoiceTotals();
  modal.style.display = 'flex';
};

window.onSelectInvoiceClient = function(clientId) {
  if (!clientId) return;
  const client = (window.activeClients || []).find(c => c.id === clientId);
  if (client) {
    document.getElementById('ci-client-name').value = client.name || '';
    document.getElementById('ci-client-email').value = client.email || '';
    document.getElementById('ci-client-phone').value = client.phone_number || '';
    document.getElementById('ci-client-company').value = client.company_name || client.name || '';
  }
};

window.calcInvoiceTotals = function() {
  const subtotal = parseFloat(document.getElementById('ci-subtotal')?.value) || 0;
  const taxRate = parseFloat(document.getElementById('ci-tax-rate')?.value) || 0;
  const taxAmt = subtotal * (taxRate / 100);
  const total = subtotal + taxAmt;

  const totalEl = document.getElementById('ci-total-display');
  if (totalEl) {
    totalEl.value = `₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
};

window.submitCreateInvoice = async function(event) {
  event.preventDefault();

  const clientName = document.getElementById('ci-client-name').value.trim();
  const clientCompany = document.getElementById('ci-client-company').value.trim();
  const clientEmail = document.getElementById('ci-client-email').value.trim();
  const clientPhone = document.getElementById('ci-client-phone').value.trim();
  const description = document.getElementById('ci-description').value.trim();
  const subtotal = parseFloat(document.getElementById('ci-subtotal').value) || 0;
  const taxRate = parseFloat(document.getElementById('ci-tax-rate').value) || 18;
  const status = document.getElementById('ci-status').value;
  const paymentMethod = document.getElementById('ci-payment-method').value.trim();
  const clientId = document.getElementById('ci-client-select').value;

  const isEdit = !!window.editingInvoiceId;
  const url = isEdit ? `/api/admin/invoices/${window.editingInvoiceId}` : '/api/admin/invoices';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        clientName,
        clientCompany,
        clientEmail,
        clientPhone,
        planName: description,
        description,
        subtotal,
        taxRate,
        status,
        paymentMethod
      })
    });

    const data = await res.json();
    if (data.success) {
      document.getElementById('admin-create-invoice-modal').style.display = 'none';
      window.editingInvoiceId = null;
      window.fetchAdminInvoices();
    } else {
      alert('Error saving invoice: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Failed to save invoice: ' + e.message);
  }
};

// --- Razorpay Payment Gateway Functions ---
window.fetchRazorpayConfig = async function() {
  try {
    const res = await fetch('/api/admin/razorpay-config');
    const data = await res.json();
    if (!data.success) return;

    const cfg = data.config || {};
    document.getElementById('rzp-status').value = cfg.status || 'active';
    document.getElementById('rzp-key-id').value = cfg.keyId || '';
    document.getElementById('rzp-key-secret').value = cfg.keySecretMasked || '';
    document.getElementById('rzp-webhook-secret').value = cfg.webhookSecret || '';
    document.getElementById('rzp-currency').value = cfg.currency || 'INR';
    document.getElementById('rzp-auto-invoice').checked = cfg.autoInvoice !== false;

    const badge = document.getElementById('razorpay-status-badge');
    if (badge) {
      if (cfg.status === 'active' && cfg.keyId) {
        badge.style.background = 'rgba(16,185,129,0.15)';
        badge.style.color = '#10b981';
        badge.style.borderColor = 'rgba(16,185,129,0.3)';
        badge.innerHTML = `<span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block;"></span> Active & Connected`;
      } else {
        badge.style.background = 'rgba(239,68,68,0.15)';
        badge.style.color = '#ef4444';
        badge.style.borderColor = 'rgba(239,68,68,0.3)';
        badge.innerHTML = `<span style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444; display: inline-block;"></span> Disabled / Not Configured`;
      }
    }

    const tenantInfo = document.getElementById('razorpay-tenant-info-text');
    if (tenantInfo) {
      tenantInfo.textContent = `Configuring custom Razorpay credentials for: ${data.tenantName || 'Current Domain Host'}`;
    }
  } catch (e) {
    console.error('Failed to fetch Razorpay config:', e);
  }
};

window.saveRazorpayConfig = async function(event) {
  event.preventDefault();
  const status = document.getElementById('rzp-status').value;
  const keyId = document.getElementById('rzp-key-id').value.trim();
  const keySecret = document.getElementById('rzp-key-secret').value.trim();
  const webhookSecret = document.getElementById('rzp-webhook-secret').value.trim();
  const currency = document.getElementById('rzp-currency').value;
  const autoInvoice = document.getElementById('rzp-auto-invoice').checked;

  try {
    const res = await fetch('/api/admin/razorpay-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, keyId, keySecret, webhookSecret, currency, autoInvoice })
    });

    const data = await res.json();
    if (data.success) {
      alert('✅ Razorpay Gateway credentials saved successfully!');
      window.fetchRazorpayConfig();
    } else {
      alert('Error saving Razorpay settings: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Failed to save Razorpay settings: ' + e.message);
  }
};

window.testRazorpayConnection = function() {
  const keyId = document.getElementById('rzp-key-id').value.trim();
  if (!keyId) {
    alert('Please enter a Razorpay Key ID first.');
    return;
  }
  if (!keyId.startsWith('rzp_live_') && !keyId.startsWith('rzp_test_')) {
    alert('⚠️ Invalid Key ID format. Razorpay Key IDs usually start with "rzp_live_" or "rzp_test_".');
    return;
  }
  alert(`✅ Razorpay Key ID format is valid! Key ID: ${keyId}`);
};

window.toggleInvoiceStatus = async function(invoiceId, currentStatus) {
  const newStatus = currentStatus === 'paid' ? 'unpaid' : 'paid';
  try {
    const res = await fetch(`/api/admin/invoices/${invoiceId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      window.fetchAdminInvoices();
    }
  } catch(e) {}
};

window.deleteInvoice = async function(invoiceId) {
  if (!confirm(`Are you sure you want to delete invoice ${invoiceId}?`)) return;
  try {
    const res = await fetch(`/api/admin/invoices/${invoiceId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      window.fetchAdminInvoices();
    }
  } catch(e) {}
};

window.openViewInvoiceModal = function(invoiceId) {
  const inv = (window._cachedInvoices || []).find(i => i.id === invoiceId);
  if (!inv) return;

  const brand = window.BrandingContext || { appName: 'Callio', logoUrl: '', supportEmail: 'support@callio.in' };
  const brandName = brand.appName || 'Callio';
  const logoHtml = brand.logoUrl 
    ? `<img src="${brand.logoUrl}" style="height: 38px; max-height: 38px; object-fit: contain;">`
    : `<div style="font-size: 1.4rem; font-weight: 900; color: #2563eb;">${brandName}</div>`;

  const dt = inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Today';
  const dueDt = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : 'On Receipt';
  
  const subtotalNum = Number(inv.subtotal || 0);
  const taxRate = Number(inv.taxRate !== undefined ? inv.taxRate : 18);
  const taxAmount = Number(inv.taxAmount || (subtotalNum * (taxRate / 100)));
  const cgst = (taxAmount / 2).toFixed(2);
  const sgst = (taxAmount / 2).toFixed(2);
  const totalNum = Number(inv.totalAmount || (subtotalNum + taxAmount));

  const isPaid = inv.status === 'paid';
  const statusBadge = isPaid
    ? `<span style="background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 800; text-transform: uppercase;">PAID</span>`
    : `<span style="background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 800; text-transform: uppercase;">UNPAID</span>`;

  const html = `
    <!-- Header -->
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px;">
      <div>
        ${logoHtml}
        <div style="font-size: 0.8rem; color: #64748b; margin-top: 6px;">AI Conversational Voice Platform</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 1.6rem; font-weight: 900; color: #0f172a; letter-spacing: -0.5px;">TAX INVOICE</div>
        <div style="font-family: monospace; font-size: 0.95rem; font-weight: 700; color: #2563eb; margin-top: 2px;"># ${escapeHtml(inv.id)}</div>
        <div style="margin-top: 6px;">${statusBadge}</div>
      </div>
    </div>

    <!-- Metadata Row -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; margin-bottom: 28px;">
      <div>
        <div style="font-size: 0.7rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">ISSUED BY (PROVIDER)</div>
        <div style="font-weight: 700; color: #0f172a; font-size: 0.95rem;">${escapeHtml(brandName)}</div>
        <div style="font-size: 0.82rem; color: #475569; margin-top: 2px;">Domain: ${escapeHtml(inv.tenantDomain || window.location.host)}</div>
        <div style="font-size: 0.82rem; color: #475569;">Email: ${escapeHtml(brand.supportEmail || 'support@' + window.location.host)}</div>
        ${inv.issuerGstin || window._domainGstin ? `<div style="font-size: 0.82rem; color: #059669; font-weight: 700; margin-top: 3px; font-family: monospace;">GSTIN: ${escapeHtml(inv.issuerGstin || window._domainGstin)}</div>` : `<div style="font-size: 0.78rem; color: #94a3b8; margin-top: 2px;">GSTIN: Provider / Unregistered</div>`}
      </div>
      <div>
        <div style="font-size: 0.7rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">BILLED TO (CUSTOMER)</div>
        <div style="font-weight: 700; color: #0f172a; font-size: 0.95rem;">${escapeHtml(inv.clientName)}</div>
        ${inv.clientCompany && inv.clientCompany !== inv.clientName ? `<div style="font-size: 0.82rem; color: #475569;">${escapeHtml(inv.clientCompany)}</div>` : ''}
        <div style="font-size: 0.82rem; color: #475569;">${escapeHtml(inv.clientEmail || '—')} | ${escapeHtml(inv.clientPhone || '—')}</div>
        <div style="font-size: 0.82rem; color: #475569;">${escapeHtml(inv.clientAddress || 'India')}</div>
        ${inv.customerGstin || inv.clientGstin ? `<div style="font-size: 0.82rem; color: #2563eb; font-weight: 700; margin-top: 3px; font-family: monospace;">GSTIN: ${escapeHtml(inv.customerGstin || inv.clientGstin)}</div>` : `<div style="font-size: 0.78rem; color: #94a3b8; margin-top: 2px;">GSTIN: Consumer / Unregistered</div>`}
      </div>
    </div>

    <!-- Dates Row -->
    <div style="display: flex; justify-content: space-between; margin-bottom: 24px; font-size: 0.85rem;">
      <div><span style="color: #64748b;">Invoice Date:</span> <strong style="color: #0f172a;">${dt}</strong></div>
      <div><span style="color: #64748b;">Payment Method:</span> <strong style="color: #0f172a;">${escapeHtml(inv.paymentMethod || 'Online Payment')}</strong></div>
      <div><span style="color: #64748b;">Due Date:</span> <strong style="color: #0f172a;">${dueDt}</strong></div>
    </div>

    <!-- Items Table -->
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <thead>
        <tr style="background: #f1f5f9; text-align: left;">
          <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase; border-radius: 8px 0 0 8px;">Description / Item</th>
          <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase; text-align: center;">Qty</th>
          <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase; text-align: right;">Rate</th>
          <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase; text-align: right; border-radius: 0 8px 8px 0;">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 14px; font-size: 0.88rem; font-weight: 600; color: #0f172a;">
            ${escapeHtml(inv.description || inv.planName || 'AI Voice Subscription')}
          </td>
          <td style="padding: 14px; font-size: 0.88rem; color: #475569; text-align: center;">1</td>
          <td style="padding: 14px; font-size: 0.88rem; color: #475569; text-align: right;">₹${subtotalNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          <td style="padding: 14px; font-size: 0.88rem; font-weight: 700; color: #0f172a; text-align: right;">₹${subtotalNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        </tr>
      </tbody>
    </table>

    <!-- Total Calculations Box -->
    <div style="display: flex; justify-content: flex-end; margin-bottom: 32px;">
      <div style="width: 280px;">
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.85rem; color: #475569;">
          <span>Subtotal:</span>
          <span>₹${subtotalNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.85rem; color: #475569;">
          <span>CGST (9%):</span>
          <span>₹${cgst}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.85rem; color: #475569;">
          <span>SGST (9%):</span>
          <span>₹${sgst}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 10px 0; margin-top: 6px; border-top: 2px solid #0f172a; font-size: 1.1rem; font-weight: 900; color: #0f172a;">
          <span>Total Amount:</span>
          <span style="color: #2563eb;">₹${totalNum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>
    </div>

    <!-- Footer Note -->
    <div style="border-top: 1px solid #e2e8f0; padding-top: 18px; text-align: center; font-size: 0.78rem; color: #94a3b8;">
      Thank you for choosing ${escapeHtml(brandName)}! This is a computer-generated tax invoice and does not require a physical signature.
    </div>
  `;

  document.getElementById('printable-invoice-content').innerHTML = html;
  document.getElementById('admin-view-invoice-modal').style.display = 'flex';
};

window.printInvoiceModal = function() {
  const content = document.getElementById('printable-invoice-content').innerHTML;
  const printWin = window.open('', '_blank', 'width=850,height=900');
  printWin.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Tax Invoice</title>
        <style>
          body { font-family: 'Inter', sans-serif; margin: 30px; color: #0f172a; }
          @media print {
            .no-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        ${content}
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 500);
          };
        </script>
      </body>
    </html>
  `);
  printWin.document.close();
};

window.fetchTrialLeads = async function() {
  try {
    const res = await fetch('/api/admin/trial-leads');
    const data = await res.json();
    if (data.success) {
      const tbody = document.getElementById('admin-trial-leads-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';
      if (!data.leads || data.leads.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No trial leads found.</td></tr>';
        return;
      }
      data.leads.forEach(lead => {
        const tr = document.createElement('tr');
        const dt = new Date(lead.timestamp).toLocaleString();
        
        // Clean summary string if raw JSON leaked
        let cleanSum = lead.summary || '';
        if (cleanSum.startsWith('{') || cleanSum.includes('"summary":')) {
          cleanSum = cleanSum.replace(/^{\s*"summary"\s*:\s*"?/i, '')
                             .replace(/^"summary"\s*:\s*"/i, '')
                             .replace(/",?\s*"leadQuality"[\s\S]*$/i, '')
                             .replace(/"\s*}\s*$/i, '')
                             .replace(/\\n/g, '\n')
                             .replace(/\\"/g, '"')
                             .replace(/\n/g, '<br>');
        }

        const currentBrand = window.getWhitelabelBrandName ? window.getWhitelabelBrandName() : 'Callio';
        if (currentBrand && currentBrand !== 'Callio') {
          cleanSum = cleanSum.replace(/Callio/gi, currentBrand);
        }

        // Render call summary cleanly with tooltips
        const summaryHtml = cleanSum
          ? `<div style="max-height: 100px; overflow-y: auto; font-size: 0.78rem; line-height: 1.4; color: var(--on-surface);" title="${cleanSum.replace(/<br>/g, '\n')}">${cleanSum}</div>`
          : `<span style="color: var(--text-muted); font-style: italic; font-size: 0.75rem;">Pending call / No summary</span>`;
          
        // Render lead status / quality
        const statusHtml = lead.leadQuality
          ? `
            <div style="display: flex; flex-direction: column; gap: 5px; vertical-align: middle;">
              <span class="badge" style="
                background: ${lead.leadQuality === 'Hot Lead' ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.05))' : (lead.leadQuality === 'Warm Lead' ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(245, 158, 11, 0.05))' : 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(59, 130, 246, 0.05))')};
                color: ${lead.leadQuality === 'Hot Lead' ? '#ef4444' : (lead.leadQuality === 'Warm Lead' ? '#f59e0b' : '#3b82f6')};
                font-size: 0.68rem; padding: 3px 8px; border-radius: 20px; font-weight: bold; width: fit-content; border: 1px solid ${lead.leadQuality === 'Hot Lead' ? 'rgba(239, 68, 68, 0.25)' : (lead.leadQuality === 'Warm Lead' ? 'rgba(245, 158, 11, 0.25)' : 'rgba(59, 130, 246, 0.25)')};
                letter-spacing: 0.3px; text-transform: uppercase;
              ">
                ${lead.leadQuality === 'Hot Lead' ? '🔥 ' : (lead.leadQuality === 'Warm Lead' ? '⚡ ' : '❄️ ')}${lead.leadQuality}
              </span>
              <span style="font-size: 0.72rem; color: var(--text-muted); line-height: 1.35; font-weight: 500;">
                <span style="color: var(--color-coral); font-weight: 600;">Action:</span> ${lead.actionToTake || 'No action needed.'}
              </span>
            </div>
            `
          : `<span style="color: var(--text-muted); font-style: italic; font-size: 0.75rem;">N/A</span>`;

        // Render custom sleek audio player for recording
        const recordingHtml = lead.recordingUrl
          ? `
            <div style="display: flex; align-items: center; gap: 8px; background: rgba(255, 107, 74, 0.04); padding: 5px 12px; border-radius: 30px; border: 1px solid rgba(255, 107, 74, 0.15); width: 140px; box-shadow: 0 2px 4px rgba(0,0,0,0.03);">
              <button onclick="window.playLeadRecording(this, '${lead.recordingUrl}')" style="
                background: var(--grad-coral); color: white; border: none; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 5px rgba(255, 107, 74, 0.25); outline: none; padding: 0;
              ">▶</button>
              <span style="font-size: 0.72rem; color: var(--text-main); font-weight: 600; font-family: monospace;">Listen</span>
            </div>
            `
          : `<span style="color: var(--text-muted); font-style: italic; font-size: 0.75rem;">No recording</span>`;
          
        tr.innerHTML = `
          <td><strong style="font-family: 'Sora', sans-serif; font-weight: 600; color: var(--text-main);">${lead.name}</strong></td>
          <td><span style="color: var(--color-coral); font-family: monospace; font-weight: 600;">${lead.phone}</span></td>
          <td><span class="badge" style="background: rgba(255, 107, 74, 0.08); color: var(--color-coral); border: 1px solid rgba(255, 107, 74, 0.15); font-size: 0.7rem; padding: 3px 10px; border-radius: 20px; font-weight: bold; font-family: monospace;">${lead.voice}</span></td>
          <td style="max-width: 250px; vertical-align: middle;">${summaryHtml}</td>
          <td style="vertical-align: middle; max-width: 180px;">${statusHtml}</td>
          <td style="vertical-align: middle;">${recordingHtml}</td>
          <td style="color: var(--text-muted); font-size: 0.78rem; vertical-align: middle;">${dt}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error('Failed to fetch trial leads:', err);
  }
};

// Dynamic Server Time monitor updater
setInterval(() => {
  const el = document.getElementById('admin-server-time');
  if (el) {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (el.textContent !== timeStr) {
      el.textContent = timeStr;
    }
  }
}, 15000);

// --- Fetch Billing & Wallet Data ---
async function fetchBillingData() {
  if (!loggedInUser) return;
  
  const container = document.getElementById('admin-client-select-container');
  const select = document.getElementById('admin-billing-client-select');
  const editBtn = document.getElementById('admin-edit-plan-btn');
  const adminBillingCard = document.getElementById('admin-billing-card');
  
  if (adminBillingCard) {
    adminBillingCard.style.display = loggedInUser.role === 'admin' ? 'flex' : 'none';
  }
  
  if (loggedInUser.role === 'admin' && container && select && editBtn) {
    container.style.display = 'block';
    editBtn.style.display = 'flex';
    
    // Fetch clients if cache is empty
    if (!window.adminClientsCache || window.adminClientsCache.length === 0) {
      try {
        const cRes = await fetch('/api/admin/clients');
        const cData = await cRes.json();
        if (cData.success && Array.isArray(cData.clients)) {
          window.adminClientsCache = cData.clients;
        }
      } catch (e) {
        console.error('Failed fetching admin clients:', e);
      }
    }
    
    // Populate dropdown with all registered clients
    select.innerHTML = '';
    const clients = window.adminClientsCache || [];
    
    clients.forEach(client => {
      if (client.id === loggedInUser.id) return;
      const opt = document.createElement('option');
      opt.value = client.id;
      opt.textContent = `${client.name} (${client.email || client.phone_number || client.id})`;
      select.appendChild(opt);
    });
    
    const optAdmin = document.createElement('option');
    optAdmin.value = loggedInUser.id;
    optAdmin.textContent = `${loggedInUser.name} (Admin Account)`;
    select.appendChild(optAdmin);
    
    // Select the currently managed client if any, otherwise default to first real client
    if (window.currentManagedClientId && select.querySelector(`option[value="${window.currentManagedClientId}"]`)) {
      select.value = window.currentManagedClientId;
    } else if (clients.length > 0) {
      select.value = clients[0].id;
      window.currentManagedClientId = clients[0].id;
    } else {
      select.value = loggedInUser.id;
    }
    
    // Trigger initial render of pricing and details
    window.onAdminBillingClientChange();
  } else {
    if (container) container.style.display = 'none';
    if (editBtn) editBtn.style.display = 'none';
    
    const clientId = loggedInUser.id;
    try {
      await fetchPlans();
      const res = await fetch(`/api/client/billing?clientId=${clientId}`);
      const data = await res.json();
      if (data.success) {
        // Sync local session with the server database state
        loggedInUser = { ...loggedInUser, balance: data.balance, plan: data.plan, used_minutes: data.used_minutes };
        localStorage.setItem('user_session', JSON.stringify(loggedInUser));
        applyUserPlanAndLimits(loggedInUser);
        
        // Render remaining minutes (billing card + header)
        const balanceEl = document.getElementById('billing-wallet-balance');
        const headerWalletBalance = document.getElementById('header-wallet-balance');
        const remMins = data.balance !== undefined ? (data.balance >= 99999 ? '∞' : Math.max(0, data.balance).toFixed(1)) : '0.0';
        if (balanceEl) balanceEl.textContent = `${remMins} Mins`;
        if (headerWalletBalance) {
          headerWalletBalance.textContent = `${remMins}`;
        }

        // Render rates
        const rateMinEl = document.getElementById('pricing-rate-minute');
        const rateRecEl = document.getElementById('pricing-rate-recording');
        const rateSessEl = document.getElementById('pricing-rate-session');
        
        const rates = data.pricing || { rate_per_minute: 2.00, rate_recording_per_minute: 0.50, rate_per_session: 1.00 };
        if (rateMinEl) rateMinEl.textContent = `₹${rates.rate_per_minute.toFixed(2)} / min`;
        if (rateRecEl) rateRecEl.textContent = `₹${rates.rate_recording_per_minute.toFixed(2)} / min`;
        if (rateSessEl) rateSessEl.textContent = `₹${rates.rate_per_session.toFixed(2)} / call`;
        
        // Render transactions table
        window.renderBillingTransactions(data.billing_history || []);
      }
    } catch (err) {
      console.error('Failed to fetch billing data:', err);
    }
  }
}
window.fetchBillingData = fetchBillingData;

// --- Admin Billing Client Change Handler ---
window.onAdminBillingClientChange = async function() {
  const select = document.getElementById('admin-billing-client-select');
  if (!select) return;
  const clientId = select.value;
  
  try {
    const res = await fetch(`/api/client/billing?clientId=${clientId}`);
    const data = await res.json();
    if (data.success) {
      // Render remaining minutes (admin-view billing card for selected client + header)
      const balanceEl = document.getElementById('billing-wallet-balance');
      const headerWalletBalance = document.getElementById('header-wallet-balance');
      const remMins = data.balance !== undefined ? (data.balance >= 99999 ? '∞' : Math.max(0, data.balance).toFixed(1)) : '0.0';
      if (balanceEl) {
        balanceEl.textContent = `${remMins} Mins`;
      }
      if (headerWalletBalance) {
        headerWalletBalance.textContent = `${remMins}`;
      }
      
      // Render rates
      const rateMinEl = document.getElementById('pricing-rate-minute');
      const rateRecEl = document.getElementById('pricing-rate-recording');
      const rateSessEl = document.getElementById('pricing-rate-session');
      
      const rates = data.pricing || { rate_per_minute: 2.00, rate_recording_per_minute: 0.50, rate_per_session: 1.00 };
      if (rateMinEl) rateMinEl.textContent = `₹${rates.rate_per_minute.toFixed(2)} / min`;
      if (rateRecEl) rateRecEl.textContent = `₹${rates.rate_recording_per_minute.toFixed(2)} / min`;
      if (rateSessEl) rateSessEl.textContent = `₹${rates.rate_per_session.toFixed(2)} / call`;
      
      // Cache values for editing
      window.currentManagedClientId = clientId;
      window.currentManagedClientName = select.options[select.selectedIndex] ? select.options[select.selectedIndex].text : clientId;
      window.currentManagedRates = rates;
      
      // Render transactions table
      window.renderBillingTransactions(data.billing_history || []);
    }
  } catch (err) {
    console.error('[Admin Billing Change Error] Failed:', err);
  }
};

// --- Billing Filters, Pagination & CSV Export Helpers ---
window.billingTransactions = [];
window.billingCurrentPage = 1;
window.billingPageSize = 10;
window.currentFilteredBillingTransactions = [];

window.renderBillingTransactions = function(transactions) {
  if (transactions) {
    window.billingTransactions = transactions;
  }
  
  const tbody = document.getElementById('billing-history-table-body');
  if (!tbody) return;
  
  // 1. Get filter values
  const dateRange = document.getElementById('billing-filter-date-range')?.value || 'all';
  const customContainer = document.getElementById('billing-custom-date-container');
  if (customContainer) {
    customContainer.style.display = dateRange === 'custom' ? 'flex' : 'none';
  }
  
  const startDateVal = document.getElementById('billing-filter-start-date')?.value || '';
  const endDateVal = document.getElementById('billing-filter-end-date')?.value || '';
  const typeFilter = document.getElementById('billing-filter-type')?.value || 'all';
  
  // 2. Filter transactions
  let filtered = [...window.billingTransactions];
  
  // Type filter
  if (typeFilter !== 'all') {
    filtered = filtered.filter(t => t.type === typeFilter);
  }
  
  // Date filter
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  
  if (dateRange === 'today') {
    filtered = filtered.filter(t => {
      const d = new Date(t.timestamp);
      return d >= startOfToday;
    });
  } else if (dateRange === 'yesterday') {
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    filtered = filtered.filter(t => {
      const d = new Date(t.timestamp);
      return d >= startOfYesterday && d < startOfToday;
    });
  } else if (dateRange === 'day-before') {
    const startOfDayBefore = new Date(startOfToday);
    startOfDayBefore.setDate(startOfDayBefore.getDate() - 2);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    filtered = filtered.filter(t => {
      const d = new Date(t.timestamp);
      return d >= startOfDayBefore && d < startOfYesterday;
    });
  } else if (dateRange === 'last-7') {
    const startOfLast7 = new Date(startOfToday);
    startOfLast7.setDate(startOfLast7.getDate() - 7);
    filtered = filtered.filter(t => {
      const d = new Date(t.timestamp);
      return d >= startOfLast7;
    });
  } else if (dateRange === 'custom') {
    if (startDateVal) {
      const startLimit = new Date(startDateVal);
      filtered = filtered.filter(t => new Date(t.timestamp) >= startLimit);
    }
    if (endDateVal) {
      const endLimit = new Date(endDateVal);
      endLimit.setHours(23, 59, 59, 999);
      filtered = filtered.filter(t => new Date(t.timestamp) <= endLimit);
    }
  }
  
  // 3. Paginate
  const totalEntries = filtered.length;
  const totalPages = Math.ceil(totalEntries / window.billingPageSize) || 1;
  
  if (window.billingCurrentPage > totalPages) {
    window.billingCurrentPage = totalPages;
  }
  if (window.billingCurrentPage < 1) {
    window.billingCurrentPage = 1;
  }
  
  const startIndex = (window.billingCurrentPage - 1) * window.billingPageSize;
  const endIndex = Math.min(startIndex + window.billingPageSize, totalEntries);
  const paginated = filtered.slice(startIndex, endIndex);
  
  // 4. Render Table
  tbody.innerHTML = '';
  if (paginated.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No transaction history found for selected filters.</td></tr>`;
  } else {
    paginated.forEach(txn => {
      const row = document.createElement('tr');
      const isRecharge = txn.type === 'recharge';
      
      const typeBadge = isRecharge 
        ? `<span class="hc-badge status-badge badge-completed" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); display: inline-block;">RECHARGE</span>`
        : `<span class="hc-badge status-badge badge-failed" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); display: inline-block;">CALL CHARGE</span>`;
        
      const amountText = isRecharge
        ? `<span style="color: #10b981; font-weight: bold;">+${txn.amount} Mins</span>`
        : `<span style="color: #ef4444; font-weight: bold;">-${txn.totalCharge} Mins</span>`;
        
      const durationText = txn.duration !== undefined ? `${txn.duration}s` : '—';
      
      row.innerHTML = `
        <td style="font-family: monospace; font-size: 0.85rem;">${txn.id}</td>
        <td style="font-size: 0.85rem;">${new Date(txn.timestamp).toLocaleString()}</td>
        <td>${typeBadge}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${txn.description || ''}</td>
        <td style="color: var(--text-muted);">${durationText}</td>
        <td style="text-align: right;">${amountText}</td>
      `;
      tbody.appendChild(row);
    });
  }
  
  // 5. Update pagination UI controls
  const infoEl = document.getElementById('billing-pagination-info');
  if (infoEl) {
    infoEl.textContent = totalEntries > 0 
      ? `Showing ${startIndex + 1} to ${endIndex} of ${totalEntries} entries`
      : `Showing 0 to 0 of 0 entries`;
  }
  
  const btnPrev = document.getElementById('btn-billing-prev');
  const btnNext = document.getElementById('btn-billing-next');
  
  if (btnPrev) btnPrev.disabled = window.billingCurrentPage === 1;
  if (btnNext) btnNext.disabled = window.billingCurrentPage === totalPages;
  
  // Cache current filtered set for CSV download
  window.currentFilteredBillingTransactions = filtered;
};

window.onBillingFilterChange = function() {
  window.billingCurrentPage = 1;
  window.renderBillingTransactions();
};

window.onBillingPrevPage = function() {
  if (window.billingCurrentPage > 1) {
    window.billingCurrentPage--;
    window.renderBillingTransactions();
  }
};

window.onBillingNextPage = function() {
  window.billingCurrentPage++;
  window.renderBillingTransactions();
};

window.downloadBillingCSV = function() {
  const txns = window.currentFilteredBillingTransactions || window.billingTransactions || [];
  if (txns.length === 0) {
    alert("No transactions found to download.");
    return;
  }
  
  let csvContent = "Transaction ID,Date & Time,Type,Description,Duration,Usage (Mins)\n";
  
  txns.forEach(t => {
    const id = t.id;
    const date = new Date(t.timestamp).toLocaleString().replace(/,/g, '');
    const type = t.type === 'recharge' ? 'RECHARGE' : 'CALL CHARGE';
    const desc = (t.description || '').replace(/,/g, ';');
    const duration = t.duration !== undefined ? `${t.duration}s` : 'N/A';
    const usage = t.type === 'recharge' ? `+${t.amount}` : `-${t.totalCharge}`;
    
    csvContent += `${id},${date},${type},"${desc}",${duration},${usage}\n`;
  });
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `billing_history_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// --- Admin Billing Edit Button Handler ---
window.onAdminEditPlanClick = function() {
  const clientId = window.currentManagedClientId || loggedInUser.id;
  const clientName = window.currentManagedClientName || loggedInUser.name;
  const rates = window.currentManagedRates || { rate_per_minute: 2.00, rate_recording_per_minute: 0.50, rate_per_session: 1.00 };
  
  window.openPricingModal(clientId, clientName, rates.rate_per_minute, rates.rate_recording_per_minute, rates.rate_per_session);
};

window.handleAdminDecision = async function(clientId, action) {
  try {
    const res = await fetch('/api/admin/approve-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, action })
    });
    const data = await res.json();
    if (data.success) {
      fetchAdminRequests();
      fetchAdminClients();
    } else {
      alert(data.error || 'Operation failed.');
    }
  } catch (err) {
    console.error(err);
    alert('Error performing admin action.');
  }
};

window.viewClientCallDetail = function(callSid) {
  // Leverage existing call details drawer logic
  selectedCallSid = callSid;
  showDetailsView();
  // Open the transcript drawer
  document.getElementById('transcript-drawer')?.classList.add('active');
  elTabSummary.click();
};

window.fetchAdminPlans = window.renderAdminPlansTable = async function() {
  try {
    const isReseller = loggedInUser && loggedInUser.role === 'reseller';
    
    // Hide 'Create New Base Plan' button for Whitelabel Resellers (Base plans are fixed by Super Admin)
    const btnCreatePlan = document.getElementById('btn-create-new-plan-admin');
    if (btnCreatePlan) {
      btnCreatePlan.style.display = isReseller ? 'none' : 'inline-flex';
    }

    // Fetch Reseller Pricing Config if logged in as reseller
    let resellerConfig = null;
    if (isReseller) {
      try {
        const rRes = await fetch('/api/reseller/pricing-config');
        resellerConfig = await rRes.json();
        if (resellerConfig.success) {
          const wBal = document.getElementById('reseller-wallet-balance-display');
          if (wBal) wBal.innerText = `₹${Number(resellerConfig.wallet_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
          
          const baseRateEl = document.getElementById('reseller-base-calling-rate');
          if (baseRateEl) baseRateEl.innerText = `₹${resellerConfig.wholesale_rate_per_minute}/min`;

          const pMinInput = document.getElementById('reseller-per-minute-markup-input');
          if (pMinInput && resellerConfig.markups) {
            pMinInput.value = resellerConfig.markups.per_minute_markup || 0;
          }

          if (resellerConfig.markups?.plan_markups) {
            const mB = document.getElementById('reseller-markup-basic');
            const mP = document.getElementById('reseller-markup-pro');
            const mC = document.getElementById('reseller-markup-custom');
            if (mB) mB.value = resellerConfig.markups.plan_markups.basic || 0;
            if (mP) mP.value = resellerConfig.markups.plan_markups.pro || 0;
            if (mC) mC.value = resellerConfig.markups.plan_markups.custom || 0;
          }
          window.updateResellerMarkupCalculations();
        }
      } catch(e) {}
    }

    const res = await fetch('/api/plans');
    const data = await res.json();
    if (data.success && data.plans) {
      window.activePlans = data.plans;
      
      const btnCreatePlan = document.getElementById('btn-create-new-plan-admin');
      if (btnCreatePlan) btnCreatePlan.style.display = isReseller ? 'none' : 'inline-flex';

      const thead = document.getElementById('admin-plans-table-head');
      if (thead) {
        if (isReseller) {
          thead.innerHTML = `
            <tr>
              <th>Plan Name</th>
              <th>Plan ID</th>
              <th>Fixed Base Cost</th>
              <th>Your Commission Markup</th>
              <th>Final Retail Price</th>
              <th>Minutes Limit</th>
              <th>Agents Limit</th>
              <th>Base Calling Price</th>
              <th>Retail Calling Price</th>
              <th style="text-align: right;">Status</th>
            </tr>`;
        } else {
          thead.innerHTML = `
            <tr>
              <th>Plan Name</th>
              <th>Plan ID</th>
              <th>Monthly Price</th>
              <th>Minutes Limit</th>
              <th>Agents Limit</th>
              <th>Calling Rate</th>
              <th>CRM Integration</th>
              <th>API Access</th>
              <th>Razorpay Plan ID</th>
              <th style="text-align: right;">Actions</th>
            </tr>`;
        }
      }

      const tbody = document.getElementById('admin-plans-table-body');
      if (tbody) {
        tbody.innerHTML = '';
        if (data.plans.length === 0) {
          tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 20px;">No platform base plans configured.</td></tr>`;
          return;
        }
        data.plans.forEach(p => {
          const row = document.createElement('tr');

          if (isReseller) {
            const basePrice = p.base_price_per_month !== undefined ? p.base_price_per_month : p.price_per_month;
            const baseCalling = p.base_rate_per_minute !== undefined ? p.base_rate_per_minute : (p.rate_per_minute || 5);
            const markupMonthly = p.reseller_markup_monthly || (resellerConfig?.markups?.plan_markups?.[p.id] || 0);
            const markupPerMin = p.reseller_markup_per_minute || (resellerConfig?.markups?.per_minute_markup || 0);
            const finalRetailMonthly = basePrice + markupMonthly;
            const finalRetailCalling = Number((baseCalling + markupPerMin).toFixed(2));

            const basePriceStr = `₹${Number(basePrice).toLocaleString('en-IN')}`;
            const markupMonthlyStr = `+₹${Number(markupMonthly).toLocaleString('en-IN')}`;
            const finalRetailMonthlyStr = `₹${Number(finalRetailMonthly).toLocaleString('en-IN')}`;
            const minsStr = p.max_minutes >= 99999 ? 'Unlimited' : `${p.max_minutes} mins`;
            const agentsStr = p.max_agents >= 99999 ? 'Unlimited' : p.max_agents;
            const baseCallingStr = `₹${baseCalling}/min`;
            const retailCallingStr = `₹${finalRetailCalling}/min`;

            row.innerHTML = `
              <td style="font-weight: 700; color: var(--text-main);">${escapeHtml(p.name)}</td>
              <td style="font-family: monospace; font-size: 0.82rem; color: var(--color-cyan);">${escapeHtml(p.id)}</td>
              <td style="font-weight: 600; color: var(--text-muted);">${basePriceStr}</td>
              <td style="font-weight: 700; color: var(--color-cyan);">${markupMonthlyStr} <span style="font-size:0.68rem; opacity:0.8;">(Profit)</span></td>
              <td style="font-weight: 800; color: var(--color-green, #10b981);">${finalRetailMonthlyStr}</td>
              <td>${minsStr}</td>
              <td>${agentsStr}</td>
              <td style="font-weight: 500; color: var(--text-muted);">${baseCallingStr}</td>
              <td style="font-weight: 800; color: var(--color-green, #10b981);">${retailCallingStr}</td>
              <td style="text-align: right; white-space: nowrap;"><span style="font-size: 0.72rem; color: var(--color-cyan); font-weight: 700;">🔒 Platform Fixed Base</span></td>
            `;
          } else {
            // Super Admin View (Direct price, limits, features & Razorpay Plan ID)
            const priceStr = `₹${Number(p.price_per_month).toLocaleString('en-IN')}/mo`;
            const minsStr = p.max_minutes >= 99999 ? 'Unlimited' : `${p.max_minutes} mins`;
            const agentsStr = p.max_agents >= 99999 ? 'Unlimited' : `${p.max_agents} Agents`;
            const rateStr = `₹${p.rate_per_minute}/min`;
            const crmBadge = p.crm_integration 
              ? `<span style="color: var(--color-green, #10b981); font-weight: bold;">✓ Enabled</span>` 
              : `<span style="color: var(--text-muted); font-size: 0.85rem;">🔒 Locked</span>`;
            const apiBadge = p.api_sharing 
              ? `<span style="color: var(--color-green, #10b981); font-weight: bold;">✓ Enabled</span>` 
              : `<span style="color: var(--text-muted); font-size: 0.85rem;">🔒 Locked</span>`;
            const rzpPlanId = p.razorpay_plan_id 
              ? `<span style="font-family: monospace; font-size: 0.78rem; color: var(--color-cyan);">${escapeHtml(p.razorpay_plan_id)}</span>` 
              : `<span style="color: var(--text-muted); font-size: 0.78rem;">Not Set</span>`;

            const actionButtons = `<button onclick="window.openEditPlanModal('${p.id}')" class="admin-action-btn" style="margin-right: 6px;">Edit</button>
               ${p.id === 'basic' ? `<button disabled class="admin-action-btn admin-action-btn-delete" style="opacity:0.5; cursor:not-allowed;">Delete</button>` : `<button onclick="window.deletePlan('${p.id}')" class="admin-action-btn admin-action-btn-delete">Delete</button>`}`;

            row.innerHTML = `
              <td style="font-weight: 700; color: var(--text-main);">${escapeHtml(p.name)}</td>
              <td style="font-family: monospace; font-size: 0.82rem; color: var(--color-cyan);">${escapeHtml(p.id)}</td>
              <td style="font-weight: 800; color: var(--color-green, #10b981);">${priceStr}</td>
              <td>${minsStr}</td>
              <td>${agentsStr}</td>
              <td style="font-weight: 600;">${rateStr}</td>
              <td>${crmBadge}</td>
              <td>${apiBadge}</td>
              <td>${rzpPlanId}</td>
              <td style="text-align: right; white-space: nowrap;">${actionButtons}</td>
            `;
          }
          tbody.appendChild(row);
        });
      }
    }
  } catch (err) {
    console.error('Failed to fetch admin plans:', err);
  }
};

window.updateResellerMarkupCalculations = function() {
  const pMinInput = document.getElementById('reseller-per-minute-markup-input');
  const baseRateEl = document.getElementById('reseller-base-calling-rate');
  const retailRateEl = document.getElementById('reseller-retail-calling-rate');
  if (pMinInput && retailRateEl) {
    const baseRate = parseFloat((baseRateEl?.innerText || '2.00').replace(/[^\d.]/g, '')) || 2.0;
    const markup = parseFloat(pMinInput.value) || 0;
    retailRateEl.innerText = `₹${(baseRate + markup).toFixed(2)}/min`;
  }
};

window.saveResellerMarkups = async function() {
  const perMinMarkup = parseFloat(document.getElementById('reseller-per-minute-markup-input')?.value || 0);
  const basicMarkup = parseFloat(document.getElementById('reseller-markup-basic')?.value || 0);
  const proMarkup = parseFloat(document.getElementById('reseller-markup-pro')?.value || 0);
  const customMarkup = parseFloat(document.getElementById('reseller-markup-custom')?.value || 0);

  const payload = {
    per_minute_markup: perMinMarkup,
    plan_markups: {
      basic: basicMarkup,
      pro: proMarkup,
      custom: customMarkup
    }
  };

  try {
    const res = await fetch('/api/reseller/markups', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert("✅ Commission markups saved successfully! Your sub-clients will see the new retail prices.");
      if (typeof window.renderAdminPlansTable === 'function') window.renderAdminPlansTable();
    } else {
      alert("Error saving markups: " + (data.error || 'Failed'));
    }
  } catch (e) {
    alert("Network error saving reseller markups.");
  }
};

window.openResellerWalletRechargeModal = function() {
  const amountStr = prompt("Enter amount in ₹ to recharge Whitelabel Reseller Wallet:", "5000");
  if (!amountStr) return;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    alert("Please enter a valid positive amount.");
    return;
  }

  fetch('/api/reseller/wallet/recharge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      alert(`🎉 Wallet Recharged Successfully! Added ₹${amount.toLocaleString('en-IN')}. New Balance: ₹${Number(data.wallet_balance).toLocaleString('en-IN')}`);
      if (typeof window.renderAdminPlansTable === 'function') window.renderAdminPlansTable();
    } else {
      alert("Recharge failed: " + (data.error || 'Unknown error'));
    }
  })
  .catch(err => {
    alert("Network error recharging wallet.");
  });
};

// Bind logout action
document.getElementById('btn-logout')?.addEventListener('click', logout);

// --- Platform Subscription Plans Management (Admin & Client) ---
async function fetchPlans() {
  try {
    const res = await fetch('/api/plans');
    const data = await res.json();
    if (data.success && data.plans) {
      window.activePlans = data.plans;
      if (document.getElementById('admin-plans-table-body') && typeof window.fetchAdminPlans === 'function') {
        window.fetchAdminPlans();
      }
    }
  } catch (err) {
    console.error('Failed to fetch plans:', err);
  }
}

window.openCreatePlanModal = function() {
  document.getElementById('plan-modal-title').textContent = 'Create Subscription Plan';
  
  const idInput = document.getElementById('plan-id-input');
  idInput.value = '';
  idInput.disabled = false;
  
  document.getElementById('plan-name-input').value = '';
  document.getElementById('plan-price-input').value = '';
  document.getElementById('plan-minutes-input').value = '';
  document.getElementById('plan-agents-input').value = '';
  document.getElementById('plan-rate-input').value = '';
  document.getElementById('plan-crm-input').checked = false;
  document.getElementById('plan-api-input').checked = false;
  document.getElementById('plan-desc-input').value = '';
  const rzpIdEl = document.getElementById('plan-razorpay-id-input');
  if (rzpIdEl) rzpIdEl.value = '';
  
  document.getElementById('admin-plan-modal').style.display = 'flex';
};

window.openEditPlanModal = function(planId) {
  const plan = (window.activePlans || []).find(p => p.id === planId);
  if (!plan) return;
  
  document.getElementById('plan-modal-title').textContent = 'Edit Subscription Plan';
  
  const idInput = document.getElementById('plan-id-input');
  idInput.value = plan.id;
  idInput.disabled = true;
  
  document.getElementById('plan-name-input').value = plan.name;
  document.getElementById('plan-price-input').value = plan.price_per_month;
  document.getElementById('plan-minutes-input').value = plan.max_minutes;
  document.getElementById('plan-agents-input').value = plan.max_agents;
  document.getElementById('plan-rate-input').value = plan.rate_per_minute || 5;
  document.getElementById('plan-crm-input').checked = !!plan.crm_integration;
  document.getElementById('plan-api-input').checked = !!plan.api_sharing;
  document.getElementById('plan-desc-input').value = plan.description || '';
  const rzpIdEl = document.getElementById('plan-razorpay-id-input');
  if (rzpIdEl) rzpIdEl.value = plan.razorpay_plan_id || '';
  
  document.getElementById('admin-plan-modal').style.display = 'flex';
};

window.closePlanModal = function() {
  document.getElementById('admin-plan-modal').style.display = 'none';
};

window.showPlanUpgradeModal = function(message) {
  const modal = document.getElementById('plan-upgrade-modal');
  const msgEl = document.getElementById('plan-upgrade-message');
  if (modal && msgEl) {
    msgEl.textContent = message;
    modal.style.display = 'flex';
  }
};

window.closeUpgradeModal = function() {
  const modal = document.getElementById('plan-upgrade-modal');
  if (modal) modal.style.display = 'none';
};

window.redirectToUpgrade = function() {
  window.closeUpgradeModal();
  const pricingTabBtn = document.getElementById('nav-billing');
  if (pricingTabBtn) {
    pricingTabBtn.click();
  }
};

window.submitPlanSave = async function(event) {
  event.preventDefault();
  
  const id = document.getElementById('plan-id-input').value.trim();
  const name = document.getElementById('plan-name-input').value.trim();
  const price_per_month = Number(document.getElementById('plan-price-input').value);
  const max_minutes = Number(document.getElementById('plan-minutes-input').value);
  const max_agents = Number(document.getElementById('plan-agents-input').value);
  const rate_per_minute = Number(document.getElementById('plan-rate-input').value);
  const crm_integration = document.getElementById('plan-crm-input').checked;
  const api_sharing = document.getElementById('plan-api-input').checked;
  const description = document.getElementById('plan-desc-input').value.trim();
  const razorpay_plan_id = (document.getElementById('plan-razorpay-id-input')?.value || '').trim();

  try {
    const res = await fetch('/api/admin/plans/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, name, price_per_month, max_minutes, max_agents, rate_per_minute, crm_integration, api_sharing, description, razorpay_plan_id
      })
    });
    const data = await res.json();
    if (data.success) {
      window.closePlanModal();
      await fetchPlans();
      window.fetchAdminPlans();
      
      // Update loggedInUser plan cache if changed
      if (loggedInUser && loggedInUser.plan && loggedInUser.plan.toLowerCase() === id.toLowerCase()) {
        loggedInUser.plan = id;
        localStorage.setItem('user_session', JSON.stringify(loggedInUser));
        applyUserPlanAndLimits(loggedInUser);
      }
    } else {
      alert(data.error || 'Failed to save plan.');
    }
  } catch (err) {
    console.error('Error saving plan:', err);
    alert('Failed to connect to plans server.');
  }
};

window.deletePlan = async function(planId) {
  if (planId === 'basic') {
    alert("Cannot delete Basic Plan!");
    return;
  }
  if (!confirm(`Are you sure you want to delete the plan "${planId.toUpperCase()}"? This action cannot be undone.`)) {
    return;
  }
  
  try {
    const res = await fetch('/api/admin/plans/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId })
    });
    const data = await res.json();
    if (data.success) {
      await fetchPlans();
      window.fetchAdminPlans();
    } else {
      alert(data.error || 'Failed to delete plan.');
    }
  } catch (err) {
    console.error('Error deleting plan:', err);
    alert('Failed to delete plan due to communication error.');
  }
};

// --- Spacing Editor Logic ---
window.toggleSpacingEditor = function() {
  const panel = document.getElementById('spacing-editor-panel');
  if (panel) {
    if (panel.style.display === 'none' || !panel.style.display) {
      panel.style.display = 'block';
    } else {
      panel.style.display = 'none';
    }
  }
};

window.resetSpacingEditor = function() {
  const defaults = {
    'logo-left': 8,
    'logo-gap': 20,
    'tab-gap': 15,
    'actions-gap': 100,
    'navbar-right': 8
  };

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setVal('input-logo-left', defaults['logo-left']);
  setVal('input-logo-gap', defaults['logo-gap']);
  setVal('input-tab-gap', defaults['tab-gap']);
  setVal('input-actions-gap', defaults['actions-gap']);
  setVal('input-navbar-right', defaults['navbar-right']);

  const chk = document.getElementById('check-actions-auto');
  if (chk) chk.checked = true;
  const actGap = document.getElementById('input-actions-gap');
  if (actGap) actGap.disabled = true;

  document.documentElement.style.setProperty('--nav-padding-left', defaults['logo-left'] + 'px');
  document.documentElement.style.setProperty('--nav-logo-gap', defaults['logo-gap'] + 'px');
  document.documentElement.style.setProperty('--nav-tab-gap', defaults['tab-gap'] + 'px');
  document.documentElement.style.setProperty('--nav-actions-gap', 'auto');
  document.documentElement.style.setProperty('--nav-padding-right', defaults['navbar-right'] + 'px');

  setText('val-logo-left', defaults['logo-left'] + 'px');
  setText('val-logo-gap', defaults['logo-gap'] + 'px');
  setText('val-tab-gap', defaults['tab-gap'] + 'px');
  setText('val-actions-gap', 'Auto');
  setText('val-navbar-right', defaults['navbar-right'] + 'px');
  
  saveSpacingToLocalStorage();
};

function saveSpacingToLocalStorage() {
  const logoLeftEl = document.getElementById('input-logo-left');
  if (!logoLeftEl) return;
  const settings = {
    logoLeft: logoLeftEl.value,
    logoGap: document.getElementById('input-logo-gap')?.value || 20,
    tabGap: document.getElementById('input-tab-gap')?.value || 15,
    actionsGap: document.getElementById('input-actions-gap')?.value || 100,
    actionsAuto: document.getElementById('check-actions-auto')?.checked ?? true,
    navbarRight: document.getElementById('input-navbar-right')?.value || 8
  };
  localStorage.setItem('navbar_spacing_settings', JSON.stringify(settings));
}

function loadSpacingFromLocalStorage() {
  const saved = localStorage.getItem('navbar_spacing_settings');
  if (saved) {
    try {
      const settings = JSON.parse(saved);
      const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

      setVal('input-logo-left', settings.logoLeft);
      setVal('input-logo-gap', settings.logoGap);
      setVal('input-tab-gap', settings.tabGap);
      setVal('input-actions-gap', settings.actionsGap);
      setVal('input-navbar-right', settings.navbarRight);

      const chk = document.getElementById('check-actions-auto');
      if (chk) chk.checked = settings.actionsAuto;
      const actGap = document.getElementById('input-actions-gap');
      if (actGap) actGap.disabled = settings.actionsAuto;

      document.documentElement.style.setProperty('--nav-padding-left', settings.logoLeft + 'px');
      document.documentElement.style.setProperty('--nav-logo-gap', settings.logoGap + 'px');
      document.documentElement.style.setProperty('--nav-tab-gap', settings.tabGap + 'px');
      document.documentElement.style.setProperty('--nav-actions-gap', settings.actionsAuto ? 'auto' : settings.actionsGap + 'px');
      document.documentElement.style.setProperty('--nav-padding-right', settings.navbarRight + 'px');

      setText('val-logo-left', settings.logoLeft + 'px');
      setText('val-logo-gap', settings.logoGap + 'px');
      setText('val-tab-gap', settings.tabGap + 'px');
      setText('val-actions-gap', settings.actionsAuto ? 'Auto' : settings.actionsGap + 'px');
      setText('val-navbar-right', settings.navbarRight + 'px');
    } catch (e) {
      console.error('Error loading spacing settings:', e);
    }
  }
}

window.toggleSpacingControlsVisibility = function() {
  const hidden = localStorage.getItem('navbar_spacing_controls_hidden') === 'true';
  localStorage.setItem('navbar_spacing_controls_hidden', (!hidden).toString());
  applySpacingControlsVisibility();
};

function applySpacingControlsVisibility() {
  const hidden = localStorage.getItem('navbar_spacing_controls_hidden') === 'true';
  
  const elCard = document.getElementById('dashboard-spacing-card');
  const elFloatBtn = document.getElementById('btn-toggle-spacing-editor');
  const elPanel = document.getElementById('spacing-editor-panel');
  const elVisibilityBtn = document.getElementById('btn-toggle-spacing-visibility');

  if (elCard) {
    elCard.style.display = hidden ? 'none' : 'flex';
  }
  if (elFloatBtn) {
    elFloatBtn.style.display = hidden ? 'none' : 'flex';
  }
  if (elPanel && hidden) {
    elPanel.style.display = 'none';
  }
  
  if (elVisibilityBtn) {
    if (hidden) {
      elVisibilityBtn.textContent = 'HIDDEN';
      elVisibilityBtn.style.background = '#6b7280';
    } else {
      elVisibilityBtn.textContent = 'VISIBLE';
      elVisibilityBtn.style.background = 'var(--grad-coral)';
    }
  }
}

// --- Tenant White-Labeling Logic ---
window.applyBranding = function(branding) {
  if (!branding) return;

  // 1. Dynamic Title
  document.title = (branding.appName ? branding.appName + ' - ' : '') + 'Live AI Voice Agent';

  // 2. Favicon
  let favicon = document.querySelector("link[rel~='icon']");
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    document.head.appendChild(favicon);
  }
  favicon.href = branding.faviconUrl;

  // 3. Dynamic CSS variables & Logo Height rule
  const logoH = (branding.logoHeight || branding.logo_height || 36) + 'px';
  let styleTag = document.getElementById('dynamic-branding-colors');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'dynamic-branding-colors';
    document.head.appendChild(styleTag);
  }
  styleTag.innerHTML = `
    :root {
      --color-primary: ${branding.primaryColor || '#FF6B4A'} !important;
      --color-secondary: ${branding.secondaryColor || '#ae3115'} !important;
      --grad-coral: linear-gradient(135deg, ${branding.primaryColor || '#FF6B4A'}, ${branding.secondaryColor || '#ae3115'}) !important;
    }
    .brand-logo, .app-logo-img {
      max-height: ${logoH} !important;
      height: ${logoH} !important;
      width: auto !important;
      object-fit: contain !important;
    }
  `;

  // Sync to local cache so page refresh uses fresh branding instantly
  try {
    window.BrandingContext = branding;
    localStorage.setItem('cached_domain_branding_' + window.location.host, JSON.stringify(branding));
  } catch (e) {}

  // 4. Update logos
  document.querySelectorAll('.brand-logo, .app-logo-img').forEach(img => {
    if (branding.logoUrl) img.src = branding.logoUrl;
    if (branding.appName) img.alt = branding.appName;
    img.style.setProperty('height', logoH, 'important');
    img.style.setProperty('max-height', logoH, 'important');
    img.style.width = 'auto';
  });
};

window.updateLiveLogoHeight = function(val) {
  const h = (val || 36) + 'px';
  document.querySelectorAll('.brand-logo, .app-logo-img').forEach(img => {
    img.style.setProperty('height', h, 'important');
    img.style.setProperty('max-height', h, 'important');
    img.style.width = 'auto';
    img.style.objectFit = 'contain';
  });
  let styleTag = document.getElementById('dynamic-branding-colors');
  if (styleTag) {
    styleTag.innerHTML = styleTag.innerHTML.replace(/(height:\s*)\d+px/g, `$1${h}`);
  }
};

window.handleBrandingFileUpload = function(inputEl, targetInputId) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;

  const targetInput = document.getElementById(targetInputId);
  if (targetInput) {
    targetInput.value = 'Uploading Image...';
    targetInput.disabled = true;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const rawDataUrl = e.target.result;
    const img = new Image();

    img.onload = function() {
      // Downscale to max 1600px for crystal-clear HD quality while keeping file under 300KB
      let width = img.width;
      let height = img.height;
      const maxDim = 1600;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const compressedDataUrl = canvas.toDataURL(mimeType, 0.88);
      const base64Data = compressedDataUrl.split(',')[1];

      fetch('/api/upload-branding-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileData: base64Data
        })
      })
      .then(async res => {
        if (!res.ok) {
          const errText = await res.text();
          let errJson;
          try { errJson = JSON.parse(errText); } catch(e){}
          throw new Error(errJson?.error || `Upload failed with HTTP ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        if (data && data.success && data.url) {
          if (targetInput) {
            targetInput.value = data.url;
            targetInput.disabled = false;
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (typeof window.updateBrandPreview === 'function') window.updateBrandPreview();
        } else {
          throw new Error(data.error || 'Upload failed');
        }
      })
      .catch(err => {
        console.error('Image upload failed:', err);
        alert('Image upload failed: ' + (err.message || 'File too large. Please select a smaller image.'));
        if (targetInput) {
          targetInput.value = '';
          targetInput.disabled = false;
        }
      });
    };

    img.onerror = function() {
      alert('Invalid image file format.');
      if (targetInput) {
        targetInput.value = '';
        targetInput.disabled = false;
      }
    };

    img.src = rawDataUrl;
  };

  reader.readAsDataURL(file);
};

window.saveBrandingSettings = async function(event) {
  event.preventDefault();
  
  let id = document.getElementById('branding-tenant-id').value.trim();
  if (!id) id = 'default';
  const appName = document.getElementById('branding-app-name').value.trim();
  if (!appName) {
    alert('Please enter an App Name / Company Name.');
    return;
  }
  const customDomain = document.getElementById('branding-custom-domain').value.trim();
  const subdomain = document.getElementById('branding-subdomain').value.trim();
  const logoUrl = document.getElementById('branding-logo-url').value.trim();
  const logoHeight = parseInt(document.getElementById('branding-logo-height')?.value || '36', 10);
  const faviconUrl = document.getElementById('branding-favicon-url').value.trim();
  const authHeroUrl = document.getElementById('branding-auth-hero-url')?.value.trim() || '';
  const primaryColor = document.getElementById('branding-primary-color').value.trim();
  const secondaryColor = document.getElementById('branding-secondary-color').value.trim();
  const supportEmail = document.getElementById('branding-support-email').value.trim();
  const supportPhone = document.getElementById('branding-support-phone').value.trim();
  const copyrightText = document.getElementById('branding-copyright').value.trim();
  const demoSystemPrompt = document.getElementById('branding-demo-prompt')?.value.trim() || '';

  try {
    const res = await fetch('/api/admin/branding', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Tenant-Id': window.BrandingContext ? window.BrandingContext.id : ''
      },
      body: JSON.stringify({
        id, customDomain, subdomain, appName, logoUrl, logoHeight, faviconUrl, authHeroUrl, primaryColor, secondaryColor, supportEmail, supportPhone, copyrightText, demoSystemPrompt
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch(e){}
      const msg = errJson?.error || `HTTP ${res.status} ${res.statusText}`;
      alert('Failed to save branding: ' + msg);
      return;
    }

    const data = await res.json();
    if (data.success) {
      alert('✅ Branding & White Labeling settings saved successfully!');
      window.BrandingContext = data.branding;
      window.applyBranding(data.branding);
    } else {
      alert('Failed to save branding: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Error saving branding:', err);
    alert('Communication error saving branding: ' + err.message);
  }
};

function initSpacingEditor() {
  const elLogoLeft = document.getElementById('input-logo-left');
  const elLogoGap = document.getElementById('input-logo-gap');
  const elTabGap = document.getElementById('input-tab-gap');
  const elActionsGap = document.getElementById('input-actions-gap');
  const elActionsAuto = document.getElementById('check-actions-auto');
  const elNavbarRight = document.getElementById('input-navbar-right');
  const elToggleBtn = document.getElementById('btn-toggle-spacing-editor');

  if (elToggleBtn) {
    elToggleBtn.addEventListener('click', window.toggleSpacingEditor);
  }

  if (!elLogoLeft) return;

  elLogoLeft.addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('val-logo-left').textContent = val + 'px';
    document.documentElement.style.setProperty('--nav-padding-left', val + 'px');
    saveSpacingToLocalStorage();
  });

  elLogoGap.addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('val-logo-gap').textContent = val + 'px';
    document.documentElement.style.setProperty('--nav-logo-gap', val + 'px');
    saveSpacingToLocalStorage();
  });

  elTabGap.addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('val-tab-gap').textContent = val + 'px';
    document.documentElement.style.setProperty('--nav-tab-gap', val + 'px');
    saveSpacingToLocalStorage();
  });

  elActionsGap.addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('val-actions-gap').textContent = val + 'px';
    document.documentElement.style.setProperty('--nav-actions-gap', val + 'px');
    saveSpacingToLocalStorage();
  });

  elActionsAuto.addEventListener('change', (e) => {
    const checked = e.target.checked;
    elActionsGap.disabled = checked;
    if (checked) {
      document.getElementById('val-actions-gap').textContent = 'Auto';
      document.documentElement.style.setProperty('--nav-actions-gap', 'auto');
    } else {
      const val = elActionsGap.value;
      document.getElementById('val-actions-gap').textContent = val + 'px';
      document.documentElement.style.setProperty('--nav-actions-gap', val + 'px');
    }
    saveSpacingToLocalStorage();
  });

  elNavbarRight.addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('val-navbar-right').textContent = val + 'px';
    document.documentElement.style.setProperty('--nav-padding-right', val + 'px');
    saveSpacingToLocalStorage();
  });

  loadSpacingFromLocalStorage();
  applySpacingControlsVisibility();
}

// Check authentication on startup
async function initApp() {
  await fetchPlans();
  checkAuth();
  initSpacingEditor();
  if (window.BrandingContext) {
    window.applyBranding(window.BrandingContext);
  }
}
initApp();

// --- Impersonation ("Login as User") Functions ---
window.impersonateUser = function(clientId) {
  if (!window.adminClientsCache) return;
  const client = window.adminClientsCache.find(c => c.id === clientId);
  if (client) {
    // Save current admin session
    localStorage.setItem('admin_session', JSON.stringify(loggedInUser));
    // Set user session to client
    localStorage.setItem('user_session', JSON.stringify(client));
    localStorage.setItem('is_impersonating', 'true');
    // Force active tab to dashboard
    localStorage.setItem('activeTab', 'tab-recordings');
    location.reload();
  }
};

window.stopImpersonating = function() {
  const adminSession = localStorage.getItem('admin_session');
  if (adminSession) {
    localStorage.setItem('user_session', adminSession);
    localStorage.removeItem('admin_session');
    localStorage.removeItem('is_impersonating');
    // Force active tab back to admin panel
    localStorage.setItem('activeTab', 'tab-admin-panel');
    location.reload();
  }
};

// --- Today's Activity Console Modal Functions ---
window.openTodayCallsModal = function(e) {
  if (e) e.preventDefault();
  
  // Navigate directly to full page Callings tab instead of modal
  window.navigateToCallingsPage();

  const modal = document.getElementById('today-calls-modal');
  const dateEl = document.getElementById('today-modal-date');
  const listEl = document.getElementById('today-modal-calls-list');
  
  if (!listEl) return;
  
  if (dateEl) {
    dateEl.innerText = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  
  const today = new Date().toDateString();
  const calls = window.lastDashboardCallbacks || window.callsCache || [];
  const todayCalls = calls.filter(c => c.createdAt && new Date(c.createdAt).toDateString() === today);
  
  listEl.innerHTML = '';
  
  if (todayCalls.length === 0) {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <span style="font-size: 2rem; display: block; margin-bottom: 10px;">📅</span>
        <h4 style="color: #fff; margin-bottom: 5px;">No Activity Today</h4>
        <p style="font-size: 0.85rem;">There are no calls logged for today yet.</p>
      </div>
    `;
  } else {
    const sorted = [...todayCalls].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    sorted.forEach(c => {
      const card = document.createElement('div');
      card.style.background = 'rgba(255, 255, 255, 0.02)';
      card.style.border = '1px solid var(--border-color)';
      card.style.borderRadius = '12px';
      card.style.padding = '15px';
      card.style.marginBottom = '10px';
      
      const isIncoming = c.direction ? (c.direction === 'incoming') : (loggedInUser && (c.to === loggedInUser.phone_number || (loggedInUser.phone_number && loggedInUser.phone_number.includes(c.to))));
      const directionIcon = isIncoming ? 
        `<span style="color: var(--color-green); font-weight: bold; margin-right: 6px;">⬇ Incoming</span>` : 
        `<span style="color: var(--color-cyan); font-weight: bold; margin-right: 6px;">⬆ Outgoing</span>`;
      
      const toNum = c.to || 'Unknown';
      const partiesText = isIncoming ? `Caller ➔ You` : `You ➔ ${toNum}`;
      
      const callDate = new Date(c.createdAt);
      const timeText = callDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      let badgeStyle = 'background: rgba(239, 68, 68, 0.1); color: var(--color-red); border: 1px solid rgba(239, 68, 68, 0.2);';
      if (c.status === 'completed') {
        badgeStyle = 'background: rgba(16, 185, 129, 0.1); color: var(--color-green); border: 1px solid rgba(16, 185, 129, 0.2);';
      }
      
      // Calculate duration using fallbacks
      const end = c.endedAt || c.updatedAt;
      const start = c.startedAt || c.createdAt;
      const durationSecs = end && start ? Math.round((new Date(end) - new Date(start)) / 1000) : null;
      const durationText = durationSecs !== null && durationSecs >= 0 ? durationSecs + 's' : '-';
      
      const verdictHtml = formatParsedSummaryHTML(c.summary, false);
      
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 8px; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            ${directionIcon}
            <strong style="color: var(--text-main); font-size: 0.9rem;">${partiesText}</strong>
          </div>
          <span class="badge" style="margin: 0; padding: 3px 8px; font-size: 0.72rem; ${badgeStyle}">${c.status}</span>
        </div>
        
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted);">
          <span>Time: <strong>${timeText}</strong></span>
          <span>Duration: <strong>${durationText}</strong></span>
        </div>
        
        ${verdictHtml}
      `;
      listEl.appendChild(card);
    });
  }
};

// ─── Wallet & Transaction Ledger Renderer ──────────────────────────────────────
window.renderClientTransactionHistory = function(transactions, balance) {
  window.clientTransactionsCache = transactions || [];

  const balanceEl = document.getElementById('billing-wallet-balance');
  if (balanceEl && balance !== undefined) {
    balanceEl.textContent = `${Number(balance).toFixed(1)} Mins`;
  }

  const tbody = document.getElementById('billing-history-table-body');
  if (!tbody) return;

  if (!transactions || transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">No transactions recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = transactions.map(txn => {
    const isCredit = (txn.usage && txn.usage.startsWith('+')) || txn.type === 'recharge';
    const badgeBg = isCredit ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    const badgeColor = isCredit ? '#10b981' : '#ef4444';
    const formattedDate = txn.timestamp ? new Date(txn.timestamp).toLocaleString('en-IN') : 'N/A';
    const txnId = txn.id || 'TXN_N/A';

    return `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--color-cyan); font-weight: 700;">${txnId}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${formattedDate}</td>
        <td>
          <span style="font-size: 0.72rem; font-weight: 800; padding: 2px 8px; border-radius: 12px; background: ${badgeBg}; color: ${badgeColor}; text-transform: uppercase;">
            ${txn.type || 'RECHARGE'}
          </span>
        </td>
        <td style="font-size: 0.82rem; color: var(--text-main); font-weight: 600;">${txn.details || 'Wallet Recharge'}</td>
        <td style="font-size: 0.82rem; color: var(--text-muted);">${txn.duration || '-'}</td>
        <td style="font-weight: 800; font-size: 0.88rem; color: ${badgeColor};">${txn.usage || '+0 Mins'}</td>
        <td style="text-align: right;">
          <button onclick="window.openInvoiceModal('${txnId}')" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.76rem; font-weight: 700; border-radius: 6px; cursor: pointer; color: var(--color-cyan); border-color: rgba(6,182,212,0.3); background: rgba(6,182,212,0.08); display: inline-flex; align-items: center; gap: 4px;">
            📄 Invoice
          </button>
        </td>
      </tr>
    `;
  }).join('');
};

window.openInvoiceModal = function(txnId) {
  const txn = (window.clientTransactionsCache || []).find(t => t.id === txnId || t.txnId === txnId) || {
    id: txnId,
    timestamp: new Date().toISOString(),
    details: 'Wallet Self-Recharge',
    amountPaid: 2500,
    usage: '+500 Mins'
  };

  const container = document.getElementById('printable-invoice-content');
  const modal = document.getElementById('admin-view-invoice-modal');

  if (!modal || !container) {
    alert('Invoice modal container missing.');
    return;
  }

  const brand = window.BrandingContext || {};
  const appName = brand.appName || 'Callio AI Voice Agent';
  const logoUrl = brand.logoUrl || '/logo_new.png';
  const supportEmail = brand.supportEmail || 'support@callio.ai';
  const user = window.loggedInUser || { name: 'Valued Customer', email: 'customer@client.com' };

  const txnDate = txn.timestamp ? new Date(txn.timestamp).toLocaleString('en-IN') : new Date().toLocaleString('en-IN');
  const details = txn.details || 'AI Voice Agent Wallet Recharge';
  const amountPaid = txn.amountPaid || 2500;
  const subtotal = (amountPaid / 1.18).toFixed(2);
  const gstTax = (amountPaid - Number(subtotal)).toFixed(2);
  const refId = txn.id || ('INV-' + Date.now().toString().slice(-6));

  const customerGstin = txn.customerGstin || user.gstin || (document.getElementById('user-gstin-input')?.value.trim().toUpperCase()) || '';
  const issuerGstin = txn.issuerGstin || window._domainGstin || '';

  const customerGstinHtml = customerGstin 
    ? `<div style="font-size: 0.82rem; color: #2563eb; font-weight: 700; margin-top: 3px; font-family: monospace;">Customer GSTIN: ${customerGstin}</div>` 
    : `<div style="font-size: 0.78rem; color: #94a3b8; margin-top: 2px;">Customer GSTIN: Consumer / Unregistered</div>`;

  const issuerGstinHtml = issuerGstin 
    ? `<div style="font-size: 0.82rem; color: #059669; font-weight: 700; margin-top: 3px; font-family: monospace;">Merchant GSTIN: ${issuerGstin}</div>` 
    : `<div style="font-size: 0.78rem; color: #94a3b8; margin-top: 2px;">Merchant GSTIN: Verified Provider</div>`;

  container.innerHTML = `
    <div style="padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; background: #ffffff; border-radius: 12px;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 24px;">
        <div>
          <img src="${logoUrl}" alt="${appName}" style="max-height: 48px; object-fit: contain; margin-bottom: 8px;" onerror="this.style.display='none'">
          <h2 style="margin: 0; font-size: 1.4rem; color: #0f172a; font-weight: 800;">${appName}</h2>
          <p style="margin: 4px 0 0 0; font-size: 0.8rem; color: #64748b;">Official Tax Invoice &amp; Payment Receipt</p>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 0.75rem; font-weight: 800; color: #10b981; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); padding: 4px 12px; border-radius: 20px; display: inline-block; margin-bottom: 8px;">
            🟢 PAID &amp; VERIFIED
          </div>
          <div style="font-size: 0.85rem; font-weight: 700; color: #334155;">Invoice #: <span style="font-family: monospace; color: #2563eb;">INV-${refId}</span></div>
          <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">Date: ${txnDate}</div>
        </div>
      </div>

      <!-- Customer & Issuer Info -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; background: #f8fafc; padding: 18px; border-radius: 10px; border: 1px solid #e2e8f0;">
        <div>
          <div style="font-size: 0.7rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Billed To (Customer):</div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #0f172a;">${user.name || 'Client Account'}</div>
          <div style="font-size: 0.82rem; color: #475569; margin-top: 2px;">Email: ${user.email || 'N/A'}</div>
          <div style="font-size: 0.82rem; color: #475569; margin-top: 2px;">Account ID: ${user.id || 'N/A'}</div>
          ${customerGstinHtml}
        </div>
        <div style="text-align: right;">
          <div style="font-size: 0.7rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Issued By (Platform):</div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #0f172a;">${appName} Inc.</div>
          <div style="font-size: 0.82rem; color: #475569; margin-top: 2px;">Support: ${supportEmail}</div>
          ${issuerGstinHtml}
        </div>
      </div>

      <!-- Itemized Table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <thead>
          <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
            <th style="text-align: left; padding: 10px 14px; font-size: 0.78rem; color: #475569; font-weight: 700;">DESCRIPTION</th>
            <th style="text-align: center; padding: 10px 14px; font-size: 0.78rem; color: #475569; font-weight: 700;">QTY / DURATION</th>
            <th style="text-align: right; padding: 10px 14px; font-size: 0.78rem; color: #475569; font-weight: 700;">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 14px; font-size: 0.88rem; font-weight: 700; color: #0f172a;">
              ${details}
            </td>
            <td style="padding: 14px; text-align: center; font-size: 0.85rem; color: #475569; font-weight: 600;">
              ${txn.usage || '1 Package'}
            </td>
            <td style="padding: 14px; text-align: right; font-size: 0.88rem; font-weight: 700; color: #0f172a;">
              ₹${subtotal}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Totals Breakdown -->
      <div style="display: flex; justify-content: flex-end; margin-bottom: 24px;">
        <div style="width: 280px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.82rem; color: #64748b; margin-bottom: 6px;">
            <span>Subtotal:</span>
            <span style="font-weight: 600; color: #334155;">₹${subtotal}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.82rem; color: #64748b; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0;">
            <span>GST (18% Included):</span>
            <span style="font-weight: 600; color: #334155;">₹${gstTax}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 1.05rem; font-weight: 800; color: #0f172a;">
            <span>Total Paid:</span>
            <span style="color: #10b981;">₹${Number(amountPaid).toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>

      <!-- Footer Note -->
      <div style="border-top: 1px dashed #cbd5e1; padding-top: 16px; text-align: center; font-size: 0.75rem; color: #94a3b8;">
        This is a computer-generated official tax invoice and payment receipt. No signature required.
      </div>
    </div>
  `;

  modal.style.display = 'flex';
};

window.printInvoiceModal = function() {
  window.print();
};

window.getUserSessionProfile = async function() {
  if (window.loggedInUser && (window.loggedInUser.id || window.loggedInUser.email)) {
    return window.loggedInUser;
  }
  if (typeof loggedInUser !== 'undefined' && loggedInUser && (loggedInUser.id || loggedInUser.email)) {
    window.loggedInUser = loggedInUser;
    return loggedInUser;
  }
  try {
    const stored = localStorage.getItem('user_session') || sessionStorage.getItem('user_session');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && (parsed.id || parsed.email)) {
        window.loggedInUser = parsed;
        return parsed;
      }
    }
  } catch(e) {}

  try {
    const meRes = await fetch('/api/user/me');
    const meData = await meRes.json();
    if (meData && meData.user) {
      window.loggedInUser = meData.user;
      return meData.user;
    }
  } catch(e) {}

  return null;
};

window.fetchClientTransactionsAndBalance = async function() {
  try {
    const user = await window.getUserSessionProfile();
    const clientId = user ? (user.id || user.email || '') : '';
    const res = await fetch(`/api/client/transactions?clientId=${encodeURIComponent(clientId)}`);
    const data = await res.json();
    if (data.success) {
      if (data.customerGstin) {
        const input = document.getElementById('user-gstin-input');
        if (input && !input.value) input.value = data.customerGstin;
      }
      if (data.issuerGstin) {
        window._domainGstin = data.issuerGstin;
      }
      window.renderClientTransactionHistory(data.transactions || [], data.balance);
    }
  } catch (err) {
    console.error('Failed to fetch transaction history:', err);
  }
};

window.initiateUserRecharge = async function() {
  const amountInput = document.getElementById('user-recharge-amount');
  const methodSelect = document.getElementById('user-payment-method');
  if (!amountInput) return;

  const amount = Number(amountInput.value);
  if (isNaN(amount) || amount <= 0) {
    alert("Please enter valid recharge minutes (e.g. 500).");
    return;
  }

  const currentUser = await window.getUserSessionProfile();
  if (!currentUser) {
    alert("⚠️ Could not resolve user session. Please refresh the page and try again.");
    return;
  }

  const targetClientId = currentUser.id || currentUser.email || 'admin';
  const customerGstin = document.getElementById('user-gstin-input')?.value.trim().toUpperCase() || '';

  // Calculate total price based on plan rate
  const plan = currentUser.plan || 'basic';
  const planInfo = (window.activePlans || []).find(p => p.id.toLowerCase() === plan.toLowerCase());
  const rate = planInfo ? planInfo.rate_per_minute : (plan.toLowerCase() === 'pro' ? 4.24 : (plan.toLowerCase() === 'custom' ? 2.00 : 5.00));
  const totalRupees = Math.round(amount * rate);
  const method = methodSelect ? methodSelect.value : 'UPI';

  // Check if Razorpay Gateway is enabled
  try {
    const rRes = await fetch('/api/admin/razorpay-config');
    const rData = await rRes.json();

    if (rData.success && rData.isEnabled && window.Razorpay && rData.keyId) {
      // Trigger Razorpay payment modal
      const options = {
        key: rData.keyId,
        amount: totalRupees * 100, // amount in paisa
        currency: 'INR',
        payment_capture: 1, // Auto-capture payment immediately upon completion
        name: window.BrandingContext?.appName || 'Callio AI Voice Agent',
        description: `Wallet Recharge: ${amount} Minutes (@ ₹${rate.toFixed(2)}/min)`,
        image: window.BrandingContext?.logoUrl || '/logo_new.png',
        notes: {
          clientId: targetClientId,
          minutes: amount,
          customerGstin: customerGstin
        },
        handler: async function (response) {
          try {
            const rechargeRes = await fetch('/api/client/recharge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientId: targetClientId,
                amount: amount,
                paymentMethod: method,
                razorpayPaymentId: response.razorpay_payment_id,
                customerGstin: customerGstin
              })
            });
            const rechargeData = await rechargeRes.json();
            if (rechargeData.success) {
              alert(`✅ Payment & Recharge Successful!\nPayment ID: ${response.razorpay_payment_id}\nAdded ${amount} Minutes to your wallet balance.\nNew Balance: ${rechargeData.balance.toFixed(1)} Mins.`);
              amountInput.value = '';
              if (window.loggedInUser) {
                window.loggedInUser.balance = rechargeData.balance;
                if (customerGstin) window.loggedInUser.gstin = customerGstin;
                localStorage.setItem('user_session', JSON.stringify(window.loggedInUser));
              }
              window.fetchClientTransactionsAndBalance();
            } else {
              alert(`Recharge verification failed: ${rechargeData.error}`);
            }
          } catch(err) {
            alert(`Communication error verifying payment: ${err.message}`);
          }
        },
        prefill: {
          name: window.loggedInUser?.name || '',
          email: window.loggedInUser?.email || ''
        },
        theme: {
          color: window.BrandingContext?.primaryColor || '#ea580c'
        }
      };
      const rzp = new window.Razorpay(options);
      rzp.open();
      return;
    } else if (isAdmin) {
      // Allow Super Admin manual top-up with explicit confirmation
      if (confirm(`[ADMIN MANUAL TOP-UP]\nDo you want to manually add ${amount} minutes (Value ₹${totalRupees}) to client wallet without Razorpay payment?`)) {
        const rechargeRes = await fetch('/api/client/recharge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: targetClientId,
            amount: amount,
            paymentMethod: 'Admin Manual',
            isAdminManual: true
          })
        });
        const rechargeData = await rechargeRes.json();
        if (rechargeData.success) {
          alert(`✅ Admin Manual Top-up Successful!\nAdded ${amount} Mins to account. New Balance: ${rechargeData.balance.toFixed(1)} Mins.`);
          amountInput.value = '';
          if (typeof fetchBillingData === 'function') fetchBillingData();
        } else {
          alert(`Admin Top-up failed: ${rechargeData.error}`);
        }
      }
      return;
    }
  } catch(e) {
    console.error('Razorpay check error:', e);
  }

  // Blocking notice for regular users if Razorpay is not configured
  alert(`🔒 Online Payment Gateway Setup Required!\nRazorpay is not yet configured for this platform. Please set up Razorpay in Admin Panel > Razorpay Gateway or contact support.`);
};

window.closeTodayCallsModal = function() {
  const modal = document.getElementById('today-calls-modal');
  if (modal) modal.style.display = 'none';
};


// Spacing Editor logic removed. Resetting CSS variables to defaults.
localStorage.removeItem('navbar_spacing_config_client');
localStorage.removeItem('navbar_spacing_config_admin');
localStorage.removeItem('navbar_spacing_config_guest');
document.documentElement.style.removeProperty('--nav-padding-left');
document.documentElement.style.removeProperty('--nav-padding-right');
document.documentElement.style.removeProperty('--nav-logo-gap');
document.documentElement.style.removeProperty('--nav-tab-gap');
document.documentElement.style.removeProperty('--nav-actions-gap');

// --- Client Wallet Self-Recharge Simulation ---
window.selectRechargePkg = function(amount) {
  const input = document.getElementById('user-recharge-amount');
  if (input) {
    input.value = amount;
  }
};

window.closePaymentModal = function() {
  const modal = document.getElementById('payment-simulation-modal');
  if (modal) modal.style.display = 'none';
};

// --- Fetch Admin Transactions Log ---
async function fetchAdminTransactions() {
  try {
    const res = await fetch('/api/admin/transactions');
    const data = await res.json();
    window.renderAdminTransactions(data.transactions || []);
  } catch (err) {
    console.error('Failed to fetch admin transactions:', err);
  }
}
window.fetchAdminTransactions = fetchAdminTransactions;

// --- Admin Global Billing Logs Helpers (Pagination, Filters, CSV) ---
window.adminTransactions = [];
window.adminBillingCurrentPage = 1;
window.adminBillingPageSize = 10;
window.currentFilteredAdminTransactions = [];

window.renderAdminTransactions = function(transactions) {
  if (transactions) {
    window.adminTransactions = transactions;
  }
  
  const tbody = document.getElementById('admin-transactions-table-body');
  if (!tbody) return;
  
  // 1. Get filter values
  const dateRange = document.getElementById('admin-filter-date-range')?.value || 'all';
  const customContainer = document.getElementById('admin-custom-date-container');
  if (customContainer) {
    customContainer.style.display = dateRange === 'custom' ? 'flex' : 'none';
  }
  
  const startDateVal = document.getElementById('admin-filter-start-date')?.value || '';
  const endDateVal = document.getElementById('admin-filter-end-date')?.value || '';
  const typeFilter = document.getElementById('admin-filter-type')?.value || 'all';
  const searchVal = document.getElementById('admin-filter-search')?.value || '';
  
  // 2. Filter transactions
  let filtered = [...window.adminTransactions];
  
  // Search filter
  if (searchVal.trim() !== '') {
    const q = searchVal.toLowerCase();
    filtered = filtered.filter(t => 
      (t.id || '').toLowerCase().includes(q) ||
      (t.clientName || '').toLowerCase().includes(q) ||
      (t.clientEmail || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q)
    );
  }
  
  // Type filter
  if (typeFilter !== 'all') {
    filtered = filtered.filter(t => t.type === typeFilter);
  }
  
  // Date filter
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  
  if (dateRange === 'today') {
    filtered = filtered.filter(t => {
      const d = new Date(t.timestamp);
      return d >= startOfToday;
    });
  } else if (dateRange === 'yesterday') {
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    filtered = filtered.filter(t => {
      const d = new Date(t.timestamp);
      return d >= startOfYesterday && d < startOfToday;
    });
  } else if (dateRange === 'day-before') {
    const startOfDayBefore = new Date(startOfToday);
    startOfDayBefore.setDate(startOfDayBefore.getDate() - 2);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    filtered = filtered.filter(t => {
      const d = new Date(t.timestamp);
      return d >= startOfDayBefore && d < startOfYesterday;
    });
  } else if (dateRange === 'last-7') {
    const startOfLast7 = new Date(startOfToday);
    startOfLast7.setDate(startOfLast7.getDate() - 7);
    filtered = filtered.filter(t => {
      const d = new Date(t.timestamp);
      return d >= startOfLast7;
    });
  } else if (dateRange === 'custom') {
    if (startDateVal) {
      const startLimit = new Date(startDateVal);
      filtered = filtered.filter(t => new Date(t.timestamp) >= startLimit);
    }
    if (endDateVal) {
      const endLimit = new Date(endDateVal);
      endLimit.setHours(23, 59, 59, 999);
      filtered = filtered.filter(t => new Date(t.timestamp) <= endLimit);
    }
  }
  
  // 3. Paginate
  const totalEntries = filtered.length;
  const totalPages = Math.ceil(totalEntries / window.adminBillingPageSize) || 1;
  
  if (window.adminBillingCurrentPage > totalPages) {
    window.adminBillingCurrentPage = totalPages;
  }
  if (window.adminBillingCurrentPage < 1) {
    window.adminBillingCurrentPage = 1;
  }
  
  const startIndex = (window.adminBillingCurrentPage - 1) * window.adminBillingPageSize;
  const endIndex = Math.min(startIndex + window.adminBillingPageSize, totalEntries);
  const paginated = filtered.slice(startIndex, endIndex);
  
  // 4. Render Table
  tbody.innerHTML = '';
  if (paginated.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No transaction logs found for selected filters.</td></tr>`;
  } else {
    paginated.forEach(txn => {
      const row = document.createElement('tr');
      const isRecharge = txn.type === 'recharge';
      
      const typeBadge = isRecharge 
        ? `<span class="hc-badge status-badge badge-completed" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); display: inline-block;">RECHARGE</span>`
        : `<span class="hc-badge status-badge badge-failed" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); display: inline-block;">CALL CHARGE</span>`;
        
      const amountText = isRecharge
        ? `<span style="color: #10b981; font-weight: bold;">+${txn.amount} Mins</span>`
        : `<span style="color: #ef4444; font-weight: bold;">-${txn.totalCharge} Mins</span>`;
      
      row.innerHTML = `
        <td style="font-family: monospace; font-size: 0.85rem;">${txn.id}</td>
        <td style="font-size: 0.85rem;">${new Date(txn.timestamp).toLocaleString()}</td>
        <td>
          <div style="font-weight: 500; color: var(--text-main);">${escapeHtml(txn.clientName || 'Unknown')}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(txn.clientEmail || '')}</div>
        </td>
        <td>${typeBadge}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${txn.description || ''}</td>
        <td style="text-align: right;">${amountText}</td>
      `;
      tbody.appendChild(row);
    });
  }
  
  // 5. Update pagination UI controls
  const infoEl = document.getElementById('admin-billing-pagination-info');
  if (infoEl) {
    infoEl.textContent = totalEntries > 0 
      ? `Showing ${startIndex + 1} to ${endIndex} of ${totalEntries} entries`
      : `Showing 0 to 0 of 0 entries`;
  }
  
  const btnPrev = document.getElementById('btn-admin-billing-prev');
  const btnNext = document.getElementById('btn-admin-billing-next');
  
  if (btnPrev) btnPrev.disabled = window.adminBillingCurrentPage === 1;
  if (btnNext) btnNext.disabled = window.adminBillingCurrentPage === totalPages;
  
  // Cache current filtered set for CSV download
  window.currentFilteredAdminTransactions = filtered;
};

window.onAdminBillingFilterChange = function() {
  window.adminBillingCurrentPage = 1;
  window.renderAdminTransactions();
};

window.onAdminBillingPrevPage = function() {
  if (window.adminBillingCurrentPage > 1) {
    window.adminBillingCurrentPage--;
    window.renderAdminTransactions();
  }
};

window.onAdminBillingNextPage = function() {
  window.adminBillingCurrentPage++;
  window.renderAdminTransactions();
};

window.downloadAdminBillingCSV = function() {
  const txns = window.currentFilteredAdminTransactions || window.adminTransactions || [];
  if (txns.length === 0) {
    alert("No transactions found to download.");
    return;
  }
  
  let csvContent = "Transaction ID,Date & Time,Client Name,Client Email,Type,Description,Usage (Mins)\n";
  
  txns.forEach(t => {
    const id = t.id;
    const date = new Date(t.timestamp).toLocaleString().replace(/,/g, '');
    const clientName = (t.clientName || 'Unknown').replace(/,/g, ' ');
    const clientEmail = (t.clientEmail || '').replace(/,/g, ' ');
    const type = t.type === 'recharge' ? 'RECHARGE' : 'CALL CHARGE';
    const desc = (t.description || '').replace(/,/g, ';');
    const usage = t.type === 'recharge' ? `+${t.amount}` : `-${t.totalCharge}`;
    
    csvContent += `${id},${date},${clientName},${clientEmail},${type},"${desc}",${usage}\n`;
  });
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `global_billing_history_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

window.subscribePlan = async function(planName, price) {
  if (!loggedInUser) return;
  
  if (planName === 'custom' || planName === 'enterprise') {
    alert("Please contact our sales team to set up a custom plan tailored to your requirements.");
    return;
  }
  
  // 1. Attempt to create Razorpay Recurring Subscription
  try {
    const res = await fetch('/api/razorpay/create-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId: planName,
        clientId: loggedInUser.id
      })
    });

    const data = await res.json();

    if (data.success && data.subscriptionId && data.keyId && window.Razorpay) {
      // Trigger Razorpay Subscription Checkout Modal (Auto-Recurring Payment)
      const options = {
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: window.BrandingContext?.appName || 'Callio AI Voice Agent',
        description: `${data.plan?.name || planName.toUpperCase()} - Monthly Recurring Subscription (₹${price}/mo)`,
        image: window.BrandingContext?.logoUrl || '/logo_new.png',
        handler: async function (response) {
          try {
            const vRes = await fetch('/api/razorpay/verify-subscription', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_subscription_id: response.razorpay_subscription_id,
                razorpay_signature: response.razorpay_signature,
                planId: planName,
                clientId: loggedInUser.id
              })
            });

            const vData = await vRes.json();
            if (vData.success && vData.client) {
              loggedInUser = { ...loggedInUser, plan: vData.client.plan, status: 'active', balance: vData.client.balance, billing_history: vData.client.billing_history };
              localStorage.setItem('user_session', JSON.stringify(loggedInUser));
              applyUserRole(loggedInUser);
              fetchBillingData();
              alert(`🎉 Subscription Activated Successfully!\n\nYour account is now subscribed to the ${planName.toUpperCase()} Plan (₹${price}/month recurring auto-debit).`);
            } else {
              alert(`Subscription verification failed: ${vData.error || 'Unknown error'}`);
            }
          } catch(err) {
            alert(`Error verifying subscription: ${err.message}`);
          }
        },
        prefill: {
          name: loggedInUser.name || '',
          email: loggedInUser.email || ''
        },
        theme: {
          color: window.BrandingContext?.primaryColor || '#ea580c'
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
      return;
    }
  } catch(e) {
    console.warn('[Razorpay Subscription Init Exception] Falling back to standard subscription flow:', e.message);
  }

  // Fallback to simulated / manual subscription flow
  const confirmMsg = `Are you sure you want to subscribe to the ${planName.toUpperCase()} Plan (₹${price}/month)?`;
  if (!confirm(confirmMsg)) return;
  
  const paymentMethod = prompt("Choose payment method (UPI, Card, NetBanking):", "UPI");
  if (paymentMethod === null) return;
  
  const modal = document.getElementById('payment-simulation-modal');
  const loadingState = document.getElementById('payment-loading-state');
  const successState = document.getElementById('payment-success-state');
  const successMsg = document.getElementById('payment-success-msg');
  
  if (modal && loadingState && successState && successMsg) {
    loadingState.style.display = 'flex';
    successState.style.display = 'none';
    modal.style.display = 'flex';
    
    setTimeout(async () => {
      try {
        const res = await fetch('/api/client/subscribe-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: loggedInUser.id,
            plan: planName,
            amount: price,
            paymentMethod: paymentMethod || 'UPI'
          })
        });
        
        const data = await res.json();
        if (data.success) {
          loggedInUser = { ...loggedInUser, plan: data.plan, balance: data.balance, billing_history: data.billing_history };
          localStorage.setItem('user_session', JSON.stringify(loggedInUser));
          applyUserRole(loggedInUser);
          fetchBillingData();
          loadingState.style.display = 'none';
          successState.style.display = 'flex';
          successMsg.innerHTML = `Successfully subscribed to the <strong>${planName.toUpperCase()} Plan</strong> for ₹${price.toFixed(2)} using ${paymentMethod}.`;
        } else {
          alert(`Subscription failed: ${data.error}`);
          modal.style.display = 'none';
        }
      } catch (err) {
        alert('Failed to connect to billing server. Please try again.');
        modal.style.display = 'none';
      }
    }, 1500);
  }
};

window.toggleCallingCredentials = function() {
  const content = document.getElementById('calling-credentials-content');
  const arrow = document.getElementById('credentials-accordion-arrow');
  if (content && arrow) {
    if (content.style.display === 'none' || !content.style.display) {
      content.style.display = 'block';
      arrow.textContent = '▲';
    } else {
      content.style.display = 'none';
      arrow.textContent = '▼';
    }
  }
};

// Admin Panel Uptime Counter
(function() {
  const startTime = Date.now();
  function updateUptime() {
    const el = document.getElementById('admin-uptime-display');
    if (!el) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  updateUptime();
  window._adminUptimeInterval = window.setInterval(updateUptime, 1000);
})();

window.saveTelephonyCredsFromCrm = function() {
  const authId = document.getElementById('calling-vobiz-auth-id')?.value.trim() || '';
  const authToken = document.getElementById('calling-vobiz-auth-token')?.value.trim() || '';
  const callerId = document.getElementById('calling-vobiz-caller-id')?.value.trim() || '';
  
  localStorage.setItem('vobiz_auth_id', authId);
  localStorage.setItem('vobiz_auth_token', authToken);
  localStorage.setItem('vobiz_caller_id', callerId);

  const elVobizAuthId = document.getElementById('vobiz-auth-id');
  const elVobizAuthToken = document.getElementById('vobiz-auth-token');
  const elVobizCallerId = document.getElementById('vobiz-caller-id');
  if (elVobizAuthId) elVobizAuthId.value = authId;
  if (elVobizAuthToken) elVobizAuthToken.value = authToken;
  if (elVobizCallerId) elVobizCallerId.value = callerId;

  if (typeof showToast === 'function') {
    showToast('Telephony credentials & number saved successfully!', 'success');
  } else {
    alert('Telephony credentials & number saved successfully!');
  }
};

window.adminResetPassword = async function(clientId, clientName) {
  const newPass = prompt(`Enter new password for ${clientName}:`);
  if (!newPass || !newPass.trim()) return;
  try {
    const res = await fetch('/api/admin/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, newPassword: newPass.trim() })
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ Password for ${clientName} reset successfully!`);
      if (window.fetchAdminClients) window.fetchAdminClients();
    } else {
      alert('Error: ' + (data.error || 'Failed to reset password.'));
    }
  } catch (err) {
    alert('Failed to reset password. Please try again.');
  }
};

window.compressKycDocumentFile = function(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    // If image file, resize/compress via canvas for fast upload
    if (file.type && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1200;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = () => resolve(e.target.result);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    } else {
      // PDF or other documents
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    }
  });
};

window.updateKycFileListDisplay = function(input) {
  const countEl = document.getElementById('kyc-file-count');
  const listEl = document.getElementById('kyc-file-list');
  if (!input || !input.files || input.files.length === 0) {
    if (countEl) countEl.textContent = 'No files chosen';
    if (listEl) listEl.innerHTML = '';
    return;
  }

  const files = Array.from(input.files);
  if (countEl) countEl.textContent = `${files.length} file${files.length > 1 ? 's' : ''} selected`;

  if (listEl) {
    listEl.innerHTML = files.map((f) => `
      <span style="font-size: 0.72rem; background: rgba(6,182,212,0.12); color: var(--color-cyan); border: 1px solid rgba(6,182,212,0.3); padding: 3px 8px; border-radius: 6px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
        📄 ${f.name} (${Math.round(f.size / 1024)} KB)
      </span>
    `).join('');
  }
};

window.submitKycNumberRequest = async function(event) {
  if (event) event.preventDefault();
  const company = document.getElementById('kyc-company-name')?.value.trim() || '';
  const person = document.getElementById('kyc-person-name')?.value.trim() || '';
  const numberType = document.getElementById('kyc-number-type')?.value || 'Indian Virtual Mobile';
  const useCase = document.getElementById('kyc-use-case')?.value || 'Select All (Sales, Support, Surveys, Reminders)';
  const fileInput = document.getElementById('kyc-document-file');

  const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
  if (files.length === 0) {
    alert('Please upload at least one KYC document (GST, Address Proof, Aadhaar, or PAN).');
    return;
  }

  const documentUrls = [];
  for (const f of files) {
    if (f.size > 25 * 1024 * 1024) {
      alert(`File "${f.name}" size exceeds 25MB. Please choose a smaller file.`);
      return;
    }
    try {
      const url = await window.compressKycDocumentFile(f);
      if (url) documentUrls.push(url);
    } catch(e) {
      console.error('Error compressing file:', e);
    }
  }

  if (documentUrls.length === 0) {
    alert('Please select valid KYC document files to upload.');
    return;
  }

  const userObj = (typeof loggedInUser !== 'undefined' && loggedInUser) ? loggedInUser : {};
  const userEmail = userObj.email || '';
  const userPhone = userObj.phone_number || userObj.phone || '';

  try {
    const res = await fetch('/api/client/request-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company,
        person,
        email: userEmail,
        phone: userPhone,
        number_type: numberType,
        use_case: useCase,
        document_urls: documentUrls,
        document_url: documentUrls[0] || null,
        userId: userObj.id || null
      })
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ Your Virtual Number & KYC request (${documentUrls.length} document${documentUrls.length > 1 ? 's' : ''} uploaded) has been submitted to the admin for verification!`);
      if (typeof closeNumbersModal === 'function') closeNumbersModal();
      if (typeof fetchAdminRequests === 'function') fetchAdminRequests();
    } else {
      alert('Error: ' + (data.error || 'Failed to submit request.'));
    }
  } catch (err) {
    alert('Error submitting request: ' + err.message);
  }
};

// ─── Enterprise Inquiry Modal Functions ──────────────────────────────────────

window.openEnterpriseModal = function() {
  const modal = document.getElementById('enterprise-inquiry-modal');
  if (modal) {
    const form = document.getElementById('enterprise-inquiry-form');
    if (form) form.reset();
    const msg = document.getElementById('ent-form-msg');
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
    const btn = document.getElementById('ent-submit-btn');
    if (btn) { btn.disabled = false; btn.innerHTML = '🚀 Submit Enterprise Inquiry'; }
    modal.style.display = 'flex';
  }
};

window.closeEnterpriseModal = function() {
  const modal = document.getElementById('enterprise-inquiry-modal');
  if (modal) modal.style.display = 'none';
};

document.addEventListener('click', function(e) {
  const modal = document.getElementById('enterprise-inquiry-modal');
  if (modal && e.target === modal) window.closeEnterpriseModal();
});

window.submitEnterpriseInquiry = async function(event) {
  event.preventDefault();
  const name = document.getElementById('ent-name')?.value.trim();
  const phone = document.getElementById('ent-phone')?.value.trim();
  const company = document.getElementById('ent-company')?.value.trim();
  const requirement = document.getElementById('ent-requirement')?.value.trim();
  const msg = document.getElementById('ent-form-msg');
  const btn = document.getElementById('ent-submit-btn');

  if (!name || !phone || !company || !requirement) {
    if (msg) {
      msg.style.display = 'block';
      msg.style.background = 'rgba(239,68,68,0.12)';
      msg.style.color = '#ef4444';
      msg.style.border = '1px solid rgba(239,68,68,0.25)';
      msg.textContent = '⚠️ Please fill in all required fields.';
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Submitting...'; }

  try {
    const res = await fetch('/api/public/enterprise-inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, company, requirement })
    });
    const data = await res.json();
    if (data.success) {
      if (msg) {
        msg.style.display = 'block';
        msg.style.background = 'rgba(16,185,129,0.12)';
        msg.style.color = '#10b981';
        msg.style.border = '1px solid rgba(16,185,129,0.25)';
        msg.textContent = '✅ ' + (data.message || 'Inquiry submitted! Our team will contact you within 24 hours.');
      }
      if (btn) btn.innerHTML = '✅ Submitted!';
      setTimeout(() => window.closeEnterpriseModal(), 3000);
    } else {
      if (msg) { msg.style.display = 'block'; msg.style.background = 'rgba(239,68,68,0.12)'; msg.style.color = '#ef4444'; msg.style.border = '1px solid rgba(239,68,68,0.25)'; msg.textContent = '❌ ' + (data.error || 'Submission failed. Please try again.'); }
      if (btn) { btn.disabled = false; btn.innerHTML = '🚀 Submit Enterprise Inquiry'; }
    }
  } catch (err) {
    if (msg) { msg.style.display = 'block'; msg.style.background = 'rgba(239,68,68,0.12)'; msg.style.color = '#ef4444'; msg.style.border = '1px solid rgba(239,68,68,0.25)'; msg.textContent = '❌ Network error. Please try again.'; }
    if (btn) { btn.disabled = false; btn.innerHTML = '🚀 Submit Enterprise Inquiry'; }
  }
};

// ─── Admin: Fetch & Render Enterprise Inquiries ────────────────────────────

window.fetchEnterpriseInquiries = async function() {
  const tbody = document.getElementById('admin-enterprise-inquiries-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px;">Loading inquiries...</td></tr>';

  try {
    const res = await fetch('/api/admin/enterprise-inquiries');
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#ef4444;padding:20px;">${data.error || 'Failed to load inquiries.'}</td></tr>`;
      return;
    }
    const inquiries = data.inquiries || [];
    if (inquiries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:30px;font-style:italic;">No enterprise inquiries yet. Inquiries submitted via the Enterprise plan form will appear here.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    inquiries.forEach(inq => {
      const dt = new Date(inq.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const statusColors = {
        new: { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: 'rgba(59,130,246,0.25)', label: '🆕 New' },
        contacted: { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: 'rgba(245,158,11,0.25)', label: '📞 Contacted' },
        resolved: { bg: 'rgba(16,185,129,0.12)', color: '#10b981', border: 'rgba(16,185,129,0.25)', label: '✅ Resolved' }
      };
      const sc = statusColors[inq.status] || statusColors.new;
      const isReseller = inq.reseller_id !== null;
      const domainBadge = isReseller
        ? `<span style="background:rgba(139,92,246,0.12);color:#8b5cf6;border:1px solid rgba(139,92,246,0.25);font-size:0.7rem;padding:2px 7px;border-radius:20px;font-weight:700;">${inq.reseller_name || inq.domain}</span>`
        : `<span style="background:rgba(255,107,74,0.12);color:var(--color-primary);border:1px solid rgba(255,107,74,0.25);font-size:0.7rem;padding:2px 7px;border-radius:20px;font-weight:700;">Callio Main</span>`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-size:0.78rem;color:var(--text-muted);white-space:nowrap;">${dt}</td>
        <td style="font-weight:700;font-size:0.88rem;">${inq.name}</td>
        <td><a href="tel:${inq.phone}" style="color:var(--color-primary);font-weight:600;font-size:0.85rem;text-decoration:none;">${inq.phone}</a></td>
        <td style="font-weight:600;font-size:0.85rem;">${inq.company}</td>
        <td><div style="max-width:200px;max-height:60px;overflow-y:auto;font-size:0.78rem;line-height:1.45;" title="${inq.requirement.replace(/"/g,'&quot;')}">${inq.requirement}</div></td>
        <td>${domainBadge}</td>
        <td><span class="badge" style="background:${sc.bg};color:${sc.color};border:1px solid ${sc.border};font-size:0.7rem;padding:3px 8px;border-radius:20px;font-weight:700;white-space:nowrap;">${sc.label}</span></td>
        <td>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            ${inq.status !== 'contacted' ? `<button onclick="window.updateEnterpriseInquiryStatus('${inq.id}','contacted')" class="admin-action-btn" style="font-size:0.7rem;padding:4px 8px;">📞 Contacted</button>` : ''}
            ${inq.status !== 'resolved' ? `<button onclick="window.updateEnterpriseInquiryStatus('${inq.id}','resolved')" class="admin-action-btn admin-action-btn-recharge" style="font-size:0.7rem;padding:4px 8px;">✅ Resolve</button>` : ''}
            <button onclick="window.deleteEnterpriseInquiry('${inq.id}')" class="admin-action-btn" style="font-size:0.7rem;padding:4px 8px;background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.25);">🗑️ Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#ef4444;padding:20px;">Error: ${err.message}</td></tr>`;
  }
};

window.updateEnterpriseInquiryStatus = async function(id, status) {
  try {
    const res = await fetch('/api/admin/enterprise-inquiry/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status })
    });
    const data = await res.json();
    if (data.success) window.fetchEnterpriseInquiries();
  } catch (err) { console.error('Status update failed:', err); }
};

window.deleteEnterpriseInquiry = async function(id) {
  if (!confirm('Delete this enterprise inquiry? This cannot be undone.')) return;
  try {
    const res = await fetch('/api/admin/enterprise-inquiry/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'delete' })
    });
    const data = await res.json();
    if (data.success) window.fetchEnterpriseInquiries();
  } catch (err) { console.error('Delete failed:', err); }
};

// ─── Client Subscription Plans Renderer ───────────────────────────────────────
window.fetchAndRenderSubscriptionPlans = async function() {
  const container = document.getElementById('client-pricing-cards-container');
  if (!container) return;

  try {
    const res = await fetch('/api/plans');
    const data = await res.json();
    if (!data.success || !data.plans || !data.plans.length) {
      container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 30px;">No subscription plans available currently.</div>`;
      return;
    }

    const activeUser = loggedInUser || window.CurrentClient;
    const rawUserPlan = (activeUser && activeUser.plan) ? String(activeUser.plan).trim().toLowerCase() : 'none';
    const currentClientPlan = (rawUserPlan === 'none' || rawUserPlan === 'no_plan' || rawUserPlan === 'inactive' || !rawUserPlan) ? '' : rawUserPlan;

    container.innerHTML = data.plans.map(p => {
      const isCurrent = (currentClientPlan === p.id.toLowerCase());
      const isPopular = (p.id.toLowerCase() === 'pro');
      const badgeHtml = isPopular 
        ? `<div style="position: absolute; top: -12px; right: 20px; background: linear-gradient(135deg, #ea580c, #f97316); color: #fff; font-size: 0.7rem; font-weight: 800; padding: 4px 12px; border-radius: 20px; letter-spacing: 0.05em; box-shadow: 0 4px 12px rgba(234, 88, 12, 0.4); text-transform: uppercase;">🔥 Most Popular</div>` 
        : '';

      const features = [
        `🎙️ <strong>${p.max_minutes >= 9999 ? 'Unlimited' : p.max_minutes}</strong> Calling Minutes / mo`,
        `🤖 Up to <strong>${p.max_agents >= 9999 ? 'Unlimited' : p.max_agents}</strong> AI Agents`,
        `⚡ Call Rate: <strong>₹${Number(p.rate_per_minute).toFixed(2)}</strong> / min`,
        p.crm_integration ? `✅ CRM Webhook Integration` : `❌ CRM Integrations (Locked)`,
        p.api_sharing ? `✅ API Access & Tokens` : `❌ API Tokens (Locked)`,
        `📞 High-Priority Realtime Voice Server`
      ];

      return `
        <div class="pricing-plan-card ${isPopular ? 'popular-plan' : ''}" style="position: relative; background: var(--bg-surface); border: ${isPopular ? '2px solid var(--color-primary)' : '1px solid var(--border-color)'}; border-radius: 20px; padding: 28px 24px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: ${isPopular ? '0 12px 40px rgba(234, 88, 12, 0.15)' : '0 4px 20px rgba(0,0,0,0.06)'}; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-4px)'" onmouseout="this.style.transform='none'">
          ${badgeHtml}
          <div>
            <div style="font-size: 1.25rem; font-weight: 800; color: var(--text-main); margin-bottom: 6px; font-family: var(--font-title);">${p.name}</div>
            <div style="font-size: 0.82rem; color: var(--text-muted); min-height: 38px; line-height: 1.4; margin-bottom: 18px;">${p.description || ''}</div>
            
            <div style="display: flex; align-items: baseline; gap: 4px; margin-bottom: 24px; border-bottom: 1px solid var(--border-color); padding-bottom: 20px;">
              <span style="font-size: 2.2rem; font-weight: 900; color: var(--text-main); font-family: var(--font-title);">₹${Number(p.price_per_month).toLocaleString('en-IN')}</span>
              <span style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">/ month</span>
            </div>

            <ul style="list-style: none; padding: 0; margin: 0 0 24px 0; display: flex; flex-direction: column; gap: 12px; font-size: 0.88rem; color: var(--text-main);">
              ${features.map(f => `<li style="display: flex; align-items: center; gap: 8px; font-size: 0.86rem; color: var(--text-main);">${f}</li>`).join('')}
            </ul>
          </div>

          <button onclick="window.handleSubscribePlanClick('${p.id}', '${p.name}', ${p.price_per_month})" class="btn" style="width: 100%; padding: 14px; border-radius: 12px; font-weight: 800; font-size: 0.95rem; cursor: pointer; border: none; transition: all 0.2s; ${isCurrent ? 'background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid #10b981;' : (isPopular ? 'background: linear-gradient(135deg, var(--color-primary), var(--color-secondary)); color: #fff; box-shadow: 0 6px 20px rgba(234, 88, 12, 0.3);' : 'background: var(--bg-primary); color: var(--text-main); border: 1px solid var(--border-color);')}">
            ${isCurrent ? '✔ Current Active Plan' : '⚡ Subscribe & Upgrade'}
          </button>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading subscription plans:', err);
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 30px;">Error loading subscription plans: ${err.message}</div>`;
  }
};

window.handleSubscribePlanClick = function(planId, planName, basePrice) {
  const gstRate = 0.18;
  const gstAmount = Number((basePrice * gstRate).toFixed(2));
  const totalAmount = Number((basePrice + gstAmount).toFixed(2));

  // Remove existing modal if present
  const existingModal = document.getElementById('subscription-checkout-modal-overlay');
  if (existingModal) existingModal.remove();

  const modalHtml = `
    <div id="subscription-checkout-modal-overlay" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); z-index: 100000; display: flex; align-items: center; justify-content: center; padding: 16px; font-family: 'Plus Jakarta Sans', sans-serif; box-sizing: border-box; animation: fadeIn 0.2s ease-out;">
      <div style="background: var(--bg-surface, #0B0F19); border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12)); border-radius: 24px; width: 100%; max-width: 480px; padding: 28px 24px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6); color: var(--text-main, #F9FAFB); position: relative; box-sizing: border-box;">
        
        <!-- Close Button -->
        <button onclick="window.closeCheckoutModal()" style="position: absolute; top: 18px; right: 18px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted, #9CA3AF); border-radius: 50%; width: 32px; height: 32px; font-size: 1.1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">✕</button>

        <!-- Header -->
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
          <div style="width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(135deg, rgba(234, 88, 12, 0.2), rgba(249, 115, 22, 0.1)); border: 1px solid rgba(234, 88, 12, 0.3); display: flex; align-items: center; justify-content: center; font-size: 1.3rem;">
            ⚡
          </div>
          <div>
            <h3 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--text-main, #fff); font-family: var(--font-title);">Subscription Summary</h3>
            <span style="font-size: 0.78rem; color: var(--text-muted, #9ca3af);">Review tax invoice & payable amount</span>
          </div>
        </div>

        <!-- Selected Plan Banner -->
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 0.72rem; text-transform: uppercase; color: var(--color-cyan, #38bdf8); font-weight: 700; letter-spacing: 0.5px;">Selected Plan</div>
            <div style="font-size: 1.15rem; font-weight: 800; color: var(--text-main, #fff); margin-top: 2px;">${escapeHtml(planName)}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.72rem; color: var(--text-muted, #9ca3af);">Billing Cycle</div>
            <div style="font-size: 0.85rem; font-weight: 700; color: #10b981;">Monthly Auto-Debit</div>
          </div>
        </div>

        <!-- Tax & Cost Breakdown -->
        <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; padding: 18px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.88rem; margin-bottom: 10px; color: var(--text-muted, #9ca3af);">
            <span>Base Subscription Price</span>
            <span style="font-weight: 700; color: var(--text-main, #fff);">₹${Number(basePrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.88rem; margin-bottom: 14px; color: var(--text-muted, #9ca3af);">
            <span style="display: flex; align-items: center; gap: 4px;">
              <span>Government GST (18%)</span>
              <span style="font-size: 0.65rem; background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-weight: 700;">Tax</span>
            </span>
            <span style="font-weight: 700; color: #38bdf8;">+ ₹${Number(gstAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div style="border-top: 1px dashed rgba(255,255,255,0.15); padding-top: 12px; display: flex; justify-content: space-between; align-items: baseline;">
            <span style="font-size: 0.95rem; font-weight: 800; color: var(--text-main, #fff);">Total Payable Amount</span>
            <span style="font-size: 1.45rem; font-weight: 900; color: #10b981; font-family: var(--font-title);">₹${Number(totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })} <span style="font-size: 0.72rem; font-weight: 600; color: var(--text-muted);">/ mo</span></span>
          </div>
        </div>

        <!-- Optional GSTIN Input for B2B Input Tax Credit -->
        <div style="margin-bottom: 24px;">
          <label style="display: block; font-size: 0.75rem; font-weight: 700; color: var(--text-muted, #9ca3af); margin-bottom: 6px;">Business GSTIN <span style="font-weight: 400; opacity: 0.7;">(Optional for GST Invoice Claim)</span></label>
          <input type="text" id="checkout-user-gstin" placeholder="e.g. 07AAAAA0000A1Z5" style="width: 100%; height: 42px; padding: 0 14px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; color: #fff; font-size: 0.85rem; font-family: monospace; outline: none; box-sizing: border-box; text-transform: uppercase;" />
        </div>

        <!-- Action Buttons -->
        <div style="display: flex; gap: 12px;">
          <button onclick="window.closeCheckoutModal()" class="btn" style="flex: 1; height: 46px; border-radius: 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: var(--text-main, #fff); font-weight: 700; cursor: pointer; transition: all 0.2s;">Cancel</button>
          <button id="btn-proceed-razorpay-pay" onclick="window.proceedToRazorpayCheckout('${planId}', '${escapeHtml(planName)}', ${basePrice}, ${totalAmount})" class="btn" style="flex: 2; height: 46px; border-radius: 14px; background: linear-gradient(135deg, #FF6B4A, #ea580c); border: none; color: #fff; font-weight: 800; font-size: 0.92rem; cursor: pointer; box-shadow: 0 8px 24px rgba(234, 88, 12, 0.4); transition: all 0.2s;">
            🔒 Pay ₹${Number(totalAmount).toLocaleString('en-IN')}
          </button>
        </div>

      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.closeCheckoutModal = function() {
  const modal = document.getElementById('subscription-checkout-modal-overlay');
  if (modal) modal.remove();
};

window.proceedToRazorpayCheckout = async function(planId, planName, basePrice, totalAmount) {
  const gstinInput = document.getElementById('checkout-user-gstin');
  const customerGstin = gstinInput ? gstinInput.value.trim().toUpperCase() : '';

  const btnPay = document.getElementById('btn-proceed-razorpay-pay');
  if (btnPay) {
    btnPay.disabled = true;
    btnPay.innerText = '⏳ Initializing Gateway...';
  }

  const clientId = (loggedInUser && loggedInUser.id) ? loggedInUser.id : (window.CurrentClient?.id || '');

  try {
    // 1. Attempt Razorpay Subscription API
    const subRes = await fetch('/api/payments/subscriptions/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, clientId, customerGstin })
    });

    const subData = await subRes.json();

    if (subData.success && subData.subscriptionId && window.Razorpay) {
      window.closeCheckoutModal();

      const options = {
        key: subData.keyId,
        subscription_id: subData.subscriptionId,
        name: window.BrandingContext?.appName || 'Callio AI Voice Agent',
        description: `${planName} Subscription (₹${basePrice} + 18% GST)`,
        image: window.BrandingContext?.logoUrl || '/logo_new.png',
        handler: async function (response) {
          try {
            const verifyRes = await fetch('/api/payments/subscriptions/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_subscription_id: response.razorpay_subscription_id,
                razorpay_signature: response.razorpay_signature,
                planId,
                clientId,
                customerGstin
              })
            });
            const vData = await verifyRes.json();
            if (vData.success) {
              alert(`🎉 Subscription Activated!\n\nSuccessfully subscribed to ${planName} for ₹${Number(totalAmount).toLocaleString('en-IN')}/month (including 18% GST).`);
              location.reload();
            } else {
              alert(vData.error || 'Verification failed. Please contact support.');
            }
          } catch(e) {
            alert('Payment completed! Refreshing workspace...');
            location.reload();
          }
        },
        prefill: {
          name: loggedInUser?.name || window.CurrentClient?.name || '',
          email: loggedInUser?.email || window.CurrentClient?.email || ''
        },
        theme: { color: '#ea580c' }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
      return;
    }

    // 2. Fallback to Standard Razorpay Payment Gateway Modal
    const rRes = await fetch('/api/admin/razorpay-config');
    const rData = await rRes.json();

    if (rData.success && rData.isEnabled && window.Razorpay && rData.keyId) {
      window.closeCheckoutModal();

      const options = {
        key: rData.keyId,
        amount: Math.round(totalAmount * 100),
        currency: 'INR',
        name: window.BrandingContext?.appName || 'Callio AI Voice Agent',
        description: `Subscription for ${planName} (Incl. 18% GST)`,
        image: window.BrandingContext?.logoUrl || '/logo_new.png',
        handler: async function (response) {
          try {
            await fetch('/api/payments/subscriptions/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_payment_id: response.razorpay_payment_id,
                planId,
                clientId,
                customerGstin
              })
            });
          } catch(e) {}
          alert(`✅ Payment Successful! Payment ID: ${response.razorpay_payment_id}\nYour account is now upgraded to ${planName}.`);
          location.reload();
        },
        prefill: {
          name: loggedInUser?.name || window.CurrentClient?.name || '',
          email: loggedInUser?.email || window.CurrentClient?.email || ''
        },
        theme: { color: '#ea580c' }
      };
      const rzp = new window.Razorpay(options);
      rzp.open();
    } else {
      alert(`Plan Upgrade Request Received for ${planName}.\nTotal Amount: ₹${Number(totalAmount).toLocaleString('en-IN')}/mo (Incl. 18% GST).\nPlease configure Razorpay Key ID in Admin Panel or contact support.`);
      window.closeCheckoutModal();
    }
  } catch (err) {
    console.error('Checkout Exception:', err);
    alert(`Could not initiate payment gateway. Please try again or contact support.`);
    window.closeCheckoutModal();
  }
};

// ─── Super Admin Razorpay Config Functions ────────────────────────────────────
window.loadSuperAdminRazorpayConfig = async function() {
  try {
    const tenantText = document.getElementById('razorpay-tenant-info-text');
    if (tenantText) {
      tenantText.textContent = `Configuring custom Razorpay API credentials for domain: ${window.location.host}`;
    }
    const whUrlDisplay = document.getElementById('rzp-webhook-url-display');
    if (whUrlDisplay) {
      whUrlDisplay.value = `${window.location.origin}/api/razorpay/webhook`;
    }
    const res = await fetch('/api/admin/razorpay-config');
    const data = await res.json();
    if (data.success) {
      const keyInput = document.getElementById('rzp-key-id');
      if (keyInput && data.keyId) keyInput.value = data.keyId;
      const secretInput = document.getElementById('rzp-key-secret');
      if (secretInput && data.keySecret) secretInput.value = data.keySecret;
      const whSecretInput = document.getElementById('rzp-webhook-secret');
      if (whSecretInput && data.webhookSecret) whSecretInput.value = data.webhookSecret;
      const badge = document.getElementById('razorpay-status-badge');
      if (badge) {
        if (data.isEnabled) {
          badge.innerHTML = `<span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block;"></span> Active & Connected`;
          badge.style.background = 'rgba(16,185,129,0.12)';
          badge.style.color = '#10b981';
          badge.style.borderColor = 'rgba(16,185,129,0.3)';
        } else {
          badge.innerHTML = `<span style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444; display: inline-block;"></span> Disabled / Not Configured`;
          badge.style.background = 'rgba(239,68,68,0.12)';
          badge.style.color = '#ef4444';
          badge.style.borderColor = 'rgba(239,68,68,0.3)';
        }
      }
    }
  } catch(e) {}
};

window.copyRazorpayWebhookUrl = function() {
  const input = document.getElementById('rzp-webhook-url-display');
  if (input && input.value) {
    navigator.clipboard.writeText(input.value);
    alert('📋 Razorpay Webhook Target URL copied to clipboard!\n\nURL: ' + input.value);
  }
};

window.saveRazorpayConfig = async function(event) {
  if (event) event.preventDefault();
  const keyId = document.getElementById('rzp-key-id')?.value.trim() || '';
  const keySecret = document.getElementById('rzp-key-secret')?.value.trim() || '';
  const webhookSecret = document.getElementById('rzp-webhook-secret')?.value.trim() || '';

  if (!keyId) {
    alert('Please enter your Razorpay Key ID.');
    return;
  }

  try {
    const res = await fetch('/api/admin/razorpay-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyId, keySecret, webhookSecret })
    });
    const data = await res.json();
    if (data.success) {
      alert('✅ Razorpay Gateway credentials saved successfully!');
      window.loadSuperAdminRazorpayConfig();
    } else {
      alert('Failed to save Razorpay config: ' + (data.error || 'Unknown error'));
    }
  } catch(e) {
    alert('Error saving Razorpay config: ' + e.message);
  }
};

window.loadAdminGstin = async function() {
  try {
    const res = await fetch('/api/admin/gstin');
    const data = await res.json();
    if (data.success && data.gstin) {
      const input = document.getElementById('admin-gstin-input');
      if (input) input.value = data.gstin;
      window._domainGstin = data.gstin;
    }
  } catch(e) {}
};

window.saveAdminGstin = async function() {
  const input = document.getElementById('admin-gstin-input');
  const gstin = input ? input.value.trim().toUpperCase() : '';
  try {
    const res = await fetch('/api/admin/gstin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gstin })
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ ${data.message || 'Tax Registration Number (GSTIN) saved successfully!'}`);
      window._domainGstin = gstin;
    } else {
      alert('Failed to save GSTIN: ' + (data.error || 'Unknown error'));
    }
  } catch(e) {
    alert('Error saving GSTIN: ' + e.message);
  }
};

window.testRazorpayConnection = function() {
  const keyId = document.getElementById('rzp-key-id')?.value.trim();
  if (!keyId) {
    alert('Please enter a Razorpay Key ID first.');
    return;
  }
  if (!window.Razorpay) {
    alert('Razorpay Checkout SDK is loading...');
    return;
  }
  alert(`⚡ Razorpay SDK loaded successfully!\nKey ID (${keyId.substring(0, 12)}...) is active.`);
};

// Auto-trigger plan, transaction ledger & Razorpay rendering
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    window.fetchAndRenderSubscriptionPlans();
    window.loadSuperAdminRazorpayConfig();
    window.loadAdminGstin();
    window.fetchClientTransactionsAndBalance();
  });
} else {
  window.fetchAndRenderSubscriptionPlans();
  window.loadSuperAdminRazorpayConfig();
  window.loadAdminGstin();
  window.fetchClientTransactionsAndBalance();
}
