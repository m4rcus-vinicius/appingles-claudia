import WebSocket from 'ws';
import {
  acquireLeastLoadedApiKey,
  CONFIG,
  getAllApiKeys,
  getNextFallbackApiKey,
  releaseApiKey,
} from '../config.js';
import {
  buildTutorSystemInstruction,
  HumorIntensity,
  UNFILTERED_SAFETY_SETTINGS,
} from '../prompts/tutorPersona.js';

export interface GrammarCorrectionPayload {
  id: string;
  timestamp: string;
  userSaid: string;
  correction: string;
  explanationPt: string;
  category: 'grammar' | 'vocabulary' | 'pronunciation' | 'naturalness';
}

export interface GeminiLiveCallbacks {
  onReady: () => void;
  onAudioChunk: (pcm24kBase64: string) => void;
  onTurnComplete: () => void;
  onStatusChange: (status: 'listening' | 'thinking' | 'speaking') => void;
  onInterrupted: () => void;
  onTranscript: (role: 'user' | 'tutor', text: string) => void;
  onGrammarCorrection: (correction: GrammarCorrectionPayload) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

// Frame de 100ms de silêncio digital puro em 16kHz 16-bit mono (3200 bytes de zeros)
const SILENT_100MS_PCM_16K_BASE64 = Buffer.alloc(3200, 0).toString('base64');

/**
 * Gerencia uma sessão WebSocket bidirecional com a Gemini Multimodal Live API
 * (BidiGenerateContent):
 * - Distribui automaticamente múltiplos usuários simultâneos entre o pool de chaves GEMINI_API_KEY.
 * - Consolida os pacotes de áudio de cada fala da Cláudia em um único bloco contínuo
 *   para garantir que frases longas NUNCA sejam cortadas na metade no celular.
 * - Bloqueia eco acústico no servidor durante a geração e reprodução da fala da Cláudia,
 *   evitando auto-interrupções falsas por ruído ou retorno do alto-falante.
 */
export class GeminiLiveSession {
  private geminiWs: WebSocket | null = null;
  private isSetupComplete = false;
  private isClosedByClient = false;
  private hasSentInitialGreeting = false;
  private intensity: HumorIntensity;
  private callbacks: GeminiLiveCallbacks;
  private sessionApiKey = '';

  // Buffer de consolidação de áudio do turno atual da Cláudia
  private currentTurnPcmBuffers: Buffer[] = [];
  private isGeneratingModelTurn = false;
  private muteMicUntilTimestamp = 0;

  private currentUserTranscript = '';
  private lastUserTranscript = '';
  private currentTutorTranscript = '';

  constructor(intensity: HumorIntensity, callbacks: GeminiLiveCallbacks) {
    this.intensity = intensity;
    this.callbacks = callbacks;
  }

  public connect(rotateKey = false): void {
    if (!this.sessionApiKey) {
      this.sessionApiKey = acquireLeastLoadedApiKey();
    } else if (rotateKey) {
      releaseApiKey(this.sessionApiKey);
      this.sessionApiKey = getNextFallbackApiKey(this.sessionApiKey);
    }

    if (!this.sessionApiKey) {
      this.callbacks.onError(
        'GEMINI_API_KEY não configurada no servidor backend (.env). Configure sua chave do Google AI Studio.'
      );
      return;
    }

    this.isClosedByClient = false;
    const url = `${CONFIG.geminiWsEndpoint}?key=${encodeURIComponent(this.sessionApiKey)}`;
    this.geminiWs = new WebSocket(url);

    this.geminiWs.on('open', () => {
      this.sendSetupMessage();
    });

    this.geminiWs.on('message', (data: WebSocket.RawData) => {
      this.handleGeminiMessage(data);
    });

    this.geminiWs.on('error', (err) => {
      console.error('[GeminiLiveSession] Erro no WebSocket Gemini:', err.message);
    });

    this.geminiWs.on('close', (code, reason) => {
      const reasonStr = reason.toString();
      console.log(
        `[GeminiLiveSession] Conexão encerrada (code=${code}, reason=${reasonStr})`
      );
      this.isSetupComplete = false;
      this.currentTurnPcmBuffers = [];
      this.isGeneratingModelTurn = false;

      if (!this.isClosedByClient) {
        console.log(
          '[GeminiLiveSession] Reconectando automaticamente ao Gemini Live em 600ms (rotacionando chave se houver pool)...'
        );
        setTimeout(() => {
          if (!this.isClosedByClient) {
            this.connect(true);
          }
        }, 600);
        return;
      }

      this.callbacks.onClose();
    });
  }

  private sendSetupMessage(): void {
    const setupPayload = {
      setup: {
        model: CONFIG.geminiLiveModel,
        generationConfig: {
          responseModalities: ['AUDIO'],
          temperature: 0.9,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: CONFIG.geminiVoiceName,
              },
            },
          },
        },
        safetySettings: UNFILTERED_SAFETY_SETTINGS,
        systemInstruction: {
          parts: [
            {
              text: buildTutorSystemInstruction(this.intensity),
            },
          ],
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
            endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
            prefixPaddingMs: 250,
            silenceDurationMs: 750,
          },
          // Desativa interrupção automática por ruído no meio da geração do turno da IA;
          // o usuário pode cortar a fala a qualquer momento pelo botão "Cortar Fala"
          activityHandling: 'NO_INTERRUPTION',
        },
      },
    };

    this.sendRawJson(setupPayload);
  }

  /**
   * Dispara uma saudação inicial apenas na primeira conexão da sessão
   */
  public triggerInitialGreeting(): void {
    if (!this.isSetupComplete || this.hasSentInitialGreeting) return;
    this.hasSentInitialGreeting = true;
    this.isGeneratingModelTurn = true;

    const greetingPrompt = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [
              {
                text: '[SYSTEM: O aluno acabou de abrir o microfone. Comece a conversa em inglês com energia, se apresentando rapidamente como Cláudia e fazendo uma pergunta curta e direta sobre o dia dele para testar o inglês dele.]',
              },
            ],
          },
        ],
        turnComplete: true,
      },
    };

    this.callbacks.onStatusChange('thinking');
    this.sendRawJson(greetingPrompt);
  }

  /**
   * Recebe chunks PCM 16kHz 16-bit mono (em base64) vindos do app mobile e repassa ao Gemini Live.
   * Enquanto a Cláudia está gerando ou reproduzindo sua fala no celular, envia silêncio digital
   * para evitar que o eco do alto-falante interrompa ou corte a frase dela na metade.
   */
  public sendAudioChunk(pcm16kBase64: string): void {
    if (!this.isSetupComplete || !this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) {
      return;
    }

    const shouldMuteEcho =
      this.isGeneratingModelTurn || Date.now() < this.muteMicUntilTimestamp;

    const dataToSend = shouldMuteEcho ? SILENT_100MS_PCM_16K_BASE64 : pcm16kBase64;

    const realtimeAudioMessage = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: `audio/pcm;rate=${CONFIG.audio.inputSampleRate}`,
            data: dataToSend,
          },
        ],
      },
    };

    this.sendRawJson(realtimeAudioMessage);
  }

  /**
   * Libera imediatamente a escuta do microfone quando o usuário toca em "Cortar Fala"
   */
  public handleClientBargeIn(): void {
    this.currentTurnPcmBuffers = [];
    this.isGeneratingModelTurn = false;
    this.muteMicUntilTimestamp = 0;
  }

  /**
   * Atualiza dinamicamente o modo de intensidade do humor (Moderado vs Roast) durante a sessão
   */
  public updateIntensity(newIntensity: HumorIntensity): void {
    this.intensity = newIntensity;
    if (!this.isSetupComplete) return;

    const modeNotification = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [
              {
                text:
                  newIntensity === 'roast'
                    ? '[SYSTEM UPDATE: O usuário mudou a configuração para MODO SEM FILTRO / ROAST. Aumente o nível de deboche, sarcasmo e palavrões coloquiais em português nas próximas correções!]'
                    : '[SYSTEM UPDATE: O usuário mudou a configuração para MODO MODERADO. Mantenha o tom irônico e divertido nas correções em português, mas reduza os palavrões pesados.]',
              },
            ],
          },
        ],
        turnComplete: false,
      },
    };

    this.sendRawJson(modeNotification);
  }

  /**
   * Processa as mensagens em tempo real enviadas pela Gemini Multimodal Live API
   */
  private handleGeminiMessage(rawData: WebSocket.RawData): void {
    try {
      const textData = rawData.toString('utf-8');
      const response = JSON.parse(textData);

      // 1. Confirmação de Setup concluído
      if (response.setupComplete !== undefined) {
        this.isSetupComplete = true;
        this.callbacks.onReady();
        this.callbacks.onStatusChange('listening');
        this.triggerInitialGreeting();
        return;
      }

      // 2. Conteúdo do Servidor
      const serverContent = response.serverContent;
      if (serverContent) {
        if (serverContent.inputTranscription?.text) {
          this.currentUserTranscript += serverContent.inputTranscription.text;
        }
        if (serverContent.outputTranscription?.text) {
          this.currentTutorTranscript += serverContent.outputTranscription.text;
        }

        // Acumula todas as partes de áudio PCM 24kHz da resposta da Cláudia
        const parts = serverContent.modelTurn?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (part.inlineData?.data && part.inlineData?.mimeType?.startsWith('audio/pcm')) {
              if (!this.isGeneratingModelTurn) {
                this.isGeneratingModelTurn = true;
                this.callbacks.onStatusChange('thinking');
              }
              this.currentTurnPcmBuffers.push(Buffer.from(part.inlineData.data, 'base64'));
            }
          }
        }

        // Assim que a frase completa da Cláudia termina de ser gerada, envia o áudio inteiro
        // consolidado em uma única mensagem contínua para o celular tocar do início ao fim sem cortes!
        if (serverContent.turnComplete === true) {
          this.isGeneratingModelTurn = false;

          if (this.currentTurnPcmBuffers.length > 0) {
            const fullTurnPcm = Buffer.concat(this.currentTurnPcmBuffers);
            this.currentTurnPcmBuffers = [];

            // Calcula a duração exata do áudio em ms (24000 Hz * 2 bytes = 48 bytes/ms)
            const playbackDurationMs = Math.ceil(fullTurnPcm.length / 48) + 500;
            this.muteMicUntilTimestamp = Date.now() + playbackDurationMs;

            this.callbacks.onStatusChange('speaking');
            this.callbacks.onAudioChunk(fullTurnPcm.toString('base64'));
          }

          this.callbacks.onTurnComplete();

          const rawUserTxt = this.currentUserTranscript.trim();
          const userTxt = rawUserTxt || this.lastUserTranscript;
          if (rawUserTxt) {
            this.lastUserTranscript = rawUserTxt;
          }
          const tutorTxt = this.currentTutorTranscript.trim();
          this.currentUserTranscript = '';
          this.currentTutorTranscript = '';

          if (tutorTxt.length > 5) {
            console.log(
              `[GeminiLiveSession] Turno finalizado | Aluno: "${userTxt}" | Cláudia: "${tutorTxt}"`
            );
            void this.extractCorrectionIfAny(userTxt, tutorTxt);
          }
        }
      }
    } catch (err) {
      console.error('[GeminiLiveSession] Falha ao processar mensagem JSON do Gemini:', err);
    }
  }

  /**
   * Analisa em background (sem travar o áudio) se a Cláudia deu alguma bronca/correção em português
   * neste turno e envia para o Painel de Feedback do celular.
   *
   * Camada 1: Usa BidiGenerateContent (Live API WebSocket) com Function Calling — não possui o limite
   *           de 20 requisições/dia da API REST gratuita e responde em ~2-3s.
   * Camada 2: Se necessário, faz fallback automático entre múltiplos modelos Flash REST com thinkingBudget: 0.
   */
  private async extractCorrectionIfAny(userSaid: string, tutorSaid: string): Promise<void> {
    try {
      // Usa primeiro o pool de 8 modelos REST (0 consumo de WebSockets simultâneos e ~0.9s de resposta);
      // se a cota diária REST de todas as chaves acabar, usa o extrator Live WebSocket ilimitado!
      let parsed = await this.extractViaRestPool(userSaid, tutorSaid);
      if (!parsed) {
        parsed = await this.extractViaLiveWs(userSaid, tutorSaid);
      }

      if (parsed?.hasCorrection && (parsed.correction || parsed.explanationPt)) {
        const validCategories = ['grammar', 'vocabulary', 'pronunciation', 'naturalness'];
        const rawCategory = String(parsed.category || 'grammar').toLowerCase();
        const category = (
          validCategories.includes(rawCategory) ? rawCategory : 'grammar'
        ) as GrammarCorrectionPayload['category'];

        const correctionPayload: GrammarCorrectionPayload = {
          id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toISOString(),
          userSaid: String(parsed.userSaid || userSaid || 'Expressão incorreta').trim(),
          correction: String(parsed.correction || 'Veja a explicação abaixo').trim(),
          explanationPt: String(
            parsed.explanationPt || 'Correção feita pela Cláudia durante a conversa.'
          ).trim(),
          category,
        };
        console.log('[GeminiLiveSession] Nova correção anotada no painel:', correctionPayload);
        this.callbacks.onGrammarCorrection(correctionPayload);
      }
    } catch (err) {
      console.error('[GeminiLiveSession] Erro ao extrair correção:', err);
    }
  }

  /**
   * Extrator via Gemini Multimodal Live WebSocket (sem limite de 20 req/dia no Free Tier)
   */
  private extractViaLiveWs(userSaid: string, tutorSaid: string): Promise<any | null> {
    return new Promise((resolve) => {
      const extractorKey = getNextFallbackApiKey(this.sessionApiKey) || this.sessionApiKey || CONFIG.geminiApiKey;
      const url = `${CONFIG.geminiWsEndpoint}?key=${encodeURIComponent(extractorKey)}`;
      const ws = new WebSocket(url);
      let resolved = false;

      const finish = (result: any | null) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        try {
          ws.removeAllListeners();
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch {
          // ignore close errors
        }
        resolve(result);
      };

      const timeout = setTimeout(() => finish(null), 7000);

      ws.on('error', () => finish(null));
      ws.on('close', () => finish(null));

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            setup: {
              model: CONFIG.geminiLiveModel,
              generationConfig: {
                responseModalities: ['AUDIO'],
                temperature: 0.1,
              },
              safetySettings: UNFILTERED_SAFETY_SETTINGS,
              tools: [
                {
                  functionDeclarations: [
                    {
                      name: 'report_correction_analysis',
                      description:
                        'Obrigatoriamente chamada para reportar se houve ou não correção, bronca, tradução ou dica de inglês na fala da Cláudia.',
                      parameters: {
                        type: 'OBJECT',
                        properties: {
                          hasCorrection: {
                            type: 'BOOLEAN',
                            description:
                              'true se a Cláudia corrigiu um erro, deu bronca explicando como falar certo em inglês ou mandou o aluno repetir uma frase corrigida. false se ela apenas conversou em inglês ou se ela apenas elogiou/comemorou que o aluno repetiu a frase corretamente.',
                          },
                          userSaid: {
                            type: 'STRING',
                            description:
                              'A frase ou palavra errada (ou em português) que o aluno disse. Extraia da fala do aluno ou da citação feita pela Cláudia.',
                          },
                          correction: {
                            type: 'STRING',
                            description:
                              'A forma correta em inglês ensinada ou sugerida pela Cláudia.',
                          },
                          explanationPt: {
                            type: 'STRING',
                            description:
                              'A bronca e explicação em português que a Cláudia deu para o aluno.',
                          },
                          category: {
                            type: 'STRING',
                            enum: ['grammar', 'vocabulary', 'pronunciation', 'naturalness'],
                          },
                        },
                        required: [
                          'hasCorrection',
                          'userSaid',
                          'correction',
                          'explanationPt',
                          'category',
                        ],
                      },
                    },
                  ],
                },
              ],
              systemInstruction: {
                parts: [
                  {
                    text: 'Você é o analisador de correções da tutora Cláudia. Para TODA mensagem recebida, chame imediatamente report_correction_analysis. Marque hasCorrection=true sempre que a Cláudia corrigir um erro ou ensinar a forma correta em inglês. Se ela apenas elogiar que o aluno acertou a repetição ou falar apenas em inglês sem corrigir erro, marque hasCorrection=false.',
                  },
                ],
              },
            },
          })
        );
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString('utf-8'));
          if (msg.setupComplete !== undefined) {
            ws.send(
              JSON.stringify({
                clientContent: {
                  turns: [
                    {
                      role: 'user',
                      parts: [
                        {
                          text: `Analise este turno e chame report_correction_analysis imediatamente:\n${
                            userSaid ? `Transcrição do aluno: "${userSaid}"\n` : ''
                          }Transcrição da resposta da Cláudia: "${tutorSaid}"`,
                        },
                      ],
                    },
                  ],
                  turnComplete: true,
                },
              })
            );
            return;
          }

          if (msg.toolCall?.functionCalls?.length) {
            finish(msg.toolCall.functionCalls[0].args);
            return;
          }

          if (msg.serverContent?.turnComplete === true) {
            finish(null);
          }
        } catch {
          finish(null);
        }
      });
    });
  }

  /**
   * Pool de 8 modelos Flash REST combinado com todas as chaves configuradas no pool
   * (zero conexões WebSocket extras, garantindo máxima capacidade para múltiplos usuários simultâneos)
   */
  private async extractViaRestPool(userSaid: string, tutorSaid: string): Promise<any | null> {
    const fallbackModels = [
      { name: 'gemini-3.5-flash-lite', disableThinking: false },
      { name: 'gemini-flash-lite-latest', disableThinking: false },
      { name: 'gemini-3.1-flash-lite-preview', disableThinking: false },
      { name: 'gemini-3.6-flash', disableThinking: true },
      { name: 'gemini-3.5-flash', disableThinking: true },
      { name: 'gemini-3.7-flash', disableThinking: true },
      { name: 'gemini-3-flash-preview', disableThinking: false },
      { name: 'gemini-3.8-flash', disableThinking: true },
    ];

    const promptText = `Analise a fala abaixo da tutora de inglês Cláudia (que conversa em inglês, mas muda para o português quando o aluno comete algum erro).
${userSaid ? `Transcrição do aluno: "${userSaid}"\n` : ''}Transcrição da resposta da Cláudia: "${tutorSaid}"

Verifique se nessa fala a Cláudia corrigiu algum erro gramatical, vocabulário, tradução literal, pronúncia ou deu bronca em português ensinando como falar em inglês. (Se ela apenas comemorou que o aluno repetiu certo, marque hasCorrection: false).
Retorne APENAS um objeto JSON válido com: hasCorrection (boolean), userSaid (string), correction (string), explanationPt (string), category ("grammar" | "vocabulary" | "pronunciation" | "naturalness").`;

    const allKeys = getAllApiKeys();
    const keysToTry = allKeys.length > 0 ? allKeys : [CONFIG.geminiApiKey];

    for (const apiKey of keysToTry) {
      for (const modelCfg of fallbackModels) {
        try {
          const generationConfig: Record<string, unknown> = {
            responseMimeType: 'application/json',
            temperature: 0.1,
          };
          if (modelCfg.disableThinking) {
            generationConfig.thinkingConfig = { thinkingBudget: 0 };
          }

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelCfg.name}:generateContent?key=${encodeURIComponent(
              apiKey
            )}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                safetySettings: UNFILTERED_SAFETY_SETTINGS,
                contents: [{ role: 'user', parts: [{ text: promptText }] }],
                generationConfig,
              }),
            }
          );

          if (!res.ok) continue;
          const data = (await res.json()) as any;
          const parts = data?.candidates?.[0]?.content?.parts || [];
          const textPart = parts.find((p: any) => p.text && !p.thought) || parts[0];
          if (!textPart?.text) continue;

          const cleaned = String(textPart.text)
            .replace(/^```json\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
          return JSON.parse(cleaned);
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  private sendRawJson(payload: unknown): void {
    if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN) {
      this.geminiWs.send(JSON.stringify(payload));
    }
  }

  public close(): void {
    this.isClosedByClient = true;
    if (this.sessionApiKey) {
      releaseApiKey(this.sessionApiKey);
      this.sessionApiKey = '';
    }
    if (this.geminiWs) {
      this.geminiWs.removeAllListeners();
      if (this.geminiWs.readyState === WebSocket.OPEN) {
        this.geminiWs.close();
      }
      this.geminiWs = null;
    }
    this.isSetupComplete = false;
  }
}
