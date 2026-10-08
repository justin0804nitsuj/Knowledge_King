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
      <View style={[styles.header, isOpponent && styles.headerOpponent]}>
        <Text style={styles.nameText} numberOfLines={1}>{name}</Text>
        <Text style={styles.hpText}>{clampedHp} / {maxHp}</Text>
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
    marginVertical: 4,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerOpponent: {
    flexDirection: 'row-reverse',
  },
  nameText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    flex: 1,
  },
  hpText: {
    fontSize: 14,
    color: theme.colors.textMuted,
    fontWeight: '600',
    marginLeft: 8,
  },
  barBackground: {
    height: 12,
    backgroundColor: theme.colors.border,
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 6,
  },
});
