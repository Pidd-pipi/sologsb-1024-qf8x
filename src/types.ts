export type CueStatus = 'draft' | 'ready' | 'confirmed';
export type UserRole = 'designer' | 'programmer' | 'stage-manager' | 'readonly';
export type ConflictSeverity = 'error' | 'warning';
export type MappingIssueKind = 'unmapped' | 'duplicate-target' | 'address-overflow';
export type VenueMappingStatus = 'draft' | 'applied';

export interface Cue {
  id: string;
  number: string;
  label: string;
  position: string;
  channel: string;
  color: string;
  colorHex: string;
  brightness: number;
  fadeIn: number;
  hold: number;
  fadeOut: number;
  followCueId: string;
  targetNote: string;
  notes: string;
  status: CueStatus;
  startTime?: number;
  duration?: number;
  endTime?: number;
}

export interface Scene {
  id: string;
  name: string;
  order: number;
  frozen: boolean;
  startTime?: number;
  duration?: number;
  cues: Cue[];
}

export interface LightingPlan {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  scenes: Scene[];
  venueMapping?: VenueMapping;
}

/** 一条换台通道映射：原场馆灯号 → 新场馆通道（可附 DMX 宇宙/地址） */
export interface ChannelMappingEntry {
  sourceChannel: string;
  targetChannel: string;
  dmxUniverse?: number;
  dmxAddress?: number;
  note?: string;
}

/** 换台对账待处理项（未确认前只做标注，不改动当前提示） */
export interface MappingIssue {
  id: string;
  kind: MappingIssueKind;
  sceneId: string;
  sceneName: string;
  cueId: string;
  cueNumber: string;
  cueLabel: string;
  sourceChannel: string;
  targetChannel: string;
  dmxUniverse?: number;
  dmxAddress?: number;
  /** 命中提示的场次是否已冻结：冻结场次的待处理项不阻塞确认，应用时跳过 */
  sceneFrozen: boolean;
  message: string;
}

export interface VenueMappingCounts {
  total: number;
  /** 未冻结场次上的待处理项；> 0 时无法确认应用 */
  blocking: number;
  unmapped: number;
  duplicateTarget: number;
  addressOverflow: number;
  /** 命中已冻结场次的待处理项（仅提示，不阻塞，应用时保留原通道） */
  inFrozenScene: number;
  mappedCues: number;
  cuesInFrozenScenes: number;
}

export interface MappingApplyResult {
  appliedAt: string;
  appliedBy: UserRole;
  venueName: string;
  /** 实际改写通道的提示数（未冻结场次） */
  mappedCueCount: number;
  /** 因场次冻结而保留原通道的提示数 */
  skippedFrozenCueCount: number;
}

/** 换台对账记录，随方案草稿保存 */
export interface VenueMapping {
  venueName: string;
  importedAt: string;
  status: VenueMappingStatus;
  source: 'csv' | 'json' | 'example';
  entries: ChannelMappingEntry[];
  /** 导入时的解析备注（重复行覆盖等） */
  parseWarnings: string[];
  counts: VenueMappingCounts;
  applyResult?: MappingApplyResult;
}

export interface CueConflict {
  id: string;
  planId: string;
  cueId: string;
  sceneId: string;
  severity: ConflictSeverity;
  type: 'channel-overlap' | 'follow-order' | 'missing-data' | 'duplicate-position' | 'duration';
  message: string;
}

export interface Workspace {
  plans: LightingPlan[];
  activePlanId: string;
  comparePlanId: string;
  selectedSceneId: string;
  selectedCueId: string;
  role: UserRole;
}

export interface EditorState {
  workspace: Workspace;
  past: Workspace[];
  future: Workspace[];
  lastAction: string;
}

export interface PersistedState {
  workspace: Workspace;
}
