import dotenv from 'dotenv';

dotenv.config();

/**
 * Coleta todas as chaves configuradas via:
 * - GEMINI_API_KEY (aceita 1 chave ou várias separadas por vírgula)
 * - GEMINI_API_KEY_1, GEMINI_API_KEY_2, ..., GEMINI_API_KEY_10
 */
function loadApiKeysPool(): string[] {
  const rawCandidates: string[] = [];

  if (process.env.GEMINI_API_KEY) {
    rawCandidates.push(...process.env.GEMINI_API_KEY.split(','));
  }

  for (let i = 1; i <= 10; i++) {
    const numberedKey = process.env[`GEMINI_API_KEY_${i}`];
    if (numberedKey) {
      rawCandidates.push(...numberedKey.split(','));
    }
  }

  const validKeys = rawCandidates
    .map((k) => k.trim())
    .filter((k) => k.length > 10 && k !== 'coloque_sua_chave_aqui');

  return Array.from(new Set(validKeys));
}

const apiKeysPool = loadApiKeysPool();
const activeSessionsPerKey = new Map<string, number>();
let roundRobinCursor = 0;

/**
 * Seleciona a chave com MENOS usuários simultâneos ativos no momento
 * (com desempate em Round-Robin para distribuir a cota igualmente).
 */
export function acquireLeastLoadedApiKey(): string {
  const keys = loadApiKeysPool();
  if (keys.length === 0) return '';
  if (keys.length === 1) {
    const onlyKey = keys[0];
    activeSessionsPerKey.set(onlyKey, (activeSessionsPerKey.get(onlyKey) || 0) + 1);
    return onlyKey;
  }

  let bestKey = keys[0];
  let minActive = Infinity;

  for (let i = 0; i < keys.length; i++) {
    const idx = (roundRobinCursor + i) % keys.length;
    const candidate = keys[idx];
    const activeCount = activeSessionsPerKey.get(candidate) || 0;
    if (activeCount < minActive) {
      minActive = activeCount;
      bestKey = candidate;
    }
  }

  roundRobinCursor = (keys.indexOf(bestKey) + 1) % keys.length;
  activeSessionsPerKey.set(bestKey, (activeSessionsPerKey.get(bestKey) || 0) + 1);
  return bestKey;
}

/**
 * Libera 1 sessão ativa da chave quando o usuário desconecta
 */
export function releaseApiKey(key: string): void {
  if (!key) return;
  const current = activeSessionsPerKey.get(key) || 0;
  activeSessionsPerKey.set(key, Math.max(0, current - 1));
}

/**
 * Retorna a próxima chave do pool (útil para fallback caso uma chave atinja limite ou para extração em background)
 */
export function getNextFallbackApiKey(currentKey?: string): string {
  const keys = loadApiKeysPool();
  if (keys.length === 0) return '';
  if (keys.length === 1) return keys[0];

  const currentIndex = currentKey ? keys.indexOf(currentKey) : -1;
  const nextIndex = (currentIndex + 1) % keys.length;
  return keys[nextIndex];
}

export function getAllApiKeys(): string[] {
  return loadApiKeysPool();
}

export const CONFIG = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '0.0.0.0',
  geminiApiKey: apiKeysPool[0] || '',
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
