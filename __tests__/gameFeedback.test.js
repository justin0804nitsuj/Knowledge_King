import { gameFeedback } from '../src/services/feedback/gameFeedback';
import { loadSettings } from '../src/storage/settingsStorage';
import { setAudioModeAsync, createAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';

jest.mock('../assets/audio/pvp/correct.wav', () => 'correct.wav', { virtual: true });
jest.mock('../assets/audio/pvp/wrong.wav', () => 'wrong.wav', { virtual: true });
jest.mock('../assets/audio/pvp/damage.wav', () => 'damage.wav', { virtual: true });
jest.mock('../assets/audio/pvp/hit.wav', () => 'hit.wav', { virtual: true });
jest.mock('../assets/audio/pvp/heal.wav', () => 'heal.wav', { virtual: true });
jest.mock('../assets/audio/pvp/tick.wav', () => 'tick.wav', { virtual: true });
jest.mock('../assets/audio/pvp/go.wav', () => 'go.wav', { virtual: true });
jest.mock('../assets/audio/pvp/victory.wav', () => 'victory.wav', { virtual: true });
jest.mock('../assets/audio/pvp/defeat.wav', () => 'defeat.wav', { virtual: true });
jest.mock('../assets/audio/pvp/draw.wav', () => 'draw.wav', { virtual: true });

jest.mock('../src/storage/settingsStorage', () => ({
  loadSettings: jest.fn(),
}));

jest.mock('expo-audio', () => {
  const mockPlayer = {
    play: jest.fn(),
    seekTo: jest.fn().mockResolvedValue(),
    remove: jest.fn(),
  };
  return {
    setAudioModeAsync: jest.fn(),
    createAudioPlayer: jest.fn(() => mockPlayer),
    mockPlayer, // export for test assertions
  };
});

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
}));

describe('gameFeedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    gameFeedback.cleanup(); // Reset state
  });

  it('initializes with settings and configures audio mode', async () => {
    loadSettings.mockResolvedValueOnce({ soundEffects: true, haptics: true });
    await gameFeedback.init();
    expect(loadSettings).toHaveBeenCalled();
    expect(setAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({
      playsInSilentMode: true,
    }));
  });

  it('plays sound and haptic when settings are ON', async () => {
    gameFeedback.updateSettings({ soundEffects: true, haptics: true });
    
    await gameFeedback.playAnswerCorrect();
    
    // It creates sound on first play
    expect(createAudioPlayer).toHaveBeenCalled();
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
  });

  it('does not play sound when soundEffects is OFF', async () => {
    gameFeedback.updateSettings({ soundEffects: false, haptics: true });
    await gameFeedback.playAnswerCorrect();
    expect(createAudioPlayer).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).toHaveBeenCalled(); // Haptics still ON
  });

  it('does not play haptics when haptics is OFF', async () => {
    gameFeedback.updateSettings({ soundEffects: true, haptics: false });
    await gameFeedback.playAnswerCorrect();
    expect(createAudioPlayer).toHaveBeenCalled();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('replays already loaded sound instead of creating new instance', async () => {
    gameFeedback.updateSettings({ soundEffects: true, haptics: true });
    
    await gameFeedback.playAnswerCorrect();
    await gameFeedback.playAnswerCorrect(); // second time
    
    // Should only create once
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    
    const { mockPlayer } = require('expo-audio');
    expect(mockPlayer.seekTo).toHaveBeenCalledTimes(1);
    expect(mockPlayer.play).toHaveBeenCalledTimes(2); // 1 play (first), 1 seekTo+play (second)
  });

  it('cleans up audio on cleanup()', async () => {
    gameFeedback.updateSettings({ soundEffects: true });
    await gameFeedback.playAnswerCorrect();
    
    const { mockPlayer } = require('expo-audio');
    await gameFeedback.cleanup();
    expect(mockPlayer.remove).toHaveBeenCalled();
    expect(gameFeedback.sounds).toEqual({});
  });
});
