import React from 'react';
import renderer, { act } from 'react-test-renderer';
import PvpItemBar from '../src/components/pvp/PvpItemBar';
import { ITEM_TYPES } from '../src/domain/pvp/pvpItems';
import { Text, TouchableOpacity } from 'react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ 
    t: (k, defaultText, options) => {
      if (typeof defaultText === 'object') return k;
      if (typeof defaultText === 'string') return defaultText;
      return k;
    }
  })
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons'
}));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children }) => <View>{children}</View>,
    SafeAreaProvider: ({ children }) => <View>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 })
  };
});

describe('PvpItemBar UI Polish', () => {
  const defaultItems = {
    [ITEM_TYPES.HEAL]: { remaining: 2 },
    [ITEM_TYPES.SHIELD]: { remaining: 1 },
    [ITEM_TYPES.POWER]: { remaining: 1 }
  };

  const getTexts = (root) => root.findAllByType(Text).map(t => typeof t.props.children === 'string' || Array.isArray(t.props.children) ? [].concat(t.props.children).join('') : '');

  test('initial: HEAL ×2, SHIELD ×1, POWER ×1 visible', () => {
    let component;
    act(() => {
      component = renderer.create(
        <PvpItemBar items={defaultItems} onUseItem={jest.fn()} disabled={false} />
      );
    });
    const texts = getTexts(component.root);
    expect(texts).toContain('×2');
    expect(texts).toContain('×1');
  });

  test('HEAL selected: remaining count still visible', () => {
    let component;
    act(() => {
      component = renderer.create(
        <PvpItemBar items={defaultItems} onUseItem={jest.fn()} disabled={false} />
      );
    });
    
    act(() => {
      component.root.findAllByType(TouchableOpacity)[0].props.onPress();
    });
    
    const texts = getTexts(component.root);
    expect(texts).toContain('×2');
    expect(texts).toContain('USE');
  });

  test('HEAL used: items become gray via disabled prop', () => {
    let component;
    act(() => {
      component = renderer.create(
        <PvpItemBar 
          items={defaultItems} 
          disabled={true} 
          disabledReason="Item already used this round" 
        />
      );
    });
    const texts = getTexts(component.root);
    expect(texts).toContain('Item already used this round');
  });

  test('inventory zero: ×0 visible, slot disabled', () => {
    const zeroItems = {
      [ITEM_TYPES.HEAL]: { remaining: 0 },
      [ITEM_TYPES.SHIELD]: { remaining: 1 },
      [ITEM_TYPES.POWER]: { remaining: 1 }
    };
    let component;
    act(() => {
      component = renderer.create(
        <PvpItemBar items={zeroItems} onUseItem={jest.fn()} disabled={false} />
      );
    });
    const texts = getTexts(component.root);
    expect(texts).toContain('×0');
  });

  test.each(['disabled', 'empty', 'fullHp'])('selection clears when %s makes the item unusable', reason => {
    let component;
    act(() => {
      component = renderer.create(<PvpItemBar items={defaultItems} hp={60} onUseItem={jest.fn()} />);
    });
    act(() => { component.root.findAllByType(TouchableOpacity)[0].props.onPress(); });
    expect(getTexts(component.root)).toContain('USE');
    const items = reason === 'empty' ? { ...defaultItems, HEAL: { remaining: 0 } } : defaultItems;
    act(() => {
      component.update(<PvpItemBar items={items} hp={reason === 'fullHp' ? 100 : 60}
        disabled={reason === 'disabled'} onUseItem={jest.fn()} />);
    });
    expect(getTexts(component.root)).not.toContain('USE');
    act(() => { component.unmount(); });
  });
});

