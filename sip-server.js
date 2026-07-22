/**
 * Custom SIP Server — Bridges SIP/RTP calls to Gemini Live API
 * 
 * Flow: Zoiper (SIP softphone) → SIP Signaling → RTP Audio → Gemini Live WebSocket
 * 
 * Usage: node sip-server.js
 */

import sip from 'sip';
import dgram from 'dgram';
import { WebSocket } from 'ws';
import dotenv from 'dotenv';
import { twilioToGemini, geminiToTwilio, pcm8ToPcm16, pcm24ToPcm8, pcm24ToPcm16 } from './audio-helper.js';

dotenv.config();

// ==========================================
// CONFIGURATION
// ==========================================
const SIP_PORT = 5060;
const SIP_HOST = '0.0.0.0';
const RTP_PORT_START = 20000; // RTP ports will be assigned from this range
const SERVER_IP = '192.168.1.17'; // Your PC's local IP (auto-detected via ipconfig)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// SIP Account credentials (Zoiper will use these to register)
const SIP_USERS = {
  '1001': { password: 'secret1001', name: 'Agent 1' },
  '1002': { password: 'secret1002', name: 'Agent 2' },
};

// Default Gemini config (can be overridden)
const DEFAULT_VOICE = 'Aoede';
const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';
const DEFAULT_INSTRUCTION = `You are a helpful, friendly voice assistant. 
Speak naturally and concisely. Converse in Hinglish or English depending on how the user speaks.
[CRITICAL]: If the user says goodbye or wants to hang up, say a polite goodbye and then stop responding.
[VOICEMAIL]: If you hear a voicemail greeting, stop immediately without saying anything.`;

// ==========================================
// STATE MANAGEMENT
// ==========================================
const activeSessions = new Map(); // callId → session state
let rtpPortCounter = RTP_PORT_START;

function getNextRtpPort() {
  const port = rtpPortCounter;
  rtpPortCounter += 2; // RTP uses even ports, RTCP uses odd
  if (rtpPortCounter > 21000) rtpPortCounter = RTP_PORT_START; // wrap around
  return port;
}

// ==========================================
// SIP HELPER FUNCTIONS
// ==========================================

/**
 * Parse SDP body to extract remote RTP IP and port
 */
function parseSDP(sdpBody) {
  if (!sdpBody) return null;
  const lines = sdpBody.split(/\r?\n/);
  let ip = null;
  let port = null;
  let codec = null; // 0 = PCMU (G.711 µ-law), 8 = PCMA (G.711 A-law)

  for (const line of lines) {
    if (line.startsWith('c=IN IP4 ')) {
      ip = line.replace('c=IN IP4 ', '').trim();
    }
    if (line.startsWith('m=audio ')) {
      const parts = line.split(' ');
      port = parseInt(parts[1], 10);
      // Extract codec from payload types
      if (parts.length > 3) {
        const payloads = parts.slice(3);
        if (payloads.includes('0')) codec = 0;       // PCMU
        else if (payloads.includes('8')) codec = 8;  // PCMA
        else codec = parseInt(payloads[0], 10);
      }
    }
  }
  return { ip, port, codec };
}

/**
 * Build SDP answer for our local RTP listener
 */
function buildSDP(localIp, localRtpPort) {
  return [
    'v=0',
    `o=GeminiSIPServer 0 0 IN IP4 ${localIp}`,
    's=Gemini Live Call',
    `c=IN IP4 ${localIp}`,
    't=0 0',
    `m=audio ${localRtpPort} RTP/AVP 0`,  // 0 = PCMU G.711 µ-law
    'a=rtpmap:0 PCMU/8000',
    'a=sendrecv',
    ''
  ].join('\r\n');
}

/**
 * Validate SIP user credentials
 */
function validateCredentials(username, password) {
  const user = SIP_USERS[username];
  if (!user) return false;
  return user.password === password;
}

/**
 * Extract username from SIP URI like "sip:1001@192.168.1.17"
 */
function extractUsername(uri) {
  if (!uri) return null;
  const match = uri.match(/sip:([^@]+)@/);
  return match ? match[1] : null;
}

// ==========================================
// GEMINI LIVE INTEGRATION
// ==========================================

function connectToGemini(session) {
  const { voice, systemInstruction, model, callId } = session;

  const resolvedModel = (model === 'gemini-2.5-flash') 
    ? 'gemini-3.1-flash-live-preview' 
    : (model || DEFAULT_MODEL);

  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

  console.log(`[Gemini] Connecting for call: ${callId}, Voice: ${voice}, Model: ${resolvedModel}`);

  let geminiWs;
  try {
    geminiWs = new WebSocket(geminiUrl);
  } catch (err) {
    console.error(`[Gemini] Failed to create WebSocket:`, err.message);
    return null;
  }

  session.geminiWs = geminiWs;
  session.isGeminiReady = false;
  session.audioQueue = [];

  geminiWs.on('open', () => {
    console.log(`[Gemini] Connected. Sending setup for call: ${callId}`);

    const setupMessage = {
      setup: {
        model: resolvedModel.startsWith('models/') ? resolvedModel : `models/${resolvedModel}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice || DEFAULT_VOICE }
            }
          }
        },
        systemInstruction: {
          parts: [{ text: systemInstruction || DEFAULT_INSTRUCTION }]
        },
        tools: [{
          functionDeclarations: [{
            name: 'hangupCall',
            description: 'Ends and terminates the current phone call. Call when user says goodbye or wants to hang up.',
            parameters: {
              type: 'OBJECT',
              properties: {
                reason: { type: 'STRING', description: 'Reason for hanging up' }
              },
              required: ['reason']
            }
          }]
        }]
      }
    };

    geminiWs.send(JSON.stringify(setupMessage));
  });

  geminiWs.on('message', async (data) => {
    try {
      const text = data instanceof Buffer ? data.toString('utf-8') : data;
      const response = JSON.parse(text);

      // Gemini is ready to receive audio
      if (response.setupComplete) {
        console.log(`[Gemini] Setup complete for call: ${callId}. Starting audio bridge.`);
        session.isGeminiReady = true;

        // Flush any queued audio
        while (session.audioQueue.length > 0) {
          const queued = session.audioQueue.shift();
          if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(JSON.stringify(queued));
          }
        }
        return;
      }

      // Tool call — hangupCall
      const toolCall = response.toolCall?.functionCalls?.[0];
      if (toolCall && toolCall.name === 'hangupCall') {
        console.log(`[Gemini] hangupCall tool triggered for call: ${callId}. Reason: ${toolCall.args?.reason}`);
        terminateSession(callId, 'gemini_hangup');
        return;
      }

      // Transcription logging
      if (response.serverContent?.inputTranscription?.text) {
        const userText = response.serverContent.inputTranscription.text.trim();
        if (userText) {
          console.log(`[Call ${callId}] 🗣️  User: ${userText}`);
          if (session.transcript) session.transcript.push({ role: 'user', text: userText });
        }
      }

      if (response.serverContent?.outputTranscription?.text) {
        const agentText = response.serverContent.outputTranscription.text.trim();
        if (agentText) {
          console.log(`[Call ${callId}] 🤖 Agent: ${agentText}`);
          if (session.transcript) session.transcript.push({ role: 'agent', text: agentText });
        }
      }

      // Audio from Gemini → send to caller via RTP
      const parts = response.serverContent?.modelTurn?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.inlineData?.mimeType?.startsWith('audio/') && part.inlineData?.data) {
            const pcm24Buffer = Buffer.from(part.inlineData.data, 'base64');
            
            // Gemini outputs 24kHz PCM → downsample to 8kHz → encode to G.711 µ-law
            const mulawBuffer = geminiToTwilio(pcm24Buffer);
            
            // Send via RTP
            sendRTP(session, mulawBuffer);
          }
        }
      }

    } catch (err) {
      console.error(`[Gemini] Message parse error:`, err.message);
    }
  });

  geminiWs.on('close', (code, reason) => {
    console.log(`[Gemini] WebSocket closed for call: ${callId}. Code: ${code}`);
    terminateSession(callId, 'gemini_closed');
  });

  geminiWs.on('error', (err) => {
    console.error(`[Gemini] WebSocket error for call: ${callId}:`, err.message);
  });

  return geminiWs;
}

/**
 * Send audio buffer to Gemini as realtimeInput
 */
function sendAudioToGemini(session, pcm16Buffer) {
  const audioMessage = {
    realtimeInput: {
      audio: {
        mimeType: 'audio/pcm;rate=16000',
        data: pcm16Buffer.toString('base64')
      }
    }
  };

  if (session.isGeminiReady && session.geminiWs?.readyState === WebSocket.OPEN) {
    session.geminiWs.send(JSON.stringify(audioMessage));
  } else if (!session.isGeminiReady) {
    // Queue until ready
    session.audioQueue = session.audioQueue || [];
    if (session.audioQueue.length < 50) { // Max 50 queued messages
      session.audioQueue.push(audioMessage);
    }
  }
}

// ==========================================
// RTP HANDLING
// ==========================================

// RTP packet header structure:
// Byte 0: V(2) P(1) X(1) CC(4)
// Byte 1: M(1) PT(7)
// Bytes 2-3: Sequence number
// Bytes 4-7: Timestamp
// Bytes 8-11: SSRC
// Bytes 12+: Payload

const RTP_HEADER_SIZE = 12;
let rtpSequence = Math.floor(Math.random() * 65535);
let rtpTimestamp = Math.floor(Math.random() * 0xFFFFFFFF);
const RTP_SSRC = Math.floor(Math.random() * 0xFFFFFFFF);

/**
 * Parse incoming RTP packet and extract audio payload
 */
function parseRTPPayload(buffer) {
  if (buffer.length < RTP_HEADER_SIZE) return null;
  
  const version = (buffer[0] >> 6) & 0x03;
  if (version !== 2) return null; // Not RTP v2
  
  const hasExtension = (buffer[0] >> 4) & 0x01;
  const csrcCount = buffer[0] & 0x0F;
  const payloadType = buffer[1] & 0x7F;
  
  let headerSize = RTP_HEADER_SIZE + (csrcCount * 4);
  
  // Skip extension header if present
  if (hasExtension) {
    const extOffset = headerSize;
    if (buffer.length > extOffset + 3) {
      const extLength = buffer.readUInt16BE(extOffset + 2);
      headerSize += 4 + (extLength * 4);
    }
  }
  
  const payload = buffer.slice(headerSize);
  return { payloadType, payload };
}

/**
 * Build an RTP packet with given payload
 */
function buildRTPPacket(payload) {
  const packet = Buffer.alloc(RTP_HEADER_SIZE + payload.length);
  
  // V=2, P=0, X=0, CC=0
  packet[0] = 0x80;
  // M=0, PT=0 (PCMU G.711)
  packet[1] = 0x00;
  // Sequence number — mask to 16-bit unsigned
  packet.writeUInt16BE((rtpSequence++) & 0xFFFF, 2);
  // Timestamp — >>> 0 ensures unsigned 32-bit (prevents negative overflow)
  packet.writeUInt32BE(rtpTimestamp >>> 0, 4);
  rtpTimestamp = (rtpTimestamp + payload.length) >>> 0; // Stay unsigned always
  // SSRC
  packet.writeUInt32BE(RTP_SSRC >>> 0, 8);
  // Payload
  payload.copy(packet, RTP_HEADER_SIZE);
  
  return packet;
}

/**
 * Send audio buffer via RTP to the caller's phone
 */
function sendRTP(session, mulawBuffer) {
  if (!session.rtpSocket || !session.remoteRtpIp || !session.remoteRtpPort) return;
  
  // Split into 160-byte chunks (20ms of G.711 @ 8kHz)
  const chunkSize = 160;
  for (let i = 0; i < mulawBuffer.length; i += chunkSize) {
    const chunk = mulawBuffer.slice(i, Math.min(i + chunkSize, mulawBuffer.length));
    const rtpPacket = buildRTPPacket(chunk);
    session.rtpSocket.send(rtpPacket, session.remoteRtpPort, session.remoteRtpIp, (err) => {
      if (err && !err.message?.includes('closed')) {
        console.error(`[RTP] Send error:`, err.message);
      }
    });
  }
}

/**
 * Create a UDP socket to receive RTP audio from caller
 */
function createRTPSocket(session, localPort) {
  const socket = dgram.createSocket('udp4');
  
  socket.on('message', (msg, rinfo) => {
    // Update remote RTP info from first packet (handles NAT)
    if (!session.remoteRtpIp) {
      session.remoteRtpIp = rinfo.address;
      session.remoteRtpPort = rinfo.port;
      console.log(`[RTP] ✅ First audio packet from ${rinfo.address}:${rinfo.port} for call: ${session.callId}`);
      console.log(`[RTP] Audio bridge is LIVE! Zoiper ↔ Gemini streaming started.`);
    }
    
    const parsed = parseRTPPayload(msg);
    if (!parsed || parsed.payload.length === 0) return;
    
    // Payload type 0 = PCMU (G.711 µ-law) — same as Twilio!
    // Convert µ-law 8kHz → PCM 16kHz for Gemini
    const pcm16Buffer = twilioToGemini(parsed.payload);
    sendAudioToGemini(session, pcm16Buffer);
  });
  
  socket.on('error', (err) => {
    console.error(`[RTP Socket] Error on port ${localPort}:`, err.message);
  });
  
  socket.bind(localPort, '0.0.0.0', () => {
    console.log(`[RTP] Listening on port ${localPort} for call: ${session.callId}`);
  });
  
  return socket;
}

// ==========================================
// SESSION MANAGEMENT
// ==========================================

function terminateSession(callId, reason = 'normal') {
  const session = activeSessions.get(callId);
  if (!session) return;
  
  console.log(`[Session] Terminating call: ${callId}, Reason: ${reason}`);
  
  // Close Gemini WebSocket
  if (session.geminiWs && session.geminiWs.readyState === WebSocket.OPEN) {
    session.geminiWs.close();
  }
  
  // Close RTP socket
  if (session.rtpSocket) {
    try { session.rtpSocket.close(); } catch(e) {}
  }
  
  // Send SIP BYE if still connected and we initiated the termination
  if (reason === 'gemini_hangup' && session.dialog) {
    try {
      sip.send({
        method: 'BYE',
        uri: session.dialog.remoteUri,
        headers: {
          to: session.dialog.to,
          from: session.dialog.from,
          'call-id': session.dialog.callId,
          cseq: { method: 'BYE', seq: session.dialog.localSeq++ },
          'max-forwards': 70,
          via: []
        }
      });
      console.log(`[SIP] BYE sent for call: ${callId}`);
    } catch(e) {
      console.error(`[SIP] BYE send error:`, e.message);
    }
  }
  
  // Print transcript summary
  if (session.transcript && session.transcript.length > 0) {
    console.log(`\n[Call ${callId}] === CONVERSATION TRANSCRIPT ===`);
    session.transcript.forEach(t => {
      console.log(`  ${t.role === 'user' ? '🗣️  User' : '🤖 Agent'}: ${t.text}`);
    });
    console.log(`[Call ${callId}] === END OF TRANSCRIPT ===\n`);
  }
  
  activeSessions.delete(callId);
}

// ==========================================
// SIP SERVER
// ==========================================

console.log('🚀 Starting Custom SIP Server...');
console.log(`📡 SIP Port: ${SIP_PORT}`);
console.log(`🌐 Server IP: ${SERVER_IP}`);
console.log(`🔑 Gemini API Key: ${GEMINI_API_KEY ? '✅ Loaded' : '❌ MISSING!'}`);
console.log('');
console.log('📱 Zoiper Configuration:');
console.log(`   Username: 1001`);
console.log(`   Password: secret1001`);
console.log(`   Domain/Server: ${SERVER_IP}`);
console.log(`   Port: ${SIP_PORT}`);
console.log(`   Transport: UDP`);
console.log('');

sip.start(
  {
    port: SIP_PORT,
    host: SIP_HOST,
    hostname: SERVER_IP,
    logger: {
      recv: (msg) => {},  // Suppress raw SIP log (too verbose)
      send: (msg) => {}
    }
  },
  async (request) => {
    // ==========================================
    // HANDLE SIP REGISTER (Zoiper login)
    // ==========================================
    if (request.method === 'REGISTER') {
      const username = extractUsername(request.headers.to?.uri || '');
      const authorization = request.headers.authorization;

      console.log(`[SIP] REGISTER from: ${username}`);

      // Simple auth: if credentials header present, validate
      if (authorization && authorization.params) {
        const authUsername = authorization.params.username;
        const user = SIP_USERS[authUsername];
        
        if (user) {
          // Accept registration (simplified — no full digest auth for local testing)
          sip.send(sip.makeResponse(request, 200, 'OK', {
            'contact': request.headers.contact,
            'expires': '3600'
          }));
          console.log(`[SIP] ✅ Registered: ${authUsername}`);
        } else {
          sip.send(sip.makeResponse(request, 403, 'Forbidden'));
        }
      } else {
        // First REGISTER — send 200 OK for local testing (no auth challenge)
        sip.send(sip.makeResponse(request, 200, 'OK', {
          'contact': request.headers.contact,
          'expires': '3600'
        }));
        console.log(`[SIP] ✅ Registered (no auth): ${username}`);
      }
      return;
    }

    // ==========================================
    // HANDLE SIP INVITE (Incoming call from Zoiper)
    // ==========================================
    if (request.method === 'INVITE') {
      const callId = request.headers['call-id'];
      const from = request.headers.from;
      const to = request.headers.to;
      const callerUri = from?.uri || 'unknown';
      const callerName = from?.params?.['display-name'] || extractUsername(callerUri) || 'Unknown';

      console.log(`\n[SIP] 📞 INVITE from: ${callerName} (${callerUri}), Call-ID: ${callId}`);

      // Send 100 Trying immediately
      sip.send(sip.makeResponse(request, 100, 'Trying'));

      // Parse caller's SDP to get their RTP details
      const remoteSDP = parseSDP(request.content);
      console.log(`[SIP] Remote RTP: ${remoteSDP?.ip}:${remoteSDP?.port}, Codec: ${remoteSDP?.codec}`);

      // Allocate local RTP port
      const localRtpPort = getNextRtpPort();

      // Create session state
      const session = {
        callId,
        callerName,
        callerUri,
        remoteRtpIp: remoteSDP?.ip || null,
        remoteRtpPort: remoteSDP?.port || null,
        localRtpPort,
        rtpSocket: null,
        geminiWs: null,
        isGeminiReady: false,
        audioQueue: [],
        voice: DEFAULT_VOICE,
        model: DEFAULT_MODEL,
        systemInstruction: DEFAULT_INSTRUCTION,
        transcript: [],
        dialog: {
          callId,
          from,
          to,
          remoteUri: callerUri,
          localSeq: 1
        }
      };

      activeSessions.set(callId, session);

      // Create RTP socket to receive audio from Zoiper
      session.rtpSocket = createRTPSocket(session, localRtpPort);

      // Send 180 Ringing
      sip.send(sip.makeResponse(request, 180, 'Ringing'));
      console.log(`[SIP] 📳 Ringing sent for call: ${callId}`);

      // Small delay to simulate ring
      await new Promise(resolve => setTimeout(resolve, 500));

      // Build our SDP answer
      const localSDP = buildSDP(SERVER_IP, localRtpPort);

      // Send 200 OK with SDP — must include Contact + To tag for dialog
      const response200 = sip.makeResponse(request, 200, 'OK');
      
      // Add Contact header (required for INVITE 200 OK)
      response200.headers['contact'] = [{ uri: `sip:server@${SERVER_IP}:${SIP_PORT}` }];
      
      // Add To tag (required to establish SIP dialog)
      if (response200.headers.to && !response200.headers.to.params) {
        response200.headers.to.params = {};
      }
      if (response200.headers.to) {
        response200.headers.to.params.tag = Math.random().toString(36).substr(2, 8);
      }
      
      response200.headers['content-type'] = 'application/sdp';
      response200.content = localSDP;
      sip.send(response200);
      console.log(`[SIP] ✅ 200 OK sent with Contact + To tag. Local RTP port: ${localRtpPort}`);

      // Connect to Gemini Live API
      connectToGemini(session);
      
      // After Gemini setup completes, send a greeting prompt so AI speaks first
      setTimeout(() => {
        if (session.isGeminiReady && session.geminiWs?.readyState === WebSocket.OPEN) {
          console.log(`[Gemini] Injecting opening greeting for call: ${callId}`);
          const greetMsg = {
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: 'The call has just connected. Please greet the caller warmly in Hinglish and introduce yourself.' }] }],
              turnComplete: true
            }
          };
          session.geminiWs.send(JSON.stringify(greetMsg));
        }
      }, 3000);

      return;
    }

    // ==========================================
    // HANDLE ACK
    // ==========================================
    if (request.method === 'ACK') {
      const callId = request.headers['call-id'];
      console.log(`[SIP] ACK received for call: ${callId}`);
      // ACK means call is fully established
      const session = activeSessions.get(callId);
      if (session) {
        session.established = true;
        console.log(`[SIP] ✅ Call fully established: ${callId}`);
      }
      return;
    }

    // ==========================================
    // HANDLE BYE (Caller hung up)
    // ==========================================
    if (request.method === 'BYE') {
      const callId = request.headers['call-id'];
      console.log(`[SIP] BYE received for call: ${callId}`);
      
      // Send 200 OK
      sip.send(sip.makeResponse(request, 200, 'OK'));
      
      terminateSession(callId, 'caller_bye');
      return;
    }

    // ==========================================
    // HANDLE CANCEL
    // ==========================================
    if (request.method === 'CANCEL') {
      const callId = request.headers['call-id'];
      console.log(`[SIP] CANCEL received for call: ${callId}`);
      sip.send(sip.makeResponse(request, 200, 'OK'));
      terminateSession(callId, 'cancel');
      return;
    }

    // ==========================================
    // HANDLE OPTIONS (keep-alive ping from Zoiper)
    // ==========================================
    if (request.method === 'OPTIONS') {
      sip.send(sip.makeResponse(request, 200, 'OK'));
      return;
    }

    // Unknown method — return 405
    console.log(`[SIP] Unknown method: ${request.method}`);
    sip.send(sip.makeResponse(request, 405, 'Method Not Allowed'));
  }
);

console.log('✅ SIP Server is running!');
console.log('⏳ Waiting for Zoiper to connect...\n');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  for (const [callId] of activeSessions) {
    terminateSession(callId, 'server_shutdown');
  }
  sip.stop();
  process.exit(0);
});
