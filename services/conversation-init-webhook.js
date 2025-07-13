import express from 'express';

const router = express.Router();

// Store active call contexts
const callContexts = new Map();

// Helper to store context for a call
export function storeCallContext(callSid, context) {
  callContexts.set(callSid, {
    ...context,
    timestamp: new Date()
  });
  
  console.log(`💾 Stored context for call ${callSid}:`, context);
  console.log(`📊 Total contexts stored: ${callContexts.size}`);
  
  // Clean up old contexts after 30 minutes
  setTimeout(() => {
    callContexts.delete(callSid);
    console.log(`🗑️ Cleaned up context for call ${callSid}`);
  }, 30 * 60 * 1000);
}

// Webhook endpoint that ElevenLabs calls to get conversation data
router.post('/conversation-init', (req, res) => {
  console.log('🎯 ElevenLabs conversation init webhook called');
  console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
  console.log('📋 Request headers:', req.headers);
  console.log('🔍 Query params:', req.query);
  
  // ElevenLabs might send the call_id in different ways
  const callId = req.body.call_id || 
                 req.query.call_id || 
                 req.headers['x-call-id'] ||
                 req.body.metadata?.call_id;
  
  console.log(`🔎 Looking for context with call_id: ${callId}`);
  console.log(`📚 Available contexts: ${Array.from(callContexts.keys()).join(', ')}`);
  
  let context = null;
  
  // Try to find context using the call_id
  if (callId) {
    context = callContexts.get(callId);
    if (context) {
      console.log('✅ Found context by exact call_id match');
    }
  }
  
  // If not found, try to find the most recent context (fallback for testing)
  if (!context && callContexts.size > 0) {
    const contexts = Array.from(callContexts.entries());
    const mostRecent = contexts
      .sort((a, b) => b[1].timestamp - a[1].timestamp)[0];
    
    if (mostRecent && (new Date() - mostRecent[1].timestamp < 10000)) {
      // Use context if it's less than 10 seconds old
      context = mostRecent[1];
      console.log(`📌 Using recent context from ${mostRecent[0]} (${Math.round((new Date() - context.timestamp) / 1000)}s old)`);
    }
  }
  
  if (!context) {
    console.log('⚠️ No context found for conversation init');
    console.log('🔧 Returning default variables');
    return res.json({
      variables: {
        user_name: "valued client",
        case_type: "your case",
        incident_date: "recently"
      }
    });
  }
  
  console.log('✅ Returning context for ElevenLabs:', context);
  
  // Return the variables in the format ElevenLabs expects
  const response = {
    variables: {
      user_name: context.user_name || "valued client",
      case_type: context.case_type || "your case",
      incident_date: context.incident_date || "recently"
    }
  };
  
  console.log('📤 Sending response:', JSON.stringify(response, null, 2));
  res.json(response);
});

// Health check endpoint for the webhook
router.get('/conversation-init', (req, res) => {
  res.json({
    status: 'ok',
    message: 'ElevenLabs conversation init webhook is ready',
    activeContexts: callContexts.size,
    timestamp: new Date().toISOString()
  });
});

// Test endpoint to manually store context
router.post('/conversation-init/test-context', (req, res) => {
  const { callSid, ...context } = req.body;
  const sid = callSid || 'test-' + Date.now();
  
  storeCallContext(sid, context);
  
  res.json({
    success: true,
    message: 'Context stored for testing',
    callSid: sid,
    context
  });
});

// Debug endpoint to see all stored contexts
router.get('/conversation-init/debug', (req, res) => {
  const contexts = Array.from(callContexts.entries()).map(([key, value]) => ({
    callSid: key,
    ...value,
    age: Math.round((new Date() - value.timestamp) / 1000) + 's'
  }));
  
  res.json({
    totalContexts: callContexts.size,
    contexts
  });
});

export default router;
export { callContexts };