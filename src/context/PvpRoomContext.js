import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createRoom as serviceCreateRoom, joinRoom as serviceJoinRoom, leaveRoom as serviceLeaveRoom, subscribeToRoom } from '../services/pvp/roomService';
import { useAuth } from './AuthContext';
import { RoomStatus } from '../domain/pvp/roomConstants';

const PvpRoomContext = createContext(null);

export function PvpRoomProvider({ children }) {
  const { user } = useAuth();
  const [roomId, setRoomId] = useState(null);
  const [room, setRoom] = useState(null);
  
  // Track room status
  const status = room?.meta?.status || null;
  // Track my role
  const role = room?.players?.[user?.uid]?.role || null;
  const isHost = room?.meta?.hostUid === user?.uid;

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      return;
    }

    const unsubscribe = subscribeToRoom(roomId, (roomData) => {
      if (!roomData) {
        // Room was deleted
        setRoom(null);
        setRoomId(null);
      } else {
        setRoom(roomData);
        if (roomData.meta.status === RoomStatus.CANCELLED) {
          setRoom(null);
          setRoomId(null);
        }
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  const createRoom = useCallback(async () => {
    if (!user) return null;
    try {
      const code = await serviceCreateRoom(user);
      setRoomId(code);
      return code;
    } catch (e) {
      throw e;
    }
  }, [user]);

  const joinRoom = useCallback(async (code) => {
    if (!user) return null;
    try {
      const joinedCode = await serviceJoinRoom(code, user);
      setRoomId(joinedCode);
      return joinedCode;
    } catch (e) {
      throw e;
    }
  }, [user]);

  const leaveRoom = useCallback(async () => {
    if (!roomId || !user) return;
    try {
      await serviceLeaveRoom(roomId, user);
    } catch (e) {
      console.warn("Failed to leave room cleanly", e);
    } finally {
      setRoomId(null);
      setRoom(null);
    }
  }, [roomId, user]);

  const value = {
    roomId,
    room,
    role,
    status,
    isHost,
    createRoom,
    joinRoom,
    leaveRoom
  };

  return (
    <PvpRoomContext.Provider value={value}>
      {children}
    </PvpRoomContext.Provider>
  );
}

export function usePvpRoom() {
  const context = useContext(PvpRoomContext);
  if (context === null) {
    throw new Error('usePvpRoom must be used within a PvpRoomProvider');
  }
  return context;
}
