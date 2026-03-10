import { diffLines } from 'diff';
import { sessionStore } from '../sessions/sessionStore';

/** Pairs that exceed this similarity percentage get flagged */
const PEER_SIMILARITY_THRESHOLD = 70;

/** Stores flagged pairs — keyed by `studentA_studentB` */
export const peerComparisons: Record<string, { similarity: number; flagged: boolean }> = {};

/**
 * Runs a line-level similarity check between every pair of students using their
 * final (most recent) snapshot. Flags pairs that exceed PEER_SIMILARITY_THRESHOLD.
 *
 * Called by `POST /api/sessions/:id/end`. Results stored in `peerComparisons`.
 */
export async function runPeerComparison(): Promise<void> {
    const sessions = sessionStore.getAllSessions();

    // Only compare students who have at least one snapshot
    const withSnapshots = sessions.filter(s => s.snapshots.length > 0);

    console.log(`[PeerComparison] Comparing ${withSnapshots.length} students...`);

    for (let i = 0; i < withSnapshots.length; i++) {
        for (let j = i + 1; j < withSnapshots.length; j++) {
            const a = withSnapshots[i];
            const b = withSnapshots[j];

            // Use the last snapshot as the "final submission"
            const contentA = a.snapshots[a.snapshots.length - 1].content;
            const contentB = b.snapshots[b.snapshots.length - 1].content;

            const changes = diffLines(contentA, contentB);
            const totalLines = changes.reduce((sum, part) => sum + (part.count ?? 0), 0);
            const unchangedLines = changes
                .filter(part => !part.added && !part.removed)
                .reduce((sum, part) => sum + (part.count ?? 0), 0);

            const similarity = totalLines > 0 ? (unchangedLines / totalLines) * 100 : 0;
            const flagged = similarity >= PEER_SIMILARITY_THRESHOLD;
            const key = `${a.studentId}_${b.studentId}`;

            peerComparisons[key] = { similarity: Math.round(similarity), flagged };

            if (flagged) {
                console.warn(`[PeerComparison] ⚠ Flagged: ${a.studentId} ↔ ${b.studentId} — ${similarity.toFixed(1)}% similar`);
            }
        }
    }

    console.log(`[PeerComparison] Done. ${Object.keys(peerComparisons).length} pairs compared.`);
}
