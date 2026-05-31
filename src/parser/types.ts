export interface RenderMeasurement {
  componentName: string;
  phase: string;
  actualDuration: number;
  selfDuration: number;
  startTime: number;
  commitTime: number;
  renderCount: number;
  commitIndex: number;
  isNestedUpdate: boolean;
}

export interface RenderCommit {
  index: number;
  duration: number;
  timestamp: number;
  priorityLevel: string | null;
  measurements: RenderMeasurement[];
  updaterComponentNames: string[];
}

export interface ComponentStats {
  componentName: string;
  renderCount: number;
  mountCount: number;
  updateCount: number;
  nestedUpdateCount: number;
  totalActualDuration: number;
  totalSelfDuration: number;
  maxActualDuration: number;
  commitIndices: number[];
}

export interface ParsedRenderProfile {
  id: string;
  filename: string;
  version: string;
  rendererId: number | null;
  commits: RenderCommit[];
  components: ComponentStats[];
  totalCommitDuration: number;
  totalRenderDuration: number;
}

export interface RenderSummaryEntry {
  componentName: string;
  renderCount: number;
  mountCount: number;
  updateCount: number;
  nestedUpdateCount: number;
  totalActualDuration: number;
  averageActualDuration: number;
  maxActualDuration: number;
  commitCount: number;
}

export interface HotCommitComponentSummary {
  componentName: string;
  actualDuration: number;
  selfDuration: number;
  renderCount: number;
  shareOfCommitWork: number;
}

export interface HotCommitSummary {
  commitIndex: number;
  duration: number;
  totalActualDuration: number;
  timestamp: number;
  priorityLevel: string | null;
  measurementCount: number;
  topComponents: HotCommitComponentSummary[];
  updaterComponentNames: string[];
}

export interface RerenderEvidence {
  signal: string;
  observed: number | string;
  threshold: number | string;
  detail: string;
}

export type RerenderConfidence = 'low' | 'medium' | 'high';
export type RerenderScoreBand = 'low' | 'medium' | 'high';

export interface RerenderCause {
  componentName: string;
  renderCount: number;
  updateCount: number;
  nestedUpdateCount: number;
  totalActualDuration: number;
  score: number;
  scoreBand: RerenderScoreBand;
  confidence: RerenderConfidence;
  evidence: RerenderEvidence[];
  likelyCauses: string[];
}
