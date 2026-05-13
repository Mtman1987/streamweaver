#!/bin/sh
# Trigger Kick connect for fatkid4ev4 on the live server
# This calls the HTTP server running in the same process as the Kick service
node -e "
fetch('http://127.0.0.1:8090/api/kick/connect', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ channelName: 'fatkid4ev4', tenantId: '757276653' })
}).then(r => r.text()).then(t => { console.log('Response:', t); process.exit(0); }).catch(e => { console.error('Error:', e); process.exit(1); });
"
