import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Internal normalized types (what the session stores)
// ---------------------------------------------------------------------------

export interface ReactScanChangeDescription {
  props?: string[] | null;
  state?: string[] | null;
  context?: string[] | null;
  hooks?: string[] | null;
  parent?: boolean;
  isFirstMount?: boolean;
}

export interface ReactScanSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

export interface ReactScanFiberEvent {
  fiberId: number;
  name: string;
  depth: number;
  actualDuration: number;
  selfDuration?: number;
  changeDescription?: ReactScanChangeDescription | null;
  source?: ReactScanSource | null;
  parentId?: number | null;
}

export interface ReactScanCommitEvent {
  type: 'commit';
  sessionId: string;
  commitIndex: number;
  rootId: number;
  duration: number;
  timestamp: number;
  priorityName?: string;
  laneLabels?: string[];
  updaterNames?: string[];
  fibers: ReactScanFiberEvent[];
}

// ---------------------------------------------------------------------------
// Wire format normalization
// react-scan/lite's `endpoint` option POSTs:
//   { message: LiteEventKind, data: { tree?, ... }, sessionId, timestamp }
// ---------------------------------------------------------------------------

// Shape of a LiteFiberSummary as it arrives over the wire
interface RawFiber {
  name?: unknown;
  depth?: unknown;
  tag?: unknown;
  actualDuration?: unknown;
  selfBaseDuration?: unknown;
  fiberId?: unknown;
  source?: unknown;
  ownerName?: unknown;
  changeDescription?: {
    isFirstMount?: boolean;
    props?: string[] | null;
    state?: boolean;       // boolean in real API, NOT an array
    context?: boolean;     // boolean in real API, NOT an array
    hooks?: number[];      // hook indices
    parent?: boolean;
  } | null;
}

function normalizeFiber(raw: RawFiber): ReactScanFiberEvent {
  const cd = raw.changeDescription ?? null;
  return {
    fiberId: typeof raw.fiberId === 'number' ? raw.fiberId : 0,
    name: (typeof raw.name === 'string' && raw.name.trim()) ? raw.name.trim() : '(anonymous)',
    depth: typeof raw.depth === 'number' ? raw.depth : 0,
    actualDuration: typeof raw.actualDuration === 'number' ? raw.actualDuration : 0,
    selfDuration: typeof raw.selfBaseDuration === 'number' ? raw.selfBaseDuration : 0,
    changeDescription: cd != null ? {
      isFirstMount: cd.isFirstMount ?? false,
      props: cd.props ?? null,
      state: cd.state ? ['state'] : null,
      context: cd.context ? ['context'] : null,
      hooks: cd.hooks?.map((i: number) => `hook[${i}]`) ?? null,
      parent: cd.parent ?? false,
    } : null,
    source: (raw.source && typeof raw.source === 'object') ? raw.source as ReactScanSource : null,
    parentId: null,
  };
}

function parseOneEvent(
  raw: unknown,
  commitIndex: number,
  urlSessionId: string,
): { kind: 'commit'; event: ReactScanCommitEvent } | { kind: 'status'; available: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  // ── Native react-scan/lite endpoint format ────────────────────────────────
  // Body: { message: LiteEventKind, data: {...}, sessionId, timestamp }
  if (typeof r.message === 'string') {
    const data = (r.data && typeof r.data === 'object') ? r.data as Record<string, unknown> : {};
    const ts = typeof r.timestamp === 'number' ? r.timestamp : Date.now();

    if (r.message === 'commit') {
      const tree = Array.isArray(data.tree) ? (data.tree as RawFiber[]) : [];
      const fibers = tree.map(normalizeFiber);
      // Use root-depth fiber's actualDuration as commit duration; fall back to sum.
      const rootFiber = fibers.find(f => f.depth === 0);
      const duration = rootFiber?.actualDuration ?? fibers.reduce((s, f) => s + f.actualDuration, 0);

      return {
        kind: 'commit',
        event: {
          type: 'commit',
          sessionId: urlSessionId, // always use URL sessionId — never trust the body
          commitIndex,
          rootId: typeof data.rendererId === 'number' ? data.rendererId : 1,
          duration,
          timestamp: ts,
          priorityName: typeof data.priorityName === 'string' ? data.priorityName : undefined,
          laneLabels: Array.isArray(data.laneLabels) ? (data.laneLabels as string[]) : undefined,
          updaterNames: [],
          fibers,
        },
      };
    }

    if (r.message === 'profiling-hooks-status') {
      return { kind: 'status', available: data.available === true };
    }

    return null; // other event kinds (render-start, post-commit, fiber-unmount, etc.) — expected noise
  }

  return null; // no `message` field — not a react-scan/lite payload
}

// ---------------------------------------------------------------------------
// Session model
// ---------------------------------------------------------------------------

export interface CaptureSession {
  sessionId: string;
  endpoint: string;
  status: 'active' | 'stopped';
  commits: ReactScanCommitEvent[];
  profilingAvailable: boolean | null;
  startTime: number;
  /** Count of POST bodies that had no recognizable react-scan/lite `message` field.
   *  A non-zero value with zero commits usually means the instrumentation snippet
   *  is not wired correctly (e.g. the import path is wrong or the file runs server-side). */
  unknownEvents: number;
}

// ---------------------------------------------------------------------------
// Singleton HTTP server state
// ---------------------------------------------------------------------------

const sessions = new Map<string, CaptureSession>();
let httpServer: Server | null = null;
let serverPort: number | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url ?? '';
  const match = url.match(/^\/ingest\/([^/]+)$/);
  if (!match || req.method !== 'POST') {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  const sessionId = decodeURIComponent(match[1]);
  const session = sessions.get(sessionId);

  if (!session) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'session not found' }));
    return;
  }

  if (session.status !== 'active') {
    res.writeHead(410);
    res.end(JSON.stringify({ error: 'session already stopped' }));
    return;
  }

  readBody(req)
    .then(body => {
      let rawEvents: unknown[];
      try {
        const parsed: unknown = JSON.parse(body);
        rawEvents = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }

      let received = 0;
      for (const raw of rawEvents) {
        const normalized = parseOneEvent(raw, session.commits.length, sessionId);
        if (!normalized) {
          if (raw && typeof raw === 'object' && !('message' in (raw as object))) {
            session.unknownEvents++;
          }
          continue;
        }
        received++;
        if (normalized.kind === 'commit') {
          session.commits.push(normalized.event);
        } else if (normalized.kind === 'status') {
          session.profilingAvailable = normalized.available;
        }
      }

      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, received }));
    })
    .catch(() => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'internal error' }));
    });
}

// Default port 7721; override with PERFONEXT_INGEST_PORT.
const _rawPort = parseInt(process.env.PERFONEXT_INGEST_PORT ?? '7721', 10);
if (!Number.isFinite(_rawPort) || _rawPort < 1 || _rawPort > 65535) {
  throw new Error(
    `PERFONEXT_INGEST_PORT must be a number between 1 and 65535 (got: "${process.env.PERFONEXT_INGEST_PORT}")`,
  );
}
const INGEST_PORT = _rawPort;

function startHttpServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(handleRequest);
    // Bind to loopback only — no external exposure.
    server.listen(INGEST_PORT, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Unexpected server address'));
        return;
      }
      httpServer = server;
      serverPort = addr.port;
      resolve(addr.port);
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `Ingest server port ${INGEST_PORT} is already in use. ` +
          'Free the port or set PERFONEXT_INGEST_PORT to a different value.',
        ));
      } else {
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createCaptureSession(): Promise<CaptureSession> {
  if (!httpServer) {
    await startHttpServer();
  }

  const sessionId = randomUUID();
  const endpoint = `http://127.0.0.1:${serverPort}/ingest/${sessionId}`;

  const session: CaptureSession = {
    sessionId,
    endpoint,
    status: 'active',
    commits: [],
    profilingAvailable: null,
    startTime: Date.now(),
    unknownEvents: 0,
  };

  sessions.set(sessionId, session);
  return session;
}

export function getCaptureSession(sessionId: string): CaptureSession | undefined {
  return sessions.get(sessionId);
}

export function stopCaptureSession(sessionId: string): CaptureSession | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  session.status = 'stopped';
  return session;
}

/** Remove a session from memory once its profile has been stored. */
export function deleteCaptureSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getServerPort(): number | null {
  return serverPort;
}
