"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiLiveSession = void 0;
const ws_1 = __importDefault(require("ws"));
const config_js_1 = require("../config.js");
const tutorPersona_js_1 = require("../prompts/tutorPersona.js");
// Frame de 100ms de silêncio digital puro em 16kHz 16-bit mono (3200 bytes de zeros)
const SILENT_100MS_PCM_16K_BASE64 = Buffer.alloc(3200, 0).toString('base64');
/**
 * Gerencia uma sessão WebSocket bidirecional com a Gemini Multimodal Live API
 * (BidiGenerateContent):
 * - Consolida os pacotes de áudio de cada fala da Cláudia em um único bloco contínuo
 *   para garantir que frases longas NUNCA sejam cortadas na metade no celular.
 * - Bloqueia eco acústico no servidor durante a geração e reprodução da fala da Cláudia,
 *   evitando auto-interrupções falsas por ruído ou retorno do alto-falante.
 */
class GeminiLiveSession {
    geminiWs = null;
    isSetupComplete = false;
    isClosedByClient = false;
    hasSentInitialGreeting = false;
    intensity;
    callbacks;
    // Buffer de consolidação de áudio do turno atual da Cláudia
    currentTurnPcmBuffers = [];
    isGeneratingModelTurn = false;
    muteMicUntilTimestamp = 0;
    currentUserTranscript = '';
    lastUserTranscript = '';
    currentTutorTranscript = '';
    constructor(intensity, callbacks) {
        this.intensity = intensity;
        this.callbacks = callbacks;
    }
    connect() {
        if (!config_js_1.CONFIG.geminiApiKey || config_js_1.CONFIG.geminiApiKey === 'coloque_sua_chave_aqui') {
            this.callbacks.onError('GEMINI_API_KEY não configurada no servidor backend (.env). Configure sua chave do Google AI Studio.');
            return;
        }
        this.isClosedByClient = false;
        const url = `${config_js_1.CONFIG.geminiWsEndpoint}?key=${encodeURIComponent(config_js_1.CONFIG.geminiApiKey)}`;
        this.geminiWs = new ws_1.default(url);
        this.geminiWs.on('open', () => {
            this.sendSetupMessage();
        });
        this.geminiWs.on('message', (data) => {
            this.handleGeminiMessage(data);
        });
        this.geminiWs.on('error', (err) => {
            console.error('[GeminiLiveSession] Erro no WebSocket Gemini:', err.message);
        });
        this.geminiWs.on('close', (code, reason) => {
            const reasonStr = reason.toString();
            console.log(`[GeminiLiveSession] Conexão encerrada (code=${code}, reason=${reasonStr})`);
            this.isSetupComplete = false;
            this.currentTurnPcmBuffers = [];
            this.isGeneratingModelTurn = false;
            if (!this.isClosedByClient) {
                console.log('[GeminiLiveSession] Reconectando automaticamente ao Gemini Live em 600ms...');
                setTimeout(() => {
                    if (!this.isClosedByClient) {
                        this.connect();
                    }
                }, 600);
                return;
            }
            this.callbacks.onClose();
        });
    }
    sendSetupMessage() {
        const setupPayload = {
            setup: {
                model: config_js_1.CONFIG.geminiLiveModel,
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    temperature: 0.9,
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: config_js_1.CONFIG.geminiVoiceName,
                            },
                        },
                    },
                },
                safetySettings: tutorPersona_js_1.UNFILTERED_SAFETY_SETTINGS,
                systemInstruction: {
                    parts: [
                        {
                            text: (0, tutorPersona_js_1.buildTutorSystemInstruction)(this.intensity),
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
    triggerInitialGreeting() {
        if (!this.isSetupComplete || this.hasSentInitialGreeting)
            return;
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
    sendAudioChunk(pcm16kBase64) {
        if (!this.isSetupComplete || !this.geminiWs || this.geminiWs.readyState !== ws_1.default.OPEN) {
            return;
        }
        const shouldMuteEcho = this.isGeneratingModelTurn || Date.now() < this.muteMicUntilTimestamp;
        const dataToSend = shouldMuteEcho ? SILENT_100MS_PCM_16K_BASE64 : pcm16kBase64;
        const realtimeAudioMessage = {
            realtimeInput: {
                mediaChunks: [
                    {
                        mimeType: `audio/pcm;rate=${config_js_1.CONFIG.audio.inputSampleRate}`,
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
    handleClientBargeIn() {
        this.currentTurnPcmBuffers = [];
        this.isGeneratingModelTurn = false;
        this.muteMicUntilTimestamp = 0;
    }
    /**
     * Atualiza dinamicamente o modo de intensidade do humor (Moderado vs Roast) durante a sessão
     */
    updateIntensity(newIntensity) {
        this.intensity = newIntensity;
        if (!this.isSetupComplete)
            return;
        const modeNotification = {
            clientContent: {
                turns: [
                    {
                        role: 'user',
                        parts: [
                            {
                                text: newIntensity === 'roast'
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
    handleGeminiMessage(rawData) {
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
                        console.log(`[GeminiLiveSession] Turno finalizado | Aluno: "${userTxt}" | Cláudia: "${tutorTxt}"`);
                        void this.extractCorrectionIfAny(userTxt, tutorTxt);
                    }
                }
            }
        }
        catch (err) {
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
    async extractCorrectionIfAny(userSaid, tutorSaid) {
        try {
            let parsed = await this.extractViaLiveWs(userSaid, tutorSaid);
            if (!parsed) {
                parsed = await this.extractViaRestPool(userSaid, tutorSaid);
            }
            if (parsed?.hasCorrection && (parsed.correction || parsed.explanationPt)) {
                const validCategories = ['grammar', 'vocabulary', 'pronunciation', 'naturalness'];
                const rawCategory = String(parsed.category || 'grammar').toLowerCase();
                const category = (validCategories.includes(rawCategory) ? rawCategory : 'grammar');
                const correctionPayload = {
                    id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    timestamp: new Date().toISOString(),
                    userSaid: String(parsed.userSaid || userSaid || 'Expressão incorreta').trim(),
                    correction: String(parsed.correction || 'Veja a explicação abaixo').trim(),
                    explanationPt: String(parsed.explanationPt || 'Correção feita pela Cláudia durante a conversa.').trim(),
                    category,
                };
                console.log('[GeminiLiveSession] Nova correção anotada no painel:', correctionPayload);
                this.callbacks.onGrammarCorrection(correctionPayload);
            }
        }
        catch (err) {
            console.error('[GeminiLiveSession] Erro ao extrair correção:', err);
        }
    }
    /**
     * Extrator primário via Gemini Multimodal Live WebSocket (sem limite de 20 req/dia no Free Tier)
     */
    extractViaLiveWs(userSaid, tutorSaid) {
        return new Promise((resolve) => {
            const url = `${config_js_1.CONFIG.geminiWsEndpoint}?key=${encodeURIComponent(config_js_1.CONFIG.geminiApiKey)}`;
            const ws = new ws_1.default(url);
            let resolved = false;
            const finish = (result) => {
                if (resolved)
                    return;
                resolved = true;
                clearTimeout(timeout);
                try {
                    ws.removeAllListeners();
                    if (ws.readyState === ws_1.default.OPEN || ws.readyState === ws_1.default.CONNECTING) {
                        ws.close();
                    }
                }
                catch {
                    // ignore close errors
                }
                resolve(result);
            };
            const timeout = setTimeout(() => finish(null), 7000);
            ws.on('error', () => finish(null));
            ws.on('close', () => finish(null));
            ws.on('open', () => {
                ws.send(JSON.stringify({
                    setup: {
                        model: config_js_1.CONFIG.geminiLiveModel,
                        generationConfig: {
                            responseModalities: ['AUDIO'],
                            temperature: 0.1,
                        },
                        safetySettings: tutorPersona_js_1.UNFILTERED_SAFETY_SETTINGS,
                        tools: [
                            {
                                functionDeclarations: [
                                    {
                                        name: 'report_correction_analysis',
                                        description: 'Obrigatoriamente chamada para reportar se houve ou não correção, bronca, tradução ou dica de inglês na fala da Cláudia.',
                                        parameters: {
                                            type: 'OBJECT',
                                            properties: {
                                                hasCorrection: {
                                                    type: 'BOOLEAN',
                                                    description: 'true se a Cláudia corrigiu um erro, deu bronca explicando como falar certo em inglês ou mandou o aluno repetir uma frase corrigida. false se ela apenas conversou em inglês ou se ela apenas elogiou/comemorou que o aluno repetiu a frase corretamente.',
                                                },
                                                userSaid: {
                                                    type: 'STRING',
                                                    description: 'A frase ou palavra errada (ou em português) que o aluno disse. Extraia da fala do aluno ou da citação feita pela Cláudia.',
                                                },
                                                correction: {
                                                    type: 'STRING',
                                                    description: 'A forma correta em inglês ensinada ou sugerida pela Cláudia.',
                                                },
                                                explanationPt: {
                                                    type: 'STRING',
                                                    description: 'A bronca e explicação em português que a Cláudia deu para o aluno.',
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
                }));
            });
            ws.on('message', (raw) => {
                try {
                    const msg = JSON.parse(raw.toString('utf-8'));
                    if (msg.setupComplete !== undefined) {
                        ws.send(JSON.stringify({
                            clientContent: {
                                turns: [
                                    {
                                        role: 'user',
                                        parts: [
                                            {
                                                text: `Analise este turno e chame report_correction_analysis imediatamente:\n${userSaid ? `Transcrição do aluno: "${userSaid}"\n` : ''}Transcrição da resposta da Cláudia: "${tutorSaid}"`,
                                            },
                                        ],
                                    },
                                ],
                                turnComplete: true,
                            },
                        }));
                        return;
                    }
                    if (msg.toolCall?.functionCalls?.length) {
                        finish(msg.toolCall.functionCalls[0].args);
                        return;
                    }
                    if (msg.serverContent?.turnComplete === true) {
                        finish(null);
                    }
                }
                catch {
                    finish(null);
                }
            });
        });
    }
    /**
     * Pool secundário de fallback REST (rotaciona entre 8 modelos Flash independentes caso necessário)
     */
    async extractViaRestPool(userSaid, tutorSaid) {
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

Verifique se nessa fala a Cláudia corrigiu algum erro gramatical, vocabulário, tradução literal, pronúncia ou deu bronca em português ensinando como falar em inglês.
Retorne APENAS um objeto JSON válido com: hasCorrection (boolean), userSaid (string), correction (string), explanationPt (string), category ("grammar" | "vocabulary" | "pronunciation" | "naturalness").`;
        for (const modelCfg of fallbackModels) {
            try {
                const generationConfig = {
                    responseMimeType: 'application/json',
                    temperature: 0.1,
                };
                if (modelCfg.disableThinking) {
                    generationConfig.thinkingConfig = { thinkingBudget: 0 };
                }
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelCfg.name}:generateContent?key=${encodeURIComponent(config_js_1.CONFIG.geminiApiKey)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        safetySettings: tutorPersona_js_1.UNFILTERED_SAFETY_SETTINGS,
                        contents: [{ role: 'user', parts: [{ text: promptText }] }],
                        generationConfig,
                    }),
                });
                if (!res.ok)
                    continue;
                const data = (await res.json());
                const parts = data?.candidates?.[0]?.content?.parts || [];
                const textPart = parts.find((p) => p.text && !p.thought) || parts[0];
                if (!textPart?.text)
                    continue;
                const cleaned = String(textPart.text)
                    .replace(/^```json\s*/i, '')
                    .replace(/```\s*$/i, '')
                    .trim();
                return JSON.parse(cleaned);
            }
            catch {
                continue;
            }
        }
        return null;
    }
    sendRawJson(payload) {
        if (this.geminiWs && this.geminiWs.readyState === ws_1.default.OPEN) {
            this.geminiWs.send(JSON.stringify(payload));
        }
    }
    close() {
        this.isClosedByClient = true;
        if (this.geminiWs) {
            this.geminiWs.removeAllListeners();
            if (this.geminiWs.readyState === ws_1.default.OPEN) {
                this.geminiWs.close();
            }
            this.geminiWs = null;
        }
        this.isSetupComplete = false;
    }
}
exports.GeminiLiveSession = GeminiLiveSession;
