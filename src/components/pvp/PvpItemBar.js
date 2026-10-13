import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { ITEM_TYPES, PVP_ITEMS } from '../../domain/pvp/pvpItems';

export default function PvpItemBar({ items, hp, onUseItem, disabled, disabledReason }) {
  const { t } = useTranslation();
  const [selectedItem, setSelectedItem] = useState(null);
  const selectedRemaining = items?.[selectedItem]?.remaining || 0;
  useEffect(() => {
    if (disabled || selectedRemaining <= 0 || (selectedItem === ITEM_TYPES.HEAL && hp >= 100)) {
      setSelectedItem(null);
    }
  }, [disabled, selectedRemaining, selectedItem, hp]);

  const handleSelect = (itemId) => {
    if (disabled) return;
    if (selectedItem === itemId) {
      setSelectedItem(null); // toggle off
    } else {
      setSelectedItem(itemId);
    }
  };

  const handleUse = () => {
    if (!selectedItem || disabled) return;
    onUseItem(selectedItem);
    setSelectedItem(null);
  };

  const getItemIcon = (itemId) => {
    switch (itemId) {
      case ITEM_TYPES.HEAL: return 'medkit';
      case ITEM_TYPES.SHIELD: return 'shield';
      case ITEM_TYPES.POWER: return 'flash';
      default: return 'help-circle';
    }
  };

  const getItemName = (itemId) => {
    switch (itemId) {
      case ITEM_TYPES.HEAL: return t('pvpItems.healName', 'Healing Potion');
      case ITEM_TYPES.SHIELD: return t('pvpItems.shieldName', 'Shield');
      case ITEM_TYPES.POWER: return t('pvpItems.powerName', 'Power Boost');
      default: return itemId;
    }
  };

  const getItemDescription = (itemId) => {
    switch (itemId) {
      case ITEM_TYPES.HEAL: 
        return t('pvpItems.healDesc', { amount: PVP_ITEMS[ITEM_TYPES.HEAL].healAmount });
      case ITEM_TYPES.SHIELD: 
        return t('pvpItems.shieldDesc', { amount: PVP_ITEMS[ITEM_TYPES.SHIELD].blockAmount });
      case ITEM_TYPES.POWER: 
        return t('pvpItems.powerDesc', { amount: PVP_ITEMS[ITEM_TYPES.POWER].bonusDamage });
      default: return '';
    }
  };

  const isItemDisabled = (itemId) => {
    if (disabled) return true;
    if (itemId === ITEM_TYPES.HEAL && hp >= 100) return true;
    return (items?.[itemId]?.remaining || 0) <= 0;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.slotsContainer}>

          {[ITEM_TYPES.HEAL, ITEM_TYPES.SHIELD, ITEM_TYPES.POWER].map(itemId => {
            const remaining = items?.[itemId]?.remaining ?? 0;
            // Slot is disabled if item count is zero OR the whole bar is disabled (e.g., after using an item this round)
            const slotDisabled = isItemDisabled(itemId) || disabled;
            const isSelected = selectedItem === itemId;

            return (
              <TouchableOpacity 
                key={itemId}
                style={[
                  styles.slot, 
                  slotDisabled && styles.slotDisabled,
                  isSelected && styles.slotSelected
                ]}
                disabled={slotDisabled}
                onPress={() => handleSelect(itemId)}
                testID={`pvpItemSlot_${itemId}`}
              >
                <View style={styles.iconContainer}>
                  <Ionicons 
                    name={getItemIcon(itemId)} 
                    size={24} 
                    color={slotDisabled ? theme.colors.textMuted : (isSelected ? 'white' : theme.colors.primary)} 
                  />
                </View>
                <Text style={[styles.slotName, slotDisabled && styles.textDisabled, isSelected && styles.textSelected]} numberOfLines={1}>
                  {getItemName(itemId).split(' ')[0]}
                </Text>
                <View
                  style={[styles.badge, remaining <= 0 && styles.badgeEmpty]}
                  testID={`pvpItemBadge_${itemId}`}
                >
                  <Text style={styles.badgeText} testID={`pvpItemCount_${itemId}`}>×{remaining}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
        {selectedItem && !isItemDisabled(selectedItem) && selectedRemaining > 0 && !(selectedItem === ITEM_TYPES.HEAL && hp >= 100) && (
          <View style={styles.selectionOverlay}>
            <View style={styles.descriptionBox}>
              <Text style={styles.itemName}>{getItemName(selectedItem)}</Text>
              <Text style={styles.itemDesc}>{getItemDescription(selectedItem)}</Text>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelectedItem(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.useBtn} onPress={handleUse}>
                <Text style={styles.useText}>USE</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {disabled && Boolean(disabledReason) && (
          <View style={styles.disabledOverlay}>
            <Text style={styles.disabledText}>{disabledReason}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: theme.colors.card,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  container: {
    padding: theme.spacing.medium,
    position: 'relative',
  },
  slotsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    overflow: 'visible',
  },
  slot: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.spacing.small,
    marginHorizontal: theme.spacing.small,
    backgroundColor: theme.colors.background,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'visible',
    position: 'relative',
  },
  slotSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  slotDisabled: {
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
  },
  iconContainer: {
    marginBottom: 4,
  },
  slotName: {
    fontSize: 12,
    fontWeight: 'bold',
    color: theme.colors.textMain,
  },
  textDisabled: {
    color: theme.colors.textMuted,
  },
  textSelected: {
    color: 'white',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: theme.colors.secondary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: theme.colors.card,
    zIndex: 10,
    elevation: 3,
  },
  badgeEmpty: {
    backgroundColor: theme.colors.textMuted,
  },
  badgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  selectionOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.medium,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    zIndex: 10,
  },
  descriptionBox: {
    flex: 1,
    marginRight: theme.spacing.medium,
  },
  itemName: {
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBottom: 4,
    fontSize: 14,
  },
  itemDesc: {
    color: theme.colors.textMain,
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cancelText: {
    color: theme.colors.textMuted,
    fontWeight: 'bold',
  },
  useBtn: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  useText: {
    color: 'white',
    fontWeight: 'bold',
  },
  disabledOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.small,
    borderRadius: 8,
    marginBottom: theme.spacing.medium,
    alignItems: 'center',
    zIndex: 10,
  },
  disabledText: {
    color: theme.colors.danger,
    fontSize: 12,
    fontWeight: 'bold',
  }
});
