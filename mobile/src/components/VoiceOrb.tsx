import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { HumorIntensity, SessionStatus } from '../types/tutor';

interface VoiceOrbProps {
  status: SessionStatus;
  micLevel: number;
  intensity: HumorIntensity;
}

const STATUS_META: Record<
  SessionStatus,
  { label: string; subtitle: string; color: string; glowColor: string }
> = {
  disconnected: {
    label: 'OFFLINE',
    subtitle: 'Toque em Iniciar Sessão para falar com a Cláudia',
    color: '#475569',
    glowColor: 'rgba(71, 85, 105, 0.25)',
  },
  connecting: {
    label: 'CONECTANDO...',
    subtitle: 'Abrindo canal de áudio bidirecional com a Cláudia',
    color: '#38BDF8',
    glowColor: 'rgba(56, 189, 248, 0.35)',
  },
  listening: {
    label: 'OUVINDO VOCÊ (EN)',
    subtitle: 'Fale em inglês! Se errar, prepara o ouvido...',
    color: '#10B981',
    glowColor: 'rgba(16, 185, 129, 0.40)',
  },
  thinking: {
    label: 'PROCESSANDO...',
    subtitle: 'Cláudia está julgando o seu inglês...',
    color: '#F59E0B',
    glowColor: 'rgba(245, 158, 11, 0.40)',
  },
  speaking: {
    label: 'CLÁUDIA FALANDO',
    subtitle: 'Ouça a resposta ou toque em "Cortar Fala" para interromper',
    color: '#EF4444',
    glowColor: 'rgba(239, 68, 68, 0.45)',
  },
};

export const VoiceOrb: React.FC<VoiceOrbProps> = ({
  status,
  micLevel,
  intensity,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const outerRingAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    pulseAnim.stopAnimation();
    outerRingAnim.stopAnimation();

    if (status === 'disconnected') {
      pulseAnim.setValue(1);
      outerRingAnim.setValue(1);
      return;
    }

    const duration =
      status === 'speaking' ? 420 : status === 'thinking' ? 650 : 1100;
    const maxScale =
      status === 'speaking' ? 1.24 : status === 'thinking' ? 1.15 : 1.08;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: maxScale,
            duration,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(outerRingAnim, {
            toValue: maxScale + 0.18,
            duration,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(outerRingAnim, {
            toValue: 1,
            duration,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [status, pulseAnim, outerRingAnim]);

  const meta = STATUS_META[status];
  const dynamicMicBoost = status === 'listening' ? 1 + micLevel * 0.35 : 1;

  return (
    <View style={styles.container}>
      <View style={styles.orbWrapper}>
        <Animated.View
          style={[
            styles.outerRing,
            {
              backgroundColor: meta.glowColor,
              borderColor: meta.color,
              transform: [
                {
                  scale: Animated.multiply(outerRingAnim, dynamicMicBoost),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.coreOrb,
            {
              backgroundColor: meta.color,
              transform: [
                {
                  scale: Animated.multiply(pulseAnim, dynamicMicBoost),
                },
              ],
            },
          ]}
        >
          <Text style={styles.orbEmoji}>
            {status === 'speaking'
              ? intensity === 'roast'
                ? '🤬'
                : '😏'
              : status === 'listening'
              ? '🎙️'
              : status === 'thinking'
              ? '🤨'
              : '🎧'}
          </Text>
        </Animated.View>
      </View>

      <View style={[styles.statusBadge, { borderColor: meta.color }]}>
        <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
        <Text style={[styles.statusLabel, { color: meta.color }]}>
          {meta.label}
        </Text>
      </View>

      <Text style={styles.subtitle}>{meta.subtitle}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  orbWrapper: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  outerRing: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 1.5,
  },
  coreOrb: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  orbEmoji: {
    fontSize: 32,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    marginBottom: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
