import { Buffer } from 'buffer';

// Frame de 100ms de silêncio digital puro em 16kHz 16-bit mono (3200 bytes de zeros)
const SILENT_100MS_PCM_16K_BASE64 = Buffer.alloc(3200, 0).toString('base64');

export function getSilentPcm16kBase64(): string {
  return SILENT_100MS_PCM_16K_BASE64;
}

/**
 * Converte um ArrayBuffer PCM int16 (de qualquer taxa de amostragem/canais do hardware)
 * para PCM 16kHz 16-bit Mono em Base64 + calcula o nível RMS normalizado (0.0 a 1.0).
 */
export function processRawPcmBufferTo16kMono(
  data: ArrayBuffer,
  actualSampleRate: number,
  actualChannels: number
): { pcm16kBase64: string; rms: number } {
  const int16View = new Int16Array(data);
  const totalFrames = Math.floor(int16View.length / Math.max(1, actualChannels));
  if (totalFrames === 0) {
    return { pcm16kBase64: '', rms: 0 };
  }

  const targetRate = 16000;
  const ratio = actualSampleRate > 0 ? actualSampleRate / targetRate : 1;
  const outputFrames = Math.max(1, Math.floor(totalFrames / ratio));
  const outInt16 = new Int16Array(outputFrames);

  let sumSquares = 0;

  for (let i = 0; i < outputFrames; i++) {
    const srcFrameIndex = Math.min(totalFrames - 1, Math.floor(i * ratio));
    const sample = int16View[srcFrameIndex * actualChannels];
    outInt16[i] = sample;

    const normalized = sample / 32768.0;
    sumSquares += normalized * normalized;
  }

  const rms = Math.min(1, Math.sqrt(sumSquares / outputFrames) * 3.5);
  const outBytes = Buffer.from(
    outInt16.buffer,
    outInt16.byteOffset,
    outInt16.byteLength
  );

  return {
    pcm16kBase64: outBytes.toString('base64'),
    rms,
  };
}

/**
 * Envelopa múltiplos pacotes PCM 16-bit mono (em base64) em um arquivo WAV (RIFF) em Base64
 * e calcula a duração exata em milissegundos para garantir que o player nunca trave.
 */
export function createWavBase64FromPcmChunks(
  pcmBase64Chunks: string[],
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16
): { wavBase64: string; durationMs: number } {
  const buffers = pcmBase64Chunks.map((b64) => Buffer.from(b64, 'base64'));
  const pcmData = Buffer.concat(buffers);
  const dataSize = pcmData.length;

  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  // "RIFF" chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  // "fmt " sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // "data" sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const wavBuffer = Buffer.concat([header, pcmData]);
  const durationMs = Math.max(250, Math.ceil((dataSize / byteRate) * 1000));

  return {
    wavBase64: wavBuffer.toString('base64'),
    durationMs,
  };
}
