import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { HumorIntensity } from '../types/tutor';

interface IntensitySelectorProps {
  intensity: HumorIntensity;
  onChange: (newIntensity: HumorIntensity) => void;
}

export const IntensitySelector: React.FC<IntensitySelectorProps> = ({
  intensity,
  onChange,
}) => {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.sectionLabel}>MODALIDADE DA TUTORA:</Text>
      <View style={styles.segmentedControl}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={[
            styles.optionButton,
            intensity === 'iniciante' && styles.optionActiveIniciante,
          ]}
          onPress={() => onChange('iniciante')}
        >
          <Text
            style={[
              styles.optionTitle,
              intensity === 'iniciante' && styles.optionTitleActiveIniciante,
            ]}
            numberOfLines={1}
          >
            🌱 Iniciante
          </Text>
          <Text style={styles.optionDesc} numberOfLines={2}>
            Do zero, paciente e sem broncas
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          style={[
            styles.optionButton,
            intensity === 'moderado' && styles.optionActiveModerado,
          ]}
          onPress={() => onChange('moderado')}
        >
          <Text
            style={[
              styles.optionTitle,
              intensity === 'moderado' && styles.optionTitleActiveModerado,
            ]}
            numberOfLines={1}
          >
            😏 Moderado
          </Text>
          <Text style={styles.optionDesc} numberOfLines={2}>
            Irônico, sem palavrão pesado
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          style={[
            styles.optionButton,
            intensity === 'roast' && styles.optionActiveRoast,
          ]}
          onPress={() => onChange('roast')}
        >
          <Text
            style={[
              styles.optionTitle,
              intensity === 'roast' && styles.optionTitleActiveRoast,
            ]}
            numberOfLines={1}
          >
            🔥 Sem Filtro
          </Text>
          <Text style={styles.optionDesc} numberOfLines={2}>
            Debochado e boca-suja
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginVertical: 6,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: 6,
  },
  optionButton: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderWidth: 1.5,
    borderColor: '#334155',
    justifyContent: 'center',
  },
  optionActiveIniciante: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  optionActiveModerado: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
  },
  optionActiveRoast: {
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  optionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#CBD5E1',
    marginBottom: 2,
  },
  optionTitleActiveIniciante: {
    color: '#34D399',
  },
  optionTitleActiveModerado: {
    color: '#38BDF8',
  },
  optionTitleActiveRoast: {
    color: '#F87171',
  },
  optionDesc: {
    fontSize: 10,
    color: '#94A3B8',
    lineHeight: 13,
  },
});
