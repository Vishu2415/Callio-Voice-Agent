/**
 * fix-orphan-calls.js
 * 
 * One-time migration script:
 * - Matches orphan calls (no clientId) to a client based on destination number
 * - Calls that cannot be matched to any client get assigned clientId='admin'
 * - Stress test / junk calls are removed
 * 
 * Run: node scripts/fix-orphan-calls.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CALLS_DB   = path.join(__dirname, '..', 'calls_db.json');
const CLIENTS_DB = path.join(__dirname, '..', 'clients_db.json');

function normalizePhone(num) {
  if (!num) return '';
  // Remove +, spaces, dashes, parens
  let n = String(num).replace(/[\s\-\+\(\)]/g, '');
  // Strip leading country code 91 for India
  if (n.startsWith('91') && n.length === 12) n = n.slice(2);
  if (n.startsWith('0') && n.length === 11) n = n.slice(1);
  return n;
}

function phonesMatch(a, b) {
  return a && b && normalizePhone(a) === normalizePhone(b);
}

// Load data
const callsRaw   = fs.readFileSync(CALLS_DB, 'utf8');
const clientsRaw = fs.readFileSync(CLIENTS_DB, 'utf8');
const callsObj   = JSON.parse(callsRaw);
const clientsObj = JSON.parse(clientsRaw);

// Build client phone map
const clientPhoneMap = []; // [{clientId, phone}]
for (const [cId, client] of Object.entries(clientsObj)) {
  if (client.phone_number) {
    clientPhoneMap.push({ clientId: cId, phone: client.phone_number });
  }
}
console.log(`Loaded ${Object.keys(callsObj).length} calls, ${clientPhoneMap.length} client phones`);

let assigned = 0;
let adminAssigned = 0;
let junkRemoved = 0;
const toDelete = [];

for (const [callSid, call] of Object.entries(callsObj)) {
  // Skip if already has clientId
  if (call.clientId) continue;

  // Remove junk stress test calls
  const toField = call.to || '';
  if (toField.startsWith('stress_call_')) {
    toDelete.push(callSid);
    junkRemoved++;
    continue;
  }

  // Try to match destination number to a client
  let matchedClientId = null;
  for (const { clientId, phone } of clientPhoneMap) {
    if (phonesMatch(phone, call.to) || phonesMatch(phone, call.from)) {
      matchedClientId = clientId;
      break;
    }
  }

  if (matchedClientId) {
    callsObj[callSid].clientId = matchedClientId;
    assigned++;
  } else {
    // Assign to admin — these are calls placed before multi-tenancy was set up
    callsObj[callSid].clientId = 'admin';
    adminAssigned++;
  }
}

// Remove junk calls
for (const sid of toDelete) {
  delete callsObj[sid];
}

// Save
fs.writeFileSync(CALLS_DB, JSON.stringify(callsObj, null, 2), 'utf8');
console.log(`\n✅ Migration complete:`);
console.log(`   Assigned to specific clients : ${assigned}`);
console.log(`   Assigned to admin            : ${adminAssigned}`);
console.log(`   Junk stress calls removed    : ${junkRemoved}`);
console.log(`   Total remaining calls        : ${Object.keys(callsObj).length}`);
