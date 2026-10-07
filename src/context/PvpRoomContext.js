import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { createRoom as serviceCreateRoom, joinRoom as serviceJoinRoom, leaveRoom as serviceLeaveRoom, subscribeToRoom, setupWaitingRoomPresence, verifyRoomExists, setPlayerReady as serviceSetPlayerReady, startMatch as serviceStartMatch } from '../services/pvp/roomService';
import { useAuth } from './AuthContext';
import { RoomStatus } from '../domain/pvp/roomConstants';
import { DepartureIntent, performExplicitDeparture, createDepartureSession } from '../domain/pvp/departure';

const PvpRoomContext = createContext(null);

export function PvpRoomProvider({ children }) {
  const { user } = useAuth();
  const [roomId, setRoomId] = useState(null);
  const [room, setRoom] = useState(null);
  const [isLoadingRoom, setIsLoadingRoom] = useState(false);
  // Local-only departure intent. Never written to Firebase.
  const departureIntentRef = useRef(DepartureIntent.NONE);
  const setDepartureIntent = useCallback((intent) => {
    departureIntentRef.current = intent;
  }, []);
  const getDepartureIntent = useCallback(() => departureIntentRef.current, []);
  // One-shot remote-departure notification guards for the current room session.
  const departureSessionRef = useRef(createDepartureSession(null));
  const getDepartureSession = useCallback(() => departureSessionRef.current, []);
  
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
        if (__DEV__) console.log(`[PVP-ALERT] room snapshot null (${roomId})`);
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

    return () => {
      console.log(`[PVP-TRACE] CONTEXT unsubscribe for ${roomId}`);
      unsubscribeRoom();
    };
  }, [roomId, userUid]);

  useEffect(() => {
    if (!roomId || !userUid || !room) return;
    
    if (room.meta.status === RoomStatus.WAITING) {
      const isActuallyHost = room.meta.hostUid === userUid;
      const cleanupPresence = setupWaitingRoomPresence(roomId, user, isActuallyHost);
      return () => {
        cleanupPresence();
      };
    }
  }, [roomId, userUid, room?.meta?.status, room?.meta?.hostUid]);

  const createRoom = useCallback(async () => {
    if (!user) return null;
    console.log('[PVP-TRACE] CREATE begin');
    setDepartureIntent(DepartureIntent.NONE);
    setIsLoadingRoom(true);
    try {
      const code = await serviceCreateRoom(user);
      console.log(`[PVP-TRACE] CREATE Firebase success roomCode=${code}`);
      
      // diagnostic
      const exists = await verifyRoomExists(code);
      console.log(`[PVP-TRACE] CREATE VERIFY: room exists = ${exists}`);
      
      departureSessionRef.current = createDepartureSession(code);
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
    setDepartureIntent(DepartureIntent.NONE);
    setIsLoadingRoom(true);
    try {
      const joinedCode = await serviceJoinRoom(code, user);
      console.log(`[PVP-TRACE] JOIN Firebase success roomCode=${joinedCode}`);
      departureSessionRef.current = createDepartureSession(joinedCode);
      setRoomId(joinedCode);
      return joinedCode;
    } catch (e) {
      setIsLoadingRoom(false);
      throw e;
    }
  }, [user]);

  // Explicit local leave/close. Throws on failure (room stays active, intent reset).
  const leaveRoom = useCallback(async () => {
    if (!roomId || !user) return;
    await performExplicitDeparture({
      isHost,
      setIntent: setDepartureIntent,
      leave: () => serviceLeaveRoom(roomId, user),
      clearActiveRoom: () => {
        setRoomId(null);
        setRoom(null);
      },
    });
  }, [roomId, user, isHost, setDepartureIntent]);

  const value = {
    roomId,
    room,
    role,
    status,
    isHost,
    isLoadingRoom,
    createRoom,
    joinRoom,
    leaveRoom,
    getDepartureIntent,
    getDepartureSession,
    setReady: async (isReady) => {
      if (roomId && user) {
        await serviceSetPlayerReady(roomId, user, isReady);
      }
    },
    startMatch: async () => {
      if (roomId && user && isHost) {
        await serviceStartMatch(roomId, user);
      }
    }
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
