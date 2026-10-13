import React from 'react';
import renderer, { act } from 'react-test-renderer';
import WaitingRoomScreen from '../src/screens/WaitingRoomScreen';
import { PvpRoomProvider, usePvpRoom } from '../src/context/PvpRoomContext';
import { BackHandler, Alert } from 'react-native';
import * as roomService from '../src/services/pvp/roomService';
import { RoomStatus } from '../src/domain/pvp/roomConstants';

jest.mock('../src/services/pvp/roomService', () => {
  const actual = jest.requireActual('../src/services/pvp/roomService');
  return {
    ...actual,
    setupWaitingRoomPresence: jest.fn(() => jest.fn()),
    leaveRoom: jest.fn().mockResolvedValue(true),
  };
});

jest.mock('../src/context/OnlineContext', () => ({
  useOnline: () => ({ isOnline: true })
}));

jest.mock('../src/services/online/connectionService', () => ({}));
jest.mock('firebase/database', () => ({}));
jest.mock('../src/services/firebase/firebaseDatabase', () => ({}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(),
}));

const mockNavigation = {
  navigate: jest.fn(),
  replace: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
};

jest.mock('../src/context/PvpRoomContext', () => ({
  usePvpRoom: jest.fn(),
}));

describe('WaitingRoomScreen Cleanup Lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. WaitingRoom mount/unmount does not throw', () => {
    usePvpRoom.mockReturnValue({
      roomId: 'testRoom',
      room: { meta: { status: RoomStatus.WAITING, hostUid: 'host' }, players: { host: { role: 'HOST' } } },
      isHost: true,
      isLoadingRoom: false,
      leaveRoom: jest.fn(),
      getDepartureIntent: () => null,
      getDepartureSession: () => null,
      setReady: jest.fn(),
      startMatch: jest.fn()
    });
    
    expect(() => {
      let root;
      act(() => {
        root = renderer.create(<WaitingRoomScreen navigation={mockNavigation} />);
      });
      act(() => {
        root.unmount();
      });
    }).not.toThrow();
  });

  it('4. BackHandler subscription uses remove()', () => {
    usePvpRoom.mockReturnValue({
      roomId: 'testRoom',
      room: { meta: { status: RoomStatus.WAITING, hostUid: 'host' }, players: { host: { role: 'HOST' } } },
      isHost: true,
      isLoadingRoom: false,
      leaveRoom: jest.fn(),
      getDepartureIntent: () => null,
      getDepartureSession: () => null,
    });
    
    const mockRemove = jest.fn();
    const addListenerSpy = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({
      remove: mockRemove
    });
    
    let root;
    act(() => {
      root = renderer.create(<WaitingRoomScreen navigation={mockNavigation} />);
    });
    
    expect(addListenerSpy).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
    
    act(() => {
      root.unmount();
    });
    
    expect(mockRemove).toHaveBeenCalled();
    addListenerSpy.mockRestore();
  });

  it('6. WaitingRoom -> PvpBattle does not call leaveRoom', () => {
    jest.useFakeTimers();
    const mockLeaveRoom = jest.fn();
    usePvpRoom.mockReturnValue({
      roomId: 'testRoom',
      room: { meta: { status: RoomStatus.IN_BATTLE, hostUid: 'host' }, match: { matchId: 'm1' }, players: {} },
      status: RoomStatus.IN_BATTLE,
      isHost: true,
      isLoadingRoom: false,
      leaveRoom: mockLeaveRoom,
      getDepartureIntent: () => null,
      getDepartureSession: () => null,
    });

    act(() => {
      renderer.create(<WaitingRoomScreen navigation={mockNavigation} />);
    });
    
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    
    expect(mockNavigation.navigate).toHaveBeenCalledWith('PvpBattle');
    expect(mockLeaveRoom).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

