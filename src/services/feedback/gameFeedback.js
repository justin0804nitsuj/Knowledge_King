import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { loadSettings } from '../../storage/settingsStorage';
import { Platform } from 'react-native';

async function debugStep(label, fn) {
  try {
    if (__DEV__) console.log(`[Feedback] ${label}: start`);
    const result = await fn();
    if (__DEV__) console.log(`[Feedback] ${label}: ok`);
    return result;
  } catch (error) {
    console.error(`[Feedback] ${label}: FAILED`, error);
    return undefined;
  }
}

class GameFeedback {
  constructor() {
    this.sounds = {};
    this.settings = { soundEffects: true, haptics: true };
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    await debugStep('audio:init', async () => {
      this.settings = await loadSettings();
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
      });
      this.initialized = true;
    });
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
  }

  async _playSound(assetMapKey) {
    if (!this.settings.soundEffects) return;
    
    await debugStep(`audio:play:${assetMapKey}`, async () => {
      let player = this.sounds[assetMapKey];

      if (player) {
        if (typeof player.seekTo === 'function') {
          await player.seekTo(0);
        }
      } else {
        let source;
        switch (assetMapKey) {
          case 'correct': source = require('../../../assets/audio/pvp/correct.wav'); break;
          case 'wrong': source = require('../../../assets/audio/pvp/wrong.wav'); break;
          case 'damage': source = require('../../../assets/audio/pvp/damage.wav'); break;
          case 'hit': source = require('../../../assets/audio/pvp/hit.wav'); break;
          case 'heal': source = require('../../../assets/audio/pvp/heal.wav'); break;
          case 'tick': source = require('../../../assets/audio/pvp/tick.wav'); break;
          case 'go': source = require('../../../assets/audio/pvp/go.wav'); break;
          case 'victory': source = require('../../../assets/audio/pvp/victory.wav'); break;
          case 'defeat': source = require('../../../assets/audio/pvp/defeat.wav'); break;
          case 'draw': source = require('../../../assets/audio/pvp/draw.wav'); break;
        }
        
        if (source) {
          player = createAudioPlayer(source);
          this.sounds[assetMapKey] = player;
        }
      }

      if (player && typeof player.play === 'function') {
        player.play();
      }
    });
  }

  _playHaptic(style) {
    if (!this.settings.haptics || Platform.OS === 'web') return;
    void debugStep(`haptic:impact:${style}`, async () => {
      await Haptics.impactAsync(style);
    });
  }

  _playNotificationHaptic(type) {
    if (!this.settings.haptics || Platform.OS === 'web') return;
    void debugStep(`haptic:notification:${type}`, async () => {
      await Haptics.notificationAsync(type);
    });
  }

  playAnswerCorrect() {
    void this._playSound('correct');
    this._playHaptic(Haptics.ImpactFeedbackStyle.Medium);
  }

  playAnswerWrong() {
    void this._playSound('wrong');
    this._playNotificationHaptic(Haptics.NotificationFeedbackType.Warning);
  }

  playDamage() {
    void this._playSound('damage');
    this._playHaptic(Haptics.ImpactFeedbackStyle.Heavy);
  }

  playOpponentHit() {
    void this._playSound('hit');
    this._playHaptic(Haptics.ImpactFeedbackStyle.Light);
  }

  playHeal() {
    void this._playSound('heal');
    this._playNotificationHaptic(Haptics.NotificationFeedbackType.Success);
  }

  playCountdownTick() {
    void this._playSound('tick');
  }

  playCountdownGo() {
    void this._playSound('go');
    this._playHaptic(Haptics.ImpactFeedbackStyle.Medium);
  }

  playVictory() {
    void this._playSound('victory');
    this._playNotificationHaptic(Haptics.NotificationFeedbackType.Success);
  }

  playDefeat() {
    void this._playSound('defeat');
    this._playNotificationHaptic(Haptics.NotificationFeedbackType.Error);
  }

  playDraw() {
    void this._playSound('draw');
    this._playHaptic(Haptics.ImpactFeedbackStyle.Light);
  }

  async cleanup() {
    await debugStep('audio:cleanup', async () => {
      for (const key in this.sounds) {
        const player = this.sounds[key];
        if (player) {
          if (typeof player.remove === 'function') {
            player.remove();
          } else if (typeof player.release === 'function') {
            player.release();
          }
        }
      }
      this.sounds = {};
      this.initialized = false;
    });
  }
}

export const gameFeedback = new GameFeedback();
