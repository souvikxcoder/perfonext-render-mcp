import type {
  CommitBreakdown,
  CommitBreakdownComponentSummary,
  ComponentSource,
  FiberNode,
  HotCommitComponentSummary,
  HotCommitSummary,
  ParsedRenderProfile,
  RenderCommit,
  RenderComparison,
  RenderDiffEntry,
  RenderIssue,
  RenderIssueSeverity,
  RenderMeasurement,
  RenderPropagationPath,
  RenderSummaryEntry,
  RerenderCause,
  RerenderConfidence,
  RerenderEvidence,
  RerenderScoreBand,
} from './types.js';

function getScoreBand(score: number): RerenderScoreBand {
  if (score >= 6) {
    return 'high';
  }

  if (score >= 3) {
    return 'medium';
  }

  return 'low';
}

/** Returns true for React host (DOM/SVG) elements — first character is lowercase. */
function isHostElement(name: string): boolean {
  const first = name.charCodeAt(0);
  return first >= 97 /* a */ && first <= 122 /* z */;
}

/** Returns true for unnamed/anonymous components that can't be actionably diagnosed. */
function isAnonymousComponent(name: string): boolean {
  return name === 'Anonymous' || name.startsWith('(fiber:');
}

/** Returns true for named React components that appear in ranked analysis output. */
export function isAnalyzableComponent(name: string): boolean {
  return !isHostElement(name) && !isAnonymousComponent(name);
}

function getConfidence(evidenceCount: number): RerenderConfidence {
  if (evidenceCount >= 3) {
    return 'high';
  }

  if (evidenceCount >= 2) {
    return 'medium';
  }

  return 'low';
}

function getSeverityRank(severity: RenderIssueSeverity): number {
  if (severity === 'high') {
    return 3;
  }

  if (severity === 'medium') {
    return 2;
  }

  return 1;
}

function getMeasurementsTotalActualDuration(measurements: RenderMeasurement[]): number {
  return measurements.reduce((sum, measurement) => sum + measurement.actualDuration, 0);
}

function getFiberNodeMap(profile: ParsedRenderProfile, rootId?: number): Map<number, FiberNode> {
  const nodes = rootId == null
    ? profile.fiberNodes
    : profile.fiberNodes.filter(node => node.rootId === rootId);

  return new Map(nodes.map(node => [node.fiberId, node]));
}

function getMeasurementMap(commit: RenderCommit): Map<number, RenderMeasurement> {
  return new Map(commit.measurements.map(measurement => [measurement.fiberId, measurement]));
}

function getCommitTopComponents(commit: RenderCommit, limit: number): HotCommitComponentSummary[] {
  const components = new Map<string, HotCommitComponentSummary>();
  const totalActualDuration = getMeasurementsTotalActualDuration(commit.measurements);

  for (const measurement of commit.measurements) {
    const existing = components.get(measurement.componentName) ?? {
      componentName: measurement.componentName,
      actualDuration: 0,
      selfDuration: 0,
      renderCount: 0,
      shareOfCommitWork: 0,
    };

    existing.actualDuration += measurement.actualDuration;
    existing.selfDuration += measurement.selfDuration;
    existing.renderCount += measurement.renderCount;
    components.set(measurement.componentName, existing);
  }

  return Array.from(components.values())
    .filter(component => !isHostElement(component.componentName) && !isAnonymousComponent(component.componentName))
    .sort((left, right) => right.actualDuration - left.actualDuration)
    .slice(0, limit)
    .map(component => ({
      ...component,
      shareOfCommitWork: totalActualDuration > 0
        ? component.actualDuration / totalActualDuration
        : 0,
    }));
}

function getCommitByIndex(profile: ParsedRenderProfile, commitIndex: number): RenderCommit | undefined {
  return profile.commits.find(commit => commit.index === commitIndex);
}

export function getHotCommits(
  profile: ParsedRenderProfile,
  limit = 10,
  componentLimit = 3,
  priorityLevel?: string,
): HotCommitSummary[] {
  return profile.commits
    .filter(commit => priorityLevel == null || commit.priorityLevel === priorityLevel)
    .map(commit => ({
      commitIndex: commit.index,
      rootId: commit.rootId,
      duration: commit.duration,
      totalActualDuration: getMeasurementsTotalActualDuration(commit.measurements),
      timestamp: commit.timestamp,
      priorityLevel: commit.priorityLevel,
      measurementCount: commit.measurements.length,
      topComponents: getCommitTopComponents(commit, componentLimit),
      updaterComponentNames: commit.updaterComponentNames,
    }))
    .sort((left, right) => {
      if (right.duration !== left.duration) {
        return right.duration - left.duration;
      }

      return right.totalActualDuration - left.totalActualDuration;
    })
    .slice(0, limit);
}

export function getRenderSummary(profile: ParsedRenderProfile, limit = 10): {
  profileId: string;
  filename: string;
  version: string;
  rendererId: number | null;
  commitCount: number;
  componentCount: number;
  totalCommitDuration: number;
  totalRenderDuration: number;
  topComponents: RenderSummaryEntry[];
  hotCommits: HotCommitSummary[];
  issues: RenderIssue[];
  warnings: string[];
  dataQuality: 'heuristic' | 'exact';
} {
  const anonymousNames = profile.components
    .filter(c => isAnonymousComponent(c.componentName))
    .map(c => c.componentName);
  const uniqueAnonymous = [...new Set(anonymousNames)];

  const warnings: string[] = [];
  if (uniqueAnonymous.length > 0) {
    warnings.push(
      `${uniqueAnonymous.length} unnamed component${uniqueAnonymous.length > 1 ? 's' : ''} found (e.g. "Anonymous"). ` +
      `These are excluded from analysis. Add a displayName or convert arrow functions to named function expressions to get actionable results.`,
    );
  }

  return {
    profileId: profile.id,
    filename: profile.filename,
    version: profile.version,
    rendererId: profile.rendererId,
    commitCount: profile.commits.length,
    componentCount: profile.components.filter(c => isAnalyzableComponent(c.componentName)).length,
    totalCommitDuration: profile.totalCommitDuration,
    totalRenderDuration: profile.totalRenderDuration,
    hotCommits: getHotCommits(profile, Math.min(3, profile.commits.length), 3),
    topComponents: getSlowComponents(profile, limit),
    issues: detectRenderIssues(profile, 5),
    warnings,
    dataQuality: profile.hasChangeDescriptions ? 'exact' : 'heuristic',
  };
}

export function getSlowComponents(
  profile: ParsedRenderProfile,
  limit = 10,
  sortBy: 'total' | 'average' | 'max' = 'total',
  minDuration = 0,
): RenderSummaryEntry[] {
  const entries: RenderSummaryEntry[] = profile.components
    .filter(component =>
      !isHostElement(component.componentName) &&
      !isAnonymousComponent(component.componentName) &&
      component.totalActualDuration >= minDuration,
    )
    .map(component => ({
      componentName: component.componentName,
      renderCount: component.renderCount,
      mountCount: component.mountCount,
      updateCount: component.updateCount,
      nestedUpdateCount: component.nestedUpdateCount,
      totalActualDuration: component.totalActualDuration,
      averageActualDuration: component.renderCount > 0
        ? component.totalActualDuration / component.renderCount
        : 0,
      maxActualDuration: component.maxActualDuration,
      commitCount: component.commitIndices.length,
      ...(component.source ? { source: component.source } : {}),
    }));

  if (sortBy === 'average') {
    entries.sort((a, b) => b.averageActualDuration - a.averageActualDuration);
  } else if (sortBy === 'max') {
    entries.sort((a, b) => b.maxActualDuration - a.maxActualDuration);
  } else {
    entries.sort((a, b) => b.totalActualDuration - a.totalActualDuration);
  }

  return entries.slice(0, limit);
}

export function getRerenderCauses(profile: ParsedRenderProfile, limit = 10, minDuration = 0): RerenderCause[] {
  const causes = profile.components
    .filter(component =>
      !isHostElement(component.componentName) &&
      !isAnonymousComponent(component.componentName) &&
      (component.updateCount > 0 || component.nestedUpdateCount > 0) &&
      component.totalActualDuration >= minDuration,
    )
    .map(component => {
      const likelyCauses: string[] = [];
      const evidence: RerenderEvidence[] = [];
      const selfToActualRatio = component.totalActualDuration > 0
        ? component.totalSelfDuration / component.totalActualDuration
        : 0;
      const avgDuration = component.renderCount > 0
        ? component.totalActualDuration / component.renderCount
        : 0;

      // ── Exact path: use changeDescription data when available ──────────────
      const cc = component.changeCauses;
      const hasExactCauses = cc != null;
      if (hasExactCauses && cc) {
        const parts: string[] = [];
        if (cc.props.length > 0) parts.push(`props changed: ${cc.props.join(', ')}`);
        if (cc.stateChanged) parts.push('state changed');
        if (cc.contextChanged) parts.push('context changed');
        if (cc.hooks.length > 0) parts.push(`hooks fired: ${cc.hooks.join(', ')}`);
        if (cc.parentTriggered && parts.length === 0) parts.push('parent re-rendered (no own prop/state change)');

        if (parts.length > 0) {
          likelyCauses.push(
            `${component.componentName} re-rendered because: ${parts.join('; ')}.` +
            (cc.parentTriggered && parts.length > 1 ? ' Also triggered by parent re-renders.' : ''),
          );
          evidence.push({
            signal: 'exact-change-description',
            observed: parts.join('; '),
            threshold: 'n/a',
            detail: `react-scan/lite reported exact change causes for ${component.componentName} across ${component.updateCount} update render${component.updateCount === 1 ? '' : 's'}.`,
          });
        }
      }

      if (component.updateCount >= 2) {
        const updatePct = component.renderCount > 0
          ? Math.round((component.updateCount / component.renderCount) * 100)
          : 0;
        const mountPct = 100 - updatePct;

        let causeText: string;
        if (updatePct >= 80) {
          causeText =
            `${component.componentName} rendered in update phase ${component.updateCount} of ${component.renderCount} times (${updatePct}% updates, ${mountPct}% mounts). ` +
            `It almost never remounts fresh, which means it is staying alive and re-rendering in place repeatedly. ` +
            `The likely driver is a parent passing new object/array/function references on every render, or the component's own state being set more often than intended. ` +
            `Check for inline object props, unstable callback references, or a context value that changes on every parent render.`;
        } else if (updatePct >= 40) {
          causeText =
            `${component.componentName} has a mixed mount/update pattern: ${updatePct}% updates, ${mountPct}% mounts across ${component.renderCount} renders. ` +
            `The component is sometimes remounting fresh and sometimes updating in place, which can mean it is conditionally included in the tree, ` +
            `or its React key changes on some renders (causing a full unmount+mount). ` +
            `Investigate whether key changes are intentional and whether conditional rendering could be replaced with CSS visibility to avoid remount cost.`;
        } else {
          causeText =
            `${component.componentName} is mostly mounting rather than updating: ${mountPct}% mounts vs ${updatePct}% updates across ${component.renderCount} renders. ` +
            `This level of remounting usually points to unstable list keys, a parent that conditionally unmounts and recreates the component, ` +
            `or a component defined inside a render function (which creates a new type on every render and forces React to unmount instead of update). ` +
            `Ensure keys are stable identifiers and that the component is not defined inline.`;
        }
        likelyCauses.push(causeText);
        evidence.push({
          signal: 'repeated-update-phases',
          observed: component.updateCount,
          threshold: 2,
          detail: `${component.componentName} entered the update phase ${component.updateCount} times (${updatePct}%) across ${component.commitIndices.length} commit${component.commitIndices.length === 1 ? '' : 's'}. Mount/update ratio: ${mountPct}% mounts, ${updatePct}% updates.`,
        });
      }

      if (component.nestedUpdateCount > 0) {
        likelyCauses.push(
          `${component.nestedUpdateCount} of ${component.componentName}'s renders were triggered as nested updates ` +
          `(the component itself was listed as an updater for its own commit). ` +
          `This is a strong indicator of a render-then-setState loop, an effect with missing or incorrect dependencies, ` +
          `or a context provider that updates its value during render.`,
        );
        evidence.push({
          signal: 'nested-update-propagation',
          observed: component.nestedUpdateCount,
          threshold: 1,
          detail: `${component.componentName} appeared as an updater in ${component.nestedUpdateCount} of its own commits, which is a strong hint that rerender work is self-propagating inside this subtree.`,
        });
      }

      if (selfToActualRatio >= 0.9) {
        const selfPct = Math.round(selfToActualRatio * 100);
        likelyCauses.push(
          `${selfPct}% of ${component.componentName}'s render cost is self-contained (not delegated to children). ` +
          `The component body itself is doing the heavy lifting — likely expensive JSX construction, inline computations, or heavy formatting on each render. ` +
          `Wrapping with React.memo will prevent unnecessary calls, and moving expensive calculations into useMemo will avoid recomputing them when unrelated state changes.`,
        );
        evidence.push({
          signal: 'self-intensive-render',
          observed: Number(selfToActualRatio.toFixed(2)),
          threshold: 0.9,
          detail: `Self duration is ${selfPct}% of actual duration for ${component.componentName}, indicating this component does most render work in its own body rather than delegating to children. Direct memoization of this component is the correct fix.`,
        });
      }

      if (component.commitIndices.length >= 3) {
        const commitList = component.commitIndices.slice(0, 5).join(', ') +
          (component.commitIndices.length > 5 ? ` … (+${component.commitIndices.length - 5} more)` : '');
        likelyCauses.push(
          `${component.componentName} appeared in ${component.commitIndices.length} separate commits (commits ${commitList}), ` +
          `which means rerender pressure on this component is sustained across the session rather than a one-off spike. ` +
          `Likely causes are an unstable context value, a subscription or timer that triggers frequent state updates, ` +
          `or a prop that carries a new reference on every parent render.`,
        );
        evidence.push({
          signal: 'wide-commit-spread',
          observed: component.commitIndices.length,
          threshold: 3,
          detail: `${component.componentName} shows up across ${component.commitIndices.length} commits (${commitList}), which usually means rerender pressure is sustained rather than a one-off spike.`,
        });
      }

      if (likelyCauses.length === 0) {
        likelyCauses.push(
          `${component.componentName} rendered ${component.updateCount} time${component.updateCount === 1 ? '' : 's'} in update phase, ` +
          `but the signals are below the thresholds for specific heuristics. ` +
          `React Profiler exports do not include prop/state diffs, so the exact trigger cannot be determined from this data alone. ` +
          `Use why-did-you-render or React DevTools to capture the specific prop or state change.`,
        );
        evidence.push({
          signal: 'limited-export-evidence',
          observed: component.commitIndices.length,
          threshold: 'n/a',
          detail: `React Profiler exports do not include exact prop/state diffs, so only weak rerender signals were available for ${component.componentName}.`,
        });
      }

      // Score: update count (capped) + nested updates + commit spread + self-intensive + avg duration factor
      const score = Math.min(10, Number((
        Math.min(3, component.updateCount)
        + Math.min(3, component.nestedUpdateCount * 1.5)
        + (component.commitIndices.length >= 3 ? 2 : component.commitIndices.length >= 2 ? 1 : 0)
        + (selfToActualRatio >= 0.9 ? 2 : selfToActualRatio >= 0.75 ? 1 : 0)
        + Math.min(2, avgDuration / 10)  // up to +2 for components averaging ≥20ms per render
      ).toFixed(1)));

      const result: RerenderCause = {
        componentName: component.componentName,
        renderCount: component.renderCount,
        updateCount: component.updateCount,
        nestedUpdateCount: component.nestedUpdateCount,
        totalActualDuration: component.totalActualDuration,
        score,
        scoreBand: getScoreBand(score),
        confidence: getConfidence(
          evidence.filter(item => item.signal !== 'limited-export-evidence').length,
        ),
        evidence,
        likelyCauses,
      };
      if (component.source) result.source = component.source;
      return result;
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.totalActualDuration - left.totalActualDuration;
    });

  return causes.slice(0, limit);
}

export function getCommitBreakdown(
  profile: ParsedRenderProfile,
  commitIndex: number,
  componentLimit = 5,
): CommitBreakdown | null {
  const commit = getCommitByIndex(profile, commitIndex);
  if (!commit) {
    return null;
  }

  const totalActualDuration = getMeasurementsTotalActualDuration(commit.measurements);
  const components = new Map<string, CommitBreakdownComponentSummary>();

  for (const measurement of commit.measurements) {
    const existing = components.get(measurement.componentName) ?? {
      componentName: measurement.componentName,
      actualDuration: 0,
      selfDuration: 0,
      renderCount: 0,
      shareOfCommitWork: 0,
      mountCount: 0,
      updateCount: 0,
      nestedUpdateCount: 0,
    };

    existing.actualDuration += measurement.actualDuration;
    existing.selfDuration += measurement.selfDuration;
    existing.renderCount += 1;
    if (measurement.phase === 'mount') {
      existing.mountCount += 1;
    } else {
      existing.updateCount += 1;
      if (measurement.isNestedUpdate) {
        existing.nestedUpdateCount += 1;
      }
    }

    components.set(measurement.componentName, existing);
  }

  const topComponents = Array.from(components.values())
    .sort((left, right) => right.actualDuration - left.actualDuration)
    .slice(0, componentLimit)
    .map(component => ({
      ...component,
      shareOfCommitWork: totalActualDuration > 0
        ? component.actualDuration / totalActualDuration
        : 0,
    }));

  const topComponentShare = topComponents[0]?.shareOfCommitWork ?? 0;
  const topThreeShare = topComponents
    .slice(0, 3)
    .reduce((sum, component) => sum + component.shareOfCommitWork, 0);

  let interpretation: string;
  if (topComponentShare >= 0.5) {
    interpretation = 'This commit is dominated by one component, so investigate that component before the rest of the tree.';
  } else if (topThreeShare >= 0.8) {
    interpretation = 'This commit is concentrated in a small set of components, so the spike is likely localized to one subtree.';
  } else {
    interpretation = 'This commit spreads work across several components, which often points to broader parent-to-child rerender propagation.';
  }

  return {
    commitIndex: commit.index,
    rootId: commit.rootId,
    duration: commit.duration,
    totalActualDuration,
    timestamp: commit.timestamp,
    priorityLevel: commit.priorityLevel,
    measurementCount: commit.measurements.length,
    updaterComponentNames: commit.updaterComponentNames,
    topComponents,
    concentration: {
      topComponentShare,
      topThreeShare,
    },
    interpretation,
  };
}

export function traceRenderPropagation(
  profile: ParsedRenderProfile,
  commitIndex: number,
  limit = 10,
): RenderPropagationPath[] {
  const commit = getCommitByIndex(profile, commitIndex);
  if (!commit) {
    return [];
  }

  const fiberNodeMap = getFiberNodeMap(profile, commit.rootId);
  const measurementMap = getMeasurementMap(commit);
  const renderedFiberIds = new Set(measurementMap.keys());
  const updaterNames = new Set(commit.updaterComponentNames);

  // ---------------------------------------------------------------------------
  // Fallback: infer parent-child links for orphan fibers.
  //
  // Orphan fibers are fibers that rendered in this commit but have no entry in
  // the snapshot tree. This happens when components mount *after* profiling
  // starts — React DevTools only snapshots the tree as it existed at session
  // start, so any later-mounted subtree is invisible to the snapshot.
  //
  // Strategy: sort all rendered fibers by actualDuration descending, then for
  // each orphan pick the tightest candidate parent — the rendered fiber with
  // the smallest actualDuration that is still larger than the orphan's and has
  // enough remaining "child budget" (actualDuration − selfDuration) to absorb
  // it.  Subtract the orphan's cost from the chosen parent's budget so
  // subsequent orphans are assigned correctly.
  // ---------------------------------------------------------------------------
  const remainingBudget = new Map<number, number>();
  const sortedRendered = Array.from(renderedFiberIds)
    .map(id => ({ id, m: measurementMap.get(id)! }))
    .sort((a, b) => b.m.actualDuration - a.m.actualDuration);

  for (const { id, m } of sortedRendered) {
    remainingBudget.set(id, m.actualDuration - m.selfDuration);
  }

  // orphanParentMap: orphanFiberId → inferred parent fiberId (or null = root entry)
  const orphanParentMap = new Map<number, number | null>();
  // orphanChildrenMap: parentFiberId → list of orphan children assigned to it
  const orphanChildrenMap = new Map<number, number[]>();

  for (const { id, m } of sortedRendered) {
    if (fiberNodeMap.has(id)) {
      continue; // has a real snapshot link — skip
    }

    let bestParentId: number | null = null;
    let bestParentDuration = Infinity;

    for (const { id: candidateId, m: candidateM } of sortedRendered) {
      if (candidateId === id) {
        continue;
      }

      if (candidateM.actualDuration <= m.actualDuration) {
        continue; // parent must have larger actualDuration
      }

      const budget = remainingBudget.get(candidateId) ?? 0;
      if (budget >= m.actualDuration - 0.1 /* floating-point tolerance */) {
        if (candidateM.actualDuration < bestParentDuration) {
          bestParentDuration = candidateM.actualDuration;
          bestParentId = candidateId;
        }
      }
    }

    orphanParentMap.set(id, bestParentId);

    if (bestParentId !== null) {
      remainingBudget.set(bestParentId, (remainingBudget.get(bestParentId) ?? 0) - m.actualDuration);
      const siblings = orphanChildrenMap.get(bestParentId) ?? [];
      siblings.push(id);
      orphanChildrenMap.set(bestParentId, siblings);
    }
  }

  const entryFiberIds = Array.from(renderedFiberIds)
    .filter(fiberId => {
      const node = fiberNodeMap.get(fiberId);
      if (node != null) {
        // Real snapshot node: entry if its parent did not render in this commit.
        return node.parentFiberId == null || !renderedFiberIds.has(node.parentFiberId);
      }

      // Orphan fiber: entry only if its inferred parent also did not render.
      const inferredParent = orphanParentMap.get(fiberId);
      return inferredParent == null || !renderedFiberIds.has(inferredParent);
    })
    .sort((left, right) => {
      const leftMeasurement = measurementMap.get(left);
      const rightMeasurement = measurementMap.get(right);
      return (rightMeasurement?.actualDuration ?? 0) - (leftMeasurement?.actualDuration ?? 0);
    });

  const paths: RenderPropagationPath[] = [];

  const visit = (
    fiberId: number,
    fiberPath: number[],
    componentPath: string[],
    totalActualDuration: number,
  ): void => {
    const measurement = measurementMap.get(fiberId);
    if (!measurement) {
      return;
    }

    const node = fiberNodeMap.get(fiberId);
    const componentName = node?.componentName ?? `(fiber:${fiberId})`;

    const nextFiberPath = [...fiberPath, fiberId];
    const nextComponentPath = [...componentPath, componentName];
    const nextTotalActualDuration = totalActualDuration + measurement.actualDuration;

    // Snapshot children that rendered + any orphans inferred to live under this fiber.
    const snapshotChildren = node
      ? node.childFiberIds.filter(childId => renderedFiberIds.has(childId))
      : [];
    const orphanChildren = (orphanChildrenMap.get(fiberId) ?? [])
      .filter(childId => renderedFiberIds.has(childId));
    const renderedChildren = [...snapshotChildren, ...orphanChildren];

    if (renderedChildren.length === 0) {
      paths.push({
        commitIndex: commit.index,
        rootId: commit.rootId,
        fiberPath: nextFiberPath,
        componentPath: nextComponentPath,
        depth: nextComponentPath.length,
        totalActualDuration: nextTotalActualDuration,
        leafActualDuration: measurement.actualDuration,
        includesUpdater: nextComponentPath.some(name => updaterNames.has(name)),
      });
      return;
    }

    for (const childId of renderedChildren) {
      visit(childId, nextFiberPath, nextComponentPath, nextTotalActualDuration);
    }
  };

  for (const fiberId of entryFiberIds) {
    visit(fiberId, [], [], 0);
  }

  return paths
    .sort((left, right) => {
      if (right.totalActualDuration !== left.totalActualDuration) {
        return right.totalActualDuration - left.totalActualDuration;
      }

      return right.depth - left.depth;
    })
    .slice(0, limit);
}

export function detectRenderIssues(profile: ParsedRenderProfile, limit = 10): RenderIssue[] {
  const issues: RenderIssue[] = [];
  const averageCommitDuration = profile.commits.length > 0
    ? profile.totalCommitDuration / profile.commits.length
    : 0;

  for (const cause of getRerenderCauses(profile, profile.components.length, 0)) {
    if (cause.scoreBand === 'low') {
      continue;
    }

    issues.push({
      type: 'rerender-storm',
      severity: cause.scoreBand,
      title: `${cause.componentName} rerenders frequently`,
      summary: cause.likelyCauses[0] ?? `${cause.componentName} shows repeated rerender pressure.`,
      componentName: cause.componentName,
      evidence: cause.evidence,
    });
  }

  for (const commit of getHotCommits(profile, Math.min(5, profile.commits.length), 3)) {
    if (averageCommitDuration > 0 && commit.duration >= averageCommitDuration * 1.5) {
      const topShare = commit.topComponents[0]?.shareOfCommitWork ?? 0;
      issues.push({
        type: 'commit-spike',
        severity: commit.duration >= averageCommitDuration * 2 ? 'high' : 'medium',
        title: `Commit ${commit.commitIndex} is a render spike`,
        summary: `Commit ${commit.commitIndex} took ${commit.duration.toFixed(2)}ms, versus an average commit duration of ${averageCommitDuration.toFixed(2)}ms. ${topShare >= 0.5 ? 'One component dominates this spike.' : 'The spike is spread across several components.'}`,
        commitIndex: commit.commitIndex,
        evidence: [
          {
            signal: 'commit-duration-spike',
            observed: Number(commit.duration.toFixed(2)),
            threshold: Number((averageCommitDuration * 1.5).toFixed(2)),
            detail: `Commit ${commit.commitIndex} exceeded the average commit duration by ${Number((commit.duration / averageCommitDuration).toFixed(2))}x.`,
          },
        ],
      });
    }

    const cascadingPath = traceRenderPropagation(profile, commit.commitIndex, 5)
      .find(path => path.depth >= 3);

    if (cascadingPath) {
      issues.push({
        type: 'cascading-render',
        severity: cascadingPath.includesUpdater ? 'high' : 'medium',
        title: `Commit ${commit.commitIndex} shows cascading subtree work`,
        summary: `A rendered path of depth ${cascadingPath.depth} was observed (${cascadingPath.componentPath.join(' -> ')}), which suggests parent-to-child rerender propagation rather than isolated component work.`,
        commitIndex: commit.commitIndex,
        evidence: [
          {
            signal: 'deep-render-propagation',
            observed: cascadingPath.depth,
            threshold: 3,
            detail: `Rendered path ${cascadingPath.componentPath.join(' -> ')} accumulated ${cascadingPath.totalActualDuration.toFixed(2)}ms of work in a single commit.`,
          },
        ],
      });
    }
  }

  return issues
    .sort((left, right) => {
      const severityDelta = getSeverityRank(right.severity) - getSeverityRank(left.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }

      return (left.commitIndex ?? Number.MAX_SAFE_INTEGER) - (right.commitIndex ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, limit);
}

function createDiffEntry(
  componentName: string,
  baseComponent: ParsedRenderProfile['components'][number] | undefined,
  currentComponent: ParsedRenderProfile['components'][number] | undefined,
): RenderDiffEntry {
  const baseTotalActualDuration = baseComponent?.totalActualDuration ?? 0;
  const currentTotalActualDuration = currentComponent?.totalActualDuration ?? 0;
  const baseAverageActualDuration = baseComponent != null && baseComponent.renderCount > 0
    ? baseComponent.totalActualDuration / baseComponent.renderCount
    : 0;
  const currentAverageActualDuration = currentComponent != null && currentComponent.renderCount > 0
    ? currentComponent.totalActualDuration / currentComponent.renderCount
    : 0;
  const totalActualDurationDelta = currentTotalActualDuration - baseTotalActualDuration;

  let changeType: RenderDiffEntry['changeType'];
  if (!baseComponent && currentComponent) {
    changeType = 'added';
  } else if (baseComponent && !currentComponent) {
    changeType = 'removed';
  } else if (totalActualDurationDelta >= 0) {
    changeType = 'regression';
  } else {
    changeType = 'improvement';
  }

  return {
    componentName,
    changeType,
    baseTotalActualDuration,
    currentTotalActualDuration,
    totalActualDurationDelta,
    averageActualDurationDelta: currentAverageActualDuration - baseAverageActualDuration,
    maxActualDurationDelta: (currentComponent?.maxActualDuration ?? 0) - (baseComponent?.maxActualDuration ?? 0),
    renderCountDelta: (currentComponent?.renderCount ?? 0) - (baseComponent?.renderCount ?? 0),
    commitCountDelta: (currentComponent?.commitIndices.length ?? 0) - (baseComponent?.commitIndices.length ?? 0),
    percentChange: baseTotalActualDuration > 0
      ? (totalActualDurationDelta / baseTotalActualDuration) * 100
      : currentTotalActualDuration > 0
        ? 100
        : null,
  };
}

export function compareRenders(
  baseProfile: ParsedRenderProfile,
  currentProfile: ParsedRenderProfile,
  limit = 10,
  minDelta = 0,
): RenderComparison {
  const baseComponents = new Map(baseProfile.components.map(component => [component.componentName, component]));
  const currentComponents = new Map(currentProfile.components.map(component => [component.componentName, component]));
  const allComponentNames = new Set([...baseComponents.keys(), ...currentComponents.keys()]);

  const entries = Array.from(allComponentNames)
    .map(componentName => createDiffEntry(componentName, baseComponents.get(componentName), currentComponents.get(componentName)))
    .filter(entry => {
      if (entry.changeType === 'added' || entry.changeType === 'removed') {
        return true;
      }

      return Math.abs(entry.totalActualDurationDelta) > 0 && Math.abs(entry.totalActualDurationDelta) >= minDelta;
    })
    .sort((left, right) => Math.abs(right.totalActualDurationDelta) - Math.abs(left.totalActualDurationDelta))
    .slice(0, limit);

  return {
    baseProfileId: baseProfile.id,
    currentProfileId: currentProfile.id,
    regressions: entries.filter(entry => entry.changeType === 'regression' && entry.totalActualDurationDelta > 0),
    improvements: entries.filter(entry => entry.changeType === 'improvement' && entry.totalActualDurationDelta < 0),
    added: entries.filter(entry => entry.changeType === 'added'),
    removed: entries.filter(entry => entry.changeType === 'removed'),
  };
}
