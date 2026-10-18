import {
  GrammarCorrection,
  HumorIntensity,
  ServerMessage,
  SessionStatus,
} from '../types/tutor';

export interface TutorSocketCallbacks {
  onStatusChange: (status: SessionStatus) => void;
  onAudioChunk: (pcm24kBase64: string) => void;
  onTurnComplete: () => void;
  onBargeIn: () => void;
  onGrammarCorrection: (correction: GrammarCorrection) => void;
  onError: (message: string) => void;
}

/**
 * Cliente WebSocket que conecta o App Mobile ao Gateway Backend (/ws/tutor)
 */
export class TutorSocketClient {
  private ws: WebSocket | null = null;
  private callbacks: TutorSocketCallbacks;

  constructor(callbacks: TutorSocketCallbacks) {
    this.callbacks = callbacks;
  }

  public connect(backendWsUrl: string, intensity: HumorIntensity): void {
    this.disconnect();
    this.callbacks.onStatusChange('connecting');

    const separator = backendWsUrl.includes('?') ? '&' : '?';
    const fullUrl = `${backendWsUrl}${separator}intensity=${encodeURIComponent(intensity)}`;

    try {
      this.ws = new WebSocket(fullUrl);

      this.ws.onopen = () => {
        // Aguarda 'session_ready' do servidor (após handshake com Gemini Live)
      };

      this.ws.onmessage = (event) => {
        try {
          const message: ServerMessage = JSON.parse(String(event.data));
          this.handleServerMessage(message);
        } catch {
          // Ignora pacotes malformados
        }
      };

      this.ws.onerror = () => {
        this.callbacks.onError(
          'Não foi possível conectar ao servidor Gateway WebSocket. Verifique o endereço IP e se o backend está rodando.'
        );
        this.callbacks.onStatusChange('disconnected');
      };

      this.ws.onclose = () => {
        this.callbacks.onStatusChange('disconnected');
        this.ws = null;
      };
    } catch (err) {
      this.callbacks.onError(`Erro ao iniciar WebSocket: ${String(err)}`);
      this.callbacks.onStatusChange('disconnected');
    }
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'session_ready':
        this.callbacks.onStatusChange('listening');
        break;

      case 'status':
        this.callbacks.onStatusChange(msg.status);
        break;

      case 'audio_output':
        this.callbacks.onAudioChunk(msg.data);
        break;

      case 'turn_complete':
        this.callbacks.onTurnComplete();
        break;

      case 'barge_in':
        this.callbacks.onBargeIn();
        break;

      case 'grammar_correction':
        this.callbacks.onGrammarCorrection(msg.correction);
        break;

      case 'error':
        this.callbacks.onError(msg.message);
        break;

      default:
        break;
    }
  }

  /**
   * Envia chunk PCM 16kHz 16-bit mono para o Gateway
   */
  public sendAudioChunk(pcm16kBase64: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: 'audio_chunk',
        data: pcm16kBase64,
      })
    );
  }

  /**
   * Notifica o servidor que o usuário interrompeu a IA localmente (Barge-in)
   */
  public notifyClientBargeIn(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: 'client_barge_in',
      })
    );
  }

  /**
   * Altera em tempo real o nível de acidez/zombaria da tutora ("moderado" | "roast")
   */
  public setIntensity(intensity: HumorIntensity): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: 'set_intensity',
        intensity,
      })
    );
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}
