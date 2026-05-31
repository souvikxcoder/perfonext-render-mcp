import type { ParsedRenderProfile } from './parser/types.js';

const profiles = new Map<string, ParsedRenderProfile>();

export function storeRenderProfile(profile: ParsedRenderProfile): void {
  profiles.set(profile.id, profile);
}

export function getRenderProfile(id: string): ParsedRenderProfile | undefined {
  return profiles.get(id);
}

export function listRenderProfiles(): Array<{
  id: string;
  filename: string;
  commitCount: number;
  componentCount: number;
  totalCommitDuration: number;
}> {
  return Array.from(profiles.values()).map(profile => ({
    id: profile.id,
    filename: profile.filename,
    commitCount: profile.commits.length,
    componentCount: profile.components.length,
    totalCommitDuration: profile.totalCommitDuration,
  }));
}
