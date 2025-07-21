import WebSocket from 'ws';
import fetch from 'node-fetch';
import { twilioClient } from './twilio-client.js';
import { hangupCall } from '../utils/call-helpers.js';

// 🎯 WEBSOCKET CONNECTION - Handles Twilio ↔ ElevenLabs audio streaming
export function handleWebSocketConnection(ws) {
  console.log('🔌 WebSocket connection established');
  
  let elevenLabsWs = null;
  let streamSid = null;
  let callSid = null; // Store the call SID for hangup
  let isCleaningUp = false; // Prevent multiple cleanup attempts
  
  // Centralized cleanup function
  async function cleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;
    
    console.log('🧹 Starting cleanup process...');
    
    // Close ElevenLabs connection if exists
    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.close();
    }
    
    // Hang up the call once
    if (callSid) {
      await hangupCall(callSid);
    }
  }
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.event === 'start') {
        streamSid = data.start.streamSid;
        callSid = data.start.callSid; // Extract call SID from start event
        console.log(`🎬 Stream started: ${streamSid}, Call SID: ${callSid}`);
        
        // 🚀 Connect to ElevenLabs using signed URL approach
        const agentId = process.env.ELEVENLABS_INBOUND_AGENT_ID;
        const apiKey = process.env.ELEVENLABS_API_KEY;
        
        if (!agentId || !apiKey) {
          console.error('❌ Missing ELEVENLABS_INBOUND_AGENT_ID or ELEVENLABS_API_KEY');
          await cleanup();
          return;
        }
        
        try {
          console.log('🔑 Getting signed URL from ElevenLabs...');
          const signedUrlResponse = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`, {
            headers: {
              'xi-api-key': apiKey
            }
          });
          
          if (!signedUrlResponse.ok) {
            console.error('❌ Failed to get signed URL:', signedUrlResponse.statusText, await signedUrlResponse.text());
            await cleanup();
            return;
          }
          
          const signedUrlData = await signedUrlResponse.json();
          console.log('✅ Got signed URL from ElevenLabs');
          
          elevenLabsWs = new WebSocket(signedUrlData.signed_url);
          
          elevenLabsWs.on('open', () => {
            console.log('✅ Connected to ElevenLabs Conversational AI');
          });
          
          elevenLabsWs.on('message', async (elevenLabsMessage) => {
            try {
              const elevenLabsData = JSON.parse(elevenLabsMessage);
              console.log('📥 ElevenLabs message type:', elevenLabsData.type);
              
              if (elevenLabsData.type === 'conversation_initiation_metadata') {
                console.log('🎬 Conversation initiated successfully');
              }
              
              if (elevenLabsData.type === 'audio' && elevenLabsData.audio_event) {
                // Forward audio from ElevenLabs to Twilio
                const audioData = elevenLabsData.audio_event.audio_base_64;
                
                const twilioMessage = {
                  event: 'media',
                  streamSid: streamSid,
                  media: {
                    payload: audioData
                  }
                };
                
                ws.send(JSON.stringify(twilioMessage));
                console.log('🔊 Audio forwarded to Twilio');
              }
              
              if (elevenLabsData.type === 'agent_response') {
                console.log('💬 Agent said:', elevenLabsData.agent_response_event?.agent_response);
              }
              
              if (elevenLabsData.type === 'conversation_end') {
                console.log('🏁 Conversation ended by ElevenLabs');
                // Only send stop if Twilio WebSocket is still open
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    event: 'stop',
                    streamSid: streamSid
                  }));
                }
                // Clean up when conversation ends
                await cleanup();
              }
              
            } catch (error) {
              console.error('❌ Error processing ElevenLabs message:', error);
            }
          });
          
          elevenLabsWs.on('close', (code, reason) => {
            console.log('🔌 ElevenLabs connection closed:', code, reason.toString());
            // Clean up when ElevenLabs connection closes
            cleanup();
          });
          
          elevenLabsWs.on('error', (error) => {
            console.error('❌ ElevenLabs WebSocket error:', error);
            // Clean up on ElevenLabs error
            cleanup();
          });
          
        } catch (error) {
          console.error('❌ Error setting up ElevenLabs connection:', error);
          await cleanup();
        }
      }
      
      if (data.event === 'media' && elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
        // Forward audio from Twilio to ElevenLabs
        const audioMessage = {
          user_audio_chunk: data.media.payload
        };
        
        elevenLabsWs.send(JSON.stringify(audioMessage));
      }
      
      if (data.event === 'stop') {
        console.log('🛑 Stream stopped');
        if (elevenLabsWs) {
          elevenLabsWs.close();
        }
        // Don't call cleanup here as this is triggered by our own hangup
      }
      
    } catch (error) {
      console.error('❌ Error processing WebSocket message:', error);
      await cleanup();
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 Twilio WebSocket connection closed');
    if (elevenLabsWs) {
      elevenLabsWs.close();
    }
    // Clean up when Twilio WebSocket closes
    cleanup();
  });
  
  ws.on('error', (error) => {
    console.log('❌ Twilio WebSocket error:', error);
    if (elevenLabsWs) {
      elevenLabsWs.close();
    }
    // Clean up on WebSocket error
    cleanup();
  });
}