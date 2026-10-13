import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import PvpActiveEffectBadge from '../src/components/pvp/PvpActiveEffectBadge';
import en from '../src/localization/locales/en';
import zhTW from '../src/localization/locales/zh-TW';

describe('PvpActiveEffectBadge Component', () => {
  it('returns null if type or label is missing', () => {
    let noType, noLabel;
    act(() => {
      noType = renderer.create(<PvpActiveEffectBadge label="Shield" />);
      noLabel = renderer.create(<PvpActiveEffectBadge type="SHIELD" />);
    });
    expect(noType.toJSON()).toBeNull();
    expect(noLabel.toJSON()).toBeNull();
  });

  it('Shield renders the Shield badge with correct localized text', () => {
    let enTree, zhTree;
    act(() => {
      enTree = renderer.create(
        <PvpActiveEffectBadge type="SHIELD" label={en.pvp.shieldBadge} testID="shieldBadge" />
      );
      zhTree = renderer.create(
        <PvpActiveEffectBadge type="SHIELD" label={zhTW.pvp.shieldBadge} testID="shieldBadge" />
      );
    });

    const enText = enTree.root.findByType(Text).props.children.join('');
    expect(enText).toBe('🛡 Shield');

    const zhText = zhTree.root.findByType(Text).props.children.join('');
    expect(zhText).toBe('🛡 護盾');
  });

  it('Power renders the Power badge with correct localized text', () => {
    let enTree, zhTree;
    act(() => {
      enTree = renderer.create(
        <PvpActiveEffectBadge type="POWER" label={en.pvp.powerBadge} testID="powerBadge" />
      );
      zhTree = renderer.create(
        <PvpActiveEffectBadge type="POWER" label={zhTW.pvp.powerBadge} testID="powerBadge" />
      );
    });

    const enText = enTree.root.findByType(Text).props.children.join('');
    expect(enText).toBe('⚡ Power');

    const zhText = zhTree.root.findByType(Text).props.children.join('');
    expect(zhText).toBe('⚡ 力量增幅');
  });

  it('localization does not render raw i18n keys', () => {
    let shieldTree, powerTree;
    act(() => {
      shieldTree = renderer.create(
        <PvpActiveEffectBadge type="SHIELD" label={en.pvp.shieldBadge} />
      );
      powerTree = renderer.create(
        <PvpActiveEffectBadge type="POWER" label={en.pvp.powerBadge} />
      );
    });

    const shieldText = shieldTree.root.findByType(Text).props.children.join('');
    expect(shieldText).not.toContain('pvp.shieldBadge');

    const powerText = powerTree.root.findByType(Text).props.children.join('');
    expect(powerText).not.toContain('pvp.powerBadge');
  });

  it('icon is not duplicated', () => {
    let shieldTree, powerTree;
    act(() => {
      shieldTree = renderer.create(
        <PvpActiveEffectBadge type="SHIELD" label={en.pvp.shieldBadge} />
      );
      powerTree = renderer.create(
        <PvpActiveEffectBadge type="POWER" label={en.pvp.powerBadge} />
      );
    });

    const shieldText = shieldTree.root.findByType(Text).props.children.join('');
    const shieldMatches = (shieldText.match(/🛡/g) || []).length;
    expect(shieldMatches).toBe(1);

    const powerText = powerTree.root.findByType(Text).props.children.join('');
    const powerMatches = (powerText.match(/⚡/g) || []).length;
    expect(powerMatches).toBe(1);
  });
});
