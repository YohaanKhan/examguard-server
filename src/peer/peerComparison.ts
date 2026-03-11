import { diffLines } from 'diff';
import { sessionStore } from '../sessions/sessionStore';

/** Pairs that exceed this similarity percentage get flagged */
const PEER_SIMILARITY_THRESHOLD = 70;

/** Stores flagged pairs — keyed by `studentA_studentB` */
export const peerComparisons: Record<string, { similarity: number; flagged: boolean }> = {};

/**
 * Runs a line-level similarity check between every pair of students using their
 * final (most recent) snapshots for each file. Flags pairs that exceed PEER_SIMILARITY_THRESHOLD.
 *
 * Called by `POST /api/sessions/:id/end`. Results stored in `peerComparisons`.
 */
export async function runPeerComparison(): Promise<void> {
    const sessions = sessionStore.getAllSessions();

    // Only compare students who have at least one snapshot
    const withSnapshots = sessions.filter(s => s.snapshots.length > 0);

    console.log(`[PeerComparison] Comparing ${withSnapshots.length} students...`);

    // Reset results
    for (const key in peerComparisons) delete peerComparisons[key];

    for (let i = 0; i < withSnapshots.length; i++) {
        for (let j = i + 1; j < withSnapshots.length; j++) {
            const studentA = withSnapshots[i];
            const studentB = withSnapshots[j];

            // Map filename -> content for both students (taking the last snapshot for each file)
            const mapA = new Map<string, string>();
            studentA.snapshots.forEach(s => mapA.set(s.file, s.content));

            const mapB = new Map<string, string>();
            studentB.snapshots.forEach(s => mapB.set(s.file, s.content));

            let maxSimilarity = 0;
            let matchedFiles: string[] = [];

            // Compare all files that both students have worked on
            for (const [file, contentA] of mapA.entries()) {
                const contentB = mapB.get(file);
                if (contentB !== undefined) {
                    const changes = diffLines(contentA, contentB);
                    const totalLines = changes.reduce((sum, part) => sum + (part.count ?? 0), 0);
                    const unchangedLines = changes
                        .filter(part => !part.added && !part.removed)
                        .reduce((sum, part) => sum + (part.count ?? 0), 0);

                    const similarity = totalLines > 0 ? (unchangedLines / totalLines) * 100 : 0;
                    if (similarity > maxSimilarity) {
                        maxSimilarity = similarity;
                    }
                    matchedFiles.push(file);
                }
            }

            const key = `${studentA.studentId}_${studentB.studentId}`;
            const flagged = maxSimilarity >= PEER_SIMILARITY_THRESHOLD;

            if (matchedFiles.length > 0) {
                peerComparisons[key] = { similarity: Math.round(maxSimilarity), flagged };
                if (flagged) {
                    console.warn(`[PeerComparison] ⚠ Flagged: ${studentA.studentId} ↔ ${studentB.studentId} — ${maxSimilarity.toFixed(1)}% similar in shared files: [${matchedFiles.map(f => f.split('/').pop()).join(', ')}]`);
                }
            }
        }
    }

    console.log(`[PeerComparison] Done. ${Object.keys(peerComparisons).length} pairs compared.`);
}
