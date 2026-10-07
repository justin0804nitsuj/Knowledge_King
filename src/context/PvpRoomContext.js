import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createRoom as serviceCreateRoom, joinRoom as serviceJoinRoom, leaveRoom as serviceLeaveRoom, subscribeToRoom, setupPresence, verifyRoomExists } from '../services/pvp/roomService';
import { useAuth } from './AuthContext';
import { RoomStatus } from '../domain/pvp/roomConstants';

const PvpRoomContext = createContext(null);

export function PvpRoomProvider({ children }) {
  const { user } = useAuth();
  const [roomId, setRoomId] = useState(null);
  const [room, setRoom] = useState(null);
  const [isLoadingRoom, setIsLoadingRoom] = useState(false);
  
  // Track room status
  const status = room?.meta?.status || null;
  // Track my role
  const role = room?.players?.[user?.uid]?.role || null;
  const isHost = room?.meta?.hostUid === user?.uid;

  const userUid = user?.uid;

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      setIsLoadingRoom(false);
      return;
    }

    console.log(`[PVP-TRACE] CONTEXT subscribe start for ${roomId}`);
    setIsLoadingRoom(true);
    let isFirst = true;

    const unsubscribeRoom = subscribeToRoom(roomId, (roomData) => {
      if (isFirst) {
        console.log(`[PVP-TRACE] CONTEXT first snapshot exists=${!!roomData}`);
        isFirst = false;
      } else {
        console.log(`[PVP-TRACE] CONTEXT subsequent snapshot exists=${!!roomData}`);
      }
      setIsLoadingRoom(false);
      
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

    const cleanupPresence = setupPresence(roomId, user);

    return () => {
      console.log(`[PVP-TRACE] CONTEXT unsubscribe for ${roomId}`);
      unsubscribeRoom();
      cleanupPresence();
    };
  }, [roomId, userUid]);

  const createRoom = useCallback(async () => {
    if (!user) return null;
    console.log('[PVP-TRACE] CREATE begin');
    setIsLoadingRoom(true);
    try {
      const code = await serviceCreateRoom(user);
      console.log(`[PVP-TRACE] CREATE Firebase success roomCode=${code}`);
      
      // diagnostic
      const exists = await verifyRoomExists(code);
      console.log(`[PVP-TRACE] CREATE VERIFY: room exists = ${exists}`);
      
      setRoomId(code);
      return code;
    } catch (e) {
      setIsLoadingRoom(false);
      throw e;
    }
  }, [user]);

  const joinRoom = useCallback(async (code) => {
    if (!user) return null;
    console.log('[PVP-TRACE] JOIN begin');
    setIsLoadingRoom(true);
    try {
      const joinedCode = await serviceJoinRoom(code, user);
      console.log(`[PVP-TRACE] JOIN Firebase success roomCode=${joinedCode}`);
      setRoomId(joinedCode);
      return joinedCode;
    } catch (e) {
      setIsLoadingRoom(false);
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
    isLoadingRoom,
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
