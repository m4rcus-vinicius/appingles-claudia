import dotenv from 'dotenv';

dotenv.config();

export const CONFIG = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '0.0.0.0',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiLiveModel:
    process.env.GEMINI_LIVE_MODEL || 'models/gemini-2.5-flash-native-audio-latest',
  geminiVoiceName: process.env.GEMINI_VOICE_NAME || 'Aoede',
  geminiWsEndpoint:
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent',
  audio: {
    inputSampleRate: 16000,
    outputSampleRate: 24000,
    channels: 1,
    bitDepth: 16,
  },
};
