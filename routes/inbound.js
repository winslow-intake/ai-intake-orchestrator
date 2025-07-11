import express from 'express';
const router = express.Router();

// Reserved for inbound API routes, e.g. Twilio status callbacks or Airtable lookups
router.post('/status', (req, res) => {
  console.log('📡 Twilio call status:', req.body);
  res.sendStatus(200);
});

export default router;