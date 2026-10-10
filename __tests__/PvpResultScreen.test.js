import React from 'react';
import renderer, { act } from 'react-test-renderer';
import PvpResultScreen from '../src/screens/PvpResultScreen';
import * as PvpRoomContext from '../src/context/PvpRoomContext';
import * as PvpBattleService from '../src/services/pvp/pvpBattleService';
import { gameFeedback } from '../src/services/feedback/gameFeedback';
import { Animated, TouchableOpacity, BackHandler } from 'react-native';
import { leaveRoom } from '../src/services/pvp/roomService';

// Removed react-native mock

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-audio', () => ({ setAudioModeAsync: jest.fn(), createAudioPlayer: jest.fn() }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('../src/services/feedback/gameFeedback', () => ({
  gameFeedback: {
    init: jest.fn(),
    cleanup: jest.fn(),
    playVictory: jest.fn(),
    playDefeat: jest.fn(),
    playDraw: jest.fn(),
  }
}));
jest.mock('../src/context/PvpRoomContext', () => ({
  usePvpRoom: jest.fn(),
}));
jest.mock('../src/services/pvp/pvpBattleService', () => ({
  subscribeToMatchState: jest.fn(),
}));
jest.mock('../src/services/pvp/roomService', () => ({
  leaveRoom: jest.fn(),
}));

describe('PvpResultScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop: jest.fn() });
  });

  it.each(['button', 'Android Back'])('%s cleans up using the user object and resets the completed stack', async action => {
    const user = { uid: 'player-1', displayName: 'Player' };
    const reset = jest.fn();
    const stopMatchListener = jest.fn();
    const mockContextLeaveRoom = jest.fn().mockResolvedValue(undefined);
    let backHandler;
    const removeBackHandler = jest.fn();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, handler) => {
      backHandler = handler;
      return { remove: removeBackHandler };
    });
    PvpRoomContext.usePvpRoom.mockReturnValue({
      roomId: 'room-1', user,
      room: { meta: { hostUid: user.uid }, players: { 'player-1': {}, 'player-2': {} } },
      leaveRoom: mockContextLeaveRoom,
    });
    PvpBattleService.subscribeToMatchState.mockImplementation((id, callback) => {
      callback({ result: { winnerUid: user.uid }, players: {} });
      return stopMatchListener;
    });
    let component;
    act(() => { component = renderer.create(<PvpResultScreen navigation={{ reset }} />); });
    await act(async () => {
      if (action === 'button') await component.root.findByType(TouchableOpacity).props.onPress();
      else expect(backHandler()).toBe(true);
    });
    expect(mockContextLeaveRoom).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith({
      index: 0, routes: [{ name: 'MainTabs', params: { screen: 'Arena' } }],
    });
    act(() => { component.unmount(); });
    expect(stopMatchListener).toHaveBeenCalledTimes(1);
    expect(removeBackHandler).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('renders initial null result then transitions to WIN without hook errors, and plays feedback once', () => {
    let subscriberCb;
    jest.spyOn(PvpBattleService, 'subscribeToMatchState').mockImplementation((roomId, cb) => {
      subscriberCb = cb;
      return jest.fn();
    });

    jest.spyOn(PvpRoomContext, 'usePvpRoom').mockReturnValue({
      roomId: 'room-1',
      user: { uid: 'player-1' },
      isHost: true,
      room: {
        meta: { hostUid: 'player-1' },
        players: { 'player-1': {}, 'player-2': {} },
        match: { matchId: 'match-1' }
      }
    });

    // We override console.error to catch hook violations
    const originalConsoleError = console.error;
    const errorSpy = jest.fn();
    console.error = errorSpy;

    let component;
    act(() => {
      component = renderer.create(<PvpResultScreen navigation={{ reset: jest.fn() }} />);
    });

    // Initially matchState is null, should show loading
    expect(gameFeedback.playVictory).not.toHaveBeenCalled();

    // Now transition to WIN
    act(() => {
      subscriberCb({
        result: { winnerUid: 'player-1' },
        players: { 'player-1': {}, 'player-2': {} }
      });
    });

    // No Hook violation errors should occur
    const hookErrors = errorSpy.mock.calls.filter(args => 
      typeof args[0] === 'string' && args[0].includes('Rendered more hooks')
    );
    expect(hookErrors.length).toBe(0);

    // Feedback played exactly once
    expect(gameFeedback.playVictory).toHaveBeenCalledTimes(1);
    expect(gameFeedback.playDefeat).not.toHaveBeenCalled();
    expect(gameFeedback.playDraw).not.toHaveBeenCalled();

    // Rerender same WIN result
    act(() => {
      subscriberCb({
        result: { winnerUid: 'player-1' },
        players: { 'player-1': {}, 'player-2': {} }
      });
    });

    // Still played exactly once
    expect(gameFeedback.playVictory).toHaveBeenCalledTimes(1);

    console.error = originalConsoleError;
  });

  it('renders initial null result then transitions to LOSE without hook errors, and plays feedback once', () => {
    let subscriberCb;
    jest.spyOn(PvpBattleService, 'subscribeToMatchState').mockImplementation((roomId, cb) => {
      subscriberCb = cb;
      return jest.fn();
    });

    jest.spyOn(PvpRoomContext, 'usePvpRoom').mockReturnValue({
      roomId: 'room-1',
      user: { uid: 'player-1' },
      isHost: true,
      room: {
        meta: { hostUid: 'player-1' },
        players: { 'player-1': {}, 'player-2': {} },
        match: { matchId: 'match-2' }
      }
    });

    let component;
    act(() => {
      component = renderer.create(<PvpResultScreen navigation={{ reset: jest.fn() }} />);
    });

    act(() => {
      subscriberCb({
        result: { winnerUid: 'player-2' }, // opponent wins
        players: { 'player-1': {}, 'player-2': {} }
      });
    });

    expect(gameFeedback.playDefeat).toHaveBeenCalledTimes(1);
    expect(gameFeedback.playVictory).not.toHaveBeenCalled();

    act(() => {
      subscriberCb({
        result: { winnerUid: 'player-2' },
        players: { 'player-1': {}, 'player-2': {} }
      });
    });

    expect(gameFeedback.playDefeat).toHaveBeenCalledTimes(1); // still once
  });

  it('renders initial null result then transitions to DRAW without hook errors, and plays feedback once', () => {
    let subscriberCb;
    jest.spyOn(PvpBattleService, 'subscribeToMatchState').mockImplementation((roomId, cb) => {
      subscriberCb = cb;
      return jest.fn();
    });

    jest.spyOn(PvpRoomContext, 'usePvpRoom').mockReturnValue({
      roomId: 'room-1',
      user: { uid: 'player-1' },
      isHost: true,
      room: {
        meta: { hostUid: 'player-1' },
        players: { 'player-1': {}, 'player-2': {} },
        match: { matchId: 'match-3' }
      }
    });

    let component;
    act(() => {
      component = renderer.create(<PvpResultScreen navigation={{ reset: jest.fn() }} />);
    });

    act(() => {
      subscriberCb({
        result: { winnerUid: null }, // draw
        players: { 'player-1': {}, 'player-2': {} }
      });
    });

    expect(gameFeedback.playDraw).toHaveBeenCalledTimes(1);
    
    act(() => {
      subscriberCb({
        result: { winnerUid: null },
        players: { 'player-1': {}, 'player-2': {} }
      });
    });

    expect(gameFeedback.playDraw).toHaveBeenCalledTimes(1); // still once
  });
});
