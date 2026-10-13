import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { ITEM_TYPES, PVP_ITEMS } from '../../domain/pvp/pvpItems';
import {
  LOADOUT_SKILLS,
  TOTAL_DECK_SIZE,
  MAX_COPIES_PER_SKILL,
  validatePvpLoadout,
  getDefaultPvpLoadout,
  loadoutToCardList,
} from '../../domain/pvp/pvpLoadout';

export default function LoadoutEditorModal({ visible, initialLoadout, onSave, onClose }) {
  const { t } = useTranslation();
  const [loadout, setLoadout] = useState(() => initialLoadout || getDefaultPvpLoadout());

  useEffect(() => {
    if (visible) {
      setLoadout(initialLoadout || getDefaultPvpLoadout());
    }
  }, [visible, initialLoadout]);

  const totalSelected = LOADOUT_SKILLS.reduce((sum, s) => sum + (loadout[s] || 0), 0);
  const isValid = validatePvpLoadout(loadout);

  const handleIncrement = (skill) => {
    const current = loadout[skill] || 0;
    if (current >= MAX_COPIES_PER_SKILL || totalSelected >= TOTAL_DECK_SIZE) return;
    setLoadout({
      ...loadout,
      [skill]: current + 1,
    });
  };

  const handleDecrement = (skill) => {
    const current = loadout[skill] || 0;
    if (current <= 0) return;
    setLoadout({
      ...loadout,
      [skill]: current - 1,
    });
  };

  const handleSave = () => {
    if (!isValid) return;
    onSave(loadout);
    onClose();
  };

  const getSkillMeta = (skill) => {
    switch (skill) {
      case ITEM_TYPES.HEAL:
        return {
          icon: 'medkit',
          color: '#10B981',
          name: t('pvpItems.healName', 'Healing Potion'),
          desc: t('pvpItems.healDesc', { amount: PVP_ITEMS[ITEM_TYPES.HEAL].healAmount }),
        };
      case ITEM_TYPES.SHIELD:
        return {
          icon: 'shield',
          color: '#3B82F6',
          name: t('pvpItems.shieldName', 'Shield'),
          desc: t('pvpItems.shieldDesc', { amount: PVP_ITEMS[ITEM_TYPES.SHIELD].blockAmount }),
        };
      case ITEM_TYPES.POWER:
        return {
          icon: 'flash',
          color: '#F59E0B',
          name: t('pvpItems.powerName', 'Power Boost'),
          desc: t('pvpItems.powerDesc', { amount: PVP_ITEMS[ITEM_TYPES.POWER].bonusDamage }),
        };
      default:
        return { icon: 'help-circle', color: '#9CA3AF', name: skill, desc: '' };
    }
  };

  const cardSlots = loadoutToCardList(loadout);
  // Pad with empty slots if fewer than 4
  while (cardSlots.length < TOTAL_DECK_SIZE) {
    cardSlots.push(null);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('pvpLoadout.edit', 'Edit Deck')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} testID="loadoutEditorClose">
              <Ionicons name="close" size={24} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Visual 4-slot preview */}
          <View style={styles.slotsRow}>
            {cardSlots.map((card, idx) => {
              const meta = card ? getSkillMeta(card) : null;
              return (
                <View
                  key={`slot-${idx}`}
                  style={[
                    styles.cardSlot,
                    meta && { borderColor: meta.color, backgroundColor: `${meta.color}15` },
                  ]}
                >
                  {meta ? (
                    <Ionicons name={meta.icon} size={22} color={meta.color} />
                  ) : (
                    <Ionicons name="add" size={20} color={theme.colors.textMuted} />
                  )}
                  <Text style={[styles.cardSlotText, meta && { color: meta.color }]}>
                    {meta ? meta.name.split(' ')[0] : '-'}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Count status */}
          <View style={styles.statusRow}>
            <Text style={[styles.statusText, isValid ? styles.textSuccess : styles.textWarning]}>
              {t('pvpLoadout.selectedCount', { count: totalSelected, total: TOTAL_DECK_SIZE })}
            </Text>
            {!isValid && (
              <Text style={styles.hintText}>
                {t('pvpLoadout.mustBeTotal', { total: TOTAL_DECK_SIZE })}
              </Text>
            )}
          </View>

          <ScrollView style={styles.skillsList}>
            {LOADOUT_SKILLS.map((skill) => {
              const meta = getSkillMeta(skill);
              const count = loadout[skill] || 0;
              const canIncrement = count < MAX_COPIES_PER_SKILL && totalSelected < TOTAL_DECK_SIZE;
              const canDecrement = count > 0;

              return (
                <View key={skill} style={styles.skillRow}>
                  <View style={[styles.skillIconCircle, { backgroundColor: `${meta.color}20` }]}>
                    <Ionicons name={meta.icon} size={24} color={meta.color} />
                  </View>
                  <View style={styles.skillInfo}>
                    <Text style={styles.skillName}>{meta.name}</Text>
                    <Text style={styles.skillDesc} numberOfLines={1}>{meta.desc}</Text>
                  </View>

                  <View style={styles.counterRow}>
                    <TouchableOpacity
                      style={[styles.counterBtn, !canDecrement && styles.counterBtnDisabled]}
                      onPress={() => handleDecrement(skill)}
                      disabled={!canDecrement}
                      testID={`decrement-${skill}`}
                    >
                      <Ionicons name="remove" size={18} color={canDecrement ? theme.colors.textMain : theme.colors.textMuted} />
                    </TouchableOpacity>

                    <Text style={styles.countText}>{count}</Text>

                    <TouchableOpacity
                      style={[styles.counterBtn, !canIncrement && styles.counterBtnDisabled]}
                      onPress={() => handleIncrement(skill)}
                      disabled={!canIncrement}
                      testID={`increment-${skill}`}
                    >
                      <Ionicons name="add" size={18} color={canIncrement ? theme.colors.textMain : theme.colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Actions */}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>{t('pvpLoadout.cancel', 'Cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, !isValid && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!isValid}
              testID="saveLoadoutBtn"
            >
              <Text style={styles.saveBtnText}>{t('pvpLoadout.save', 'Save Deck')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: theme.colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.textMain,
  },
  closeBtn: {
    padding: 4,
  },
  slotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardSlot: {
    flex: 1,
    height: 70,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    marginHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
  },
  cardSlotText: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 4,
    color: theme.colors.textMuted,
  },
  statusRow: {
    alignItems: 'center',
    marginBottom: 16,
  },
  statusText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  hintText: {
    fontSize: 12,
    color: theme.colors.warning,
    marginTop: 2,
  },
  textSuccess: {
    color: theme.colors.success,
  },
  textWarning: {
    color: theme.colors.warning,
  },
  skillsList: {
    marginBottom: 20,
  },
  skillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    padding: 12,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  skillIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  skillInfo: {
    flex: 1,
    marginRight: 8,
  },
  skillName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginBottom: 2,
  },
  skillDesc: {
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  counterBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterBtnDisabled: {
    opacity: 0.35,
  },
  countText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginHorizontal: 12,
    minWidth: 16,
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    marginRight: 8,
  },
  cancelBtnText: {
    fontSize: 15,
    color: theme.colors.textMuted,
    fontWeight: 'bold',
  },
  saveBtn: {
    flex: 2,
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginLeft: 8,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontSize: 15,
    color: '#fff',
    fontWeight: 'bold',
  },
});
