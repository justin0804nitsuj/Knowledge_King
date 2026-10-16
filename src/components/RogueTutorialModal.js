import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

export default function RogueTutorialModal({
  visible,
  onClose,
  initialPage = 0,
}) {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(initialPage);

  const pages = [
    {
      id: 0,
      icon: 'compass-outline',
      title: t('rogue.tutorial.page1Title', '1. EXPEDITION'),
      desc: t(
        'rogue.tutorial.page1Desc',
        'Choose your path across the labyrinth map. Your HP, Relics, and Cursed Words persist throughout the entire expedition. Reach and defeat the Boss!'
      ),
      highlight: '🧭 Persisting Health & Build Across Rooms',
    },
    {
      id: 1,
      icon: 'eye-outline',
      title: t('rogue.tutorial.page2Title', '2. ENEMY INTENT'),
      desc: t(
        'rogue.tutorial.page2Desc',
        'Enemies telegraph their next action BEFORE you answer.\n\n⚔ Attack: Attacks after your answer\n💥 Heavy Attack: Stronger strike\n🛡 Guard: Enemy prepares defense and reduces your damage'
      ),
      highlight: '👁 "Intent tells me what will happen after this answer."',
    },
    {
      id: 2,
      icon: 'skull-outline',
      title: t('rogue.tutorial.page3Title', '3. CURSED WORDS'),
      desc: t(
        'rogue.tutorial.page3Desc',
        'Words answered incorrectly become Cursed and will return later.\n\nWrong again: Curse intensifies and triggers painful Backlash damage!\nCorrect: Weakens and cleanses the curse.\n\nLearn the words that challenge you to survive!'
      ),
      highlight: '☠ "The words you struggle with return until mastered."',
    },
    {
      id: 3,
      icon: 'trophy-outline',
      title: t('rogue.tutorial.page4Title', '4. RELICS & BUILDS'),
      desc: t(
        'rogue.tutorial.page4Desc',
        'Defeating Elites offers powerful Relics that last for the entire expedition. Mix and match relics to create unique synergies and overcome the labyrinth!'
      ),
      highlight: '🏺 Elite Victories = Build Synergies',
    },
  ];

  const isLastPage = currentPage === pages.length - 1;

  const handleNext = () => {
    if (isLastPage) {
      onClose();
    } else {
      setCurrentPage((prev) => prev + 1);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  if (!visible) return null;

  const activeData = pages[currentPage];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={styles.headerLabel}>
              {t('rogue.howToPlay', 'How to Play')} ({currentPage + 1}/{pages.length})
            </Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Body */}
          <ScrollView contentContainerStyle={styles.bodyContent}>
            <View style={styles.iconCircle}>
              <Ionicons name={activeData.icon} size={36} color="#60A5FA" />
            </View>

            <Text style={styles.pageTitle}>{activeData.title}</Text>

            <View style={styles.highlightBadge}>
              <Text style={styles.highlightText}>{activeData.highlight}</Text>
            </View>

            <Text style={styles.pageDesc}>{activeData.desc}</Text>
          </ScrollView>

          {/* Dots Indicator */}
          <View style={styles.dotsRow}>
            {pages.map((p, idx) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => setCurrentPage(idx)}
                style={[
                  styles.dot,
                  idx === currentPage && styles.activeDot,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Page ${idx + 1}`}
              />
            ))}
          </View>

          {/* Footer Controls */}
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={handleSkip}
              accessibilityRole="button"
              accessibilityLabel="Skip Tutorial"
            >
              <Text style={styles.skipBtnText}>{t('rogue.tutorial.skip', 'Skip')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.nextBtn}
              onPress={handleNext}
              accessibilityRole="button"
              accessibilityLabel={isLastPage ? 'Got it' : 'Next'}
            >
              <Text style={styles.nextBtnText}>
                {isLastPage
                  ? t('rogue.tutorial.done', 'Got it!')
                  : t('rogue.tutorial.next', 'Next →')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: '#334155',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  closeBtn: {
    padding: 4,
  },
  bodyContent: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#0F172A',
    borderWidth: 2,
    borderColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 10,
  },
  highlightBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3B82F6',
    marginBottom: 14,
  },
  highlightText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#93C5FD',
    textAlign: 'center',
  },
  pageDesc: {
    fontSize: 14,
    lineHeight: 22,
    color: '#CBD5E1',
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 14,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#475569',
  },
  activeDot: {
    width: 22,
    backgroundColor: '#3B82F6',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  skipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipBtnText: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '600',
  },
  nextBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  nextBtnText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
