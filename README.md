# 🎙️ Rick — Tutor de Inglês Sem Filtro (Real-Time Speech-to-Speech)

Aplicativo móvel multiplataforma (**React Native / Expo**) integrado a um gateway **Node.js (Fastify + WebSocket)** conectado à **Gemini Multimodal Live API (`BidiGenerateContent`)** para prática de conversação em inglês por áudio nativo bidirecional de baixa latência.

---

## 🧠 Arquitetura e Diferenciais Técnicos

```
[App Mobile (React Native)]
   │  ▲
   │  │ WebSocket Bidirecional (/ws/tutor)
   │  │ • Upload: PCM 16kHz, 16-bit, Mono (com AEC de hardware)
   │  │ • Download: Streaming PCM 24kHz + Eventos Tool Call & Barge-In
   ▼  │
[Gateway Backend (Fastify + ws)]
   │  ▲
   │  │ WebSocket BidiGenerateContent (Protege a GEMINI_API_KEY)
   │  │ • Safety Settings: BLOCK_NONE (Permite humor ácido e palavrões coloquiais)
   │  │ • VAD Nativo: START_OF_ACTIVITY_INTERRUPTS (Barge-In nativo)
   │  │ • Function Calling: log_grammar_correction (Alimenta o Painel de Feedback)
   ▼  │
[Google Gemini Multimodal Live API]
```

### 1. Dinâmica Bilíngue (Code-Switching Imediato)
- **Conversa Principal em Inglês:** O tutor ("Rick") puxa assuntos cotidianos e conduz o diálogo em inglês natural.
- **Bronca Instantânea em Português:** Ao detectar qualquer erro gramatical (ex: *"I have 20 years"*), tradução literal bizarra ou travada, o Rick **muda imediatamente para o português** na mesma resposta de áudio para rir do erro, dar uma bronca ácida e explicar a regra sem rodeios, voltando logo em seguida para o inglês.
- **Dois Modos de Personalidade em Tempo Real:**
  - `🔥 Sem Filtro / Roast`: Debochado, impaciente e com palavrões coloquiais em português.
  - `😏 Moderado`: Irônico e ácido, porém sem palavrões pesados.

### 2. Suporte Duplo a Interrupções (Barge-In)
- **VAD Nativo na API (`START_OF_ACTIVITY_INTERRUPTS`):** Quando você fala enquanto o tutor está falando, o Gemini interrompe a geração e envia o evento `interrupted: true`, que faz o app mobile esvaziar a fila de reprodução instantaneamente.
- **VAD Local no Cliente (RMS Threshold):** O `AudioStreamService` monitora a energia RMS do microfone (com Cancelamento de Eco Acústico — `VOICE_COMMUNICATION` ativo) e corta o áudio do tutor em milissegundos assim que detecta sua voz.

### 3. Painel de Feedback em Tempo Real via Function Calling
- Toda vez que o usuário comete um erro, o modelo aciona a tool `log_grammar_correction` em paralelo à fala em áudio, enviando para a tela do celular:
  - ❌ O que o aluno falou errado (`userSaid`)
  - ✅ Como se diz corretamente em inglês (`correction`)
  - 🔥 A explicação/bronca em português (`explanationPt`)

---

## 📂 Estrutura do Projeto

```text
AppIngles/
├── README.md
├── backend/
│   ├── .env.example                  # Exemplo de variáveis de ambiente
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                  # Servidor Fastify + rota WebSocket /ws/tutor e /health
│       ├── config.ts                 # Configurações de áudio (16kHz in / 24kHz out) e endpoints
│       ├── prompts/
│       │   └── tutorPersona.ts       # System Prompt (Code-Switching), Tools e Safety BLOCK_NONE
│       └── services/
│           └── geminiLiveSession.ts  # Cliente WebSocket BidiGenerateContent do Gemini Live
└── mobile/
    ├── app.json                      # Permissões de microfone Android/iOS
    ├── index.js
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── App.tsx                   # Tela principal (Orb, Controles, Painel de Correções, Modal)
        ├── types/
        │   └── tutor.ts              # Tipagens do protocolo WebSocket e estados da sessão
        ├── utils/
        │   └── pcmWavUtils.ts        # Cálculo de RMS (VAD local) e empacotamento PCM -> WAV
        ├── services/
        │   ├── audioStreamService.ts # Captura PCM 16kHz com AEC + Fila de reprodução 24kHz + Barge-in
        │   └── tutorSocketClient.ts  # Cliente WebSocket mobile -> backend
        └── components/
            ├── VoiceOrb.tsx          # Indicador visual animado (Ouvindo, Processando, Falando)
            ├── CorrectionCard.tsx    # Card de correção gramatical e bronca em português
            └── IntensitySelector.tsx # Seletor "Moderado" vs "Modo Sem Filtro / Roast"
```

---

## ⚙️ Como Configurar e Executar Localmente

### Pré-requisitos
- **Node.js** 18+ instalado
- Uma chave de API do **Google AI Studio** ([aistudio.google.com](https://aistudio.google.com/)) com acesso ao Gemini 2.0 (`models/gemini-2.0-flash-exp`)
- Ambiente React Native / Expo configurado (Emulador Android, Simulador iOS ou dispositivo físico via Development Build)

---

### Passo 1: Configurar e Iniciar o Backend (Gateway WebSocket)

1. Entre na pasta `backend`:
   ```bash
   cd backend
   npm install
   ```

2. Crie o arquivo `.env` a partir do `.env.example`:
   ```bash
   cp .env.example .env
   ```

3. Edite o arquivo `backend/.env` e insira sua chave `GEMINI_API_KEY`:
   ```env
   GEMINI_API_KEY=AIzaSySuaChaveAqui...
   GEMINI_LIVE_MODEL=models/gemini-2.0-flash-exp
   GEMINI_VOICE_NAME=Puck
   PORT=3001
   HOST=0.0.0.0
   ```

4. Inicie o servidor em modo de desenvolvimento:
   ```bash
   npm run dev
   ```
   - O servidor estará ativo em `http://localhost:3001` (teste em `http://localhost:3001/health`).
   - O endpoint WebSocket estará disponível em `ws://localhost:3001/ws/tutor`.

---

### Passo 2: Configurar e Executar o App Mobile (React Native)

1. Em outro terminal, entre na pasta `mobile`:
   ```bash
   cd mobile
   npm install
   ```

2. Como o projeto utiliza captura nativa de buffer PCM bruto (`react-native-live-audio-stream`), execute com o build nativo do Expo:
   - **Android (Emulador ou Dispositivo USB):**
     ```bash
     npx expo run:android
     ```
   - **iOS (macOS / Xcode):**
     ```bash
     npx expo run:ios
     ```

3. **Configurando o Endereço do Backend no App:**
   Toque no ícone **⚙️ (Configurações)** no canto superior direito do app e confira a URL do Gateway WebSocket:
   - **Emulador Android:** `ws://10.0.2.2:3001/ws/tutor` *(padrão)*
   - **Simulador iOS:** `ws://localhost:3001/ws/tutor`
   - **Celular Físico na mesma rede Wi-Fi:** `ws://SEU_IP_LOCAL:3001/ws/tutor` (ex: `ws://192.168.1.15:3001/ws/tutor`)

4. Escolha o modo (**🔥 Sem Filtro / Roast** ou **😏 Moderado**) e toque em **🎙️ INICIAR SESSÃO AO VIVO**.
