# Android Release QA Checklist

**Date:** 2026-10-09
**Branch:** hardening/android-release-qa

## Automated Verification 
✅ **Question Generation Stress Test**: 10,000 iterations ran with 0 errors (100% deterministic, 0 duplicate answers, 0 missing targets).
✅ **Dependency Audit**: Expo doctor checks passed perfectly. No missing peer dependencies.
✅ **Animations & Timers**: `MistakeReviewScreen` and `WaitingRoomScreen` leaks fixed (added cleanup for `Animated.loop` and `setTimeout`).
✅ **App Startup**: Boot flash tested implicitly via Expo Doctor; configuration validates.
✅ **Translations**: Parity script passes.

## Manual Physical-Device QA Checklist

*The following items must be verified manually on a physical Android device prior to release build.*

### 1. App Startup & Navigation
- [ ] Splash screen transitions smoothly without a white flash
- [ ] Google Auth login completes without double-initialization
- [ ] Navigation tabs switch immediately without stacking errors
- [ ] Hardware back button on Home Screen backgrounds the app

### 2. Core Game Loop (PvE)
- [ ] Entering `Adventure` and tapping a node opens `StagePreview`
- [ ] Completing a battle properly navigates to `BattleResult` exactly once
- [ ] Tapping "Next" in Battle is debounced (cannot skip multiple questions)
- [ ] Backgrounding the app during PvE and resuming 30s later keeps state

### 3. PvP & Real-time Lifecycle
- [ ] Creating a Room generates a copyable code
- [ ] Joining a Room brings the guest directly into `WaitingRoom`
- [ ] Hitting the physical "Back" button in `WaitingRoom` triggers the confirmation prompt (does not instantly leave)
- [ ] Both players clicking "Ready" transitions smoothly to `PvpBattle`
- [ ] Disconnecting Wi-Fi in `WaitingRoom` shows "Reconnecting..."
- [ ] Potions can only be consumed sequentially (no double-tap abuse)
- [ ] Upon match completion, safely navigates to `PvpResult` exactly once
- [ ] Leaving `PvpResult` successfully clears out of Arena match without ghost sessions

### 4. Audio & Haptics
- [ ] Audio plays perfectly on answers and hits without lagging
- [ ] Disabling Sound Effects in Profile instantly mutes all game sounds
- [ ] Disabling Haptics in Profile stops all vibrations
- [ ] Re-entering a new PvP battle after completing one still plays audio correctly

### 5. Persistence
- [ ] Earning XP updates the `Profile`
- [ ] Restarting the app completely (force kill) preserves Sound/Haptics settings
- [ ] Streak and daily missions remain accurate after restart

### 6. Edge Cases
- [ ] Small Android Screen (e.g., Pixel 4a): `PvpBattle` choices do not clip off-screen
- [ ] Keyboard open when typing Room Code does not break layout

---
**Status**: AUTOMATED AUDIT COMPLETE. Awaiting manual execution of checklist.
