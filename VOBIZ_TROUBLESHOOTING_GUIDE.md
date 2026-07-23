# Vobiz Integration & Troubleshooting Guide

This guide documents all bugs, root causes, and technical solutions for Vobiz Telephony & Gemini AI Voice Agent integration in `server.js`.

---

## Quick Reference Summary

| Issue / Symptom | Root Cause | Solution / Fix |
| :--- | :--- | :--- |
| **Call disconnects after 3s** | XML response ended without stream keepalive directive | Add `keepCallAlive="true"` attribute in `<Stream>` tag |
| **Number Busy / Call Failed** | Bare `&` in XML URL string caused XML parse failure | Escape `&` as `&amp;` in XML text nodes |
| **Call fails on repeat webhook** | Vobiz sent duplicate answer webhooks causing stream collision | Implement `__xml_sent_<callSid>` dedup guard |
| **Agent silent after greeting** | `mediaFormat` object caused `.toLowerCase()` TypeError in `start` event | Handle `mediaFormat` as Object or String safely |
| **User speech unrecognized** | Defaulted empty format to mu-law instead of PCM 8kHz | Use `pcm8ToPcm16` for Vobiz 8kHz L16 audio |
| **Outbound audio not playing** | Used Twilio's `media` event name instead of Vobiz spec | Use `event: 'playAudio'` with `contentType` & `sampleRate` |
| **Dashboard shows Vobiz number** | Saved `toNum` (Vobiz DID) as card display phone for incoming calls | Set `to: fromNum || toNum` for `direction: 'incoming'` |

---

## Detailed Bug Reports & Resolutions

### 1. Vobiz XML Response Auto-Hangup (3-Second Disconnect)
* **Symptom**: Agent greeted initially ("Hello Vishnu...") and 3 seconds later the call hung up automatically.
* **Root Cause**: In Vobiz XML execution engine, when the XML document ends after `<Stream>`, Vobiz treats XML execution as complete and tears down the call. (Note: Adding `<Wait>` inside `<Response>` is rejected by Vobiz XML parser).
* **Fix**: Use `keepCallAlive="true"` attribute on the `<Stream>` tag:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <Response>
    <Stream bidirectional="true" keepCallAlive="true">wss://callio.in/media-stream?provider=vobiz</Stream>
  </Response>
  ```

---

### 2. Unescaped `&` in XML Stream URL (Number Busy / 400 Error)
* **Symptom**: Incoming call failed immediately with a busy tone or 400 XML validation error.
* **Root Cause**: The WebSocket URL inside the `<Stream>` XML node contained unescaped `&` query parameter separators (`?provider=vobiz&client_id=123&call_sid=abc`). In XML specification, bare `&` is syntactically invalid.
* **Fix**:
  1. Escape `&` as `&amp;` in XML generation:
     ```javascript
     const wsUrl = `wss://${wsHost}/media-stream?provider=vobiz${clientId ? `&amp;client_id=${clientId}` : ''}${callSid ? `&amp;call_sid=${callSid}` : ''}`;
     ```
  2. In WebSocket query string parsing, add fallback for `amp;` prefixed parameters:
     ```javascript
     const clientId = urlObj.searchParams.get('client_id') || urlObj.searchParams.get('amp;client_id');
     const callSid = urlObj.searchParams.get('call_sid') || urlObj.searchParams.get('amp;call_sid');
     ```

---

### 3. Duplicate Webhook Stream Collision
* **Symptom**: Webhook logs showed multiple `[Vobiz Webhook] Received call` lines for the same `CallSid`, followed by immediate `Call Hangup`.
* **Root Cause**: Vobiz network retries sent duplicate answer webhooks. Generating multiple `<Stream>` XML responses for the same call caused stream collision and disconnect.
* **Fix**: Implemented a dedup guard in `/incoming-call-vobiz`:
  ```javascript
  if (callSid && callSettingsMap.has('__xml_sent_' + callSid)) {
    console.log(`[Vobiz Webhook] Duplicate webhook for CallSid: ${callSid}, ignoring.`);
    return res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
  if (callSid) callSettingsMap.set('__xml_sent_' + callSid, true);
  ```

---

### 4. `mediaFormat` TypeError in WebSocket `start` Event
* **Symptom**: Agent spoke greeting, but never responded to caller speech. Logs showed `TypeError: ...toLowerCase is not a function`.
* **Root Cause**: Vobiz sends `mediaFormat` in the `start` WebSocket payload as a JSON object (`{ type: 'audio/x-l16', sampleRate: 8000 }`), NOT a string. Calling `.toLowerCase()` directly on the object crashed the `start` event handler. Because `start` crashed, `initializeGemini()` was never called and `isGeminiReady` remained `false`.
* **Fix**: Safely handle both String and Object types:
  ```javascript
  const rawFmt = msg.start?.mediaFormat || msg.start?.media_format || msg.start?.contentType || '';
  ws.vobizMediaFormat = (typeof rawFmt === 'string' ? rawFmt : (rawFmt?.type || rawFmt?.encoding || rawFmt?.contentType || '')).toLowerCase();
  ```

---

### 5. Inbound Audio Format Transcoding Mismatch
* **Symptom**: Caller audio was received by server but Gemini Voice Activity Detection (VAD) failed to recognize user speech.
* **Root Cause**: Vobiz sends inbound audio as 8kHz 16-bit linear PCM (`audio/x-l16` / format `""`). The server code was defaulting empty format strings to `twilioToGemini` (8kHz mu-law decoder), resulting in garbled PCM data.
* **Fix**: Route Vobiz audio to `pcm8ToPcm16` (resampling 8kHz 16-bit PCM to 16kHz 16-bit PCM for Gemini Live API):
  ```javascript
  const isMulaw = mediaFmt.includes('mulaw') || mediaFmt.includes('pcma') || mediaFmt.includes('ulaw');
  if (isMulaw) {
    pcm16Buffer = twilioToGemini(mediaBuffer);
  } else {
    pcm16Buffer = pcm8ToPcm16(mediaBuffer); // Vobiz default: PCM16 8kHz -> PCM16 16kHz
  }
  ```

---

### 6. Outbound Audio & Interruption Event Names
* **Symptom**: Outbound audio generated by Gemini was not played by Vobiz.
* **Root Cause**: Twilio uses `event: 'media'` and `event: 'clear'`, whereas Vobiz WebSocket API requires `event: 'playAudio'` and `event: 'clearAudio'`.
* **Fix**:
  * **Outbound Audio**:
    ```javascript
    const vobizMessage = {
      event: 'playAudio',
      streamId: streamSid,
      media: {
        contentType: 'audio/x-mulaw',
        sampleRate: 8000,
        payload: base64Mulaw
      }
    };
    ```
  * **Interruption (Barge-in)**:
    ```javascript
    const clearMsg = {
      event: 'clearAudio',
      streamId: streamSid
    };
    ```

---

### 7. Dashboard Card Caller ID Display
* **Symptom**: Incoming call cards on the dashboard displayed `07971442441` (the Vobiz DID) instead of caller's actual number.
* **Root Cause**: In `getOrCreateCallState`, `to` was assigned `toNum` for incoming calls.
* **Fix**: Map `fromNum` (caller's phone number) to `to` for `direction: 'incoming'`:
  ```javascript
  getOrCreateCallState(resolvedSid, {
    provider: 'vobiz',
    to: fromNum || toNum,
    from: fromNum,
    direction: 'incoming',
    ...
  });
  ```

---

## EC2 Deployment & Diagnostics Command

To verify backend logs during active calls on EC2:

```bash
# Pull latest fixes & restart
cd ~/Callio-Voice-Agent && git pull && pm2 restart all

# View live Vobiz stream logs
pm2 logs callio-app | grep -E "Vobiz Start|Vobiz Media|Packet #|Gemini started|Agent:"
```
