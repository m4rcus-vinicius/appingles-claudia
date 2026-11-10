import React from 'react';
import {
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppReleaseInfo, CURRENT_APP_VERSION } from '../config/version';

interface UpdateModalProps {
  visible: boolean;
  releaseInfo: AppReleaseInfo | null;
  onDismiss: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  visible,
  releaseInfo,
  onDismiss,
}) => {
  if (!releaseInfo) return null;

  const handleUpdate = () => {
    if (releaseInfo.downloadUrl) {
      Linking.openURL(releaseInfo.downloadUrl).catch(() => {
        // fallback para o site caso o browser falhe
        Linking.openURL('https://claudia-ingles-backend.onrender.com/download-apk');
      });
    }
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconEmoji}>🚀</Text>
          </View>

          <Text style={styles.title}>Nova Atualização Disponível!</Text>

          <View style={styles.badgeRow}>
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>Nova: v{releaseInfo.version}</Text>
            </View>
            <Text style={styles.currentVersionText}>
              Sua versão: v{CURRENT_APP_VERSION}
            </Text>
          </View>

          <Text style={styles.notesLabel}>O que há de novo:</Text>
          <View style={styles.notesBox}>
            <ScrollView style={styles.notesScroll} nestedScrollEnabled>
              <Text style={styles.notesText}>
                {releaseInfo.notes || 'Melhorias de desempenho, correções e novas funcionalidades.'}
              </Text>
            </ScrollView>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.updateButton}
            onPress={handleUpdate}
          >
            <Text style={styles.updateButtonText}>⬇️ Atualizar Agora (1 toque)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.laterButton}
            onPress={onDismiss}
          >
            <Text style={styles.laterButtonText}>Mais tarde</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0F172A',
    borderRadius: 24,
    padding: 22,
    borderWidth: 1.5,
    borderColor: '#38BDF8',
    alignItems: 'center',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 12,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.4)',
  },
  iconEmoji: {
    fontSize: 30,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  newBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  newBadgeText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '800',
  },
  currentVersionText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  notesLabel: {
    alignSelf: 'flex-start',
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  notesBox: {
    width: '100%',
    maxHeight: 110,
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 12,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#334155',
  },
  notesScroll: {
    width: '100%',
  },
  notesText: {
    color: '#E2E8F0',
    fontSize: 12,
    lineHeight: 18,
  },
  updateButton: {
    width: '100%',
    backgroundColor: '#10B981',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  updateButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  laterButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  laterButtonText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
});
