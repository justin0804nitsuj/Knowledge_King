import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { ITEM_TYPES, PVP_ITEMS } from '../../domain/pvp/pvpItems';

export default function PvpItemBar({ items, onUseItem, disabled, disabledReason }) {
  const { t } = useTranslation();
  const [selectedItem, setSelectedItem] = useState(null);

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

  // Close selection if disabled externally (e.g. answer submitted)
  if (disabled && selectedItem) {
    setSelectedItem(null);
  }

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
    return (items?.[itemId]?.remaining || 0) <= 0;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {selectedItem && (
          <View style={styles.selectionArea}>
            <View style={styles.descriptionBox}>
              <Text style={styles.itemName}>{getItemName(selectedItem)}</Text>
              <Text style={styles.itemDesc}>{getItemDescription(selectedItem)}</Text>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelectedItem(null)}>
                <Text style={styles.cancelText}>{t('pvpItems.cancel', 'Cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.useBtn} onPress={handleUse}>
                <Text style={styles.useText}>{t('pvpItems.use', 'USE')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {disabled && disabledReason && !selectedItem && (
          <View style={styles.disabledBanner}>
            <Text style={styles.disabledText}>{disabledReason}</Text>
          </View>
        )}

        <View style={styles.slotsContainer}>
          {[ITEM_TYPES.HEAL, ITEM_TYPES.SHIELD, ITEM_TYPES.POWER].map(itemId => {
            const remaining = items?.[itemId]?.remaining || 0;
            const slotDisabled = isItemDisabled(itemId);
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
              >
                <View style={styles.iconContainer}>
                  <Ionicons 
                    name={getItemIcon(itemId)} 
                    size={24} 
                    color={slotDisabled ? theme.colors.textMuted : (isSelected ? 'white' : theme.colors.primary)} 
                  />
                </View>
                <Text style={[styles.slotName, slotDisabled && styles.textDisabled, isSelected && styles.textSelected]}>
                  {getItemName(itemId).split(' ')[0]}
                </Text>
                <View style={[styles.badge, remaining <= 0 && styles.badgeEmpty]}>
                  <Text style={styles.badgeText}>{remaining}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
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
  },
  slotsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
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
  },
  slotSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  slotDisabled: {
    opacity: 0.5,
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
    borderWidth: 2,
    borderColor: theme.colors.card,
  },
  badgeEmpty: {
    backgroundColor: theme.colors.textMuted,
  },
  badgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  selectionArea: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.background,
    padding: theme.spacing.medium,
    borderRadius: 12,
    marginBottom: theme.spacing.medium,
    borderWidth: 1,
    borderColor: theme.colors.primary,
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
  disabledBanner: {
    backgroundColor: theme.colors.background,
    padding: theme.spacing.small,
    borderRadius: 8,
    marginBottom: theme.spacing.medium,
    alignItems: 'center',
  },
  disabledText: {
    color: theme.colors.danger,
    fontSize: 12,
    fontWeight: 'bold',
  }
});
