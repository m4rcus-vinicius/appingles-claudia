"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const websocket_1 = __importDefault(require("@fastify/websocket"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_js_1 = require("./config.js");
const geminiLiveSession_js_1 = require("./services/geminiLiveSession.js");
const fastify = (0, fastify_1.default)({
    logger: true,
});
// Healthcheck endpoint
fastify.get('/health', async () => {
    const keysCount = (0, config_js_1.getAllApiKeys)().length;
    return {
        status: 'ok',
        service: 'AppIngles Live Audio Gateway (Cláudia)',
        model: config_js_1.CONFIG.geminiLiveModel,
        audioConfig: config_js_1.CONFIG.audio,
        apiKeyConfigured: keysCount > 0,
        apiKeysCount: keysCount,
    };
});
// Rota para baixar o APK compilado diretamente pelo navegador do celular
fastify.get('/download-apk', async (_req, reply) => {
    const apkPath = path_1.default.resolve(process.cwd(), '../mobile/android/app/build/outputs/apk/release/app-release.apk');
    if (!fs_1.default.existsSync(apkPath)) {
        return reply.status(404).send({
            error: 'O arquivo APK ainda está sendo compilado. Aguarde a conclusão do build.',
        });
    }
    reply.header('Content-Type', 'application/vnd.android.package-archive');
    reply.header('Content-Disposition', 'attachment; filename="Claudia-Ingles-Sem-Filtro.apk"');
    return reply.send(fs_1.default.createReadStream(apkPath));
});
/**
 * Endpoint WebSocket principal (/ws/tutor)
 * Conecta o App Mobile (React Native) ao Gemini Multimodal Live API sem expor a API Key no cliente.
 *
 * Protocolo Mobile -> Backend:
 * - Binário (Buffer): frame bruto PCM 16kHz 16-bit mono
 * - JSON:
 *   - { type: "audio_chunk", data: "<base64_pcm_16k>" }
 *   - { type: "set_intensity", intensity: "moderado" | "roast" }
 *   - { type: "client_barge_in" }
 *   - { type: "ping" }
 *
 * Protocolo Backend -> Mobile:
 * - JSON:
 *   - { type: "session_ready", sampleRateIn: 16000, sampleRateOut: 24000 }
 *   - { type: "status", status: "listening" | "thinking" | "speaking" }
 *   - { type: "audio_output", data: "<base64_pcm_24k>", sampleRate: 24000 }
 *   - { type: "barge_in" }
 *   - { type: "grammar_correction", correction: { id, timestamp, userSaid, correction, explanationPt, category } }
 *   - { type: "transcript", role: "user" | "tutor", text: "..." }
 *   - { type: "error", message: "..." }
 */
const registerRoutes = async () => {
    await fastify.register(cors_1.default, {
        origin: '*',
    });
    await fastify.register(websocket_1.default, {
        options: {
            maxPayload: 10 * 1024 * 1024, // 10MB max payload para buffers de áudio
        },
    });
    await fastify.register(async function (app) {
        app.get('/ws/tutor', { websocket: true }, (socket, req) => {
            const query = req.query;
            const initialIntensity = query?.intensity === 'moderado' ? 'moderado' : 'roast';
            app.log.info(`[Gateway] Novo cliente mobile conectado (intensity=${initialIntensity})`);
            const sendToClient = (payload) => {
                if (socket.readyState === socket.OPEN) {
                    socket.send(JSON.stringify(payload));
                }
            };
            const geminiSession = new geminiLiveSession_js_1.GeminiLiveSession(initialIntensity, {
                onReady: () => {
                    sendToClient({
                        type: 'session_ready',
                        sampleRateIn: config_js_1.CONFIG.audio.inputSampleRate,
                        sampleRateOut: config_js_1.CONFIG.audio.outputSampleRate,
                        intensity: initialIntensity,
                    });
                },
                onAudioChunk: (pcm24kBase64) => {
                    sendToClient({
                        type: 'audio_output',
                        data: pcm24kBase64,
                        sampleRate: config_js_1.CONFIG.audio.outputSampleRate,
                    });
                },
                onTurnComplete: () => {
                    sendToClient({
                        type: 'turn_complete',
                    });
                },
                onStatusChange: (status) => {
                    sendToClient({
                        type: 'status',
                        status,
                    });
                },
                onInterrupted: () => {
                    // Notifica o app mobile imediatamente para limpar o buffer de reprodução (Barge-in)
                    sendToClient({
                        type: 'barge_in',
                    });
                },
                onTranscript: (role, text) => {
                    sendToClient({
                        type: 'transcript',
                        role,
                        text,
                    });
                },
                onGrammarCorrection: (correction) => {
                    sendToClient({
                        type: 'grammar_correction',
                        correction,
                    });
                },
                onError: (message) => {
                    sendToClient({
                        type: 'error',
                        message,
                    });
                },
                onClose: () => {
                    if (socket.readyState === socket.OPEN) {
                        socket.close(1000, 'Gemini Live session ended');
                    }
                },
            });
            geminiSession.connect();
            socket.on('message', (rawMessage, isBinary) => {
                // Suporte a envio de frames PCM binários puros (menor overhead de rede)
                if (isBinary) {
                    const pcmBase64 = Buffer.from(rawMessage).toString('base64');
                    geminiSession.sendAudioChunk(pcmBase64);
                    return;
                }
                // Mensagens de controle ou chunks PCM codificados em JSON
                try {
                    const msg = JSON.parse(rawMessage.toString('utf-8'));
                    switch (msg.type) {
                        case 'audio_chunk':
                            if (typeof msg.data === 'string' && msg.data.length > 0) {
                                geminiSession.sendAudioChunk(msg.data);
                            }
                            break;
                        case 'set_intensity':
                            if (msg.intensity === 'moderado' || msg.intensity === 'roast') {
                                geminiSession.updateIntensity(msg.intensity);
                            }
                            break;
                        case 'client_barge_in':
                            // O próprio cliente cortou a fala localmente
                            geminiSession.handleClientBargeIn();
                            sendToClient({ type: 'status', status: 'listening' });
                            break;
                        case 'ping':
                            sendToClient({ type: 'pong', timestamp: Date.now() });
                            break;
                        default:
                            break;
                    }
                }
                catch {
                    app.log.warn('[Gateway] Mensagem JSON inválida recebida do cliente mobile');
                }
            });
            socket.on('close', () => {
                app.log.info('[Gateway] Cliente mobile desconectado. Encerrando sessão Gemini Live.');
                geminiSession.close();
            });
            socket.on('error', (err) => {
                app.log.error(`[Gateway] Erro no socket mobile: ${err.message}`);
                geminiSession.close();
            });
        });
    });
};
const startServer = async () => {
    try {
        await registerRoutes();
        await fastify.listen({ port: config_js_1.CONFIG.port, host: config_js_1.CONFIG.host });
        console.log(`\n🚀 Servidor Gateway AppIngles rodando em http://${config_js_1.CONFIG.host}:${config_js_1.CONFIG.port}`);
        console.log(`🎙️  WebSocket Live Audio Endpoint: ws://localhost:${config_js_1.CONFIG.port}/ws/tutor\n`);
        // Keep-alive automático na nuvem (Render Free Tier) a cada 10 minutos para evitar hibernação
        const externalUrl = process.env.RENDER_EXTERNAL_URL || 'https://claudia-ingles-backend.onrender.com';
        setInterval(() => {
            fetch(`${externalUrl}/health`).catch(() => {
                // ignore ping errors
            });
        }, 10 * 60 * 1000);
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
void startServer();
