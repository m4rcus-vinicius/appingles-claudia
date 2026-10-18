import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fs from 'fs';
import path from 'path';
import type WebSocket from 'ws';
import { CONFIG } from './config.js';
import { GeminiLiveSession } from './services/geminiLiveSession.js';
import type { HumorIntensity } from './prompts/tutorPersona.js';

const fastify = Fastify({
  logger: true,
});

// Healthcheck endpoint
fastify.get('/health', async () => {
  return {
    status: 'ok',
    service: 'AppIngles Live Audio Gateway (Cláudia)',
    model: CONFIG.geminiLiveModel,
    audioConfig: CONFIG.audio,
    apiKeyConfigured:
      Boolean(CONFIG.geminiApiKey) && CONFIG.geminiApiKey !== 'coloque_sua_chave_aqui',
  };
});

// Rota para baixar o APK compilado diretamente pelo navegador do celular
fastify.get('/download-apk', async (_req, reply) => {
  const apkPath = path.resolve(
    process.cwd(),
    '../mobile/android/app/build/outputs/apk/release/app-release.apk'
  );
  if (!fs.existsSync(apkPath)) {
    return reply.status(404).send({
      error: 'O arquivo APK ainda está sendo compilado. Aguarde a conclusão do build.',
    });
  }
  reply.header('Content-Type', 'application/vnd.android.package-archive');
  reply.header('Content-Disposition', 'attachment; filename="Claudia-Ingles-Sem-Filtro.apk"');
  return reply.send(fs.createReadStream(apkPath));
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
  await fastify.register(cors, {
    origin: '*',
  });

  await fastify.register(websocket, {
    options: {
      maxPayload: 10 * 1024 * 1024, // 10MB max payload para buffers de áudio
    },
  });

  await fastify.register(async function (app) {
    app.get('/ws/tutor', { websocket: true }, (socket: WebSocket, req) => {
      const query = req.query as { intensity?: string };
      const initialIntensity: HumorIntensity =
        query?.intensity === 'moderado' ? 'moderado' : 'roast';

      app.log.info(
        `[Gateway] Novo cliente mobile conectado (intensity=${initialIntensity})`
      );

      const sendToClient = (payload: Record<string, unknown>) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(payload));
        }
      };

      const geminiSession = new GeminiLiveSession(initialIntensity, {
        onReady: () => {
          sendToClient({
            type: 'session_ready',
            sampleRateIn: CONFIG.audio.inputSampleRate,
            sampleRateOut: CONFIG.audio.outputSampleRate,
            intensity: initialIntensity,
          });
        },
        onAudioChunk: (pcm24kBase64) => {
          sendToClient({
            type: 'audio_output',
            data: pcm24kBase64,
            sampleRate: CONFIG.audio.outputSampleRate,
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

      socket.on('message', (rawMessage: WebSocket.RawData, isBinary: boolean) => {
        // Suporte a envio de frames PCM binários puros (menor overhead de rede)
        if (isBinary) {
          const pcmBase64 = Buffer.from(rawMessage as Buffer).toString('base64');
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
        } catch {
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
    await fastify.listen({ port: CONFIG.port, host: CONFIG.host });
    console.log(
      `\n🚀 Servidor Gateway AppIngles rodando em http://${CONFIG.host}:${CONFIG.port}`
    );
    console.log(`🎙️  WebSocket Live Audio Endpoint: ws://localhost:${CONFIG.port}/ws/tutor\n`);

    // Keep-alive automático na nuvem (Render Free Tier) a cada 10 minutos para evitar hibernação
    const externalUrl =
      process.env.RENDER_EXTERNAL_URL || 'https://claudia-ingles-backend.onrender.com';
    setInterval(() => {
      fetch(`${externalUrl}/health`).catch(() => {
        // ignore ping errors
      });
    }, 10 * 60 * 1000);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

void startServer();
