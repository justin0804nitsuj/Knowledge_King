import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { theme } from '../../theme';

export default function PvpHealthBar({ name, hp, isOpponent = false, maxHp = 100 }) {
  const clampedHp = Math.max(0, Math.min(hp, maxHp));
  const animatedWidth = useRef(new Animated.Value(clampedHp)).current;
  const shakeAnimation = useRef(new Animated.Value(0)).current;

  // Animate width changes
  useEffect(() => {
    const anim = Animated.timing(animatedWidth, {
      toValue: clampedHp,
      duration: 300,
      useNativeDriver: false, // width cannot use native driver
    });
    anim.start();
    return () => anim.stop();
  }, [clampedHp, animatedWidth]);

  // Shake animation on damage (hp decreases)
  const prevHp = useRef(clampedHp);
  useEffect(() => {
    let anim;
    if (clampedHp < prevHp.current) {
      anim = Animated.sequence([
        Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: -10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: 0, duration: 50, useNativeDriver: true })
      ]);
      anim.start();
    }
    prevHp.current = clampedHp;
    return () => { if (anim) anim.stop(); };
  }, [clampedHp, shakeAnimation]);

  const widthInterpolation = animatedWidth.interpolate({
    inputRange: [0, maxHp],
    outputRange: ['0%', '100%'],
  });

  const getHealthColor = (currentHp) => {
    if (currentHp > maxHp * 0.5) return theme.colors.success || '#38a169';
    if (currentHp > maxHp * 0.2) return theme.colors.star || '#d69e2e';
    return theme.colors.danger || '#e53e3e';
  };

  return (
    <Animated.View style={[styles.container, { transform: [{ translateX: shakeAnimation }] }]}>
      <View style={[styles.metaContainer, isOpponent && styles.metaContainerOpponent]}>
        <Text
          style={[styles.nameText, isOpponent && styles.nameTextOpponent]}
          numberOfLines={1}
          ellipsizeMode="tail"
          testID={isOpponent ? 'pvpOpponentName' : 'pvpPlayerName'}
        >
          {name}
        </Text>
        <Text
          style={[styles.hpText, isOpponent && styles.hpTextOpponent]}
          testID={isOpponent ? 'pvpOpponentHpText' : 'pvpPlayerHpText'}
        >
          {clampedHp} / {maxHp}
        </Text>
      </View>
      <View style={styles.barBackground}>
        <Animated.View
          style={[
            styles.barFill,
            {
              width: widthInterpolation,
              backgroundColor: getHealthColor(clampedHp),
            },
          ]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 2,
    width: '100%',
  },
  metaContainer: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    marginBottom: 4,
    width: '100%',
  },
  metaContainerOpponent: {
    alignItems: 'flex-end',
  },
  nameText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    width: '100%',
    textAlign: 'left',
  },
  nameTextOpponent: {
    textAlign: 'right',
  },
  hpText: {
    fontSize: 13,
    color: theme.colors.textMuted,
    fontWeight: '700',
    marginTop: 2,
    width: '100%',
    textAlign: 'left',
  },
  hpTextOpponent: {
    textAlign: 'right',
  },
  barBackground: {
    height: 10,
    backgroundColor: theme.colors.border,
    borderRadius: 5,
    overflow: 'hidden',
    width: '100%',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
  },
});
