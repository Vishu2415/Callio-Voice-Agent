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
    // Show target tab pane
    const targetId = btn.getAttribute('data-tab');
    document.getElementById(targetId).classList.add('active');

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
window.triggerLeadCall = function(phone) {
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  
  // 1. Fill Quick Call phone number input
  const quickCallInput = document.getElementById('quick-call-phone');
  if (quickCallInput) {
    quickCallInput.value = cleanPhone;
    quickCallInput.dispatchEvent(new Event('input'));
    quickCallInput.focus();
  }
  
  // 2. Switch to the Quick Call tab
  const quickCallTab = document.getElementById('nav-quick-call');
  if (quickCallTab) {
    quickCallTab.click();
  }
  
  logSuccess(`Lead selected: ${phone}. Switched to Quick Call dialer.`);
};

window.dismissLeadCard = function(btn) {
  const card = btn.closest('.action-lead-card');
  if (card) {
    const cardId = card.dataset.id;
    if (cardId) {
      const storageKey = typeof loggedInUser !== 'undefined' && loggedInUser 
        ? `dismissed_leads_${loggedInUser.id || loggedInUser.username || 'default'}` 
        : 'dismissed_leads';
        
      let dismissed = [];
      try {
        dismissed = JSON.parse(localStorage.getItem(storageKey) || '[]');
      } catch (e) {
        dismissed = [];
      }
      if (!dismissed.includes(cardId)) {
        dismissed.push(cardId);
        localStorage.setItem(storageKey, JSON.stringify(dismissed));
      }
    }
    
    card.style.opacity = '0';
    card.style.transform = 'scale(0.9)';
    setTimeout(() => {
      card.remove();
      const container = document.getElementById('ai-action-cards-container');
      if (container && container.querySelectorAll('.action-lead-card').length === 0) {
        showEmptyState(container);
      }
    }, 200);
  }
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

window.populateAIActionPlanner = function() {
  const container = document.getElementById('ai-action-cards-container');
  if (!container) return;
  
  const mockLeads = [
    {
      id: 'mock_1',
      phone: '+91 88474 92101',
      urgency: 'Urgent',
      sentiment: 'Highly Interested',
      color: '#10b981', // green
      sentimentBg: 'rgba(16, 185, 129, 0.12)',
      sentimentBorder: 'rgba(16, 185, 129, 0.3)',
      urgencyColor: '#ef4444', // red
      urgencyBg: 'rgba(239, 68, 68, 0.15)',
      urgencyBorder: 'rgba(239, 68, 68, 0.25)',
      summary: 'Called about API integration. Wants to buy Enterprise plan immediately. Send pricing quotation.',
      actionText: 'Call Back'
    },
    {
      id: 'mock_2',
      phone: '+91 91234 56789',
      urgency: 'High',
      sentiment: 'Skeptical',
      color: '#f59e0b', // orange
      sentimentBg: 'rgba(245, 158, 11, 0.12)',
      sentimentBorder: 'rgba(245, 158, 11, 0.3)',
      urgencyColor: '#f97316', // orange
      urgencyBg: 'rgba(249, 115, 22, 0.15)',
      urgencyBorder: 'rgba(249, 115, 22, 0.25)',
      summary: 'Concerned about latency. Needs technical documentation and latency benchmarks via WhatsApp.',
      actionText: 'Send Doc'
    },
    {
      id: 'mock_3',
      phone: '+91 99887 76655',
      urgency: 'Medium',
      sentiment: 'Busy (Callback)',
      color: '#3b82f6', // blue
      sentimentBg: 'rgba(59, 130, 246, 0.12)',
      sentimentBorder: 'rgba(59, 130, 246, 0.3)',
      urgencyColor: '#eab308', // yellow
      urgencyBg: 'rgba(234, 179, 8, 0.15)',
      urgencyBorder: 'rgba(234, 179, 8, 0.25)',
      summary: 'Was driving during the call. Requested a callback in the evening around 6 PM.',
      actionText: 'Call Later'
    }
  ];
  
  const cardsData = [];
  
  // Convert actual calls to action cards
  if (typeof callsCache !== 'undefined' && callsCache && callsCache.length > 0) {
    const latestCalls = [...callsCache].slice(0, 4);
    latestCalls.forEach(call => {
      let urgency = 'Medium';
      let urgencyColor = '#eab308';
      let urgencyBg = 'rgba(234, 179, 8, 0.15)';
      let urgencyBorder = 'rgba(234, 179, 8, 0.25)';
      
      let sentiment = 'Neutral';
      let sentimentColor = '#94a3b8';
      let sentimentBg = 'rgba(255, 255, 255, 0.05)';
      let sentimentBorder = 'rgba(255, 255, 255, 0.15)';
      
      let summaryText = call.summary || '';
      let actionText = 'Call Back';
      
      if (call.sentiment) {
        const s = call.sentiment.toLowerCase();
        if (s.includes('positive') || s.includes('interest')) {
          sentiment = 'Interested';
          sentimentColor = '#10b981';
          sentimentBg = 'rgba(16, 185, 129, 0.12)';
          sentimentBorder = 'rgba(16, 185, 129, 0.3)';
          urgency = 'Urgent';
          urgencyColor = '#ef4444';
          urgencyBg = 'rgba(239, 68, 68, 0.15)';
          urgencyBorder = 'rgba(239, 68, 68, 0.25)';
        } else if (s.includes('negative') || s.includes('angry') || s.includes('frust')) {
          sentiment = 'Frustrated';
          sentimentColor = '#ef4444';
          sentimentBg = 'rgba(239, 68, 68, 0.12)';
          sentimentBorder = 'rgba(239, 68, 68, 0.3)';
          urgency = 'Urgent';
          urgencyColor = '#ef4444';
          urgencyBg = 'rgba(239, 68, 68, 0.15)';
          urgencyBorder = 'rgba(239, 68, 68, 0.25)';
        }
      }
      
      if (!summaryText) {
        if (call.status === 'no-answer' || call.status === 'busy') {
          summaryText = 'Call was not answered. Customer was busy or did not pick up the phone.';
          urgency = 'Medium';
          urgencyColor = '#eab308';
          sentiment = 'No Answer';
          sentimentColor = '#94a3b8';
          sentimentBg = 'rgba(255, 255, 255, 0.05)';
          sentimentBorder = 'rgba(255, 255, 255, 0.15)';
          actionText = 'Retry Call';
        } else if (call.status === 'completed') {
          summaryText = `Call completed successfully (Duration: ${typeof formatDuration === 'function' ? formatDuration(call.duration || 0) : (call.duration || 0) + 's'}). Follow up on customer requirement.`;
          actionText = 'Follow Up';
        } else {
          summaryText = `Call ended with status: ${call.status || 'ended'}. Follow up needed.`;
        }
      }
      
      cardsData.push({
        id: call.callSid || call.sid || call.id || `call_${call.createdAt || Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        phone: call.customerNumber || call.phone || call.to || call.from || '+91 88474 92101',
        urgency,
        sentiment,
        color: sentimentColor,
        sentimentBg,
        sentimentBorder,
        urgencyColor,
        urgencyBg,
        urgencyBorder,
        summary: summaryText,
        actionText
      });
    });
  }
  
  // Fill with mock leads if we have less than 3
  if (cardsData.length < 3) {
    const needed = 3 - cardsData.length;
    for (let i = 0; i < needed; i++) {
      if (mockLeads[i]) cardsData.push(mockLeads[i]);
    }
  }
  
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
  
  // If activeCards is empty, fall back to mockLeads so cards area is never blank
  if (activeCards.length === 0) {
    activeCards = mockLeads;
  }
  
  container.innerHTML = '';
  activeCards.forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = 'action-lead-card';
    cardEl.dataset.id = card.id; // Store unique ID for persistence!
    cardEl.style.cssText = 'flex: 0 0 290px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; height: 100%; transition: all 0.25s ease; position: relative; backdrop-filter: blur(10px); box-shadow: 0 1px 8px rgba(0, 0, 0, 0.1);';
    
    cardEl.onmouseover = () => {
      cardEl.style.borderColor = 'rgba(6, 182, 212, 0.4)';
      cardEl.style.transform = 'translateY(-4px)';
      cardEl.style.boxShadow = '0 12px 40px 0 rgba(6, 182, 212, 0.15)';
    };
    cardEl.onmouseout = () => {
      cardEl.style.borderColor = 'var(--border-color)';
      cardEl.style.transform = 'none';
      cardEl.style.boxShadow = '0 1px 8px rgba(0, 0, 0, 0.1)';
    };

    cardEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-shrink: 0;">
        <span style="font-size: 0.95rem; font-weight: 800; color: var(--text-main); font-family: var(--font-mono); letter-spacing: -0.2px;">${card.phone}</span>
        <span style="font-size: 0.6rem; font-weight: 800; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: ${card.urgencyBg}; color: ${card.urgencyColor}; border: 1px solid ${card.urgencyBorder}; letter-spacing: 0.5px;">${card.urgency}</span>
      </div>
      
      <div style="margin-bottom: 10px; text-align: left; flex-shrink: 0;">
        <span style="display: inline-block; padding: 4px 10px; border-radius: 6px; background: ${card.sentimentBg}; color: ${card.color}; font-weight: 800; font-size: 0.8rem; border: 1px solid ${card.sentimentBorder}; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 2px 8px ${card.sentimentBg};">
          ${card.sentiment}
        </span>
      </div>
      
      <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; text-align: left;">
        <div style="font-size: 0.78rem; color: var(--text-muted); line-height: 1.45; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;" title="${card.summary}">
          ${card.summary}
        </div>
      </div>
      
      <div style="display: flex; gap: 8px; margin-top: auto; flex-shrink: 0;">
        <button class="btn btn-primary" onclick="window.triggerLeadCall('${card.phone}')" style="flex: 1; padding: 4px; font-size: 0.72rem; border-radius: 8px; background: var(--color-cyan); border-color: var(--color-cyan); color: #000; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 6px; height: 28px; cursor: pointer; border: none; transition: background 0.2s;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 12px; height: 12px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          ${card.actionText}
        </button>
        <button class="btn btn-secondary" onclick="window.dismissLeadCard(this)" style="padding: 4px 12px; font-size: 0.72rem; border-radius: 8px; font-weight: 600; height: 28px; background: var(--bg-surface); border: 1px solid var(--border-color); color: var(--text-muted); cursor: pointer; transition: background 0.2s;">
          Done
        </button>
      </div>
    `;
    container.appendChild(cardEl);
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
    
    const name = nameInput ? nameInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passInput ? passInput.value.trim() : '';

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
        body: JSON.stringify({ id: loggedInUser.id, name, email, password })
      });
      const data = res.ok ? await res.json() : null;
      if (data && data.success) {
        loggedInUser = { ...loggedInUser, ...data.user };
        localStorage.setItem('user_session', JSON.stringify(loggedInUser));
        alert('Profile details updated successfully!');
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
  const apiKey = elApiKey.value.trim();
  if (!apiKey) {
    alert("Please enter your Gemini API Key in the Settings drawer first to test voices.");
    document.getElementById('settings-drawer')?.classList.add('active');
    return;
  }
  
  const originalText = buttonEl.innerText;
  buttonEl.innerText = "⏳...";
  buttonEl.disabled = true;
  
  const prompt = "Hello! Main ready hoon.";
  
  const payload = {
    contents: [{
      role: "user",
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        "voiceConfig": {
          "prebuiltVoiceConfig": {
            "voiceName": voiceName
          }
        }
      }
    }
  };
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`;
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
    
    const data = await res.json();
    const candidate = data.candidates?.[0];
    const part = candidate?.content?.parts?.[0];
    
    if (part?.inlineData?.data) {
      const base64Audio = part.inlineData.data;
      const arrayBuffer = base64ToArrayBuffer(base64Audio);
      const float32Data = pcmToFloat32(arrayBuffer);
      
      const sampleCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = sampleCtx.createBuffer(1, float32Data.length, 24000);
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
let selectedCallSid = null;
let callsCache = [];

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
    if (data.success) {
      if (loggedInUser && loggedInUser.role !== 'admin') {
        // Isolate to only this client's calls!
        callsCache = data.calls.filter(c => 
          c.clientId === loggedInUser.id || 
          (loggedInUser.phone_number && (c.to === loggedInUser.phone_number || c.from === loggedInUser.phone_number))
        );
      } else {
        callsCache = data.calls;
      }
      
      const activeTab = localStorage.getItem('activeTab') || 'tab-dashboard';
      if (activeTab === 'tab-dashboard') {
        renderCallsSidebar();
        renderDashboard();
        updateVobizMetrics();
        if (selectedCallSid) {
          renderCallDetails(selectedCallSid);
        }
        window.populateAIActionPlanner();
        refreshCallbacksList();
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
      const proxyUrl = `/recording-proxy/${call.callSid}`;
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

// Start periodic polling for calls list
refreshCallsList();
setInterval(() => {
  refreshCallsList();
  refreshHistoryIfOpen();
}, 8000);

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
  if (saveBtn) {
    saveBtn.innerText = 'Update Agent';
    
    // Create/toggle Cancel button if it doesn't exist
    let cancelBtn = document.getElementById('btn-cancel-agent-edit');
    if (!cancelBtn) {
      cancelBtn = document.createElement('button');
      cancelBtn.id = 'btn-cancel-agent-edit';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.innerText = 'Cancel';
      cancelBtn.style.marginLeft = '8px';
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        clearAgentForm();
      });
      saveBtn.parentNode.appendChild(cancelBtn);
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
      populateSingleContactGroups(data.groups);
    }
  } catch (e) {
    console.error("Failed to fetch groups", e);
  }
}

function renderGroupsTable(groups) {
  const container = document.querySelector('#groups-table-body');
  if (!container) return;
  container.innerHTML = '';
  
  if (groups.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 4rem 2rem;">
          <div class="empty-state" style="border: none; background: transparent; padding: 0;">
            <div class="empty-state-icon" style="display: flex; align-items: center; justify-content: center; margin-bottom: 1rem;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 44px; height: 44px; color: var(--text-muted); opacity: 0.4;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <h4 class="empty-state-title" style="font-size: 1rem; margin-bottom: 0.25rem;">No Contact Groups</h4>
            <p class="empty-state-desc" style="font-size: 0.8rem; max-width: 320px; margin: 0 auto;">Upload a CSV or Excel file on the left to create a contact group.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  groups.forEach(group => {
    const tr = document.createElement('tr');
    const dateStr = new Date(group.createdAt).toLocaleString();
    
    tr.innerHTML = `
      <td style="font-weight: 500; color: var(--text-main);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px; color: var(--color-cyan);"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          ${escapeHtml(group.name)}
        </div>
      </td>
      <td>
        <span class="group-card-count" onclick="viewGroupContacts('${group.id}')" style="cursor: pointer; background: rgba(0, 255, 255, 0.1); color: var(--color-cyan); padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 500; border: 1px solid rgba(0, 255, 255, 0.15);">${group.contacts.length} Contacts</span>
      </td>
      <td style="color: var(--text-muted); font-size: 0.85rem;">${dateStr}</td>
      <td style="text-align: right;">
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button class="btn btn-secondary btn-icon" onclick="viewGroupContacts('${group.id}')" title="View Contacts" style="padding: 6px 10px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="btn btn-secondary btn-icon" onclick="deleteGroup('${group.id}')" title="Delete" style="padding: 6px 10px; color: var(--color-red); border-color: rgba(239, 68, 68, 0.15);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </td>
    `;
    container.appendChild(tr);
  });
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
  const select = document.getElementById('single-contact-group-select');
  const newGroupNameInput = document.getElementById('single-contact-new-group-name');
  const nameInput = document.getElementById('single-contact-name');
  const phoneInput = document.getElementById('single-contact-phone');
  const tagInput = document.getElementById('single-contact-tag');
  
  if (!select || !nameInput || !phoneInput) return;
  
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const tag = tagInput ? tagInput.value.trim() : '';
  let groupId = select.value;
  
  if (!phone) {
    alert("Phone number is required.");
    return;
  }
  
  try {
    // 1. If "Create New Group" is selected, create the group first!
    if (groupId === 'new_group') {
      const groupName = newGroupNameInput.value.trim();
      if (!groupName) {
        alert("Please enter a name for the new group.");
        return;
      }
      
      const groupRes = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: groupName, clientId: loggedInUser ? loggedInUser.id : null })
      });
      const groupData = await groupRes.json();
      if (groupData.success) {
        groupId = groupData.group.id;
      } else {
        alert("Failed to create group: " + groupData.error);
        return;
      }
    }
    
    // 2. Add the contact to the resolved group
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, name, phone, tag })
    });
    const data = await res.json();
    if (data.success) {
      // Clear inputs
      nameInput.value = '';
      phoneInput.value = '';
      if (tagInput) tagInput.value = '';
      if (newGroupNameInput) newGroupNameInput.value = '';
      
      // Refresh groups list
      await fetchGroups();
      alert("Contact added successfully!");
    } else {
      alert("Failed to add contact: " + data.error);
    }
  } catch (e) {
    console.error(e);
    alert("Error adding contact.");
  }
};

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
        // Fallback: Assume first column is phone
        rows.forEach(r => {
          const cols = r.split(',');
          if (cols[0] && cols[0].trim().length >= 10) {
            pendingContacts.push({ phone: cols[0].trim(), name: cols[1] ? cols[1].trim() : '' });
          }
        });
      } else {
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i].split(',');
          if (cols[phoneIdx] && cols[phoneIdx].trim()) {
            pendingContacts.push({ 
              phone: cols[phoneIdx].trim(), 
              name: nameIdx !== -1 && cols[nameIdx] ? cols[nameIdx].trim() : ''
            });
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
    const grpRes = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: groupName, clientId: loggedInUser ? loggedInUser.id : null })
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
      fetch('/api/routing-config')
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
    const cfgRes = await fetch('/api/routing-config');
    const cfgData = await cfgRes.json();
    const rules = cfgData.success ? (cfgData.tagRules || []) : [];

    // Prevent duplicate tag
    if (rules.find(r => r.tag === tag)) {
      alert(`A rule for tag "${tag}" already exists. Remove it first.`);
      return;
    }

    rules.push({ tag, agentId });

    const saveRes = await fetch('/api/routing-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagRules: rules })
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
    const cfgRes = await fetch('/api/routing-config');
    const cfgData = await cfgRes.json();
    const rules = cfgData.success ? (cfgData.tagRules || []) : [];
    rules.splice(index, 1);
    const saveRes = await fetch('/api/routing-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagRules: rules })
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
    const res = await fetch('/api/routing-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incomingAgentId: agentId })
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


async function fetchGroupsForDropdowns() {
  try {
    const clientId = loggedInUser ? loggedInUser.id : '';
    const res = await fetch(`/api/groups?clientId=${clientId}`);
    const data = await res.json();
    if (data.success) {
      const bSelect = document.getElementById('broadcast-group-select');
      let opts = '<option value="">-- Choose Group --</option>';
      data.groups.forEach(g => {
        opts += `<option value="${g.id}">${escapeHtml(g.name)} (${g.contacts.length} contacts)</option>`;
      });
      if (bSelect) bSelect.innerHTML = opts;
    }
  } catch (e) {}
}

// --- 4. BROADCAST ACTION ---
document.getElementById('btn-start-broadcast')?.addEventListener('click', async () => {
  const agentId = document.getElementById('broadcast-agent-select').value;
  const groupId = document.getElementById('broadcast-group-select').value;
  const provider = document.getElementById('broadcast-provider').value;
  const publicUrl = document.getElementById('public-url').value;
  
  if (!agentId || !groupId) {
    alert("Please select both an Agent and a Contact Group.");
    return;
  }
  
  if (!confirm("Are you sure you want to start bulk calling this entire group?")) return;
  
  const payload = {
    agentId,
    groupId,
    provider,
    publicUrl,
    exotelApiKey: elExotelApiKey.value,
    exotelApiToken: elExotelApiToken.value,
    exotelAccountSid: elExotelAccountSid.value,
    exotelSubdomain: elExotelSubdomain.value,
    exotelCallerId: elExotelCallerId.value,
    vobizAuthId: elVobizAuthId.value,
    vobizAuthToken: elVobizAuthToken.value,
    vobizCallerId: elVobizCallerId.value
  };
  
  try {
    const res = await fetch('/api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert(`Broadcast Initiated! Dialing ${data.totalContacts} contacts in the background.`);
      // Switch to dashboard tab
      document.querySelector('.glass-navbar .nav-btn[data-tab="tab-recordings"]').click();
    } else {
      alert("Error starting broadcast: " + data.error);
    }
  } catch (e) {
    alert("Network error while starting broadcast.");
  }
});

// --- 5. QUICK CALL ACTION ---
document.getElementById('btn-dial-phone')?.addEventListener('click', async () => {
  const number = document.getElementById('telephony-number').value.trim();
  const agentId = document.getElementById('quick-agent-select').value;
  const provider = document.getElementById('telephony-provider').value;
  const publicUrl = document.getElementById('public-url').value;
  
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

function formatDuration(call) {
  const startStr = call.startedAt || call.createdAt;
  if (!startStr || call.status === 'calling') return '—';
  const start = new Date(startStr);
  let end = new Date();
  
  // If call is done, use its endedAt, updatedAt or now
  if (call.status === 'completed' || call.status === 'failed') {
    const endStr = call.endedAt || call.updatedAt;
    if (endStr) {
      end = new Date(endStr);
    } else {
      return '—';
    }
  }

  // Ensure end is not before start
  if (end < start) end = start;

  const seconds = Math.max(0, Math.floor((end - start) / 1000));
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

function renderHistoryList() {
  if (!elHistoryCallsList) return;

  const filtered = callsCache.filter(c => {
    if (!historySearchQuery) return true;
    const q = historySearchQuery.toLowerCase();
    return (c.name || '').toLowerCase().includes(q) || (c.to || '').includes(q) || (c.provider || '').includes(q);
  });

  // Group by phone number
  const groups = new Map();
  filtered.forEach(call => {
    const key = call.to || 'Unknown';
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
  const groupCalls = callsCache.filter(c => c.to === phone);
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
  
  const hasActiveCall = groupCalls.some(c => c.status === 'active' || c.status === 'calling');
  const groupStateKey = groupCalls.map(c => `${c.callSid}-${c.status}-${c.recordingStatus}-${c.transcript?.length || 0}-${c.summary ? '1' : '0'}`).join('|');
  
  if (!hasActiveCall && container.dataset.renderedState === groupStateKey) {
    return;
  }
  container.dataset.renderedState = groupStateKey;
  
  container.innerHTML = ''; // Clear container

  groupCalls.forEach(call => {
    const callBlock = document.createElement('div');
    callBlock.className = `hd-call-card status-${call.status}`;

    const callDate = call.startedAt ? new Date(call.startedAt).toLocaleString() : (call.createdAt ? new Date(call.createdAt).toLocaleString() : 'Unknown');
    const duration = call.startedAt ? formatDuration(call) : '—';
    
    const isIncomingCall = call.direction ? (call.direction === 'incoming') : (loggedInUser && (call.to === loggedInUser.phone_number || (loggedInUser.phone_number && loggedInUser.phone_number.includes(call.to))));
    
    // Header
    const headerHtml = `
      <div class="hd-call-header">
        <div class="hd-call-status" style="display: flex; gap: 6px; align-items: center;">
          <span class="status-badge badge-${call.status}">${call.status.toUpperCase()}</span>
          ${isIncomingCall 
            ? `<span class="status-badge" style="background: rgba(16, 185, 129, 0.1); color: var(--color-green); border: 1px solid rgba(16, 185, 129, 0.2); text-transform: uppercase;">⬇ Incoming</span>`
            : `<span class="status-badge" style="background: rgba(6, 182, 212, 0.1); color: var(--color-cyan); border: 1px solid rgba(6, 182, 212, 0.2); text-transform: uppercase;">⬆ Outgoing</span>`}
        </div>
        <div class="hd-call-time">
          <span>${callDate}</span>
          <span class="hd-call-duration">${duration}</span>
          ${call.status === 'active' || call.status === 'calling' 
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
      const proxyUrl = `/recording-proxy/${call.callSid}`;
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
  const activeCalls = callsCache.filter(c => c.status === 'active' || c.status === 'in-progress' || c.status === 'ringing').length;
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

  // Populate new 3 boxes for admin as well
  populateDashboardBoxes(callsCache);

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
    chart: { type: 'line', height: lineChartHeight, toolbar: { show: false }, background: 'transparent', animations: { enabled: true, dynamicAnimation: { speed: 1000 } } },
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
    chart: { type: 'line', height: lineChartHeight, toolbar: { show: false }, background: 'transparent', animations: { enabled: true } },
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
    chart: { type: 'bar', height: barChartHeight, stacked: true, toolbar: { show: false }, background: 'transparent', animations: { enabled: true } },
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
  if (logs.length > 0) {
    logs.forEach(log => {
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
    const res = await fetch('/api/config');
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
  
  const payload = {
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
    elBtnToggleSharedKeyVisibility.innerText = '🔒 Hide';
  } else {
    elSharedApiKeyInput.type = 'password';
    elBtnToggleSharedKeyVisibility.innerText = '👁️ Show';
  }
});

elBtnCopySharedKey?.addEventListener('click', (e) => {
  e.preventDefault();
  if (!elSharedApiKeyInput.value) {
    alert('Please generate an API key first.');
    return;
  }
  navigator.clipboard.writeText(elSharedApiKeyInput.value).then(() => {
    const originalText = elBtnCopySharedKey.innerText;
    elBtnCopySharedKey.innerText = '✅ Copied!';
    setTimeout(() => {
      elBtnCopySharedKey.innerText = originalText;
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
      const originalText = btn.innerText;
      btn.innerText = '✅';
      setTimeout(() => { btn.innerText = originalText; }, 2000);
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
function checkAuth() {
  const session = localStorage.getItem('user_session');
  if (session) {
    loggedInUser = JSON.parse(session);
    applyUserRole(loggedInUser);
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
  localStorage.removeItem('user_session');
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
    if (isCurrent) {
      actionBtn.textContent = 'Active Plan';
      actionBtn.disabled = true;
      actionBtn.className = 'btn btn-secondary';
      actionBtn.style.cssText = 'width: 100%; font-weight: 600; padding: 10px; border-radius: 8px; justify-content: center; height: 38px; opacity: 0.7; cursor: not-allowed;';
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
    const plan = user.plan || 'basic';
    
    // Find active plan details
    const planDetails = (window.activePlans || []).find(p => p.id.toLowerCase() === plan.toLowerCase()) || {
      id: 'basic',
      name: 'Basic Plan',
      max_minutes: 100,
      max_agents: 2,
      rate_per_minute: 5,
      crm_integration: false,
      api_sharing: false
    };

    // Update active plan UI elements
    const planBadge = document.getElementById('active-plan-badge');
    if (planBadge) {
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
    
    const minutesStatus = document.getElementById('plan-minutes-status');
    const minutesProgress = document.getElementById('plan-minutes-progress');
    const agentsLimit = document.getElementById('plan-agents-limit');
    const durationLimit = document.getElementById('plan-duration-limit');
    const integrationsStatus = document.getElementById('plan-integrations-status');
    
    const usedMins = user.used_minutes || 0;
    const maxMins = planDetails.max_minutes;
    
    if (minutesStatus) minutesStatus.textContent = `${usedMins.toFixed(1)} / ${maxMins >= 99999 ? 'Unlimited' : maxMins} mins`;
    if (minutesProgress) {
      const pct = Math.min(100, (usedMins / maxMins) * 100);
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
  if (nameInput) nameInput.value = user.name || '';
  if (emailInput) emailInput.value = user.email || '';
  if (passInput) passInput.value = '';
}

function applyUserRole(user) {
  hideAuthModal();
  
  if (user) {
    if (user.role === 'reseller') {
      window.location.href = '/reseller';
      return;
    }
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
  
  // Handle wallet indicator visibility & remaining minutes
  const walletIndicator = document.getElementById('wallet-balance-indicator');
  const headerWalletBalance = document.getElementById('header-wallet-balance');
  if (walletIndicator && headerWalletBalance) {
    if (user.role === 'client') {
      walletIndicator.style.display = 'flex';
      // Show remaining minutes
      const plan = user.plan || 'basic';
      const planDetails = (window.activePlans || []).find(p => p.id.toLowerCase() === plan.toLowerCase());
      const maxMins = planDetails ? (planDetails.max_minutes >= 99999 ? '∞' : planDetails.max_minutes) : 100;
      const usedMins = user.used_minutes || 0;
      const remaining = maxMins === '∞' ? '∞' : Math.max(0, maxMins - usedMins).toFixed(1);
      headerWalletBalance.textContent = `${remaining}`;
    } else {
      walletIndicator.style.display = 'none';
    }
  }

  // Populate profile settings inputs
  populateProfileSettings(user);

  // Apply pricing plans features locking and details UI
  applyUserPlanAndLimits(user);

  // Reset all nav buttons visibility
  document.querySelectorAll('.glass-navbar .nav-btn').forEach(btn => btn.style.display = 'none');
  
  if (user.role === 'admin') {
    // Admin has access to all standard tabs + admin tab + billing + settings
    document.getElementById('nav-dashboard').style.display = 'block';
    document.getElementById('nav-agents').style.display = 'block';
    document.getElementById('nav-contacts').style.display = 'block';
    document.getElementById('nav-broadcast').style.display = 'block';
    document.getElementById('nav-quick-call').style.display = 'block';
    document.getElementById('nav-crm-automation').style.display = 'block';
    document.getElementById('nav-api-sharing').style.display = 'block';
    document.getElementById('nav-admin-panel').style.display = 'block';
    
    // Populate branding settings form
    window.loadBrandingToForm();
    document.getElementById('nav-billing').style.display = 'none';
    
    // Show settings and provider selection for admin
    const settingsBtn = document.getElementById('btn-toggle-settings');
    if (settingsBtn) settingsBtn.style.display = 'flex';
    const adminSettingsOnly = document.getElementById('admin-settings-only');
    if (adminSettingsOnly) adminSettingsOnly.style.display = 'block';
    const providerGroup = document.getElementById('quick-call-provider-group');
    if (providerGroup) providerGroup.style.display = 'block';

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
    const savedTab = localStorage.getItem('activeTab');
    if (savedTab) {
      const tabButton = document.querySelector(`.glass-navbar .nav-btn[data-tab="${savedTab}"]`);
      if (tabButton && tabButton.style.display !== 'none') {
        tabButton.click();
      } else {
        document.getElementById('nav-dashboard').click();
      }
    } else {
      document.getElementById('nav-dashboard').click();
    }
    
    // Fetch Admin data
    fetchAdminRequests();
    fetchAdminClients();
    fetchAdminTransactions();
    fetchClientDashboardData();
  } else {
    // Client has access to all standard tabs except Admin Panel
    document.getElementById('nav-dashboard').style.display = 'block';
    document.getElementById('nav-agents').style.display = 'block';
    document.getElementById('nav-contacts').style.display = 'block';
    document.getElementById('nav-broadcast').style.display = 'block';
    document.getElementById('nav-quick-call').style.display = 'block';
    document.getElementById('nav-crm-automation').style.display = 'block';
    document.getElementById('nav-api-sharing').style.display = 'block';
    document.getElementById('nav-billing').style.display = 'block';
    
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
    const savedTab = localStorage.getItem('activeTab');
    if (savedTab) {
      const tabButton = document.querySelector(`.glass-navbar .nav-btn[data-tab="${savedTab}"]`);
      if (tabButton && tabButton.style.display !== 'none') {
        tabButton.click();
      } else {
        document.getElementById('nav-dashboard').click();
      }
    } else {
      document.getElementById('nav-dashboard').click();
    }
    
    // Fetch Client data
    fetchClientDashboardData();
  }
  
  // Immediately refresh calls list and AI Action Planner for the logged-in user
  refreshCallsList();
}

// 1. Signup Action
document.getElementById('btn-signup-submit')?.addEventListener('click', async () => {
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const phone = document.getElementById('signup-phone').value.trim();
  const password = document.getElementById('signup-password').value;

  if (!name || !email || !phone || !password) {
    alert('Please fill in all fields.');
    return;
  }

  try {
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
        localStorage.setItem('user_session', JSON.stringify(loginData.user));
        loggedInUser = loginData.user;
        applyUserRole(loggedInUser);
      }
    } else {
      alert(data.error || 'Signup failed.');
    }
  } catch (err) {
    console.error('Signup error:', err);
    alert('Signup failed. Please try again.');
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
      localStorage.setItem('user_session', JSON.stringify(data.user));
      loggedInUser = data.user;
      applyUserRole(loggedInUser);
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

// 3. Client Dashboard Data Fetch
async function fetchClientDashboardData() {
  if (!loggedInUser) return;
  
  try {
    await fetchPlans();
    const res = await fetch(`/api/client/dashboard-data?clientId=${loggedInUser.id}`);
    const data = await res.json();
    if (data.success) {
      loggedInUser = { ...loggedInUser, ...data.client };
      localStorage.setItem('user_session', JSON.stringify(loggedInUser));
      applyUserPlanAndLimits(loggedInUser);
      if (typeof renderClientNumberStatus === 'function') renderClientNumberStatus(data.client);
      if (typeof renderClientAgentConfig === 'function') renderClientAgentConfig(data.client.agent_config);
      updateDashboardWithClientCalls(data.calls || []);
      if (typeof window.populateAIActionPlanner === 'function') window.populateAIActionPlanner();
    }
  } catch (err) {
    console.error('Failed to fetch client dashboard:', err);
  }
}

function updateDashboardWithClientCalls(calls) {
  const totalCalls = calls.length;
  const completedCalls = calls.filter(c => c.status === 'completed').length;
  const failedCalls = calls.filter(c => c.status === 'failed' || c.status === 'no-answer' || c.status === 'busy' || c.status === 'voicemail').length;
  const interestedCalls = calls.filter(c => c.summary?.toLowerCase().includes('interested') && !c.summary?.toLowerCase().includes('not interested')).length;
  const pickupRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;

  const elCallsMade = document.getElementById('vb-calls-made');
  const elActiveCalls = document.getElementById('vb-active-calls');
  const elPickupRate = document.getElementById('vb-pickup-rate');
  const elCompletedCalls = document.getElementById('vb-completed-calls');
  const elFailedCalls = document.getElementById('vb-failed-calls');
  const elInterestedCalls = document.getElementById('vb-interested-calls');

  if (elCallsMade) elCallsMade.innerText = totalCalls;
  if (elActiveCalls) elActiveCalls.innerText = 0;
  if (elPickupRate) elPickupRate.innerText = pickupRate + '%';
  if (elCompletedCalls) elCompletedCalls.innerText = completedCalls;
  if (elFailedCalls) elFailedCalls.innerText = failedCalls;
  if (elInterestedCalls) elInterestedCalls.innerText = interestedCalls;

  // Populate new 3 boxes
  populateDashboardBoxes(calls);
}

function populateDashboardBoxes(calls) {
  // Cache the calls globally for the modal to use
  window.lastDashboardCalls = calls;

  // 1. Recent Call Connections (up to 4 calls)
  const lastCallBox = document.getElementById('dashboard-last-call-box');
  if (lastCallBox) {
    if (calls && calls.length > 0) {
      const sortedCalls = [...calls].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      lastCallBox.innerHTML = '';
      
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
        
        const toNum = lastCall.to || 'Unknown';
        const partiesText = isIncoming ? `Incoming ➔ You` : `You ➔ ${toNum}`;
        
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
  const incCircle = document.getElementById('traffic-incoming-circle');
  const outCircle = document.getElementById('traffic-outgoing-circle');
  
  if (incEl) incEl.innerText = incomingCount;
  if (outEl) outEl.innerText = outgoingCount;
  if (totalEl) totalEl.innerText = totalToday;
  
  if (ratioEl) {
    if (totalToday > 0) {
      const outPct = Math.round((outgoingCount / totalToday) * 100);
      const incPct = 100 - outPct;
      if (outPct > incPct) {
        ratioEl.innerText = `${outPct}% Outbound`;
        ratioEl.style.color = 'var(--color-cyan)';
      } else if (incPct > outPct) {
        ratioEl.innerText = `${incPct}% Inbound`;
        ratioEl.style.color = 'var(--color-green)';
      } else {
        ratioEl.innerText = 'Balanced Ratio';
        ratioEl.style.color = '#f59e0b';
      }
    } else {
      ratioEl.innerText = 'No Traffic';
      ratioEl.style.color = 'var(--text-muted)';
    }
  }
  
  if (incCircle && outCircle) {
    const circumference = 314.16; // 2 * Math.PI * 50
    if (totalToday > 0) {
      const incPct = incomingCount / totalToday;
      const outPct = outgoingCount / totalToday;
      
      const incStroke = circumference * incPct;
      const outStroke = circumference * outPct;
      
      incCircle.style.strokeDasharray = `${circumference}`;
      incCircle.style.strokeDashoffset = `${circumference - incStroke}`;
      
      outCircle.style.strokeDasharray = `${circumference}`;
      outCircle.style.strokeDashoffset = `${circumference - outStroke}`;
      outCircle.style.transform = `rotate(${incPct * 360}deg)`;
      outCircle.style.transformOrigin = '60px 60px';
    } else {
      incCircle.style.strokeDashoffset = `${circumference}`;
      outCircle.style.strokeDashoffset = `${circumference}`;
    }
  }

  // 3. Recent AI Summaries
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
          div.style.padding = '8px';
          div.style.background = 'rgba(255,255,255,0.01)';
          div.style.border = '1px solid rgba(255,255,255,0.03)';
          div.style.borderRadius = '8px';
          
          const isIncoming = c.direction ? (c.direction === 'incoming') : (loggedInUser && (c.to === loggedInUser.phone_number || (loggedInUser.phone_number && loggedInUser.phone_number.includes(c.to))));
          const isInterested = c.summary.toLowerCase().includes('interested') && !c.summary.toLowerCase().includes('not interested');
          const dotColor = isInterested ? 'var(--color-green)' : 'var(--color-red)';
          
          div.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 4px; font-size: 0.75rem;">
              <span>${isIncoming ? 'Incoming ➔ You' : `You ➔ ${c.to || 'Unknown'}`}</span>
              <span style="display: flex; align-items: center; gap: 4px;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: ${dotColor}; display: inline-block;"></span>
                ${isInterested ? 'Interested' : 'No Interest'}
              </span>
            </div>
            <div style="color: var(--text-muted); font-size: 0.72rem; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(c.summary)}</div>
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
      // Save globally for modal
      window.lastDashboardCallbacks = callbacks;
      renderDashboardCallbacks(callbacks);
      
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

function renderDashboardCallbacks(callbacks) {
  const callbacksList = document.getElementById('dashboard-callbacks-list');
  if (!callbacksList) return;

  // Filter only pending/dialing callbacks
  const pendingCallbacks = callbacks.filter(cb => cb.status === 'pending' || cb.status === 'dialing');

  if (pendingCallbacks.length > 0) {
    callbacksList.innerHTML = '';
    // Show next scheduled first
    pendingCallbacks.slice(0, 4).forEach(cb => {
      const div = document.createElement('div');
      div.className = 'callback-item';
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.justifyContent = 'space-between';
      div.style.padding = '8px';
      div.style.background = 'rgba(255,255,255,0.01)';
      div.style.border = '1px solid rgba(255,255,255,0.03)';
      div.style.borderRadius = '8px';

      const cbDate = new Date(cb.scheduledAt);
      const timeText = isNaN(cbDate.getTime()) 
        ? cb.requestedTime 
        : cbDate.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

      const nameOrPhone = cb.name || cb.phone || 'Unknown';
      const statusBadgeColor = cb.status === 'dialing' ? 'var(--color-cyan)' : 'var(--color-orange)';

      div.innerHTML = `
        <div style="display: flex; align-items: center; gap: 6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; color: ${statusBadgeColor};"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 0.82rem; color: var(--text-main); font-weight: 500;">${nameOrPhone}</span>
            <span style="font-size: 0.7rem; color: var(--text-muted);">${timeText} (${cb.requestedTime})</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button onclick="window.triggerCallbackCallDirect('${cb.id}')" class="btn btn-primary" style="padding: 2px 8px; font-size: 0.65rem; background: var(--color-cyan); border: none; border-radius: 4px; color: #000; font-weight: 600; cursor: pointer;">Call Now</button>
          <button onclick="window.deleteCallbackDirect('${cb.id}')" style="background: transparent; border: none; color: var(--color-red); cursor: pointer; padding: 2px; display: flex; align-items: center;">
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

window.openCallbacksModal = function(event) {
  if (event) event.preventDefault();
  const modal = document.getElementById('callbacks-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  renderCallbacksModalContent();
};

window.closeCallbacksModal = function() {
  const modal = document.getElementById('callbacks-modal');
  if (modal) modal.style.display = 'none';
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
      const initials = req.name.split(/\s+/).filter(Boolean).map(n => n[0]).join('').substring(0, 2);
      tr.innerHTML = `
        <td>
          <div class="client-info-cell">
            <div class="client-avatar-circle">${initials}</div>
            <div class="client-meta-details">
              <span class="client-meta-name">${escapeHtml(req.name)}</span>
              <span class="client-meta-email">${escapeHtml(req.email)}</span>
            </div>
          </div>
        </td>
        <td class="phone">${escapeHtml(req.requested_number)}</td>
        <td>
          <span class="badge" style="background: rgba(255,152,0,0.1); color: #ff9800; border: 1px solid rgba(255,152,0,0.2); margin: 0; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 500;">Pending</span>
        </td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button onclick="handleAdminDecision('${req.id}', 'approve')" class="btn btn-primary" style="padding: 6px 12px; font-size: 0.8rem; background: var(--color-green); border-color: var(--color-green); color: #000; font-weight: 600;">Approve</button>
            <button onclick="handleAdminDecision('${req.id}', 'reject')" class="btn btn-danger" style="padding: 6px 12px; font-size: 0.8rem; background: var(--color-red); border-color: var(--color-red); color: #fff; font-weight: 600;">Reject</button>
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

      tr.innerHTML = `
        <td>
          <div class="client-info-cell">
            <div class="client-avatar-circle">${initials}</div>
            <div class="client-meta-details">
              <span class="client-meta-name">${escapeHtml(client.name)}</span>
              <span class="client-meta-email">${escapeHtml(client.email)}</span>
            </div>
          </div>
        </td>
        <td>${roleBadge}</td>
        <td>${planBadge}</td>
        <td class="phone">${escapeHtml(client.phone_number || 'None')}</td>
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
            <button onclick="window.openAssignNumberModal('${client.id}', '${escapeHtml(client.name)}', '${escapeHtml(client.phone_number || '')}')" class="admin-action-btn" style="background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); color: #c084fc;">Assign Number</button>
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

// --- Assign Number Modal & Form Handling ---
window.openAssignNumberModal = function(clientId, clientName, currentNumber) {
  document.getElementById('assign-number-client-id').value = clientId;
  document.getElementById('assign-number-client-name').value = clientName;
  document.getElementById('assign-number-current').value = currentNumber || 'None';
  document.getElementById('assign-number-new-input').value = currentNumber || '';
  document.getElementById('assign-number-quick-select').value = '';
  document.getElementById('admin-assign-number-modal').style.display = 'flex';
};

window.closeAssignNumberModal = function() {
  document.getElementById('admin-assign-number-modal').style.display = 'none';
};

window.submitAssignNumberUpdate = async function(event) {
  event.preventDefault();
  const clientId = document.getElementById('assign-number-client-id').value;
  const phoneNumber = document.getElementById('assign-number-new-input').value.trim();

  try {
    const res = await fetch('/api/admin/update-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, phone_number: phoneNumber })
    });
    const data = await res.json();
    if (data.success) {
      alert('Telephony number assigned successfully!');
      window.closeAssignNumberModal();
      fetchAdminClients(); // Refresh client table in Admin Panel
    } else {
      alert(`Assignment failed: ${data.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
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
};

// --- Admin Panel Sub-tabs Switcher ---
window.switchAdminSubtab = function(tabName) {
  const sections = {
    'users': 'admin-panel-section-users',
    'requests': 'admin-panel-section-requests',
    'logs': 'admin-panel-section-logs',
    'plans': 'admin-panel-section-plans',
    'trial-leads': 'admin-panel-section-trial-leads',
    'branding': 'admin-panel-section-branding',
    'resellers': 'admin-panel-section-resellers'
  };
  const buttons = {
    'users': 'admin-subtab-users',
    'requests': 'admin-subtab-requests',
    'logs': 'admin-subtab-logs',
    'plans': 'admin-subtab-plans',
    'trial-leads': 'admin-subtab-trial-leads',
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
      if (key === 'plans') {
        window.fetchAdminPlans();
      }
      if (key === 'trial-leads') {
        window.fetchTrialLeads();
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
  tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 20px;">Loading resellers...</td></tr>';

  try {
    const adminPass = localStorage.getItem('adminPassword') || 'admin123';
    const res = await fetch(`/api/admin/resellers?admin_password=${encodeURIComponent(adminPass)}`);
    const data = await res.json();

    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #ef4444; padding: 20px;">${data.error || 'Failed to load resellers.'}</td></tr>`;
      return;
    }

    const resellers = data.resellers || [];
    if (resellers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">No whitelabel resellers created yet. Click "Add New Reseller" to get started.</td></tr>';
      return;
    }

    tbody.innerHTML = resellers.map(r => `
      <tr>
        <td style="font-weight: 600;">${r.name}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${r.email}</td>
        <td style="font-size: 0.85rem; font-family: monospace;">${r.domain || r.subdomain || '—'}</td>
        <td style="font-size: 0.85rem;">
          <strong>${r.quota?.used_minutes || 0}</strong> / ${r.quota?.total_minutes || 0} min
        </td>
        <td style="font-size: 0.85rem; color: var(--color-cyan); font-weight: 600;">
          ₹${r.quota?.wholesale_rate_per_minute || 2.0}/min
        </td>
        <td style="font-size: 0.85rem;">${r.client_count || 0} clients</td>
        <td>
          <span class="badge ${r.status === 'active' ? 'badge-green' : 'badge-red'}" style="padding: 2px 8px; border-radius: 100px; font-size: 0.75rem; font-weight: 600;">${r.status}</span>
        </td>
        <td style="text-align: right;">
          <button onclick="window.editResellerQuota('${r.id}', ${r.quota?.total_minutes||1000}, ${r.quota?.wholesale_rate_per_minute||2.0})" class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.75rem; margin-right: 4px;">Quota &amp; Rate</button>
          <button onclick="window.toggleResellerStatus('${r.id}', '${r.status}')" class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.75rem; margin-right: 4px;">${r.status === 'active' ? 'Suspend' : 'Activate'}</button>
          <button onclick="window.deleteReseller('${r.id}', '${r.name}')" class="btn btn-danger" style="padding: 3px 8px; font-size: 0.75rem; background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Fetch resellers error:', err);
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #ef4444; padding: 20px;">Connection error loading resellers.</td></tr>';
  }
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
        
        // Render call summary cleanly with tooltips
        const summaryHtml = lead.summary
          ? `<div style="max-height: 100px; overflow-y: auto; font-size: 0.78rem; line-height: 1.4; color: var(--on-surface);" title="${lead.summary.replace(/<br>/g, '\n')}">${lead.summary}</div>`
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
  
  if (loggedInUser.role === 'admin' && container && select && editBtn) {
    container.style.display = 'block';
    editBtn.style.display = 'flex';
    
    // Populate dropdown with all registered clients
    select.innerHTML = '';
    const clients = window.adminClientsCache || [];
    
    // Default option is the admin's own billing status
    const optAdmin = document.createElement('option');
    optAdmin.value = loggedInUser.id;
    optAdmin.textContent = `${loggedInUser.name} (Admin Account)`;
    select.appendChild(optAdmin);
    
    clients.forEach(client => {
      if (client.id === loggedInUser.id) return;
      const opt = document.createElement('option');
      opt.value = client.id;
      opt.textContent = client.name;
      select.appendChild(opt);
    });
    
    // Select the currently managed client if any, otherwise default to admin
    if (window.currentManagedClientId) {
      select.value = window.currentManagedClientId;
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
        if (headerWalletBalance && loggedInUser.role === 'client') {
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
      // Render remaining minutes (admin-view billing card for selected client)
      const balanceEl = document.getElementById('billing-wallet-balance');
      if (balanceEl) {
        const remMins = data.balance !== undefined ? (data.balance >= 99999 ? '∞' : Math.max(0, data.balance).toFixed(1)) : '0.0';
        balanceEl.textContent = `${remMins} Mins`;
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
      window.currentManagedClientName = select.options[select.selectedIndex].text;
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

// Bind logout action
document.getElementById('btn-logout')?.addEventListener('click', logout);

// --- Platform Subscription Plans Management (Admin & Client) ---
async function fetchPlans() {
  try {
    const res = await fetch('/api/plans');
    const data = await res.json();
    if (data.success && data.plans) {
      window.activePlans = data.plans;
    }
  } catch (err) {
    console.error('Failed to fetch plans:', err);
  }
}

window.fetchAdminPlans = async function() {
  try {
    const res = await fetch('/api/plans');
    const data = await res.json();
    if (data.success && data.plans) {
      window.activePlans = data.plans;
      
      const tbody = document.getElementById('admin-plans-table-body');
      if (tbody) {
        tbody.innerHTML = '';
        if (data.plans.length === 0) {
          tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 20px;">No plans configured.</td></tr>`;
          return;
        }
        data.plans.forEach(p => {
          const row = document.createElement('tr');
          
          const crmBadge = p.crm_integration 
            ? `<span style="color: var(--color-green); font-weight: bold;">✓ Enabled</span>` 
            : `<span style="color: var(--text-muted); font-size: 0.85rem;">🔒 Locked</span>`;
            
          const apiBadge = p.api_sharing 
            ? `<span style="color: var(--color-green); font-weight: bold;">✓ Enabled</span>` 
            : `<span style="color: var(--text-muted); font-size: 0.85rem;">🔒 Locked</span>`;
            
          const priceStr = `₹${Number(p.price_per_month).toLocaleString('en-IN')}`;
          const minsStr = p.max_minutes >= 99999 ? 'Unlimited' : `${p.max_minutes} mins`;
          const agentsStr = p.max_agents >= 99999 ? 'Unlimited' : p.max_agents;
          const rateStr = `₹${p.rate_per_minute}/min`;
          
          const deleteBtn = p.id === 'basic' 
            ? `<button disabled class="admin-action-btn admin-action-btn-delete" style="opacity: 0.5; cursor: not-allowed;">Delete</button>` 
            : `<button onclick="window.deletePlan('${p.id}')" class="admin-action-btn admin-action-btn-delete">Delete</button>`;
            
          row.innerHTML = `
            <td style="font-weight: 600; color: var(--text-main);">${escapeHtml(p.name)}</td>
            <td style="font-family: monospace; font-size: 0.82rem; color: var(--color-cyan);">${escapeHtml(p.id)}</td>
            <td style="font-weight: 500;">${priceStr}</td>
            <td>${minsStr}</td>
            <td>${agentsStr}</td>
            <td>${rateStr}</td>
            <td>${crmBadge}</td>
            <td>${apiBadge}</td>
            <td style="text-align: right; white-space: nowrap;">
              <button onclick="window.openEditPlanModal('${p.id}')" class="admin-action-btn" style="margin-right: 6px;">Edit</button>
              ${deleteBtn}
            </td>
          `;
          tbody.appendChild(row);
        });
      }
    }
  } catch (err) {
    console.error('Failed to fetch admin plans:', err);
  }
};

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

  try {
    const res = await fetch('/api/admin/plans/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, name, price_per_month, max_minutes, max_agents, rate_per_minute, crm_integration, api_sharing, description
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

  document.getElementById('input-logo-left').value = defaults['logo-left'];
  document.getElementById('input-logo-gap').value = defaults['logo-gap'];
  document.getElementById('input-tab-gap').value = defaults['tab-gap'];
  document.getElementById('input-actions-gap').value = defaults['actions-gap'];
  document.getElementById('input-navbar-right').value = defaults['navbar-right'];

  document.getElementById('check-actions-auto').checked = true;
  document.getElementById('input-actions-gap').disabled = true;

  document.documentElement.style.setProperty('--nav-padding-left', defaults['logo-left'] + 'px');
  document.documentElement.style.setProperty('--nav-logo-gap', defaults['logo-gap'] + 'px');
  document.documentElement.style.setProperty('--nav-tab-gap', defaults['tab-gap'] + 'px');
  document.documentElement.style.setProperty('--nav-actions-gap', 'auto');
  document.documentElement.style.setProperty('--nav-padding-right', defaults['navbar-right'] + 'px');

  document.getElementById('val-logo-left').textContent = defaults['logo-left'] + 'px';
  document.getElementById('val-logo-gap').textContent = defaults['logo-gap'] + 'px';
  document.getElementById('val-tab-gap').textContent = defaults['tab-gap'] + 'px';
  document.getElementById('val-actions-gap').textContent = 'Auto';
  document.getElementById('val-navbar-right').textContent = defaults['navbar-right'] + 'px';
  
  saveSpacingToLocalStorage();
};

function saveSpacingToLocalStorage() {
  const logoLeftEl = document.getElementById('input-logo-left');
  if (!logoLeftEl) return;
  const settings = {
    logoLeft: logoLeftEl.value,
    logoGap: document.getElementById('input-logo-gap').value,
    tabGap: document.getElementById('input-tab-gap').value,
    actionsGap: document.getElementById('input-actions-gap').value,
    actionsAuto: document.getElementById('check-actions-auto').checked,
    navbarRight: document.getElementById('input-navbar-right').value
  };
  localStorage.setItem('navbar_spacing_settings', JSON.stringify(settings));
}

function loadSpacingFromLocalStorage() {
  const saved = localStorage.getItem('navbar_spacing_settings');
  if (saved) {
    try {
      const settings = JSON.parse(saved);
      const logoLeftEl = document.getElementById('input-logo-left');
      if (!logoLeftEl) return;

      logoLeftEl.value = settings.logoLeft;
      document.getElementById('input-logo-gap').value = settings.logoGap;
      document.getElementById('input-tab-gap').value = settings.tabGap;
      document.getElementById('input-actions-gap').value = settings.actionsGap;
      document.getElementById('check-actions-auto').checked = settings.actionsAuto;
      document.getElementById('input-navbar-right').value = settings.navbarRight;

      document.getElementById('input-actions-gap').disabled = settings.actionsAuto;

      document.documentElement.style.setProperty('--nav-padding-left', settings.logoLeft + 'px');
      document.documentElement.style.setProperty('--nav-logo-gap', settings.logoGap + 'px');
      document.documentElement.style.setProperty('--nav-tab-gap', settings.tabGap + 'px');
      document.documentElement.style.setProperty('--nav-actions-gap', settings.actionsAuto ? 'auto' : settings.actionsGap + 'px');
      document.documentElement.style.setProperty('--nav-padding-right', settings.navbarRight + 'px');

      document.getElementById('val-logo-left').textContent = settings.logoLeft + 'px';
      document.getElementById('val-logo-gap').textContent = settings.logoGap + 'px';
      document.getElementById('val-tab-gap').textContent = settings.tabGap + 'px';
      document.getElementById('val-actions-gap').textContent = settings.actionsAuto ? 'Auto' : settings.actionsGap + 'px';
      document.getElementById('val-navbar-right').textContent = settings.navbarRight + 'px';
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
  document.title = branding.appName + ' - Live AI Voice Agent';

  // 2. Favicon
  let favicon = document.querySelector("link[rel~='icon']");
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    document.head.appendChild(favicon);
  }
  favicon.href = branding.faviconUrl;

  // 3. Dynamic CSS variables
  let styleTag = document.getElementById('dynamic-branding-colors');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'dynamic-branding-colors';
    document.head.appendChild(styleTag);
  }
  styleTag.innerHTML = `
    :root {
      --color-primary: ${branding.primaryColor} !important;
      --color-secondary: ${branding.secondaryColor} !important;
      --grad-coral: linear-gradient(135deg, ${branding.primaryColor}, ${branding.secondaryColor}) !important;
    }
  `;

  // 4. Update logos
  document.querySelectorAll('.brand-logo').forEach(img => {
    img.src = branding.logoUrl;
    img.alt = branding.appName;
  });

  // 5. Update app names
  document.querySelectorAll('.brand-name').forEach(el => {
    el.textContent = branding.appName;
  });

  // 6. Update copyright footers
  document.querySelectorAll('.brand-copyright').forEach(el => {
    el.textContent = branding.copyrightText;
  });
};

window.handleBrandingFileUpload = function(inputEl, targetInputId) {
  const file = inputEl.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const base64Data = e.target.result.split(',')[1];
    
    // Show uploading status
    const targetInput = document.getElementById(targetInputId);
    targetInput.value = 'Uploading...';
    targetInput.disabled = true;

    try {
      const res = await fetch('/api/upload-branding-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileData: base64Data
        })
      });
      const data = await res.json();
      if (data.success) {
        targetInput.value = data.url;
        // Trigger live change event to notify picker or preview
        targetInput.dispatchEvent(new Event('change'));
      } else {
        alert('Upload failed: ' + data.error);
        targetInput.value = '';
      }
    } catch (err) {
      console.error('Error uploading file:', err);
      alert('Network error during file upload.');
      targetInput.value = '';
    } finally {
      targetInput.disabled = false;
    }
  };
  reader.readAsDataURL(file);
};

window.saveBrandingSettings = async function(event) {
  event.preventDefault();
  
  let id = document.getElementById('branding-tenant-id').value.trim();
  if (!id) id = 'default';
  const appName = document.getElementById('branding-app-name').value.trim();
  const customDomain = document.getElementById('branding-custom-domain').value.trim();
  const subdomain = document.getElementById('branding-subdomain').value.trim();
  const logoUrl = document.getElementById('branding-logo-url').value.trim();
  const faviconUrl = document.getElementById('branding-favicon-url').value.trim();
  const primaryColor = document.getElementById('branding-primary-color').value.trim();
  const secondaryColor = document.getElementById('branding-secondary-color').value.trim();
  const supportEmail = document.getElementById('branding-support-email').value.trim();
  const supportPhone = document.getElementById('branding-support-phone').value.trim();
  const copyrightText = document.getElementById('branding-copyright').value.trim();

  try {
    const res = await fetch('/api/admin/branding', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Tenant-Id': window.BrandingContext ? window.BrandingContext.id : ''
      },
      body: JSON.stringify({
        id, customDomain, subdomain, appName, logoUrl, faviconUrl, primaryColor, secondaryColor, supportEmail, supportPhone, copyrightText
      })
    });
    const data = await res.json();
    if (data.success) {
      alert('Branding & White Labeling settings saved successfully!');
      window.BrandingContext = data.branding;
      window.applyBranding(data.branding);
    } else {
      alert('Failed to save branding: ' + data.error);
    }
  } catch (err) {
    console.error('Error saving branding:', err);
    alert('Communication error saving branding.');
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
  
  const modal = document.getElementById('today-calls-modal');
  const dateEl = document.getElementById('today-modal-date');
  const listEl = document.getElementById('today-modal-calls-list');
  
  if (!modal || !listEl) return;
  
  if (dateEl) {
    dateEl.innerText = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  
  const today = new Date().toDateString();
  const calls = window.lastDashboardCalls || [];
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
      card.style.border = '1px solid rgba(255, 255, 255, 0.06)';
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
      
      let verdictHtml = '';
      if (c.summary) {
        const isInterested = c.summary.toLowerCase().includes('interested') && !c.summary.toLowerCase().includes('not interested');
        const verdictText = isInterested ? 'Interested Lead' : 'No Interest / Unreachable';
        const verdictColor = isInterested ? 'var(--color-green)' : 'var(--color-red)';
        const verdictBg = isInterested ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)';
        const verdictBorder = isInterested ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
        
        verdictHtml = `
          <div style="margin-top: 12px; padding: 10px; background: ${verdictBg}; border: 1px solid ${verdictBorder}; border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 0.8rem; color: ${verdictColor}; margin-bottom: 4px;">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: ${verdictColor};"></span>
              ${verdictText}
            </div>
            <p style="margin: 0; font-size: 0.8rem; color: #ddd; line-height: 1.4;">${escapeHtml(c.summary)}</p>
          </div>
        `;
      } else {
        verdictHtml = `
          <div style="margin-top: 12px; padding: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; font-size: 0.8rem; color: var(--text-muted); text-align: center;">
            No AI analysis available for this call.
          </div>
        `;
      }
      
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
  
  modal.style.display = 'flex';
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

window.initiateUserRecharge = function() {
  const amountInput = document.getElementById('user-recharge-amount');
  const methodSelect = document.getElementById('user-payment-method');
  if (!amountInput || !methodSelect) return;

  const amount = Number(amountInput.value);
  if (isNaN(amount) || amount <= 0) {
    alert("Please enter a valid recharge amount.");
    return;
  }

  const method = methodSelect.value;

  // Show simulated checkout modal
  const modal = document.getElementById('payment-simulation-modal');
  const loadingState = document.getElementById('payment-loading-state');
  const successState = document.getElementById('payment-success-state');
  const successMsg = document.getElementById('payment-success-msg');
  const summaryEl = document.getElementById('payment-order-summary');

  if (modal && loadingState && successState && successMsg) {
    if (summaryEl) {
      const plan = loggedInUser.plan || 'basic';
      const planInfo = (window.activePlans || []).find(p => p.id.toLowerCase() === plan.toLowerCase());
      const rate = planInfo ? planInfo.rate_per_minute : (plan.toLowerCase() === 'pro' ? 4.24 : 5.00);
      const cost = amount * rate;
      summaryEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.85rem;"><span>Plan:</span><strong style="text-transform: capitalize; color: var(--text-main);">${plan}</strong></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.85rem;"><span>Minutes to Buy:</span><strong style="color: var(--text-main);">${amount} Mins</strong></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.85rem;"><span>Rate/Min:</span><strong style="color: var(--text-main);">₹${rate.toFixed(2)}/min</strong></div>
        <div style="display:flex; justify-content:space-between; border-top:1px dashed var(--border-color); padding-top:6px; margin-top:6px; font-weight:bold; color:var(--color-cyan); font-size:0.9rem;"><span>Total Amount:</span><strong>₹${cost.toFixed(2)}</strong></div>
      `;
    }

    loadingState.style.display = 'flex';
    successState.style.display = 'none';
    modal.style.display = 'flex';

    // Simulate processing delay (1.5 seconds)
    setTimeout(async () => {
      try {
        const res = await fetch('/api/client/recharge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: loggedInUser.id,
            amount: amount,
            paymentMethod: method
          })
        });
        const data = await res.json();
        if (data.success) {
          // Update local session balance if applicable
          loggedInUser.balance = data.balance;
          localStorage.setItem('user_session', JSON.stringify(loggedInUser));

          // Reload header indicator with updated minutes
          const headerWalletBalance = document.getElementById('header-wallet-balance');
          if (headerWalletBalance) {
            const remMins = loggedInUser.balance !== undefined ? (loggedInUser.balance >= 99999 ? '∞' : Math.max(0, loggedInUser.balance).toFixed(1)) : '0.0';
            headerWalletBalance.textContent = `${remMins}`;
          }

          // Reload billing/recharge page data
          fetchBillingData();

          // Show success state
          loadingState.style.display = 'none';
          successState.style.display = 'flex';
          successMsg.innerHTML = `Successfully added <strong>${amount} Mins</strong> to your wallet balance using ${method}.`;
          
          // Clear input field
          amountInput.value = '';
        } else {
          alert(`Recharge failed: ${data.error}`);
          modal.style.display = 'none';
        }
      } catch (err) {
        console.error(err);
        alert("Payment simulation failed.");
        modal.style.display = 'none';
      }
    }, 1500);
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
  
  if (planName === 'custom') {
    alert("Please contact our sales team at sales@callingagent.com or call +91 8047492101 to set up a custom plan tailored to your requirements.");
    return;
  }
  
  const confirmMsg = `Are you sure you want to subscribe to the ${planName.toUpperCase()} Plan (₹${price}/month)?\nThis will simulate a secure payment checkout.`;
  if (!confirm(confirmMsg)) return;
  
  // Show simulated checkout loader/modal
  const paymentMethod = prompt("Simulating secure payment. Choose payment method (UPI, Card, NetBanking):", "UPI");
  if (paymentMethod === null) return; // cancelled
  
  // Get simulated payment modal elements
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
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            clientId: loggedInUser.id,
            plan: planName,
            amount: price,
            paymentMethod: paymentMethod || 'UPI'
          })
        });
        
        const data = await res.json();
        if (data.success) {
          // Update loggedInUser local session
          loggedInUser = { ...loggedInUser, plan: data.plan, balance: data.balance, billing_history: data.billing_history };
          localStorage.setItem('user_session', JSON.stringify(loggedInUser));
          
          // Re-apply role and limits
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
        console.error('Subscription error:', err);
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

