# Startup Routine (Good Morning)

When the user says "good morning" or asks to start the environment, I must perform the following steps:

1. **Start the Node.js Server:**
   - Run `node server.js` in the background (using `run_command` as a background task).
   - Inform the user that the backend server is up and running.

2. **Provide Ngrok Instructions:**
   - DO NOT start ngrok yourself. The user prefers to start it manually in their own terminal.
   - Provide the exact command to the user so they can copy-paste it into their command prompt: `ngrok http 5050`
   - Remind them to copy the generated "Forwarding" public URL (e.g., `https://<something>.ngrok-free.app`) from their terminal.
   - Remind them to paste this public URL into the **"Global Settings" > "Public Server URL"** field in the Dashboard, and also into their Telephony Provider's Webhook URL (Vobiz/Exotel/Twilio) if they plan to test incoming calls.
