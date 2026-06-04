import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compareRenders,
  getHotCommits,
  getRenderSummary,
  getRerenderCauses,
  getSlowComponents,
} from '../src/parser/analysis.js';
import { parseRenderProfile } from '../src/parser/react-profile.js';

const fixturePath = resolve(import.meta.dirname, 'fixtures/sample-render-profile.json');
const dataForRootsFixturePath = resolve(import.meta.dirname, 'fixtures/sample-render-profile-dataforroots.json');

describe('render profile parser', () => {
  it('parses a valid React DevTools profiler export', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');

    expect(profile.filename).toBe('sample-render-profile.json');
    expect(profile.version).toBe('5');
    expect(profile.commits).toHaveLength(3);
    expect(profile.components.length).toBeGreaterThan(0);
    expect(profile.totalCommitDuration).toBeCloseTo(26.4, 1);
  });

  it('rejects invalid JSON payloads', () => {
    expect(() => parseRenderProfile('{', 'bad.json')).toThrow('Invalid render profile JSON');
    expect(() => parseRenderProfile('{}', 'bad.json')).toThrow('Invalid render profile format');
  });

  it('parses profiles that store commits under dataForRoots', async () => {
    const content = await readFile(dataForRootsFixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile-dataforroots.json');

    expect(profile.commits).toHaveLength(2);
    expect(profile.components.length).toBe(2);
    expect(profile.components[0].componentName).toBe('SearchResults');
  });
});

describe('render profile analysis', () => {
  it('returns a summary sorted by total actual duration', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');
    const summary = getRenderSummary(profile, 3);

    expect(summary.commitCount).toBe(3);
    expect(summary.topComponents[0].componentName).toBe('ProductList');
    expect(summary.topComponents[0].totalActualDuration).toBeGreaterThanOrEqual(summary.topComponents[1].totalActualDuration);
    expect(summary.hotCommits[0].commitIndex).toBe(0);
    expect(summary.hotCommits[0].topComponents.length).toBeGreaterThan(0);
    expect(summary.hotCommits[0].topComponents[0].componentName).toBe('App');
    expect(Array.isArray(summary.issues)).toBe(true);
  });

  it('finds slow components and rerender signals', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');

    const slowComponents = getSlowComponents(profile, 2);
    const causes = getRerenderCauses(profile, 5);

    expect(slowComponents.map(component => component.componentName)).toContain('ProductList');
    expect(causes.length).toBeGreaterThan(0);
    expect(causes.map(cause => cause.componentName)).toContain('SearchResults');
    expect(causes[0].likelyCauses.length).toBeGreaterThan(0);
    expect(causes[0].evidence.length).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(causes[0].confidence);
    expect(['low', 'medium', 'high']).toContain(causes[0].scoreBand);
  });

  it('ranks hot commits with top components inside each commit', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');
    const hotCommits = getHotCommits(profile, 2, 2);

    expect(hotCommits).toHaveLength(2);
    expect(hotCommits[0].duration).toBeGreaterThanOrEqual(hotCommits[1].duration);
    expect(hotCommits[0].topComponents).toHaveLength(2);
    expect(hotCommits[0].topComponents[0].shareOfCommitWork).toBeGreaterThan(0);
    expect(Array.isArray(hotCommits[0].updaterComponentNames)).toBe(true);
  });

  it('compares two render profiles and reports regressions', () => {
    const baseProfile = parseRenderProfile(JSON.stringify({
      version: 5,
      dataForRoots: [{
        commitData: [
          {
            duration: 5,
            fiberActualDurations: [[1, 5], [2, 2]],
            fiberSelfDurations: [[1, 2], [2, 2]],
            priorityLevel: 'Normal',
            timestamp: 100,
          },
        ],
        displayName: 'App',
        initialTreeBaseDurations: [[1, 3], [2, 2]],
        rootID: 1,
        snapshots: [
          [1, { displayName: 'App', children: [2] }],
          [2, { displayName: 'List', children: [] }],
        ],
      }],
    }), 'base.json');

    const currentProfile = parseRenderProfile(JSON.stringify({
      version: 5,
      dataForRoots: [{
        commitData: [
          {
            duration: 9,
            fiberActualDurations: [[1, 9], [2, 6], [3, 4]],
            fiberSelfDurations: [[1, 3], [2, 6], [3, 4]],
            priorityLevel: 'Normal',
            timestamp: 100,
          },
        ],
        displayName: 'App',
        initialTreeBaseDurations: [[1, 3], [2, 2], [3, 1]],
        rootID: 1,
        snapshots: [
          [1, { displayName: 'App', children: [2, 3] }],
          [2, { displayName: 'List', children: [] }],
          [3, { displayName: 'FilterBar', children: [] }],
        ],
      }],
    }), 'current.json');

    const comparison = compareRenders(baseProfile, currentProfile, 10, 0);

    expect(comparison.regressions.some(entry => entry.componentName === 'App')).toBe(true);
    expect(comparison.regressions.some(entry => entry.componentName === 'List')).toBe(true);
    expect(comparison.added.some(entry => entry.componentName === 'FilterBar')).toBe(true);
  });

  it('counts nested updates from commit updaters field', () => {
    const profileWithUpdaters = JSON.stringify({
      version: 5,
      dataForRoots: [{
        commitData: [
          {
            duration: 5,
            fiberActualDurations: [[1, 5], [2, 3]],
            fiberSelfDurations: [[1, 2], [2, 3]],
            priorityLevel: 'Normal',
            timestamp: 100,
            updaters: null,
          },
          {
            duration: 4,
            fiberActualDurations: [[1, 4], [2, 2]],
            fiberSelfDurations: [[1, 2], [2, 2]],
            priorityLevel: 'Normal',
            timestamp: 200,
            updaters: [{ id: 2, displayName: 'Button', key: null, type: 5 }],
          },
        ],
        displayName: 'App',
        initialTreeBaseDurations: [[1, 3], [2, 2]],
        rootID: 1,
        snapshots: [
          [1, { displayName: 'App', children: [2] }],
          [2, { displayName: 'Button', children: [] }],
        ],
      }],
    });

    const profile = parseRenderProfile(profileWithUpdaters, 'updaters-test.json');
    const button = profile.components.find(c => c.componentName === 'Button');
    expect(button?.nestedUpdateCount).toBe(1);
    const app = profile.components.find(c => c.componentName === 'App');
    expect(app?.nestedUpdateCount).toBe(0);
    expect(profile.commits[1].updaterComponentNames).toContain('Button');
  });

  it('assigns globally sequential commit indices across multiple roots', () => {
    const multiRootProfile = JSON.stringify({
      version: 5,
      dataForRoots: [
        {
          commitData: [
            { duration: 3, fiberActualDurations: [[1, 3]], fiberSelfDurations: [[1, 3]], priorityLevel: null, timestamp: 10 },
            { duration: 4, fiberActualDurations: [[1, 4]], fiberSelfDurations: [[1, 4]], priorityLevel: null, timestamp: 20 },
          ],
          displayName: 'RootA',
          initialTreeBaseDurations: [],
          rootID: 1,
          snapshots: [[1, { displayName: 'CompA', children: [] }]],
        },
        {
          commitData: [
            { duration: 5, fiberActualDurations: [[2, 5]], fiberSelfDurations: [[2, 5]], priorityLevel: null, timestamp: 30 },
          ],
          displayName: 'RootB',
          initialTreeBaseDurations: [],
          rootID: 2,
          snapshots: [[2, { displayName: 'CompB', children: [] }]],
        },
      ],
    });

    const profile = parseRenderProfile(multiRootProfile, 'multi-root.json');
    expect(profile.commits).toHaveLength(3);
    expect(profile.commits.map(c => c.index)).toEqual([0, 1, 2]);
  });

  it('filters components by minDuration in getRerenderCauses', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');

    const all = getRerenderCauses(profile, 10, 0);
    const filtered = getRerenderCauses(profile, 10, 50);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
    expect(filtered.every(c => c.totalActualDuration >= 50)).toBe(true);
  });

  it('sorts slow components by average duration when sortBy=average', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');

    const byAvg = getSlowComponents(profile, 10, 'average');
    for (let i = 1; i < byAvg.length; i++) {
      expect(byAvg[i - 1].averageActualDuration).toBeGreaterThanOrEqual(byAvg[i].averageActualDuration);
    }
  });
});
