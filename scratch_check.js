import { FreeSwitchAdapter } from './telephony/adapters/FreeSwitchAdapter.js';

const adapter = new FreeSwitchAdapter({
  host: '127.0.0.1',
  port: 8021,
  password: 'ClueCon'
});

setTimeout(async () => {
  try {
    console.log("Killing gateway vobiz...");
    const killResult = await adapter.sendCommand('api sofia profile external kill_gateway vobiz');
    console.log("Kill result:", killResult);
    
    console.log("Waiting 2 seconds...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log("Rescanning external profile...");
    const scanResult = await adapter.sendCommand('api sofia profile external rescan');
    console.log("Rescan result:", scanResult);
    
    console.log("Waiting 4 seconds for registration to complete...");
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    console.log("\n--- VOBIZ GATEWAY STATUS ---");
    const gateways = await adapter.sendCommand('api sofia status gateway vobiz');
    console.log(gateways);
    
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}, 2000);
