"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIG = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.CONFIG = {
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || '0.0.0.0',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiLiveModel: process.env.GEMINI_LIVE_MODEL || 'models/gemini-2.5-flash-native-audio-latest',
    geminiVoiceName: process.env.GEMINI_VOICE_NAME || 'Aoede',
    geminiWsEndpoint: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent',
    audio: {
        inputSampleRate: 16000,
        outputSampleRate: 24000,
        channels: 1,
        bitDepth: 16,
    },
};
