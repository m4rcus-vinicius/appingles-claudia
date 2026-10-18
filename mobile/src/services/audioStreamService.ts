import {
  AudioModule,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStream,
  type AudioStreamBuffer,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import {
  createWavBase64FromPcmChunks,
  getSilentPcm16kBase64,
  processRawPcmBufferTo16kMono,
} from '../utils/pcmWavUtils';

export interface AudioStreamCallbacks {
  onMicPcmChunk: (pcm16kBase64: string, rmsLevel: number) => void;
  onLocalBargeInDetected: () => void;
  onPlaybackStateChange: (isPlaying: boolean) => void;
}

/**
 * Serviço Nativo de Áudio Bidirecional em Tempo Real (Expo SDK 57 - expo-audio)
 * - Captura contínua PCM 16kHz 16-bit mono via `AudioModule.AudioStream`.
 * - Envia silêncio digital enquanto a Cláudia fala para manter o relógio de VAD ativo sem eco.
 * - Possui watchdog de duração exata (`durationMs + 400ms`) para garantir que o player NUNCA
 *   fique preso no estado "speaking" nem deixe o app mudo após uma fala.
 */
export class AudioStreamService {
  private isCapturing = false;
  private isPlayingAiAudio = false;
  private incomingPcmQueue: string[] = [];
  private isTurnStreamComplete = false;
  private activePlayer: AudioPlayer | null = null;
  private activeMicStream: AudioStream | null = null;
  private micListenerSub: { remove: () => void } | null = null;
  private isDrainingQueue = false;
  private playbackGeneration = 0;
  private callbacks: AudioStreamCallbacks;

  // Controle de Barge-in durante fala da IA
  private consecutiveVoiceFrames = 0;
  private readonly BARGE_IN_RMS_THRESHOLD = 0.68;
  private readonly BARGE_IN_REQUIRED_FRAMES = 6;

  // Noise Gate suave (0.025) apenas para cortar o ruído estático de fundo após você parar de falar
  private readonly SPEECH_RMS_GATE = 0.025;
  private speechTailFramesRemaining = 0;
  private readonly SPEECH_TAIL_HOLD_FRAMES = 6; // ~600ms de cauda natural após a última sílaba

  private readonly MIN_CHUNKS_FOR_SMOOTH_SEGMENT = 24;

  constructor(callbacks: AudioStreamCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Solicita permissão de microfone e configura a sessão de áudio no Expo SDK 57
   */
  public async initializeAudioSession(): Promise<boolean> {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      return false;
    }

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: false,
    });

    return true;
  }

  /**
   * Inicia a captura contínua do microfone em buffer PCM (16kHz, mono, 16-bit) via AudioModule.AudioStream
   */
  public startMicrophoneCapture(): void {
    if (this.isCapturing) return;
    this.isCapturing = true;

    try {
      const stream = new AudioModule.AudioStream({
        sampleRate: 16000,
        channels: 1,
        encoding: 'int16',
      });

      this.micListenerSub = stream.addListener(
        'audioStreamBuffer',
        (buffer: AudioStreamBuffer) => {
          if (!this.isCapturing || !buffer?.data) return;

          const { pcm16kBase64, rms } = processRawPcmBufferTo16kMono(
            buffer.data,
            buffer.sampleRate || 16000,
            buffer.channels || 1
          );

          if (!pcm16kBase64) return;

          // 1. Enquanto a Cláudia está falando no viva-voz:
          // Enviamos silêncio digital (zeros) para manter o stream do Gemini vivo sem eco acústico!
          if (this.isPlayingAiAudio) {
            this.checkLocalBargeIn(rms);
            this.callbacks.onMicPcmChunk(getSilentPcm16kBase64(), 0);
            return;
          }

          // 2. Quando é a vez do usuário falar (Ouvindo):
          if (rms >= this.SPEECH_RMS_GATE) {
            this.speechTailFramesRemaining = this.SPEECH_TAIL_HOLD_FRAMES;
            this.callbacks.onMicPcmChunk(pcm16kBase64, rms);
          } else if (this.speechTailFramesRemaining > 0) {
            this.speechTailFramesRemaining -= 1;
            this.callbacks.onMicPcmChunk(pcm16kBase64, rms);
          } else {
            this.callbacks.onMicPcmChunk(getSilentPcm16kBase64(), 0);
          }
        }
      );

      this.activeMicStream = stream;
      void stream.start().catch((err) => {
        console.warn('[AudioStreamService] Erro ao iniciar AudioStream:', err);
      });
    } catch (err) {
      console.warn('[AudioStreamService] Falha ao criar AudioStream:', err);
      this.isCapturing = false;
    }
  }

  private checkLocalBargeIn(rms: number): void {
    if (rms > this.BARGE_IN_RMS_THRESHOLD) {
      this.consecutiveVoiceFrames += 1;
      if (this.consecutiveVoiceFrames >= this.BARGE_IN_REQUIRED_FRAMES) {
        this.consecutiveVoiceFrames = 0;
        this.stopPlaybackImmediately();
        this.callbacks.onLocalBargeInDetected();
      }
    } else {
      this.consecutiveVoiceFrames = 0;
    }
  }

  /**
   * Enfileira chunks de áudio PCM 24kHz recebidos via WebSocket da IA
   */
  public enqueueAiAudioChunk(pcm24kBase64: string): void {
    if (this.incomingPcmQueue.length === 0 && !this.isPlayingAiAudio) {
      this.isTurnStreamComplete = false;
    }
    this.incomingPcmQueue.push(pcm24kBase64);

    if (
      !this.isDrainingQueue &&
      (this.incomingPcmQueue.length >= this.MIN_CHUNKS_FOR_SMOOTH_SEGMENT ||
        this.isTurnStreamComplete)
    ) {
      void this.drainPlaybackQueue();
    }
  }

  /**
   * Sinaliza que o servidor terminou de enviar todos os chunks de áudio da fala atual
   */
  public markTurnComplete(): void {
    this.isTurnStreamComplete = true;
    if (!this.isDrainingQueue && this.incomingPcmQueue.length > 0) {
      void this.drainPlaybackQueue();
    }
  }

  private async drainPlaybackQueue(): Promise<void> {
    if (this.isDrainingQueue) return;
    this.isDrainingQueue = true;
    const currentGen = this.playbackGeneration;

    try {
      while (
        this.incomingPcmQueue.length > 0 &&
        currentGen === this.playbackGeneration
      ) {
        if (
          !this.isTurnStreamComplete &&
          this.incomingPcmQueue.length < this.MIN_CHUNKS_FOR_SMOOTH_SEGMENT
        ) {
          await new Promise((r) => setTimeout(r, 220));
          if (currentGen !== this.playbackGeneration) break;
        }

        const batch = this.incomingPcmQueue.splice(
          0,
          this.incomingPcmQueue.length
        );
        if (batch.length === 0) break;

        const { wavBase64, durationMs } = createWavBase64FromPcmChunks(
          batch,
          24000,
          1,
          16
        );
        const tempFileUri = `${
          FileSystem.cacheDirectory || ''
        }claudia_audio_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 6)}.wav`;

        await FileSystem.writeAsStringAsync(tempFileUri, wavBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        if (currentGen !== this.playbackGeneration) {
          void FileSystem.deleteAsync(tempFileUri, { idempotent: true }).catch(
            () => {}
          );
          break;
        }

        if (!this.isPlayingAiAudio) {
          this.isPlayingAiAudio = true;
          this.callbacks.onPlaybackStateChange(true);
        }

        await this.playWavFile(tempFileUri, durationMs, currentGen);
        void FileSystem.deleteAsync(tempFileUri, { idempotent: true }).catch(
          () => {}
        );
      }
    } finally {
      this.isDrainingQueue = false;
      if (this.incomingPcmQueue.length === 0 && this.isPlayingAiAudio) {
        this.isPlayingAiAudio = false;
        this.callbacks.onPlaybackStateChange(false);
      }
    }
  }

  private playWavFile(
    fileUri: string,
    durationMs: number,
    generation: number
  ): Promise<void> {
    return new Promise((resolve) => {
      if (generation !== this.playbackGeneration) {
        resolve();
        return;
      }

      try {
        const player = createAudioPlayer(
          { uri: fileUri },
          { updateInterval: 80 }
        );
        this.activePlayer = player;
        player.volume = 1.0;

        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(watchdogTimer);
          sub.remove();
          if (this.activePlayer === player) {
            this.activePlayer = null;
          }
          try {
            player.remove();
          } catch {
            // Ignora se já removido
          }
          resolve();
        };

        // Watchdog baseado na duração exata do WAV (+450ms de margem) para NUNCA travar
        // caso o evento didJustFinish falhe no Android
        const watchdogTimer = setTimeout(() => {
          finish();
        }, durationMs + 450);

        const sub = player.addListener('playbackStatusUpdate', (status) => {
          if (generation !== this.playbackGeneration) {
            finish();
            return;
          }
          if (status.didJustFinish || status.error) {
            finish();
          }
        });

        player.play();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Cancela IMEDIATAMENTE toda reprodução de áudio da IA e esvazia o buffer (Barge-in)
   */
  public stopPlaybackImmediately(): void {
    this.playbackGeneration += 1;
    this.incomingPcmQueue = [];
    this.isTurnStreamComplete = true;
    this.isPlayingAiAudio = false;
    this.callbacks.onPlaybackStateChange(false);

    if (this.activePlayer) {
      const playerToStop = this.activePlayer;
      this.activePlayer = null;
      try {
        playerToStop.pause();
        playerToStop.remove();
      } catch {
        // Ignora erro ao limpar player
      }
    }
  }

  /**
   * Encerra totalmente captura de microfone e reprodução
   */
  public stopAll(): void {
    if (this.isCapturing) {
      this.isCapturing = false;

      if (this.micListenerSub) {
        try {
          this.micListenerSub.remove();
        } catch {
          // Ignora
        }
        this.micListenerSub = null;
      }

      if (this.activeMicStream) {
        try {
          this.activeMicStream.stop();
        } catch {
          // Ignora
        }
        this.activeMicStream = null;
      }
    }
    this.stopPlaybackImmediately();
  }
}
