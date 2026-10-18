import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

const HINT_CONFIGS = Object.freeze({
  first_action_select: {
    titleKey: 'rogue.hints.firstActionTitle',
    defaultTitle: '⚔️ Tactical Action System',
    descKey: 'rogue.hints.firstActionDesc',
    defaultDesc: 'Choose your action for this turn before answering. Your action will only succeed if your vocabulary answer is correct!',
    icon: 'flash-outline',
  },
  first_curse: {
    titleKey: 'rogue.hints.firstCurseTitle',
    defaultTitle: '⚠️ Cursed Word Encountered!',
    descKey: 'rogue.hints.firstCurseDesc',
    defaultDesc: 'Wrong answers curse words. Answer correctly next time to weaken and purify them!',
    icon: 'warning-outline',
  },
  first_guard: {
    titleKey: 'rogue.hints.firstGuardTitle',
    defaultTitle: '🛡️ Enemy is Guarding',
    descKey: 'rogue.hints.firstGuardDesc',
    defaultDesc: 'The enemy will take reduced damage this turn. Keep attacking to break through!',
    icon: 'shield-outline',
  },
  first_heavy_attack: {
    titleKey: 'rogue.hints.firstHeavyTitle',
    defaultTitle: '⚔️ Heavy Attack Incoming!',
    descKey: 'rogue.hints.firstHeavyDesc',
    defaultDesc: 'The enemy is preparing a devastating blow. Answer accurately to minimize damage!',
    icon: 'flash-outline',
  },
  first_relic_draft: {
    titleKey: 'rogue.hints.firstRelicTitle',
    defaultTitle: '🏺 Relics of Power',
    descKey: 'rogue.hints.firstRelicDesc',
    defaultDesc: 'Relics provide passive bonuses throughout your run. Choose the one that suits your strategy!',
    icon: 'gift-outline',
  },
  first_relic: {
    titleKey: 'rogue.hints.firstRelicTitle',
    defaultTitle: '🏺 Relics of Power',
    descKey: 'rogue.hints.firstRelicDesc',
    defaultDesc: 'Relics provide passive bonuses throughout your run. Choose the one that suits your strategy!',
    icon: 'gift-outline',
  },
});

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

  const config = (hintKey && HINT_CONFIGS[hintKey]) ? HINT_CONFIGS[hintKey] : {};

  const hintTitle =
    title ||
    (config.titleKey ? t(config.titleKey, config.defaultTitle) : config.defaultTitle) ||
    t('rogue.hints.defaultTitle', '💡 Expedition Hint');

  const hintDesc =
    desc ||
    (config.descKey ? t(config.descKey, config.defaultDesc) : config.defaultDesc) ||
    '';

  const hintIcon = icon || config.icon || 'information-circle-outline';

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
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={20} color="#94A3B8" />
        </TouchableOpacity>
      </View>
      {Boolean(hintDesc) && <Text style={styles.desc}>{hintDesc}</Text>}
      <TouchableOpacity
        onPress={onDismiss}
        style={styles.dismissBtn}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        activeOpacity={0.8}
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
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    padding: 14,
    marginVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  icon: {
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FDE68A',
    flexShrink: 1,
  },
  closeBtn: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  desc: {
    fontSize: 13,
    lineHeight: 20,
    color: '#F1F5F9',
    marginBottom: 12,
  },
  dismissBtn: {
    alignSelf: 'flex-end',
    backgroundColor: '#F59E0B',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  dismissBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
});
