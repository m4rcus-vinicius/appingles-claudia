import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CorrectionCategory, GrammarCorrection } from '../types/tutor';

interface CorrectionCardProps {
  item: GrammarCorrection;
}

const CATEGORY_LABELS: Record<
  CorrectionCategory,
  { label: string; color: string }
> = {
  grammar: { label: 'GRAMÁTICA', color: '#F97316' },
  vocabulary: { label: 'VOCABULÁRIO', color: '#8B5CF6' },
  pronunciation: { label: 'PRONÚNCIA', color: '#EC4899' },
  naturalness: { label: 'INGLÊS NATURAL', color: '#06B6D4' },
};

export const CorrectionCard: React.FC<CorrectionCardProps> = ({ item }) => {
  const cat = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.grammar;
  const formattedTime = new Date(item.timestamp).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={[styles.badge, { borderColor: cat.color }]}>
          <Text style={[styles.badgeText, { color: cat.color }]}>
            {cat.label}
          </Text>
        </View>
        <Text style={styles.timestamp}>{formattedTime}</Text>
      </View>

      {/* O que o aluno falou errado */}
      <View style={styles.phraseRow}>
        <Text style={styles.wrongIcon}>❌</Text>
        <View style={styles.phraseTextWrapper}>
          <Text style={styles.phraseLabel}>Você mandou essa pérola:</Text>
          <Text style={styles.wrongText}>"{item.userSaid}"</Text>
        </View>
      </View>

      {/* Como se fala certo em inglês */}
      <View style={styles.phraseRow}>
        <Text style={styles.rightIcon}>✅</Text>
        <View style={styles.phraseTextWrapper}>
          <Text style={styles.phraseLabel}>Fale assim em inglês:</Text>
          <Text style={styles.rightText}>"{item.correction}"</Text>
        </View>
      </View>

      {/* Bronca e explicação em português dada pela tutora */}
      <View style={styles.explanationBox}>
        <Text style={styles.explanationTitle}>🔥 Bronca da Cláudia (PT-BR):</Text>
        <Text style={styles.explanationText}>{item.explanationPt}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  timestamp: {
    fontSize: 11,
    color: '#64748B',
  },
  phraseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  wrongIcon: {
    fontSize: 15,
    marginRight: 8,
    marginTop: 2,
  },
  rightIcon: {
    fontSize: 15,
    marginRight: 8,
    marginTop: 2,
  },
  phraseTextWrapper: {
    flex: 1,
  },
  phraseLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 1,
  },
  wrongText: {
    fontSize: 14,
    color: '#FCA5A5',
    textDecorationLine: 'line-through',
    fontWeight: '600',
  },
  rightText: {
    fontSize: 15,
    color: '#6EE7B7',
    fontWeight: '700',
  },
  explanationBox: {
    marginTop: 6,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#EF4444',
  },
  explanationTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F87171',
    marginBottom: 3,
  },
  explanationText: {
    fontSize: 13,
    color: '#E2E8F0',
    lineHeight: 18,
  },
});
