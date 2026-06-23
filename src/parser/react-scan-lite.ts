import { randomUUID } from 'node:crypto';

import type { ReactScanCommitEvent, ReactScanFiberEvent } from '../ingest/server.js';
import type {
  ChangeCauses,
  ComponentSource,
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

  // Single pass over raw fibers to collect source, changeCauses, and hasChangeDescriptions.
  const sourceMap = new Map<string, ComponentSource>();
  const changeCausesMap = new Map<string, {
    props: Set<string>;
    stateChanged: boolean;
    contextChanged: boolean;
    hooks: Set<string>;
    parentTriggered: boolean;
  }>();
  let hasChangeDescriptions = false;

  for (const raw of rawCommits) {
    for (const fiber of raw.fibers ?? []) {
      const name = fiber.name?.trim() || `(fiber:${fiber.fiberId})`;

      if (fiber.source && !sourceMap.has(name)) {
        sourceMap.set(name, {
          fileName: fiber.source.fileName,
          lineNumber: fiber.source.lineNumber,
          columnNumber: fiber.source.columnNumber,
        });
      }

      const cd = fiber.changeDescription;
      if (cd == null || cd.isFirstMount) continue;

      // Count as "exact" only when at least one diff field carries real data.
      const hasRealDiff =
        (cd.props?.length ?? 0) > 0 ||
        cd.state !== null ||
        cd.context !== null ||
        (cd.hooks?.length ?? 0) > 0;

      if (hasRealDiff) hasChangeDescriptions = true;

      // Aggregate per-component causes (even parent-only renders are tracked).
      let causes = changeCausesMap.get(name);
      if (!causes) {
        causes = { props: new Set(), stateChanged: false, contextChanged: false, hooks: new Set(), parentTriggered: false };
        changeCausesMap.set(name, causes);
      }
      for (const p of cd.props ?? []) causes.props.add(p);
      if (cd.state !== null) causes.stateChanged = true;
      if (cd.context !== null) causes.contextChanged = true;
      for (const h of cd.hooks ?? []) causes.hooks.add(h);
      if (cd.parent === true) causes.parentTriggered = true;
    }
  }

  for (const component of components) {
    const src = sourceMap.get(component.componentName);
    if (src) component.source = src;

    const raw = changeCausesMap.get(component.componentName);
    if (raw && (raw.props.size > 0 || raw.stateChanged || raw.contextChanged || raw.hooks.size > 0 || raw.parentTriggered)) {
      const changeCauses: ChangeCauses = {
        props: Array.from(raw.props),
        stateChanged: raw.stateChanged,
        contextChanged: raw.contextChanged,
        hooks: Array.from(raw.hooks),
        parentTriggered: raw.parentTriggered,
      };
      component.changeCauses = changeCauses;
    }
  }
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
    hasChangeDescriptions,
  };
}
