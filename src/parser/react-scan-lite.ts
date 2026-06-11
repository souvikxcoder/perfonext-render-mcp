import { randomUUID } from 'node:crypto';

import type { ReactScanCommitEvent, ReactScanFiberEvent } from '../ingest/server.js';
import type {
  ComponentStats,
  FiberNode,
  ParsedRenderProfile,
  RenderCommit,
  RenderMeasurement,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildMeasurements(
  fibers: ReactScanFiberEvent[],
  rootId: number,
  commitIndex: number,
  commitTime: number,
): RenderMeasurement[] {
  return fibers.map(fiber => ({
    fiberId: fiber.fiberId,
    rootId,
    componentName: fiber.name?.trim() || `(fiber:${fiber.fiberId})`,
    phase: fiber.changeDescription?.isFirstMount === true ? 'mount' : 'update',
    actualDuration: fiber.actualDuration ?? 0,
    selfDuration: fiber.selfDuration ?? 0,
    startTime: commitTime,
    commitTime,
    renderCount: 1,
    commitIndex,
    isNestedUpdate: false,
  }));
}

function buildFiberNodes(fibers: ReactScanFiberEvent[], rootId: number): FiberNode[] {
  // Wire format has no explicit parent IDs; parentFiberId and childFiberIds are always null/empty.
  return fibers.map(fiber => ({
    fiberId: fiber.fiberId,
    rootId,
    componentName: fiber.name?.trim() || `(fiber:${fiber.fiberId})`,
    parentFiberId: null,
    childFiberIds: [],
  }));
}

function buildComponentStats(commits: RenderCommit[]): ComponentStats[] {
  const statsMap = new Map<string, ComponentStats>();

  for (const commit of commits) {
    for (const m of commit.measurements) {
      let stats = statsMap.get(m.componentName);
      if (!stats) {
        stats = {
          componentName: m.componentName,
          renderCount: 0,
          mountCount: 0,
          updateCount: 0,
          nestedUpdateCount: 0,
          totalActualDuration: 0,
          totalSelfDuration: 0,
          maxActualDuration: 0,
          commitIndices: [],
        };
        statsMap.set(m.componentName, stats);
      }

      stats.renderCount++;
      if (m.phase === 'mount') {
        stats.mountCount++;
      } else {
        stats.updateCount++;
      }
      if (m.isNestedUpdate) stats.nestedUpdateCount++;
      stats.totalActualDuration += m.actualDuration;
      stats.totalSelfDuration += m.selfDuration;
      if (m.actualDuration > stats.maxActualDuration) {
        stats.maxActualDuration = m.actualDuration;
      }
      if (!stats.commitIndices.includes(m.commitIndex)) {
        stats.commitIndices.push(m.commitIndex);
      }
    }
  }

  return Array.from(statsMap.values());
}

// ---------------------------------------------------------------------------
// Public adapter
// ---------------------------------------------------------------------------

/**
 * Convert an array of raw react-scan/lite commit events into the internal
 * ParsedRenderProfile model used by all analysis tools.
 */
export function adaptReactScanEvents(
  rawCommits: ReactScanCommitEvent[],
  sessionId: string,
): ParsedRenderProfile {
  const commits: RenderCommit[] = rawCommits.map((raw, idx) => ({
    index: idx,
    rootId: raw.rootId ?? 1,
    duration: raw.duration ?? 0,
    timestamp: raw.timestamp ?? 0,
    priorityLevel: raw.priorityName ?? null,
    measurements: buildMeasurements(
      raw.fibers ?? [],
      raw.rootId ?? 1,
      idx,
      raw.timestamp ?? 0,
    ),
    updaterComponentNames: raw.updaterNames ?? [],
  }));

  // Deduplicate fibers across commits by fiberId (use first occurrence).
  const seenFiberIds = new Set<number>();
  const fiberNodes: FiberNode[] = [];
  for (const raw of rawCommits) {
    const rootId = raw.rootId ?? 1;
    for (const fe of raw.fibers ?? []) {
      if (!seenFiberIds.has(fe.fiberId)) {
        seenFiberIds.add(fe.fiberId);
        fiberNodes.push(...buildFiberNodes([fe], rootId));
      }
    }
  }

  const components = buildComponentStats(commits);
  const totalCommitDuration = commits.reduce((sum, c) => sum + c.duration, 0);
  const totalRenderDuration = commits.reduce(
    (sum, c) => sum + c.measurements.reduce((ms, m) => ms + m.actualDuration, 0),
    0,
  );

  return {
    id: randomUUID(),
    filename: `react-scan-session:${sessionId}`,
    version: '5',
    rendererId: null,
    commits,
    fiberNodes,
    components,
    totalCommitDuration,
    totalRenderDuration,
  };
}
