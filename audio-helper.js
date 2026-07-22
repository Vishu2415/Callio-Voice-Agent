// Custom high-performance audio transcoding helper
// Handles conversion between Twilio (8kHz 8-bit mu-law) and Gemini Live (16kHz input / 24kHz output PCM 16-bit LE)

// --- Mu-Law decoding table ---
const muLawToLinearTable = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let mu = ~i;
  let sign = (mu & 0x80) ? -1 : 1;
  let exponent = (mu >> 4) & 0x07;
  let mantissa = mu & 0x0F;
  let sample = ((mantissa << 3) + 33) << exponent;
  sample -= 33;
  muLawToLinearTable[i] = sign * sample * 4; // Scale to full 16-bit range
}

// --- Mu-Law encoding table ---
const BIAS = 0x84;
const CLIP = 32635;
function linearToMuLawSample(sample) {
  let sign = (sample < 0) ? 0x80 : 0x00;
  if (sample < 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  
  sample = sample + BIAS;
  let exponent = 7;
  for (let bit = 0x4000; (sample & bit) === 0 && exponent > 0; bit >>= 1) {
    exponent--;
  }
  let mantissa = (sample >> (exponent + 3)) & 0x0F;
  let ulaw = ~(sign | (exponent << 4) | mantissa);
  return ulaw & 0xFF;
}

const linearToMuLawTable = new Uint8Array(65536);
for (let i = -32768; i <= 32767; i++) {
  linearToMuLawTable[i + 32768] = linearToMuLawSample(i);
}

// --- Public Transcoding Functions ---

/**
 * Decodes 8kHz 8-bit Mu-law (Twilio format) to 16-bit linear PCM and resamples to 16kHz.
 * @param {Buffer} mulawBuffer - Inbound Twilio media payload (mu-law bytes)
 * @returns {Buffer} - 16kHz 16-bit PCM Buffer (Gemini Live input format)
 */
export function twilioToGemini(mulawBuffer) {
  const len = mulawBuffer.length;
  const pcm8 = new Int16Array(len);
  
  // 1. Mu-law byte to Int16 PCM
  for (let i = 0; i < len; i++) {
    pcm8[i] = muLawToLinearTable[mulawBuffer[i]];
  }
  
  // 2. Linear resample from 8kHz to 16kHz (1:2 upsampling)
  const pcm16 = new Int16Array(len * 2);
  for (let i = 0; i < len; i++) {
    const current = pcm8[i];
    const next = (i + 1 < len) ? pcm8[i + 1] : current;
    
    pcm16[i * 2] = current;
    pcm16[i * 2 + 1] = Math.round((current + next) / 2);
  }
  
  return Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
}

/**
 * Downsamples 24kHz 16-bit linear PCM (Gemini format) to 8kHz and encodes to 8-bit Mu-law.
 * @param {Buffer} pcm24Buffer - Outbound Gemini audio chunk
 * @returns {Buffer} - 8kHz 8-bit Mu-law Buffer (Twilio format)
 */
export function geminiToTwilio(pcm24Buffer) {
  // Convert Buffer to Int16Array (since it is little endian)
  const pcm24 = new Int16Array(
    pcm24Buffer.buffer,
    pcm24Buffer.byteOffset,
    pcm24Buffer.length / 2
  );
  
  // 1. Downsample 24kHz to 8kHz (3:1 downsampling by averaging)
  const targetLen = Math.floor(pcm24.length / 3);
  const pcm8 = new Int16Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const sum = pcm24[i * 3] + pcm24[i * 3 + 1] + pcm24[i * 3 + 2];
    pcm8[i] = Math.round(sum / 3);
  }
  
  // 2. Encode Int16 PCM to 8-bit Mu-law
  const mulaw = new Uint8Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const sampleVal = pcm8[i];
    mulaw[i] = linearToMuLawTable[sampleVal + 32768];
  }
  
  return Buffer.from(mulaw.buffer, mulaw.byteOffset, mulaw.byteLength);
}

/**
 * Resamples 8kHz 16-bit linear PCM (Exotel format) to 16kHz 16-bit PCM (Gemini Live input format).
 * @param {Buffer} pcm8Buffer - 8kHz 16-bit PCM Buffer
 * @returns {Buffer} - 16kHz 16-bit PCM Buffer
 */
export function pcm8ToPcm16(pcm8Buffer) {
  const pcm8 = new Int16Array(
    pcm8Buffer.buffer,
    pcm8Buffer.byteOffset,
    pcm8Buffer.length / 2
  );
  const len = pcm8.length;
  const pcm16 = new Int16Array(len * 2);
  for (let i = 0; i < len; i++) {
    const current = pcm8[i];
    const next = (i + 1 < len) ? pcm8[i + 1] : current;
    
    pcm16[i * 2] = current;
    pcm16[i * 2 + 1] = Math.round((current + next) / 2);
  }
  return Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
}

/**
 * Downsamples 24kHz 16-bit linear PCM (Gemini format) to 8kHz 16-bit PCM (Exotel format).
 * @param {Buffer} pcm24Buffer - 24kHz 16-bit PCM Buffer
 * @returns {Buffer} - 8kHz 16-bit PCM Buffer
 */
export function pcm24ToPcm8(pcm24Buffer) {
  const pcm24 = new Int16Array(
    pcm24Buffer.buffer,
    pcm24Buffer.byteOffset,
    pcm24Buffer.length / 2
  );
  const targetLen = Math.floor(pcm24.length / 3);
  const pcm8 = new Int16Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const sum = pcm24[i * 3] + pcm24[i * 3 + 1] + pcm24[i * 3 + 2];
    pcm8[i] = Math.round(sum / 3);
  }
  return Buffer.from(pcm8.buffer, pcm8.byteOffset, pcm8.byteLength);
}

/**
 * Downsamples 24kHz 16-bit linear PCM (Gemini format) to 16kHz 16-bit PCM (Vobiz format).
 * @param {Buffer} pcm24Buffer - 24kHz 16-bit PCM Buffer
 * @returns {Buffer} - 16kHz 16-bit PCM Buffer
 */
export function pcm24ToPcm16(pcm24Buffer) {
  const pcm24 = new Int16Array(
    pcm24Buffer.buffer,
    pcm24Buffer.byteOffset,
    pcm24Buffer.length / 2
  );
  // 3 samples at 24kHz map to 2 samples at 16kHz
  const targetLen = Math.floor((pcm24.length / 3) * 2);
  const pcm16 = new Int16Array(targetLen);
  for (let i = 0, j = 0; i < pcm24.length - 2; i += 3, j += 2) {
    pcm16[j] = pcm24[i];
    pcm16[j + 1] = Math.round((pcm24[i + 1] + pcm24[i + 2]) / 2);
  }
  return Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
}

/**
 * Swaps bytes of a 16-bit PCM buffer (converts Big-Endian to Little-Endian or vice-versa).
 * @param {Buffer} buffer - Input PCM buffer
 * @returns {Buffer} - Byte-swapped PCM buffer
 */
export function swapBytes16(buffer) {
  const len = buffer.length;
  const swapped = Buffer.alloc(len);
  for (let i = 0; i < len - 1; i += 2) {
    swapped[i] = buffer[i + 1];
    swapped[i + 1] = buffer[i];
  }
  return swapped;
}


