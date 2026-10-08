import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { loadSettings } from '../../storage/settingsStorage';
import { Platform } from 'react-native';

class GameFeedback {
  constructor() {
    this.sounds = {};
    this.settings = { soundEffects: true, haptics: true };
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      this.settings = await loadSettings();
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
      });
      this.initialized = true;
    } catch (e) {
      console.warn('GameFeedback init failed:', e);
    }
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
  }

  async _playSound(assetMapKey) {
    if (!this.settings.soundEffects) return;
    try {
      let player = this.sounds[assetMapKey];

      if (player) {
        try {
          if (typeof player.seekTo === 'function') {
            const seekP = player.seekTo(0);
            if (seekP instanceof Promise) await seekP;
          }
        } catch (e) {
          console.warn(`seekTo error for ${assetMapKey}:`, e);
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
        const playResult = player.play();
        if (playResult instanceof Promise) {
          playResult.catch(e => console.warn(`play error for ${assetMapKey}:`, e));
        }
      }
    } catch (e) {
      console.warn(`Failed to play sound ${assetMapKey}:`, e);
    }
  }

  _playHaptic(style) {
    if (!this.settings.haptics) return;
    try {
      if (Platform.OS === 'web') return;
      const p = Haptics.impactAsync(style);
      if (p instanceof Promise) p.catch(e => console.warn('Haptic error:', e));
    } catch (e) {
      console.warn('Failed to play haptic:', e);
    }
  }

  _playNotificationHaptic(type) {
    if (!this.settings.haptics) return;
    try {
      if (Platform.OS === 'web') return;
      const p = Haptics.notificationAsync(type);
      if (p instanceof Promise) p.catch(e => console.warn('Haptic notif error:', e));
    } catch (e) {
      console.warn('Failed to play notification haptic:', e);
    }
  }

  playAnswerCorrect() {
    this._playSound('correct');
    this._playHaptic(Haptics.ImpactFeedbackStyle.Medium);
  }

  playAnswerWrong() {
    this._playSound('wrong');
    this._playNotificationHaptic(Haptics.NotificationFeedbackType.Warning);
  }

  playDamage() {
    this._playSound('damage');
    this._playHaptic(Haptics.ImpactFeedbackStyle.Heavy);
  }

  playOpponentHit() {
    this._playSound('hit');
    this._playHaptic(Haptics.ImpactFeedbackStyle.Light);
  }

  playHeal() {
    this._playSound('heal');
    this._playNotificationHaptic(Haptics.NotificationFeedbackType.Success);
  }

  playCountdownTick() {
    this._playSound('tick');
  }

  playCountdownGo() {
    this._playSound('go');
    this._playHaptic(Haptics.ImpactFeedbackStyle.Medium);
  }

  playVictory() {
    this._playSound('victory');
    this._playNotificationHaptic(Haptics.NotificationFeedbackType.Success);
  }

  playDefeat() {
    this._playSound('defeat');
    this._playNotificationHaptic(Haptics.NotificationFeedbackType.Error);
  }

  playDraw() {
    this._playSound('draw');
    this._playHaptic(Haptics.ImpactFeedbackStyle.Light);
  }

  async cleanup() {
    for (const key in this.sounds) {
      try {
        const player = this.sounds[key];
        if (player) {
          let cleanupResult;
          if (typeof player.release === 'function') {
            cleanupResult = player.release();
          } else if (typeof player.remove === 'function') {
            cleanupResult = player.remove();
          }
          if (cleanupResult instanceof Promise) {
            cleanupResult.catch(e => console.warn(`Cleanup error for ${key}:`, e));
          }
        }
      } catch (e) {
        console.warn(`Sync cleanup error for ${key}:`, e);
      }
    }
    this.sounds = {};
    this.initialized = false;
  }
}

export const gameFeedback = new GameFeedback();
