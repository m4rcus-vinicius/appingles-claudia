import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fs from 'fs';
import path from 'path';
import type WebSocket from 'ws';
import { CONFIG, getAllApiKeys } from './config.js';
import { GeminiLiveSession } from './services/geminiLiveSession.js';
import type { HumorIntensity } from './prompts/tutorPersona.js';

const fastify = Fastify({
  logger: true,
});

// Healthcheck endpoint
fastify.get('/health', async () => {
  const keysCount = getAllApiKeys().length;
  return {
    status: 'ok',
    service: 'AppIngles Live Audio Gateway (Cláudia)',
    model: CONFIG.geminiLiveModel,
    audioConfig: CONFIG.audio,
    apiKeyConfigured: keysCount > 0,
    apiKeysCount: keysCount,
  };
});

// Rota para baixar o APK compilado diretamente pelo navegador do celular (local ou na nuvem 24h)
fastify.get('/download-apk', async (_req, reply) => {
  const apkPath = path.resolve(
    process.cwd(),
    '../mobile/android/app/build/outputs/apk/release/app-release.apk'
  );
  if (!fs.existsSync(apkPath)) {
    // Na nuvem (Render), redireciona diretamente para o instalador oficial hospedado no GitHub Releases (24h online)
    return reply.redirect(
      302,
      'https://github.com/m4rcus-vinicius/appingles-claudia/releases/latest/download/Claudia-Ingles-Sem-Filtro.apk'
    );
  }
  reply.header('Content-Type', 'application/vnd.android.package-archive');
  reply.header('Content-Disposition', 'attachment; filename="Claudia-Ingles-Sem-Filtro.apk"');
  return reply.send(fs.createReadStream(apkPath));
});

// Cache para checagem automática de atualizações do aplicativo móvel
let cachedReleaseInfo: {
  version: string;
  name: string;
  notes: string;
  downloadUrl: string;
  publishedAt: string;
} | null = null;
let lastReleaseFetchTime = 0;

fastify.get('/api/app-version', async () => {
  const now = Date.now();
  if (cachedReleaseInfo && now - lastReleaseFetchTime < 5 * 60 * 1000) {
    return cachedReleaseInfo;
  }

  try {
    const res = await fetch(
      'https://api.github.com/repos/m4rcus-vinicius/appingles-claudia/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'AppIngles-Version-Checker',
        },
      }
    );

    if (res.ok) {
      const data = (await res.json()) as any;
      const tag = String(data.tag_name || '').replace(/^v/i, '');
      const asset = (data.assets || []).find((a: any) =>
        String(a.name).endsWith('.apk')
      );
      const downloadUrl =
        asset?.browser_download_url ||
        'https://github.com/m4rcus-vinicius/appingles-claudia/releases/latest/download/Claudia-Ingles-Sem-Filtro.apk';

      cachedReleaseInfo = {
        version: tag || '1.3.0',
        name: data.name || `Versão ${tag}`,
        notes:
          data.body ||
          'Novidades e melhorias de desempenho no Cláudia - Inglês Sem Filtro.',
        downloadUrl,
        publishedAt: data.published_at || new Date().toISOString(),
      };
      lastReleaseFetchTime = now;
      return cachedReleaseInfo;
    }
  } catch (err) {
    fastify.log.warn(`Erro ao consultar GitHub Releases: ${err}`);
  }

  return {
    version: '1.3.0',
    name: 'Cláudia v1.3.0 (Modo Iniciante)',
    notes: 'Nova modalidade Iniciante (zero broncas e muito acolhedora).',
    downloadUrl:
      'https://github.com/m4rcus-vinicius/appingles-claudia/releases/latest/download/Claudia-Ingles-Sem-Filtro.apk',
    publishedAt: new Date().toISOString(),
  };
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
        query?.intensity === 'iniciante'
          ? 'iniciante'
          : query?.intensity === 'moderado'
          ? 'moderado'
          : 'roast';

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
              if (
                msg.intensity === 'iniciante' ||
                msg.intensity === 'moderado' ||
                msg.intensity === 'roast'
              ) {
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
