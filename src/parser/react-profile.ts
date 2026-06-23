import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import type {
  ComponentStats,
  FiberNode,
  ParsedRenderProfile,
  RenderCommit,
  RenderMeasurement,
} from './types.js';

// ---------------------------------------------------------------------------
// Raw types matching the React DevTools Profiler export format (version 5).
// See: packages/react-devtools-shared/src/devtools/views/Profiler/types.js
// ---------------------------------------------------------------------------

interface SnapshotNodeRaw {
  id?: unknown;
  children?: unknown;
  displayName?: unknown;
  hocDisplayNames?: unknown;
  key?: unknown;
  type?: unknown;
  compiledWithForget?: unknown;
}

interface CommitDataRaw {
  changeDescriptions?: unknown;
  duration?: unknown;
  effectDuration?: unknown;
  fiberActualDurations?: unknown;
  fiberSelfDurations?: unknown;
  passiveEffectDuration?: unknown;
  priorityLevel?: unknown;
  timestamp?: unknown;
  updaters?: unknown;
}

interface RootExportRaw {
  commitData?: unknown;
  displayName?: unknown;
  initialTreeBaseDurations?: unknown;
  operations?: unknown;
  rootID?: unknown;
  snapshots?: unknown;
}

interface ReactDevToolsExport {
  version?: unknown;
  dataForRoots?: unknown;
  timelineData?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Build a fiberID -> displayName map from the snapshots array.
 * snapshots is serialised as Array<[fiberID, SnapshotNode]> in the export.
 */
function buildSnapshotMap(snapshots: unknown): Map<number, string> {
  const map = new Map<number, string>();
  if (!Array.isArray(snapshots)) return map;

  for (const entry of snapshots) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [fiberID, node] = entry;
    if (typeof fiberID !== 'number') continue;
    const raw = node as SnapshotNodeRaw;
    const name =
      typeof raw?.displayName === 'string' && raw.displayName.trim().length > 0
        ? raw.displayName
        : `(fiber:${fiberID})`;
    map.set(fiberID, name);
  }

  return map;
}

function buildFiberNodes(snapshots: unknown, rootId: number): FiberNode[] {
  if (!Array.isArray(snapshots)) {
    return [];
  }

  const nodeMap = new Map<number, SnapshotNodeRaw>();
  const parentMap = new Map<number, number | null>();

  for (const entry of snapshots) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }

    const [fiberId, node] = entry;
    if (typeof fiberId !== 'number' || node === null || typeof node !== 'object') {
      continue;
    }

    nodeMap.set(fiberId, node as SnapshotNodeRaw);
    if (!parentMap.has(fiberId)) {
      parentMap.set(fiberId, null);
    }
  }

  for (const [fiberId, node] of nodeMap) {
    const children = Array.isArray(node.children) ? node.children : [];
    for (const childId of children) {
      if (typeof childId === 'number' && nodeMap.has(childId)) {
        parentMap.set(childId, fiberId);
      }
    }
  }

  return Array.from(nodeMap.entries()).map(([fiberId, node]) => ({
    fiberId,
    rootId,
    componentName:
      typeof node.displayName === 'string' && node.displayName.trim().length > 0
        ? node.displayName
        : `(fiber:${fiberId})`,
    parentFiberId: parentMap.get(fiberId) ?? null,
    childFiberIds: Array.isArray(node.children)
      ? node.children.filter((childId): childId is number => typeof childId === 'number' && nodeMap.has(childId))
      : [],
  }));
}

/**
 * Build a Set of fiberIDs that existed before profiling started.
 * initialTreeBaseDurations is serialised as Array<[fiberID, duration]>.
 */
function buildInitialFiberIDSet(initialTreeBaseDurations: unknown): Set<number> {
  const set = new Set<number>();
  if (!Array.isArray(initialTreeBaseDurations)) return set;

  for (const entry of initialTreeBaseDurations) {
    if (Array.isArray(entry) && typeof entry[0] === 'number') {
      set.add(entry[0]);
    }
  }

  return set;
}

/**
 * Parse a single commit from the React DevTools v5 export.
 * fiberActualDurations and fiberSelfDurations are Array<[fiberID, duration]> tuples.
 */
function parseCommit(
  raw: CommitDataRaw,
  index: number,
  rootId: number,
  snapshotMap: Map<number, string>,
  initialFiberIDs: Set<number>,
  seenFiberIDs: Set<number>,
): RenderCommit {
  const fiberActualDurations = Array.isArray(raw.fiberActualDurations)
    ? (raw.fiberActualDurations as unknown[])
    : [];

  // Build a quick self-duration lookup for this commit
  const selfDurationMap = new Map<number, number>();
  if (Array.isArray(raw.fiberSelfDurations)) {
    for (const entry of raw.fiberSelfDurations as unknown[]) {
      if (
        Array.isArray(entry) &&
        typeof entry[0] === 'number' &&
        typeof entry[1] === 'number'
      ) {
        selfDurationMap.set(entry[0], entry[1]);
      }
    }
  }

  // Build the set of fiber IDs that triggered this commit (React DevTools "updaters" field).
  // updaters are the components that called setState / dispatched / caused this commit.
  const updaterFiberIDs = new Set<number>();
  if (Array.isArray(raw.updaters)) {
    for (const updater of raw.updaters as unknown[]) {
      if (updater !== null && typeof updater === 'object') {
        const u = updater as Record<string, unknown>;
        if (typeof u['id'] === 'number') {
          updaterFiberIDs.add(u['id']);
        }
      }
    }
  }

  const seenUpdaterNames = new Set<string>();
  const updaterComponentNames: string[] = [];
  for (const fiberID of updaterFiberIDs) {
    const name = snapshotMap.get(fiberID) ?? `(fiber:${fiberID})`;
    if (!seenUpdaterNames.has(name)) {
      seenUpdaterNames.add(name);
      updaterComponentNames.push(name);
    }
  }

  const measurements: RenderMeasurement[] = [];

  for (const entry of fiberActualDurations) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [fiberID, actualDuration] = entry;
    if (typeof fiberID !== 'number' || typeof actualDuration !== 'number') continue;

    const componentName = snapshotMap.get(fiberID) ?? `(fiber:${fiberID})`;
    const selfDuration = selfDurationMap.get(fiberID) ?? actualDuration;

    // A fiber is mounting if it was not present when profiling started AND
    // this is the first commit we have seen it in.
    const isMount = !initialFiberIDs.has(fiberID) && !seenFiberIDs.has(fiberID);
    seenFiberIDs.add(fiberID);

    measurements.push({
      fiberId: fiberID,
      rootId,
      componentName,
      phase: isMount ? 'mount' : 'update',
      actualDuration,
      selfDuration,
      startTime: asNumber(raw.timestamp),
      commitTime: asNumber(raw.timestamp),
      renderCount: 1,
      commitIndex: index,
      isNestedUpdate: !isMount && updaterFiberIDs.has(fiberID),
    } satisfies RenderMeasurement);
  }

  return {
    index,
    rootId,
    duration: asNumber(raw.duration),
    timestamp: asNumber(raw.timestamp),
    priorityLevel: typeof raw.priorityLevel === 'string' ? raw.priorityLevel : null,
    measurements,
    updaterComponentNames,
  } satisfies RenderCommit;
}

function buildComponentStats(commits: RenderCommit[]): ComponentStats[] {
  const stats = new Map<string, ComponentStats>();
  const commitIndexSets = new Map<string, Set<number>>();

  for (const commit of commits) {
    for (const measurement of commit.measurements) {
      const name = measurement.componentName;

      if (!stats.has(name)) {
        stats.set(name, {
          componentName: name,
          renderCount: 0,
          mountCount: 0,
          updateCount: 0,
          nestedUpdateCount: 0,
          totalActualDuration: 0,
          totalSelfDuration: 0,
          maxActualDuration: 0,
          commitIndices: [],
        });
        commitIndexSets.set(name, new Set<number>());
      }

      const existing = stats.get(name)!;
      existing.renderCount += 1;
      existing.totalActualDuration += measurement.actualDuration;
      existing.totalSelfDuration += measurement.selfDuration;
      existing.maxActualDuration = Math.max(existing.maxActualDuration, measurement.actualDuration);
      commitIndexSets.get(name)!.add(commit.index);

      if (measurement.phase === 'mount') {
        existing.mountCount += 1;
      } else {
        existing.updateCount += 1;
        if (measurement.isNestedUpdate) {
          existing.nestedUpdateCount += 1;
        }
      }
    }
  }

  for (const [name, indexSet] of commitIndexSets) {
    stats.get(name)!.commitIndices = Array.from(indexSet).sort((a, b) => a - b);
  }

  return Array.from(stats.values()).sort((a, b) => b.totalActualDuration - a.totalActualDuration);
}

export function parseRenderProfile(content: string, filename: string): ParsedRenderProfile {
  let parsed: ReactDevToolsExport;

  try {
    parsed = JSON.parse(content) as ReactDevToolsExport;
  } catch {
    throw new Error('Invalid render profile JSON');
  }

  // React DevTools has exported version 5 since early 2020 (PROFILER_EXPORT_VERSION = 5).
  if (parsed.version !== 5) {
    throw new Error(
      `Invalid render profile format: unsupported version "${String(parsed.version)}". ` +
        'Expected a React DevTools Profiler export (version 5). ' +
        'Open React DevTools -> Profiler tab -> record -> click the save icon.',
    );
  }

  if (!Array.isArray(parsed.dataForRoots) || parsed.dataForRoots.length === 0) {
    throw new Error(
      'Invalid render profile format: no root data found. ' +
        'Ensure you exported from the React DevTools Profiler tab, not the browser Performance tab.',
    );
  }

  const allCommits: RenderCommit[] = [];
  const allFiberNodes: FiberNode[] = [];

  for (const rawRoot of parsed.dataForRoots) {
    const root = rawRoot as RootExportRaw;
    const rootId = typeof root.rootID === 'number' ? root.rootID : 0;

    // fiberID -> displayName, built from the serialised snapshots map
    const snapshotMap = buildSnapshotMap(root.snapshots);
    allFiberNodes.push(...buildFiberNodes(root.snapshots, rootId));

    // Fibers present before profiling started (used for mount vs update detection)
    const initialFiberIDs = buildInitialFiberIDSet(root.initialTreeBaseDurations);
    const seenFiberIDs = new Set<number>();

    const commitDataArray = Array.isArray(root.commitData)
      ? (root.commitData as CommitDataRaw[])
      : [];

    const startIndex = allCommits.length;
    for (let i = 0; i < commitDataArray.length; i++) {
      allCommits.push(
        parseCommit(commitDataArray[i], startIndex + i, rootId, snapshotMap, initialFiberIDs, seenFiberIDs),
      );
    }
  }

  if (allCommits.length === 0) {
    throw new Error(
      'No profiling commits found. The profiler may have been started but no renders occurred.',
    );
  }

  const components = buildComponentStats(allCommits);

  return {
    id: randomUUID(),
    filename: basename(filename),
    version: '5',
    rendererId: null,
    commits: allCommits,
    fiberNodes: allFiberNodes,
    components,
    totalCommitDuration: allCommits.reduce((sum, c) => sum + c.duration, 0),
    totalRenderDuration: components.reduce((sum, c) => sum + c.totalActualDuration, 0),
    hasChangeDescriptions: false,
  };
}
