import { afterAll, describe, expect, it } from 'vitest';

import {
  createCaptureSession,
  getCaptureSession,
  getServerPort,
  stopCaptureSession,
} from '../src/ingest/server.js';
import { adaptReactScanEvents } from '../src/parser/react-scan-lite.js';

// ---------------------------------------------------------------------------
// Helpers — native react-scan/lite endpoint wire format
// { message, data: { tree, rendererId, ... }, sessionId, timestamp }
// ---------------------------------------------------------------------------

interface NativeTree {
  fiberId?: number;
  name: string;
  depth: number;
  tag?: number;
  actualDuration: number;
  actualStartTime?: number;
  selfBaseDuration: number;
  treeBaseDuration?: number;
  changeDescription?: {
    isFirstMount: boolean;
    props: string[] | null;
    state: boolean;
    context: boolean;
    hooks: number[];
    parent: boolean;
  } | null;
  source?: { fileName: string; lineNumber: number; columnNumber: number } | null;
  ownerName?: string | null;
}

interface NativeCommitBody {
  message: 'commit';
  sessionId: string;
  timestamp: number;
  data: {
    rendererId?: number;
    priorityName?: string;
    laneLabels?: string[];
    tree: NativeTree[];
  };
}

function makeCommit(overrides: Partial<{
  sessionId: string;
  commitIndex: number;
  timestamp: number;
  rendererId: number;
  priorityName: string;
  tree: NativeTree[];
}> = {}): NativeCommitBody {
  return {
    message: 'commit',
    sessionId: overrides.sessionId ?? 'test-session',
    timestamp: overrides.timestamp ?? 1000,
    data: {
      rendererId: overrides.rendererId ?? 1,
      priorityName: overrides.priorityName ?? 'Normal',
      laneLabels: [],
      tree: overrides.tree ?? [
        {
          fiberId: 1,
          name: 'Button',
          depth: 0,
          tag: 0,
          actualDuration: 8,
          actualStartTime: 100,
          selfBaseDuration: 3,
          treeBaseDuration: 8,
          changeDescription: { isFirstMount: false, props: ['onClick'], state: false, context: false, hooks: [], parent: false },
          source: { fileName: 'src/Button.tsx', lineNumber: 10, columnNumber: 5 },
          ownerName: null,
        },
        {
          fiberId: 2,
          name: 'Icon',
          depth: 1,
          tag: 0,
          actualDuration: 5,
          actualStartTime: 105,
          selfBaseDuration: 5,
          treeBaseDuration: 5,
          changeDescription: { isFirstMount: true, props: null, state: false, context: false, hooks: [], parent: false },
          source: null,
          ownerName: 'Button',
        },
      ],
    },
  };
}

async function postEvents(
  sessionId: string,
  events: NativeCommitBody[],
): Promise<Response> {
  const port = getServerPort();
  return fetch(`http://127.0.0.1:${port}/ingest/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(events),
  });
}

// ---------------------------------------------------------------------------
// Ingest server — session lifecycle
// ---------------------------------------------------------------------------

describe('ingest server — session lifecycle', () => {
  it('creates a session with active status and a valid endpoint', async () => {
    const session = await createCaptureSession();

    expect(session.status).toBe('active');
    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(session.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/ingest\//);
    expect(session.commits).toHaveLength(0);
    expect(session.profilingAvailable).toBeNull();
  });

  it('getCaptureSession returns the same session object', async () => {
    const session = await createCaptureSession();
    const fetched = getCaptureSession(session.sessionId);
    expect(fetched).toBe(session);
  });

  it('stopCaptureSession marks the session as stopped', async () => {
    const session = await createCaptureSession();
    stopCaptureSession(session.sessionId);
    expect(session.status).toBe('stopped');
  });

  it('getCaptureSession returns undefined for unknown session', () => {
    expect(getCaptureSession('does-not-exist')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Ingest server — HTTP endpoint
// ---------------------------------------------------------------------------

describe('ingest server — HTTP endpoint', () => {
  it('accepts a native commit event, normalizes it, and appends it to the session', async () => {
    const session = await createCaptureSession();
    const commit = makeCommit({ sessionId: session.sessionId });

    const res = await postEvents(session.sessionId, [commit]);
    expect(res.status).toBe(200);

    const body = await res.json() as { ok: boolean; received: number };
    expect(body.ok).toBe(true);
    expect(body.received).toBe(1);
    expect(session.commits).toHaveLength(1);
    // Verify normalization: selfBaseDuration → selfDuration, state boolean → ['state']
    const stored = session.commits[0];
    expect(stored.fibers).toHaveLength(2);
    expect(stored.fibers[0].selfDuration).toBe(3);  // from selfBaseDuration
    expect(stored.fibers[0].changeDescription?.isFirstMount).toBe(false);
    expect(stored.duration).toBe(8);  // root fiber (depth=0) actualDuration
  });

  it('accepts a native profiling-hooks-status event and updates profilingAvailable', async () => {
    const session = await createCaptureSession();
    const port = getServerPort();

    // Native format: { message: 'profiling-hooks-status', data: { available }, sessionId, timestamp }
    const res = await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'profiling-hooks-status', sessionId: session.sessionId, timestamp: Date.now(), data: { available: false } }),
    });
    expect(res.status).toBe(200);
    expect(session.profilingAvailable).toBe(false);
  });

  it('silently ignores unknown event formats (received: 0)', async () => {
    const session = await createCaptureSession();
    const port = getServerPort();

    const res = await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'profiling-hooks-status', available: true }),
    });
    const body = await res.json() as { ok: boolean; received: number };
    expect(res.status).toBe(200);
    expect(body.received).toBe(0);
    expect(session.commits).toHaveLength(0);
    expect(session.profilingAvailable).toBeNull(); // unchanged
  });

  it('accepts a batch of multiple events in one POST', async () => {
    const session = await createCaptureSession();
    const commits = [
      makeCommit({ sessionId: session.sessionId }),
      makeCommit({ sessionId: session.sessionId }),
    ];

    const res = await postEvents(session.sessionId, commits);
    expect(res.status).toBe(200);
    expect(session.commits).toHaveLength(2);
  });

  it('returns 410 when posting to a stopped session', async () => {
    const session = await createCaptureSession();
    stopCaptureSession(session.sessionId);

    const res = await postEvents(session.sessionId, [makeCommit()]);
    expect(res.status).toBe(410);
  });

  it('returns 404 for an unknown sessionId', async () => {
    // Ensure server is running by creating any session first.
    await createCaptureSession();
    const port = getServerPort();

    const res = await fetch(`http://127.0.0.1:${port}/ingest/no-such-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid JSON', async () => {
    const session = await createCaptureSession();
    const port = getServerPort();

    const res = await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('handles CORS preflight with 204', async () => {
    await createCaptureSession();
    const port = getServerPort();

    const res = await fetch(`http://127.0.0.1:${port}/ingest/any`, {
      method: 'OPTIONS',
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

// ---------------------------------------------------------------------------
// react-scan-lite adapter — tested through the full HTTP → session → adapt path
// ---------------------------------------------------------------------------

async function captureAndAdapt(bodies: NativeCommitBody[]): Promise<ReturnType<typeof adaptReactScanEvents>> {
  const session = await createCaptureSession();
  const port = getServerPort();
  await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodies),
  });
  stopCaptureSession(session.sessionId);
  return adaptReactScanEvents(session.commits, session.sessionId);
}

describe('adaptReactScanEvents', () => {
  it('produces a ParsedRenderProfile with correct counts', async () => {
    const profile = await captureAndAdapt([
      makeCommit({ timestamp: 1000 }),
      makeCommit({ timestamp: 2000 }),
    ]);

    expect(profile.filename).toMatch(/^react-scan-session:/);
    expect(profile.version).toBe('5');
    expect(profile.commits).toHaveLength(2);
    // Duration is derived from root fiber (depth=0) actualDuration = 8
    expect(profile.commits[0].duration).toBe(8);
    expect(profile.commits[1].duration).toBe(8);
    expect(profile.totalCommitDuration).toBe(16);
  });

  it('maps fiber events to measurements with correct phase', async () => {
    const profile = await captureAndAdapt([makeCommit()]);

    const m0 = profile.commits[0].measurements[0];
    const m1 = profile.commits[0].measurements[1];

    expect(m0.componentName).toBe('Button');
    expect(m0.phase).toBe('update'); // isFirstMount: false
    expect(m0.actualDuration).toBe(8);
    expect(m0.selfDuration).toBe(3); // from selfBaseDuration

    expect(m1.componentName).toBe('Icon');
    expect(m1.phase).toBe('mount'); // isFirstMount: true
    expect(m1.actualDuration).toBe(5);
  });

  it('deduplicates fiberNodes across commits', async () => {
    const profile = await captureAndAdapt([
      makeCommit(),
      makeCommit(), // same fiberIds 1 and 2
    ]);
    const ids = profile.fiberNodes.map(f => f.fiberId);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids).toHaveLength(2);
  });

  it('builds component stats aggregated across commits', async () => {
    const profile = await captureAndAdapt([makeCommit(), makeCommit()]);

    const button = profile.components.find(c => c.componentName === 'Button');
    expect(button).toBeDefined();
    expect(button!.renderCount).toBe(2);
    expect(button!.totalActualDuration).toBeCloseTo(16);
    expect(button!.commitIndices).toEqual([0, 1]);
  });

  it('handles empty commits array gracefully', () => {
    const profile = adaptReactScanEvents([], 'empty-session');
    expect(profile.commits).toHaveLength(0);
    expect(profile.components).toHaveLength(0);
    expect(profile.totalCommitDuration).toBe(0);
  });

  it('maps state:boolean and hooks:number[] from wire format to internal model', async () => {
    const session = await createCaptureSession();
    const port = getServerPort();

    await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'commit',
        sessionId: session.sessionId,
        timestamp: 1000,
        data: {
          rendererId: 1,
          tree: [{
            fiberId: 10,
            name: 'Counter',
            depth: 0,
            actualDuration: 4,
            selfBaseDuration: 4,
            changeDescription: {
              isFirstMount: false,
              props: null,
              state: true,       // boolean in real API
              context: false,
              hooks: [0, 2],     // indices in real API
              parent: false,
            },
            source: null,
          }],
        },
      }),
    });

    // Assert on the normalized session commit — state:true → ['state'], hooks:[0,2] → ['hook[0]','hook[2]']
    const fiber = session.commits[0].fibers[0];
    expect(fiber.name).toBe('Counter');
    expect(fiber.selfDuration).toBe(4);                          // selfBaseDuration → selfDuration
    expect(fiber.changeDescription?.state).toEqual(['state']);   // true → ['state']
    expect(fiber.changeDescription?.hooks).toEqual(['hook[0]', 'hook[2]']); // indices → names
    expect(fiber.changeDescription?.context).toBeNull();        // false → null
    expect(fiber.changeDescription?.props).toBeNull();
  });
});

afterAll(() => {
  // Nothing to tear down — the HTTP server is a singleton and vitest will
  // exit the process cleanly.
});
