import type {
  ChannelMappingEntry,
  Cue,
  LightingPlan,
  MappingIssue,
  Scene,
  UserRole,
  VenueMapping,
  VenueMappingCounts
} from './types';

export const DMX_UNIVERSE_SIZE = 512;

export const mappingKindLabels: Record<MappingIssue['kind'], string> = {
  unmapped: '未映射',
  'duplicate-target': '重复占用',
  'address-overflow': '超出宇宙 512 路'
};

export const mappingExampleCsv = `原通道,新通道,宇宙,地址,备注
Grand Master,Master,1,1,新场总控
Cyc 1,Cyc A,1,10,天幕冷色
FOH L 3,Foh L,1,24,左侧耳光
FOH 1-4,Foh Front,1,30,正面光四合一
FOH 1-2,Foh Front,1,30,定点复用正面光
Beam 2,Beam Bar,1,512,边界地址
Side 5,Side Wash,2,520,侧光（地址越界演示）
Dance 1-6,Wash Head,1,24,与 FOH L 3 撞地址`;

function emptyCounts(): VenueMappingCounts {
  return {
    total: 0,
    blocking: 0,
    unmapped: 0,
    duplicateTarget: 0,
    addressOverflow: 0,
    inFrozenScene: 0,
    mappedCues: 0,
    cuesInFrozenScenes: 0
  };
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

interface ParsedMapping {
  entries: ChannelMappingEntry[];
  warnings: string[];
}

/**
 * 解析控台给的通道映射文本：
 * - JSON：映射数组，字段支持中英文（sourceChannel/targetChannel/dmxUniverse/dmxAddress）
 * - CSV/TSV：表头需包含“原/新通道”列，可附 宇宙、地址、备注 列
 */
export function parseMappingText(raw: string): ParsedMapping {
  const text = raw.trim();
  if (!text) return { entries: [], warnings: ['映射内容为空'] };

  if (text.startsWith('[') || text.startsWith('{')) {
    return parseJsonMapping(text);
  }
  return parseDelimitedMapping(text);
}

function parseJsonMapping(text: string): ParsedMapping {
  const warnings: string[] = [];
  const data = JSON.parse(text) as unknown;
  const rows = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { entries?: unknown }).entries)
      ? ((data as { entries: unknown[] }).entries)
      : null;
  if (!rows) throw new Error('JSON 需要是映射数组，或包含 entries 数组的对象');

  const entries: ChannelMappingEntry[] = [];
  rows.forEach((row, index) => {
    if (typeof row !== 'object' || row === null) {
      warnings.push(`第 ${index + 1} 行不是有效对象，已跳过`);
      return;
    }
    const record = row as Record<string, unknown>;
    const source = normalize(String(record.sourceChannel ?? record['原通道'] ?? ''));
    const target = normalize(String(record.targetChannel ?? record['新通道'] ?? ''));
    if (!source || !target) {
      warnings.push(`第 ${index + 1} 行缺少原通道或新通道，已跳过`);
      return;
    }
    const entry: ChannelMappingEntry = { sourceChannel: source, targetChannel: target };
    const universe = readNumber(record.dmxUniverse ?? record['宇宙']);
    const address = readNumber(record.dmxAddress ?? record['地址']);
    if (universe !== undefined) entry.dmxUniverse = universe;
    if (address !== undefined) entry.dmxAddress = address;
    const note = normalize(String(record.note ?? record['备注'] ?? ''));
    if (note) entry.note = note;
    entries.push(entry);
  });

  return { entries: mergeDuplicateSources(entries, warnings), warnings };
}

function parseDelimitedMapping(text: string): ParsedMapping {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('至少需要表头行和一行映射');

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const header = splitCsvLine(lines[0], delimiter).map((cell) => normalize(cell).toLowerCase());
  const sourceIndex = header.findIndex((cell) => cell.includes('原') || cell.toLowerCase().includes('source'));
  const targetIndex = header.findIndex((cell) => cell.includes('新') || cell.toLowerCase().includes('target'));
  if (sourceIndex < 0 || targetIndex < 0) {
    throw new Error('表头需包含“原通道”和“新通道”两列');
  }
  const universeIndex = header.findIndex((cell) => cell.includes('宇宙') || cell.includes('universe'));
  const addressIndex = header.findIndex((cell) => cell.includes('地址') || cell.includes('address'));
  const noteIndex = header.findIndex((cell) => cell.includes('备注') || cell.includes('note'));

  const entries: ChannelMappingEntry[] = [];
  lines.slice(1).forEach((line, rowIndex) => {
    const cells = splitCsvLine(line, delimiter);
    const source = normalize(cells[sourceIndex] ?? '');
    const target = normalize(cells[targetIndex] ?? '');
    if (!source || !target) {
      warnings.push(`第 ${rowIndex + 2} 行缺少原通道或新通道，已跳过`);
      return;
    }
    const entry: ChannelMappingEntry = { sourceChannel: source, targetChannel: target };
    if (universeIndex >= 0) {
      const value = readNumber(cells[universeIndex]);
      if (value !== undefined) entry.dmxUniverse = value;
    }
    if (addressIndex >= 0) {
      const value = readNumber(cells[addressIndex]);
      if (value !== undefined) entry.dmxAddress = value;
    }
    if (noteIndex >= 0) {
      const note = normalize(cells[noteIndex] ?? '');
      if (note) entry.note = note;
    }
    entries.push(entry);
  });

  return { entries: mergeDuplicateSources(entries, warnings), warnings };
}

function splitCsvLine(line: string, delimiter: string) {
  if (delimiter === '\t') return line.split('\t').map((cell) => cell.trim());
  const result: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function readNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

/** 同一原通道出现多次时，以最后一条为准（控台常用后写覆盖） */
function mergeDuplicateSources(entries: ChannelMappingEntry[], warnings: string[]) {
  const bySource = new Map<string, ChannelMappingEntry>();
  for (const entry of entries) {
    if (bySource.has(entry.sourceChannel)) {
      warnings.push(`原通道 ${entry.sourceChannel} 出现多条映射，已采用最后一条`);
    }
    bySource.set(entry.sourceChannel, entry);
  }
  return [...bySource.values()];
}

interface Occupancy {
  key: string;
  entry: ChannelMappingEntry;
  cue: Cue;
  scene: Scene;
}

/**
 * 对导入的映射做对账分析，不改动任何提示：
 * - 未映射：提示原通道在映射表中找不到
 * - 重复占用：同一场次内，多个不同原通道映射到同一新通道，或同一宇宙同一地址
 * - 超出 512 路：地址超出 1–512，或宇宙号小于 1
 */
export function analyzeVenueMapping(plan: LightingPlan, entries: ChannelMappingEntry[]): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const mapping = new Map(entries.map((entry) => [entry.sourceChannel, entry]));

  for (const scene of plan.scenes) {
    const byChannelName = new Map<string, Occupancy[]>();
    const byDmxSlot = new Map<string, Occupancy[]>();

    for (const cue of scene.cues) {
      const source = cue.channel.trim();
      const entry = source ? mapping.get(source) : undefined;

      if (!entry) {
        issues.push({
          id: `${plan.id}-${scene.id}-${cue.id}-unmapped`,
          kind: 'unmapped',
          sceneId: scene.id,
          sceneName: scene.name,
          cueId: cue.id,
          cueNumber: cue.number,
          cueLabel: cue.label,
          sourceChannel: source || '（空通道）',
          targetChannel: '',
          sceneFrozen: scene.frozen,
          message: source
            ? `${cue.number}「${cue.label}」原通道 ${source} 在新场馆映射表中未映射`
            : `${cue.number}「${cue.label}」缺少通道，无法参与换台映射`
        });
        continue;
      }

      const overflow =
        entry.dmxAddress !== undefined &&
        (entry.dmxAddress < 1 || entry.dmxAddress > DMX_UNIVERSE_SIZE || !Number.isInteger(entry.dmxAddress));
      const universeOverflow =
        entry.dmxUniverse !== undefined && (entry.dmxUniverse < 1 || !Number.isInteger(entry.dmxUniverse));
      if (overflow || universeOverflow) {
        issues.push({
          id: `${plan.id}-${scene.id}-${cue.id}-overflow`,
          kind: 'address-overflow',
          sceneId: scene.id,
          sceneName: scene.name,
          cueId: cue.id,
          cueNumber: cue.number,
          cueLabel: cue.label,
          sourceChannel: entry.sourceChannel,
          targetChannel: entry.targetChannel,
          dmxUniverse: entry.dmxUniverse,
          dmxAddress: entry.dmxAddress,
          sceneFrozen: scene.frozen,
          message: overflow
            ? `${cue.number}「${cue.label}」映射到 ${entry.targetChannel} 的地址 ${entry.dmxAddress} 超出每宇宙 1–${DMX_UNIVERSE_SIZE} 路`
            : `${cue.number}「${cue.label}」映射到 ${entry.targetChannel} 的宇宙号 ${entry.dmxUniverse} 无效`
        });
      }

      const occupancy: Occupancy = { entry, cue, scene, key: entry.targetChannel };
      byChannelName.set(entry.targetChannel, [...(byChannelName.get(entry.targetChannel) ?? []), occupancy]);
      if (entry.dmxUniverse !== undefined && entry.dmxAddress !== undefined) {
        const slotKey = `${entry.dmxUniverse}:${entry.dmxAddress}`;
        byDmxSlot.set(slotKey, [...(byDmxSlot.get(slotKey) ?? []), occupancy]);
      }
    }

    collectDuplicateIssues(plan, scene, byChannelName, issues, 'channel');
    collectDuplicateIssues(plan, scene, byDmxSlot, issues, 'dmx');
  }

  return issues;
}

function collectDuplicateIssues(
  plan: LightingPlan,
  scene: Scene,
  groups: Map<string, Occupancy[]>,
  issues: MappingIssue[],
  mode: 'channel' | 'dmx'
) {
  for (const [key, occupancies] of groups) {
    const distinctSources = new Set(occupancies.map((item) => item.entry.sourceChannel));
    if (occupancies.length < 2 || distinctSources.size < 2) continue;
    // 只对“后来者”报问题，第一个占用者作为基准
    occupancies.slice(1).forEach((occupancy) => {
      const first = occupancies[0];
      const location =
        mode === 'dmx' ? `宇宙 ${key.replace(':', ' / 地址 ')}` : `新通道 ${key}`;
      issues.push({
        id: `${plan.id}-${scene.id}-${occupancy.cue.id}-${mode === 'dmx' ? 'dmxdup' : 'chdup'}`,
        kind: 'duplicate-target',
        sceneId: scene.id,
        sceneName: scene.name,
        cueId: occupancy.cue.id,
        cueNumber: occupancy.cue.number,
        cueLabel: occupancy.cue.label,
        sourceChannel: occupancy.entry.sourceChannel,
        targetChannel: occupancy.entry.targetChannel,
        dmxUniverse: occupancy.entry.dmxUniverse,
        dmxAddress: occupancy.entry.dmxAddress,
        sceneFrozen: scene.frozen,
        message:
          mode === 'dmx'
            ? `${occupancy.cue.number}「${occupancy.cue.label}」与 ${first.cue.number}「${first.cue.label}」重复占用 ${location}（${occupancy.entry.sourceChannel} 与 ${first.entry.sourceChannel} 映射到同一地址）`
            : `${occupancy.cue.number}「${occupancy.cue.label}」与 ${first.cue.number}「${first.cue.label}」在「${scene.name}」重复占用 ${location}`
      });
    });
  }
}

export function summarizeIssues(plan: LightingPlan, issues: MappingIssue[]): VenueMappingCounts {
  const counts = emptyCounts();
  counts.total = issues.length;
  counts.unmapped = issues.filter((issue) => issue.kind === 'unmapped').length;
  counts.duplicateTarget = issues.filter((issue) => issue.kind === 'duplicate-target').length;
  counts.addressOverflow = issues.filter((issue) => issue.kind === 'address-overflow').length;
  counts.inFrozenScene = issues.filter((issue) => issue.sceneFrozen).length;
  counts.blocking = issues.filter((issue) => !issue.sceneFrozen).length;

  const mapping = new Map((plan.venueMapping?.entries ?? []).map((entry) => [entry.sourceChannel, entry]));
  for (const scene of plan.scenes) {
    counts.cuesInFrozenScenes += scene.frozen ? scene.cues.length : 0;
    if (scene.frozen) continue;
    counts.mappedCues += scene.cues.filter((cue) => mapping.has(cue.channel.trim())).length;
  }
  return counts;
}

/** 舞台监督确认后应用：只改写未冻结场次的通道，随后由 reducer 重算时间与冲突 */
export function applyVenueMappingToPlan(
  plan: LightingPlan,
  entries: ChannelMappingEntry[],
  options: { venueName: string; source: VenueMapping['source']; role: UserRole }
) {
  // 改写前先做快照：冻结场次的待处理项在应用后仍需保留
  const frozenIssues = analyzeVenueMapping(plan, entries).filter((issue) => issue.sceneFrozen);
  const mapping = new Map(entries.map((entry) => [entry.sourceChannel, entry]));
  let mappedCueCount = 0;
  let skippedFrozenCueCount = 0;

  for (const scene of plan.scenes) {
    for (const cue of scene.cues) {
      if (scene.frozen) {
        if (mapping.has(cue.channel.trim())) skippedFrozenCueCount += 1;
        continue;
      }
      const entry = mapping.get(cue.channel.trim());
      if (entry) {
        cue.channel = entry.targetChannel;
        mappedCueCount += 1;
      }
    }
  }

  const previous = plan.venueMapping;
  const counts: VenueMappingCounts = {
    total: frozenIssues.length,
    blocking: 0,
    unmapped: frozenIssues.filter((issue) => issue.kind === 'unmapped').length,
    duplicateTarget: frozenIssues.filter((issue) => issue.kind === 'duplicate-target').length,
    addressOverflow: frozenIssues.filter((issue) => issue.kind === 'address-overflow').length,
    inFrozenScene: frozenIssues.length,
    mappedCues: mappedCueCount,
    cuesInFrozenScenes: plan.scenes.reduce((sum, scene) => sum + (scene.frozen ? scene.cues.length : 0), 0)
  };
  plan.venueMapping = {
    venueName: options.venueName.trim() || '未命名巡演场馆',
    importedAt: previous?.importedAt ?? new Date().toISOString(),
    status: 'applied',
    source: options.source,
    entries: structuredClone(entries),
    parseWarnings: previous?.parseWarnings ?? [],
    counts,
    applyResult: {
      appliedAt: new Date().toISOString(),
      appliedBy: options.role,
      venueName: options.venueName.trim() || '未命名巡演场馆',
      mappedCueCount,
      skippedFrozenCueCount
    }
  };
  return plan.venueMapping.applyResult!;
}

export function draftVenueMapping(
  plan: LightingPlan,
  entries: ChannelMappingEntry[],
  options: { venueName: string; source: VenueMapping['source']; warnings?: string[] }
): VenueMapping {
  const issues = analyzeVenueMapping(plan, entries);
  return {
    venueName: options.venueName.trim() || '未命名巡演场馆',
    importedAt: new Date().toISOString(),
    status: 'draft',
    source: options.source,
    entries: structuredClone(entries),
    parseWarnings: options.warnings ?? [],
    counts: summarizeIssues(plan, issues)
  };
}
