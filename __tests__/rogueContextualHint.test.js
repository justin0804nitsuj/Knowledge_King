import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import RogueContextualHint from '../src/components/RogueContextualHint';

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, defaultValue) => defaultValue || key,
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

describe('RogueContextualHint Component', () => {
  it('returns null when visible is explicitly false or hintKey is absent', () => {
    let tree1, tree2;
    act(() => {
      tree1 = renderer.create(<RogueContextualHint visible={false} hintKey="first_relic_draft" />);
      tree2 = renderer.create(<RogueContextualHint />);
    });
    expect(tree1.toJSON()).toBeNull();
    expect(tree2.toJSON()).toBeNull();
  });

  it('renders correctly for canonical first_relic_draft key', () => {
    let tree;
    act(() => {
      tree = renderer.create(<RogueContextualHint hintKey="first_relic_draft" />);
    });

    const textNodes = tree.root.findAllByType(Text);
    const textValues = textNodes.map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children));

    // Must contain title, description, and dismiss button text
    expect(textValues.some((txt) => typeof txt === 'string' && txt.includes('Relics of Power'))).toBe(true);
    expect(textValues.some((txt) => typeof txt === 'string' && txt.includes('Relics provide passive bonuses'))).toBe(true);
    expect(textValues.some((txt) => txt === 'Got it')).toBe(true);
  });

  it('renders correctly for alias first_relic key', () => {
    let tree;
    act(() => {
      tree = renderer.create(<RogueContextualHint hintKey="first_relic" />);
    });

    const textNodes = tree.root.findAllByType(Text);
    const textValues = textNodes.map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children));
    expect(textValues.some((txt) => typeof txt === 'string' && txt.includes('Relics of Power'))).toBe(true);
  });

  it('renders correctly for all other canonical keys (first_action_select, first_curse, first_guard, first_heavy_attack)', () => {
    const canonicalKeys = [
      'first_action_select',
      'first_curse',
      'first_guard',
      'first_heavy_attack',
    ];

    for (const key of canonicalKeys) {
      let tree;
      act(() => {
        tree = renderer.create(<RogueContextualHint hintKey={key} />);
      });
      const textNodes = tree.root.findAllByType(Text);
      const textValues = textNodes.map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children));
      // Must have title, desc, and Got it
      expect(textValues.length).toBeGreaterThanOrEqual(3);
      for (const val of textValues) {
        expect(val).toBeTruthy();
      }
    }
  });

  it('calls onDismiss when close button or Got it button is pressed', () => {
    const onDismissMock = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <RogueContextualHint hintKey="first_relic_draft" onDismiss={onDismissMock} />
      );
    });

    const buttons = tree.root.findAllByType(TouchableOpacity);
    expect(buttons.length).toBe(2); // close button and dismiss button

    // Trigger close button
    act(() => {
      buttons[0].props.onPress();
    });
    expect(onDismissMock).toHaveBeenCalledTimes(1);

    // Trigger Got it button
    act(() => {
      buttons[1].props.onPress();
    });
    expect(onDismissMock).toHaveBeenCalledTimes(2);
  });

  it('applies high-contrast styling tokens', () => {
    let tree;
    act(() => {
      tree = renderer.create(<RogueContextualHint hintKey="first_relic_draft" />);
    });

    const rootJson = tree.toJSON();
    // Card background must be high-contrast slate #1E293B with amber border #F59E0B
    expect(rootJson.props.style.backgroundColor).toBe('#1E293B');
    expect(rootJson.props.style.borderColor).toBe('#F59E0B');

    // Title color should be bright amber-yellow #FDE68A
    const textNodes = tree.root.findAllByType(Text);
    const titleNode = textNodes.find((n) => n.props.style && n.props.style.color === '#FDE68A');
    expect(titleNode).toBeTruthy();

    // Body desc color should be #F1F5F9 (white-slate)
    const descNode = textNodes.find((n) => n.props.style && n.props.style.color === '#F1F5F9');
    expect(descNode).toBeTruthy();

    // Dismiss button text should be dark navy on amber
    const btnTextNode = textNodes.find((n) => n.props.style && n.props.style.color === '#0F172A');
    expect(btnTextNode).toBeTruthy();
  });
});
