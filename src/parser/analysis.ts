import type {
  HotCommitComponentSummary,
  HotCommitSummary,
  ParsedRenderProfile,
  RenderCommit,
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

function getConfidence(evidenceCount: number): RerenderConfidence {
  if (evidenceCount >= 3) {
    return 'high';
  }

  if (evidenceCount >= 2) {
    return 'medium';
  }

  return 'low';
}

function getCommitTopComponents(commit: RenderCommit, limit: number): HotCommitComponentSummary[] {
  const components = new Map<string, HotCommitComponentSummary>();
  const totalActualDuration = commit.measurements.reduce(
    (sum, measurement) => sum + measurement.actualDuration,
    0,
  );

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
    .sort((left, right) => right.actualDuration - left.actualDuration)
    .slice(0, limit)
    .map(component => ({
      ...component,
      shareOfCommitWork: totalActualDuration > 0
        ? component.actualDuration / totalActualDuration
        : 0,
    }));
}

export function getHotCommits(
  profile: ParsedRenderProfile,
  limit = 10,
  componentLimit = 3,
): HotCommitSummary[] {
  return profile.commits
    .map(commit => ({
      commitIndex: commit.index,
      duration: commit.duration,
      totalActualDuration: commit.measurements.reduce(
        (sum, measurement) => sum + measurement.actualDuration,
        0,
      ),
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
} {
  return {
    profileId: profile.id,
    filename: profile.filename,
    version: profile.version,
    rendererId: profile.rendererId,
    commitCount: profile.commits.length,
    componentCount: profile.components.length,
    totalCommitDuration: profile.totalCommitDuration,
    totalRenderDuration: profile.totalRenderDuration,
    hotCommits: getHotCommits(profile, Math.min(3, profile.commits.length), 3),
    topComponents: getSlowComponents(profile, limit),
  };
}

export function getSlowComponents(
  profile: ParsedRenderProfile,
  limit = 10,
  sortBy: 'total' | 'average' | 'max' = 'total',
  minDuration = 0,
): RenderSummaryEntry[] {
  const entries: RenderSummaryEntry[] = profile.components
    .filter(component => component.totalActualDuration >= minDuration)
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
      (component.updateCount > 0 || component.nestedUpdateCount > 0) &&
      component.totalActualDuration >= minDuration
    )
    .map(component => {
      const likelyCauses: string[] = [];
      const evidence: RerenderEvidence[] = [];
      const selfToActualRatio = component.totalActualDuration > 0
        ? component.totalSelfDuration / component.totalActualDuration
        : 0;

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
          detail: `${component.componentName} shows up across ${component.commitIndices.length} commits, which usually means rerender pressure is sustained rather than a one-off spike.`,
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

      const score = Math.min(10, Number((
        Math.min(3, component.updateCount)
        + Math.min(3, component.nestedUpdateCount * 1.5)
        + (component.commitIndices.length >= 3 ? 2 : component.commitIndices.length >= 2 ? 1 : 0)
        + (selfToActualRatio >= 0.9 ? 2 : selfToActualRatio >= 0.75 ? 1 : 0)
      ).toFixed(1)));

      return {
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
      } satisfies RerenderCause;
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.totalActualDuration - left.totalActualDuration;
    });

  return causes.slice(0, limit);
}
