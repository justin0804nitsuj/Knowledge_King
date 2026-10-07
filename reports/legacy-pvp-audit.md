# Legacy PvP Database Audit

As preparation for Phase 8, the legacy Firebase room implementation (`legacy-web/index.html`) was audited. The following insecure or obsolete assumptions were identified and must NOT be carried forward into the new Phase 8 room architecture:

## 1. Permissive Rules and Security
- **Legacy Issue**: The legacy implementation likely used permissive (`.read: true`, `.write: true`) rules or allowed any client to overwrite any part of a room object.
- **Phase 8 Action**: Rooms must be strictly namespaced under `rooms/{roomId}`. Only authenticated users can write, and only to specific fields (e.g., their own player node, or the host setting the initial status).

## 2. Client Authority over Game State
- **Legacy Issue**: Clients were trusted to calculate results and dictate game state (e.g., clients directly writing opponent scores or setting arbitrary room status such as "started" or "finished").
- **Phase 8 Action**: 
  - Room metadata (status, host, seed) should be restricted after initialization.
  - Clients must ONLY be allowed to update their own `{uid}` node within `rooms/{roomId}/players/`. They cannot write to another player's node.

## 3. Lack of Validation
- **Legacy Issue**: No validation on score values, answer timestamps, or room configurations.
- **Phase 8 Action**:
  - Enforce server-side rule validation on max possible scores, valid statuses (`WAITING`, `PLAYING`, `FINISHED`), and timestamp formats.
  - Incorporate PvP Compatibility checks (ruleset version, vocabulary schema) into the room payload to prevent incompatible deterministic data desyncs.
