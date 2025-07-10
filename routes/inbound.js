const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  console.log('📞 Inbound call received:', req.body);
  
  try {
    // Return TwiML that streams to YOUR server WebSocket endpoint
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <Stream url="wss://ai-intake-orchestrator.onrender.com/media-stream" />
      </Connect>
    </Response>`;
    
    res.type('text/xml').send(twiml);
    
  } catch (error) {
    console.error('❌ Error in inbound route:', error);
    res.status(500).send('Error processing inbound call');
  }
});

module.exports = router;