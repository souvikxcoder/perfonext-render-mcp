export interface RenderMeasurement {
  fiberId: number;
  rootId: number;
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
  rootId: number;
  duration: number;
  timestamp: number;
  priorityLevel: string | null;
  measurements: RenderMeasurement[];
  updaterComponentNames: string[];
}

export interface FiberNode {
  fiberId: number;
  rootId: number;
  componentName: string;
  parentFiberId: number | null;
  childFiberIds: number[];
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
  fiberNodes: FiberNode[];
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
  rootId: number;
  duration: number;
  totalActualDuration: number;
  timestamp: number;
  priorityLevel: string | null;
  measurementCount: number;
  topComponents: HotCommitComponentSummary[];
  updaterComponentNames: string[];
}

export interface CommitBreakdownComponentSummary extends HotCommitComponentSummary {
  mountCount: number;
  updateCount: number;
  nestedUpdateCount: number;
}

export interface CommitBreakdown {
  commitIndex: number;
  rootId: number;
  duration: number;
  totalActualDuration: number;
  timestamp: number;
  priorityLevel: string | null;
  measurementCount: number;
  updaterComponentNames: string[];
  topComponents: CommitBreakdownComponentSummary[];
  concentration: {
    topComponentShare: number;
    topThreeShare: number;
  };
  interpretation: string;
}

export interface RenderPropagationPath {
  commitIndex: number;
  rootId: number;
  fiberPath: number[];
  componentPath: string[];
  depth: number;
  totalActualDuration: number;
  leafActualDuration: number;
  includesUpdater: boolean;
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

export type RenderIssueType = 'rerender-storm' | 'commit-spike' | 'cascading-render';
export type RenderIssueSeverity = 'low' | 'medium' | 'high';

export interface RenderIssue {
  type: RenderIssueType;
  severity: RenderIssueSeverity;
  title: string;
  summary: string;
  componentName?: string;
  commitIndex?: number;
  evidence: RerenderEvidence[];
}

export type RenderDiffChangeType = 'regression' | 'improvement' | 'added' | 'removed';

export interface RenderDiffEntry {
  componentName: string;
  changeType: RenderDiffChangeType;
  baseTotalActualDuration: number;
  currentTotalActualDuration: number;
  totalActualDurationDelta: number;
  averageActualDurationDelta: number;
  maxActualDurationDelta: number;
  renderCountDelta: number;
  commitCountDelta: number;
  percentChange: number | null;
}

export interface RenderComparison {
  baseProfileId: string;
  currentProfileId: string;
  regressions: RenderDiffEntry[];
  improvements: RenderDiffEntry[];
  added: RenderDiffEntry[];
  removed: RenderDiffEntry[];
}
