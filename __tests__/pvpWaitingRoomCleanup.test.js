import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import WaitingRoomScreen from '../src/screens/WaitingRoomScreen';
import { PvpRoomProvider, usePvpRoom } from '../src/context/PvpRoomContext';
import { BackHandler, Alert } from 'react-native';
import * as roomService from '../src/services/pvp/roomService';
import { RoomStatus } from '../domain/pvp/roomConstants';

jest.mock('../src/services/pvp/roomService', () => {
  const actual = jest.requireActual('../src/services/pvp/roomService');
  return {
    ...actual,
    setupWaitingRoomPresence: jest.fn(() => jest.fn()),
    leaveRoom: jest.fn().mockResolvedValue(true),
  };
});

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
      const { unmount } = render(<WaitingRoomScreen navigation={mockNavigation} />);
      unmount();
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
    
    const { unmount } = render(<WaitingRoomScreen navigation={mockNavigation} />);
    
    expect(addListenerSpy).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
    
    unmount();
    
    expect(mockRemove).toHaveBeenCalled();
    addListenerSpy.mockRestore();
  });

  it('6. WaitingRoom -> PvpBattle does not call leaveRoom', () => {
    const mockLeaveRoom = jest.fn();
    usePvpRoom.mockReturnValue({
      roomId: 'testRoom',
      room: { meta: { status: RoomStatus.IN_BATTLE, hostUid: 'host' }, match: { matchId: 'm1' }, players: {} },
      isHost: true,
      isLoadingRoom: false,
      leaveRoom: mockLeaveRoom,
      getDepartureIntent: () => null,
      getDepartureSession: () => null,
    });

    render(<WaitingRoomScreen navigation={mockNavigation} />);
    
    expect(mockNavigation.navigate).toHaveBeenCalledWith('PvpBattle');
    expect(mockLeaveRoom).not.toHaveBeenCalled();
  });

  it('8. explicit Leave still performs proper leave behavior', async () => {
    const mockLeaveRoom = jest.fn().mockResolvedValue(true);
    usePvpRoom.mockReturnValue({
      roomId: 'testRoom',
      room: { meta: { status: RoomStatus.WAITING, hostUid: 'host' }, players: {} },
      isHost: true,
      isLoadingRoom: false,
      leaveRoom: mockLeaveRoom,
      getDepartureIntent: () => null,
      getDepartureSession: () => null,
    });
    
    const alertSpy = jest.spyOn(Alert, 'alert');
    
    const { getByText } = render(<WaitingRoomScreen navigation={mockNavigation} />);
    
    fireEvent.press(getByText('arena.leaveRoom'));
    
    expect(alertSpy).toHaveBeenCalled();
    const confirmPress = alertSpy.mock.calls[0][2][1].onPress;
    
    await act(async () => {
      await confirmPress();
    });
    
    expect(mockLeaveRoom).toHaveBeenCalled();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('MainTabs', { screen: 'Arena' });
    alertSpy.mockRestore();
  });
});
