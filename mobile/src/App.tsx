import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CorrectionCard } from './components/CorrectionCard';
import { IntensitySelector } from './components/IntensitySelector';
import { VoiceOrb } from './components/VoiceOrb';
import { AudioStreamService } from './services/audioStreamService';
import { TutorSocketClient } from './services/tutorSocketClient';
import {
  GrammarCorrection,
  HumorIntensity,
  SessionStatus,
} from './types/tutor';

// Exemplo inicial no painel para demonstrar a dinâmica logo ao abrir o app
const INITIAL_DEMO_CORRECTIONS: GrammarCorrection[] = [
  {
    id: 'demo-1',
    timestamp: new Date().toISOString(),
    userSaid: 'I have 20 years',
    correction: 'I am 20 years old',
    explanationPt:
      'Caralho, de onde você tirou essa frase? "I have 20 years" não existe, porra! Em inglês você "é", não "tem" idade: fala "I am 20 years old".',
    category: 'grammar',
  },
];

export default function App() {
  const [status, setStatus] = useState<SessionStatus>('disconnected');
  const [intensity, setIntensity] = useState<HumorIntensity>('roast');
  const [micLevel, setMicLevel] = useState<number>(0);
  const [corrections, setCorrections] = useState<GrammarCorrection[]>(
    INITIAL_DEMO_CORRECTIONS
  );
  const [settingsVisible, setSettingsVisible] = useState<boolean>(false);
  // Configurado por padrão com o IP local do seu PC na rede (192.168.100.19) para funcionar direto no celular
  const [backendWsUrl, setBackendWsUrl] = useState<string>(
    'ws://192.168.100.19:3001/ws/tutor'
  );
  const [lastBargeInTime, setLastBargeInTime] = useState<string | null>(null);

  const socketRef = useRef<TutorSocketClient | null>(null);
  const audioRef = useRef<AudioStreamService | null>(null);

  useEffect(() => {
    const audioService = new AudioStreamService({
      onMicPcmChunk: (pcm16kBase64, rmsLevel) => {
        setMicLevel(rmsLevel);
        socketRef.current?.sendAudioChunk(pcm16kBase64);
      },
      onLocalBargeInDetected: () => {
        // Usuário interrompeu a fala da tutora localmente
        setLastBargeInTime(new Date().toLocaleTimeString('pt-BR'));
        setStatus('listening');
        socketRef.current?.notifyClientBargeIn();
      },
      onPlaybackStateChange: (isPlaying) => {
        setStatus((prev) => {
          if (prev === 'disconnected') return 'disconnected';
          return isPlaying ? 'speaking' : 'listening';
        });
      },
    });

    const socketClient = new TutorSocketClient({
      onStatusChange: (newStatus) => {
        setStatus((prev) => {
          // Mantém o status 'speaking' enquanto o buffer local ainda estiver tocando
          if (prev === 'speaking' && newStatus === 'listening') {
            return prev;
          }
          return newStatus;
        });
        if (newStatus === 'listening') {
          audioService.startMicrophoneCapture();
        } else if (newStatus === 'disconnected') {
          audioService.stopAll();
          setMicLevel(0);
        }
      },
      onAudioChunk: (pcm24kBase64) => {
        audioService.enqueueAiAudioChunk(pcm24kBase64);
      },
      onTurnComplete: () => {
        audioService.markTurnComplete();
      },
      onBargeIn: () => {
        // Sinal de Barge-in vindo do VAD nativo do Gemini Live
        audioService.stopPlaybackImmediately();
        setLastBargeInTime(new Date().toLocaleTimeString('pt-BR'));
        setStatus('listening');
      },
      onGrammarCorrection: (newCorrection) => {
        setCorrections((prev) => [newCorrection, ...prev]);
      },
      onError: (msg) => {
        Alert.alert('Aviso de Conexão', msg);
      },
    });

    audioRef.current = audioService;
    socketRef.current = socketClient;

    return () => {
      audioService.stopAll();
      socketRef.current?.disconnect();
    };
  }, []);

  const handleToggleSession = useCallback(async () => {
    if (status !== 'disconnected') {
      audioRef.current?.stopAll();
      socketRef.current?.disconnect();
      setStatus('disconnected');
      setMicLevel(0);
      return;
    }

    const granted = await audioRef.current?.initializeAudioSession();
    if (!granted) {
      Alert.alert(
        'Permissão de Microfone',
        'É necessário liberar o microfone para conversar em tempo real com a Cláudia.'
      );
      return;
    }

    socketRef.current?.connect(backendWsUrl.trim(), intensity);
  }, [status, backendWsUrl, intensity]);

  const handleChangeIntensity = useCallback((newIntensity: HumorIntensity) => {
    setIntensity(newIntensity);
    socketRef.current?.setIntensity(newIntensity);
  }, []);

  const isSessionActive = status !== 'disconnected';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="#000000"
        translucent={false}
      />

      {/* Barrinha preta dedicada no topo para as notificações, relógio e bateria do celular */}
      <View style={styles.topStatusBarSpacer} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTextContainer}>
          <Text style={styles.appTitle}>CLÁUDIA • INGLÊS SEM FILTRO</Text>
          <Text style={styles.appSubtitle}>
            Conversa em Inglês 🇺🇸 • Broncas em Português 🇧🇷
          </Text>
        </View>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => setSettingsVisible(true)}
        >
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* Seletor Rápido de Intensidade (Moderado vs Sem Filtro/Roast) */}
      <View style={styles.topSection}>
        <IntensitySelector
          intensity={intensity}
          onChange={handleChangeIntensity}
        />

        {/* Indicador Visual de Áudio + Botão Central Ligar/Desligar */}
        <VoiceOrb status={status} micLevel={micLevel} intensity={intensity} />

        <View style={styles.controlsRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[
              styles.mainSessionButton,
              isSessionActive ? styles.stopButton : styles.startButton,
            ]}
            onPress={handleToggleSession}
          >
            <Text style={styles.mainSessionButtonText}>
              {isSessionActive ? '⏹ ENCERRAR CONVERSA' : '🎙️ INICIAR SESSÃO AO VIVO'}
            </Text>
          </TouchableOpacity>

          {status === 'speaking' && (
            <TouchableOpacity
              style={styles.bargeInButton}
              onPress={() => {
                audioRef.current?.stopPlaybackImmediately();
                socketRef.current?.notifyClientBargeIn();
                setStatus('listening');
              }}
            >
              <Text style={styles.bargeInButtonText}>✋ Cortar Fala</Text>
            </TouchableOpacity>
          )}
        </View>

        {lastBargeInTime && (
          <Text style={styles.bargeInHint}>
            ⚡ Última interrupção (Barge-in) às {lastBargeInTime}
          </Text>
        )}
      </View>

      {/* Painel de Feedback de Correções Gramaticais */}
      <View style={styles.feedbackSection}>
        <View style={styles.feedbackHeader}>
          <Text style={styles.feedbackTitle}>
            📋 PAINEL DE CORREÇÕES & BRONCAS ({corrections.length})
          </Text>
          {corrections.length > 0 && (
            <TouchableOpacity onPress={() => setCorrections([])}>
              <Text style={styles.clearButtonText}>Limpar</Text>
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          data={corrections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <CorrectionCard item={item} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                Nenhuma canelada registrada ainda. Comece a falar em inglês que a
                Cláudia já encontra motivo pra te zoar!
              </Text>
            </View>
          }
        />
      </View>

      {/* Modal de Configurações (Servidor Gateway + Intensidade) */}
      <Modal
        visible={settingsVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSettingsVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Configurações da Sessão</Text>

            <Text style={styles.inputLabel}>
              URL do Gateway WebSocket (Backend):
            </Text>
            <TextInput
              style={styles.textInput}
              value={backendWsUrl}
              onChangeText={setBackendWsUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="ws://192.168.100.19:3001/ws/tutor"
              placeholderTextColor="#64748B"
            />
            <Text style={styles.inputHelper}>
              • Celular na mesma rede Wi-Fi: ws://192.168.100.19:3001/ws/tutor{'\n'}
              • Emulador Android: ws://10.0.2.2:3001/ws/tutor
            </Text>

            <IntensitySelector
              intensity={intensity}
              onChange={handleChangeIntensity}
            />

            <TouchableOpacity
              style={styles.closeModalButton}
              onPress={() => setSettingsVisible(false)}
            >
              <Text style={styles.closeModalButtonText}>Salvar e Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  topStatusBarSpacer: {
    height: Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 6 : 0,
    backgroundColor: '#000000',
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#0B0F19',
  },
  headerTextContainer: {
    flex: 1,
    paddingRight: 10,
  },
  appTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#F8FAFC',
    letterSpacing: 0.6,
  },
  appSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  settingsButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIcon: {
    fontSize: 18,
  },
  topSection: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 8,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 4,
  },
  mainSessionButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButton: {
    backgroundColor: '#10B981',
  },
  stopButton: {
    backgroundColor: '#EF4444',
  },
  mainSessionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  bargeInButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#334155',
    borderWidth: 1,
    borderColor: '#64748B',
  },
  bargeInButtonText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  bargeInHint: {
    fontSize: 11,
    color: '#38BDF8',
    textAlign: 'center',
    marginTop: 4,
  },
  feedbackSection: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 28 : 0,
    borderTopWidth: 1,
    borderColor: '#1E293B',
  },
  feedbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  feedbackTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#CBD5E1',
    letterSpacing: 0.8,
  },
  clearButtonText: {
    fontSize: 12,
    color: '#38BDF8',
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 44,
  },
  emptyBox: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#CBD5E1',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#475569',
  },
  inputHelper: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 6,
    marginBottom: 14,
    lineHeight: 16,
  },
  closeModalButton: {
    marginTop: 14,
    backgroundColor: '#38BDF8',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeModalButtonText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 14,
  },
});
