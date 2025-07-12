import twilio from 'twilio';

// Initialize Twilio client for making API calls
export const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);