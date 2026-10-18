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
      <Text style={styles.sectionLabel}>NÍVEL DE ZOMBARIA / PERSONALIDADE:</Text>
      <View style={styles.segmentedControl}>
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
              intensity === 'moderado' && styles.optionTitleActive,
            ]}
          >
            😏 Moderado
          </Text>
          <Text style={styles.optionDesc}>Irônico e ácido, sem palavrão pesado</Text>
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
              intensity === 'roast' && styles.optionTitleActive,
            ]}
          >
            🔥 Sem Filtro / Roast
          </Text>
          <Text style={styles.optionDesc}>Debochado, impaciente e boca-suja</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginVertical: 8,
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
    gap: 10,
  },
  optionButton: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: '#334155',
  },
  optionActiveModerado: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  optionActiveRoast: {
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  optionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#CBD5E1',
    marginBottom: 2,
  },
  optionTitleActive: {
    color: '#FFFFFF',
  },
  optionDesc: {
    fontSize: 11,
    color: '#94A3B8',
  },
});
