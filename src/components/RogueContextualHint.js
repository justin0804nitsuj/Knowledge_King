import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

export default function RogueContextualHint({
  hintKey,
  visible,
  title,
  desc,
  icon,
  onDismiss,
}) {
  const { t } = useTranslation();

  const isVisible = visible !== undefined ? visible : Boolean(hintKey);
  if (!isVisible) return null;

  let hintTitle = title;
  let hintDesc = desc;
  let hintIcon = icon || 'information-circle-outline';

  if (hintKey === 'first_action_select') {
    hintTitle = hintTitle || t('rogue.hints.firstActionTitle', '⚔️ Tactical Action System');
    hintDesc =
      hintDesc ||
      t(
        'rogue.hints.firstActionDesc',
        'Choose your action for this turn before answering. Your action will only succeed if your vocabulary answer is correct!'
      );
    hintIcon = icon || 'flash-outline';
  } else if (hintKey === 'first_curse') {
    hintTitle = hintTitle || t('rogue.hints.firstCurseTitle', '⚠️ Cursed Word Encountered!');
    hintDesc =
      hintDesc ||
      t(
        'rogue.hints.firstCurseDesc',
        'Wrong answers curse words. Answer correctly next time to weaken and purify them!'
      );
    hintIcon = icon || 'warning-outline';
  } else if (hintKey === 'first_guard') {
    hintTitle = hintTitle || t('rogue.hints.firstGuardTitle', '🛡️ Enemy is Guarding');
    hintDesc =
      hintDesc ||
      t(
        'rogue.hints.firstGuardDesc',
        'The enemy will take reduced damage this turn. Keep attacking to break through!'
      );
    hintIcon = icon || 'shield-outline';
  } else if (hintKey === 'first_heavy_attack') {
    hintTitle = hintTitle || t('rogue.hints.firstHeavyTitle', '⚔️ Heavy Attack Incoming!');
    hintDesc =
      hintDesc ||
      t(
        'rogue.hints.firstHeavyDesc',
        'The enemy is preparing a devastating blow. Answer accurately to minimize damage!'
      );
    hintIcon = icon || 'flash-outline';
  } else if (hintKey === 'first_relic') {
    hintTitle = hintTitle || t('rogue.hints.firstRelicTitle', '🏺 Relics of Power');
    hintDesc =
      hintDesc ||
      t(
        'rogue.hints.firstRelicDesc',
        'Relics provide passive bonuses throughout your run. Choose the one that suits your strategy!'
      );
    hintIcon = icon || 'gift-outline';
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconTitleRow}>
          <Ionicons name={hintIcon} size={20} color="#F59E0B" style={styles.icon} />
          <Text style={styles.title}>{hintTitle}</Text>
        </View>
        <TouchableOpacity
          onPress={onDismiss}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Dismiss hint"
        >
          <Ionicons name="close" size={18} color="#94A3B8" />
        </TouchableOpacity>
      </View>
      <Text style={styles.desc}>{hintDesc}</Text>
      <TouchableOpacity
        onPress={onDismiss}
        style={styles.dismissBtn}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <Text style={styles.dismissBtnText}>
          {t('rogue.hints.dismiss', 'Got it')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    padding: 14,
    marginVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  iconTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  icon: {
    marginRight: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FDE68A',
  },
  closeBtn: {
    padding: 2,
  },
  desc: {
    fontSize: 13,
    lineHeight: 19,
    color: '#E2E8F0',
    marginBottom: 10,
  },
  dismissBtn: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  dismissBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FDE68A',
  },
});
