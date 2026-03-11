import { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single telemetry event received from the VS Code extension.
 * The index signature accommodates any extra fields (file, content, charDelta, etc.)
 * without needing to enumerate every possible event shape upfront.
 */
export type TelemetryEvent = {
    type: string;
    timeStamp: number;
    [key: string]: unknown;
};

/**
 * A full-file snapshot captured by the extension every 60 seconds.
 */
export type Snapshot = {
    type: 'SNAPSHOT';
    timeStamp: number;
    file: string;
    content: string;
};

/**
 * Full state for one student's exam session.
 */
export type Session = {
    studentId: string;
    examCode: string;
    joinedAt: number;
    events: TelemetryEvent[];
    snapshots: Snapshot[];
    suspicionScore: number;
    /** Timestamp when the student last disconnected. null if active. */
    disconnectedAt: number | null;
    /** Whether a teacher has explicitly allowed this student to bypass the 2-minute reconnect limit */
    allowLateRejoin?: boolean;
    /** Live WebSocket to the student's extension — null if disconnected */
    ws: WebSocket | null;
};

// ---------------------------------------------------------------------------
// Suspicion score weights (mirrors implementation.md constants)
// ---------------------------------------------------------------------------
const SUSPICION_PASTE_WEIGHT = 40;
const SUSPICION_FOCUS_WEIGHT = 20;
const SUSPICION_FULLSCREEN_EXIT_WEIGHT = 10;
const SUSPICION_FULLSCREEN_BLOCK_WEIGHT = 25;
const SUSPICION_MACRO_WEIGHT = 15;
const MAX_SUSPICION_SCORE = 100;

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

class SessionStore {

    /** studentId → Session */
    private sessions: Map<string, Session> = new Map();

    /**
     * Set of active teacher dashboard WebSocket clients.
     * Every time a suspicion score changes, the new sessions list is broadcast to all of them.
     */
    private dashboardClients: Set<WebSocket> = new Set();

    // -----------------------------------------------------------------------
    // Session lifecycle
    // -----------------------------------------------------------------------

    /**
     * Creates or resumes a session for a student.
     *
     * @param studentId - Unique student identifier e.g. 's12345678'
     * @param examCode  - Exam code the student authenticated with
     * @param ws        - The live WebSocket to the student's extension
     * @returns Object indicating success, and a reason string if blocked
     */
    createSession(studentId: string, examCode: string, ws: WebSocket): { success: boolean; reason?: string } {
        const existing = this.sessions.get(studentId);

        if (existing) {
            if (existing.ws) {
                console.warn(`[SessionStore] Blocked duplicate connection for ${studentId}`);
                return { success: false, reason: 'Session already active on another machine or window' };
            } else {
                // Check if they exceeded the 2 minute grace period
                if (existing.disconnectedAt && !existing.allowLateRejoin) {
                    const timeOffline = Date.now() - existing.disconnectedAt;
                    if (timeOffline > 2 * 60 * 1000) { // 2 minutes
                        console.warn(`[SessionStore] Blocked late reconnect for ${studentId} (offline for ${Math.round(timeOffline / 1000)}s)`);
                        return { success: false, reason: 'Reconnection window expired. You were disconnected for more than 2 minutes. Ask your teacher to allow rejoin.' };
                    }
                }

                // Reattach genuine reconnect
                if (existing.disconnectedAt && !existing.allowLateRejoin) {
                    const timeOffline = Date.now() - existing.disconnectedAt;
                    // For every 10 seconds offline, add 5 suspicion points (max 60 for the 120s limit)
                    const penaltyPoints = Math.floor(timeOffline / 10000) * 5;
                    if (penaltyPoints > 0) {
                        existing.events.push({
                            type: 'DISCONNECT_PENALTY',
                            timeStamp: Date.now(),
                            penalty: penaltyPoints
                        });
                        console.log(`[SessionStore] Applied +${penaltyPoints} penalty to ${studentId} for being offline ${Math.round(timeOffline / 1000)}s`);
                    }
                }

                existing.ws = ws;
                existing.disconnectedAt = null;
                existing.allowLateRejoin = false; // Reset the flag once they successfully join
                this.recalculateScore(existing); // Apply the disconnect penalty immediately
                console.log(`[SessionStore] Session resumed — ${studentId} (${examCode})`);
                return { success: true };
            }
        }

        const session: Session = {
            studentId,
            examCode,
            joinedAt: Date.now(),
            disconnectedAt: null,
            events: [],
            snapshots: [],
            suspicionScore: 0,
            ws
        };
        this.sessions.set(studentId, session);
        console.log(`[SessionStore] Session created — ${studentId} (${examCode})`);
        return { success: true };
    }

    /**
     * Completely deletes a session and clears all its history.
     * Used by teachers to explicitly override a stuck or genuinely crashed session.
     */
    deleteSession(studentId: string): void {
        const session = this.sessions.get(studentId);
        if (session && session.ws) {
            session.ws.close(1008, 'Session reset by teacher');
        }
        this.sessions.delete(studentId);
        console.log(`[SessionStore] Session completely deleted — ${studentId}`);
        this.broadcastUpdate();
    }

    /**
     * Explicitly permits a disconnected student to reconnect regardless of how long they've been offline.
     */
    allowRejoin(studentId: string): boolean {
        const session = this.sessions.get(studentId);
        if (session && !session.ws) {
            session.allowLateRejoin = true;
            console.log(`[SessionStore] Teacher explicitly allowed late rejoin for ${studentId}`);
            this.broadcastUpdate();
            return true;
        }
        return false;
    }

    /**
     * Removes all student sessions associated with a specific exam code from server memory.
     * Used when an exam is deleted or wiped by a teacher.
     */
    clearExamSessions(examCode: string): void {
        const toDeleteIds: string[] = [];
        for (const [studentId, session] of this.sessions.entries()) {
            if (session.examCode === examCode) {
                if (session.ws) {
                    session.ws.close(1008, 'Exam cleared by teacher');
                }
                toDeleteIds.push(studentId);
            }
        }
        toDeleteIds.forEach(id => this.sessions.delete(id));
        console.log(`[SessionStore] Purged ${toDeleteIds.length} sessions for exam ${examCode}`);
        this.broadcastUpdate();
    }

    /**
     * Marks a student's session as disconnected by nulling the `ws` reference
     * and recording the disconnection time.
     *
     * @param studentId - The student who disconnected
     */
    markDisconnected(studentId: string): void {
        const session = this.sessions.get(studentId);
        if (session) {
            session.ws = null;
            session.disconnectedAt = Date.now();
            console.log(`[SessionStore] ${studentId} disconnected — session data preserved (grace period started)`);
        }
    }

    // -----------------------------------------------------------------------
    // Event + snapshot ingestion
    // -----------------------------------------------------------------------

    /**
     * Appends a telemetry event to the session and recalculates the suspicion score
     * if the event type affects it (PASTE, FOCUS_LOST).
     *
     * @param studentId - The student to append the event to
     * @param event     - The telemetry event received from the extension
     */
    addEvent(studentId: string, event: TelemetryEvent): void {
        const session = this.sessions.get(studentId);
        if (!session) {
            console.warn(`[SessionStore] No session for ${studentId} — event dropped`);
            return;
        }

        session.events.push(event);

        // Recalculate and broadcast when a score-affecting event arrives
        if (
            event.type === 'PASTE' ||
            event.type === 'FOCUS_LOST' ||
            event.type === 'FULLSCREEN_EXIT' ||
            event.type === 'FULLSCREEN_BLOCKED' ||
            event.type === 'SUSPICIOUS_CADENCE' ||
            event.type === 'EXAM_SUBMITTED'
        ) {
            this.recalculateScore(session);
            this.broadcastUpdate();
        }
    }

    /**
     * Appends a code snapshot to the session.
     *
     * @param studentId - The student whose snapshot this is
     * @param snapshot  - The full-file snapshot object
     */
    addSnapshot(studentId: string, snapshot: Snapshot): void {
        const session = this.sessions.get(studentId);
        if (!session) {
            console.warn(`[SessionStore] No session for ${studentId} — snapshot dropped`);
            return;
        }
        session.snapshots.push(snapshot);
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    /**
     * Retrieves a single student's session.
     *
     * @param studentId - The student ID to look up
     * @returns The session, or undefined if not found
     */
    getSession(studentId: string): Session | undefined {
        return this.sessions.get(studentId);
    }

    /**
     * Returns all sessions as an array (WebSocket refs stripped for JSON safety).
     * Used by `GET /api/sessions` to feed the teacher dashboard.
     */
    getAllSessions(): Omit<Session, 'ws'>[] {
        return Array.from(this.sessions.values()).map(({ ws: _ws, ...rest }) => rest);
    }

    // -----------------------------------------------------------------------
    // Dashboard broadcast
    // -----------------------------------------------------------------------

    /**
     * Registers a teacher dashboard WebSocket client so it receives live score updates.
     *
     * @param ws - The dashboard's WebSocket connection
     */
    addDashboardClient(ws: WebSocket): void {
        this.dashboardClients.add(ws);
        console.log(`[SessionStore] Dashboard client connected (total: ${this.dashboardClients.size})`);
    }

    /**
     * Removes a dashboard client when it disconnects.
     *
     * @param ws - The WebSocket to remove
     */
    removeDashboardClient(ws: WebSocket): void {
        this.dashboardClients.delete(ws);
        console.log(`[SessionStore] Dashboard client disconnected (total: ${this.dashboardClients.size})`);
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /**
     * Recalculates the suspicion score for a session based on paste + focus loss counts.
     *
     * Formula (from implementation.md):
     *   score = (pasteCount × 40) + (focusLossCount × 20), clamped to [0, 100]
     */
    private recalculateScore(session: Session): void {
        const pasteCount = session.events.filter(e => e.type === 'PASTE').length;
        const focusLossCount = session.events.filter(e => e.type === 'FOCUS_LOST').length;
        const fullscreenExits = session.events.filter(e => e.type === 'FULLSCREEN_EXIT').length;
        const fullscreenBlocked = session.events.filter(e => e.type === 'FULLSCREEN_BLOCKED').length;
        const macroCount = session.events.filter(e => e.type === 'SUSPICIOUS_CADENCE').length;
        const disconnectPenalty = session.events.filter(e => e.type === 'DISCONNECT_PENALTY').reduce((sum, e) => sum + ((e.penalty as number) || 0), 0);

        const raw =
            (pasteCount * SUSPICION_PASTE_WEIGHT) +
            (focusLossCount * SUSPICION_FOCUS_WEIGHT) +
            (fullscreenExits * SUSPICION_FULLSCREEN_EXIT_WEIGHT) +
            (fullscreenBlocked * SUSPICION_FULLSCREEN_BLOCK_WEIGHT) +
            (macroCount * SUSPICION_MACRO_WEIGHT) +
            disconnectPenalty;

        session.suspicionScore = Math.min(raw, MAX_SUSPICION_SCORE);

        console.log(`[SessionStore] ${session.studentId} suspicion score: ${session.suspicionScore}`);
    }

    /**
     * Pushes the current sessions list to every connected dashboard client.
     * Called automatically after each score recalculation.
     */
    private broadcastUpdate(): void {
        const payload = JSON.stringify({
            type: 'SESSIONS_UPDATE',
            sessions: this.getAllSessions()
        });

        for (const client of this.dashboardClients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }
}

/**
 * Singleton instance shared across the entire backend.
 *
 * @example
 * import { sessionStore } from './sessions/sessionStore';
 * sessionStore.createSession('s123', 'EXAM2024', ws);
 * sessionStore.addEvent('s123', { type: 'PASTE', timeStamp: Date.now() });
 */
export const sessionStore = new SessionStore();