import express from 'express';

const router = express.Router();

// Store active call contexts (same as before)
const callContexts = new Map();

// Helper to store context for a call
export function storeCallContext(callSid, context) {
  callContexts.set(callSid, {
    ...context,
    timestamp: new Date()
  });
  
  // Clean up old contexts after 30 minutes
  setTimeout(() => {
    callContexts.delete(callSid);
  }, 30 * 60 * 1000);
}

// Webhook endpoint that ElevenLabs calls to get conversation data
router.post('/conversation-init', (req, res) => {
  console.log('🎯 ElevenLabs conversation init webhook called:', req.body);
  console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
  console.log('📋 Request headers:', req.headers);
  
  // Extract call identifier from ElevenLabs
  const { call_id, agent_id } = req.body;
  
  // Try to find context using call_id or other identifiers
  let context = null;
  
  // First try exact match
  if (call_id) {
    context = callContexts.get(call_id);
  }
  
  // If not found, try to find most recent context (for testing)
  if (!context) {
    const recentContext = Array.from(callContexts.values())
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    
    if (recentContext && (new Date() - recentContext.timestamp < 5000)) {
      // Use context if it's less than 5 seconds old
      context = recentContext;
      console.log('📌 Using recent context for call');
    }
  }
  
  if (!context) {
    console.log('⚠️ No context found for conversation init');
    return res.json({
      variables: {
        user_name: "valued client",
        case_type: "your case",
        incident_date: "recently"
      }
    });
  }
  
  console.log('✅ Returning context for ElevenLabs:', context);
  
  // Return the variables ElevenLabs expects
  res.json({
    variables: {
      user_name: context.user_name || "valued client",
      case_type: context.case_type || "your case",
      incident_date: context.incident_date || "recently"
    }
  });
});

// Test endpoint to manually store context (keep this for testing)
router.post('/conversation-init/test-context', (req, res) => {
  const { callSid, ...context } = req.body;
  
  storeCallContext(callSid || 'test-' + Date.now(), context);
  
  res.json({
    success: true,
    message: 'Context stored for testing',
    context
  });
});

export default router;
export { callContexts };