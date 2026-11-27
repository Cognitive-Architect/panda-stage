import { SHOT_MIN_DURATION_MS } from '../constants';

export const DEFAULT_AUTO_SCENE_DURATION_MS = 3_000;
export const AUTO_SCENE_BLOCK_SEPARATOR = '---';

const CORE_SCENE_FIELDS = ['镜头', '背景', '出场', '站位', '时长', '道具'] as const;
export type AutoSceneField = (typeof CORE_SCENE_FIELDS)[number];

export type AutoSceneStancePreset =
  | 'default'
  | 'two-person-dialogue'
  | 'center'
  | 'left'
  | 'right'
  | 'spread'
  | 'match-height';

export interface SceneManualPoint {
  readonly x: number;
  readonly y: number;
}

export interface SceneStanceSpec {
  readonly raw: string;
  readonly preset: AutoSceneStancePreset;
  readonly groundYRatio?: number;
  readonly leftXRatio?: number;
  readonly rightXRatio?: number;
  readonly xRatios?: readonly number[];
  readonly matchHeight?: boolean;
  readonly namedXRatios?: Readonly<Record<string, number>>;
  readonly explicitPositions?: readonly (SceneManualPoint | undefined)[];
}

export interface SceneCastDraft {
  readonly index: number;
  readonly name: string;
  readonly expressionName?: string;
  readonly explicitPosition?: SceneManualPoint;
}

export interface ScenePropDraft {
  readonly index: number;
  readonly name: string;
  readonly explicitPosition?: SceneManualPoint;
}

export interface SceneDraftBlock {
  /** 1-based block index in the structured input. */
  readonly index: number;
  readonly shotName: string;
  readonly durationMs: number;
  readonly durationExplicit: boolean;
  /** Empty string or undefined means intentionally empty background. */
  readonly backgroundName: string | null;
  readonly cast: readonly SceneCastDraft[];
  readonly props: readonly ScenePropDraft[];
  readonly stance: SceneStanceSpec;
  /** Optional extra sections preserved for WF-04 (e.g. `对白`, `表演`). */
  readonly extraSections?: Readonly<Record<string, readonly { readonly lineNumber: number; readonly text: string }[]>>;
}

export type SceneParseErrorCode =
  | 'INVALID_INPUT'
  | 'EMPTY_INPUT'
  | 'EMPTY_BLOCK'
  | 'UNKNOWN_FIELD'
  | 'DUPLICATE_FIELD'
  | 'MISSING_FIELD'
  | 'EMPTY_FIELD'
  | 'INVALID_DURATION'
  | 'INVALID_STANCE';

export interface SceneParseIssue {
  readonly code: SceneParseErrorCode;
  readonly message: string;
  readonly blockIndex?: number;
  readonly lineNumber?: number;
  readonly field?: string;
}

export interface ParseStructuredSceneOptions {
  /**
   * Additional section labels (e.g. `['对白', '表演']` for WF-04) whose
   * subsequent lines are captured into `block.extraSections` instead of being
   * rejected as unknown fields.
   */
  readonly allowExtraSections?: readonly string[];
  /** Default shot duration in ms when `时长` is omitted. Defaults to 3000. */
  readonly defaultDurationMs?: number;
}

export interface ParseStructuredSceneResult {
  readonly ok: boolean;
  readonly blocks: readonly SceneDraftBlock[];
  readonly issues: readonly SceneParseIssue[];
}

interface SourceLine {
  readonly lineNumber: number;
  readonly text: string;
}

interface ParsedFieldLine {
  readonly label: string;
  readonly value: string;
}

const ITEM_SEPARATORS = /[、,，；;]+/u;
const NONE_TOKENS = new Set(['无', '空', '没有', 'none', 'empty', '-']);

function splitFieldLine(line: string): ParsedFieldLine | null {
  const asciiColon = line.indexOf(':');
  const fullWidthColon = line.indexOf('：');
  const separatorIndex =
    asciiColon < 0
      ? fullWidthColon
      : fullWidthColon < 0
        ? asciiColon
        : Math.min(asciiColon, fullWidthColon);
  if (separatorIndex < 0) return null;
  return {
    label: line.slice(0, separatorIndex).trim(),
    value: line.slice(separatorIndex + 1).trim(),
  };
}

function splitBlocks(rawInput: string): SourceLine[][] {
  const blocks: SourceLine[][] = [];
  let current: SourceLine[] = [];
  const lines = rawInput.replace(/\r\n?/gu, '\n').split('\n');
  for (const [lineIndex, rawLine] of lines.entries()) {
    const text = rawLine.trim();
    if (text === AUTO_SCENE_BLOCK_SEPARATOR) {
      blocks.push(current);
      current = [];
      continue;
    }
    if (!text) continue;
    current.push({ lineNumber: lineIndex + 1, text });
  }
  blocks.push(current);
  return blocks;
}

function parseExplicitCoords(raw: string): SceneManualPoint | undefined {
  const match = raw.match(/x\s*=\s*(-?\d+(?:\.\d+)?)\s*[,，\s]+\s*y\s*=\s*(-?\d+(?:\.\d+)?)/iu);
  if (!match) return undefined;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

function parseCastEntry(rawToken: string, index: number): SceneCastDraft | null {
  let token = rawToken.trim();
  if (!token) return null;

  let explicitPosition: SceneManualPoint | undefined;
  const bracketMatch = token.match(/[[【]([^\]】]+)[\]】]/u);
  if (bracketMatch) {
    explicitPosition = parseExplicitCoords(bracketMatch[1]!);
    if (explicitPosition) {
      token = token.replace(bracketMatch[0], '').trim();
    }
  }

  let expressionName: string | undefined;
  const parenMatch = token.match(/[（(]([^）)]+)[）)]$/u);
  if (parenMatch) {
    const inner = parenMatch[1]!.trim();
    const coords = parseExplicitCoords(inner);
    if (coords && !explicitPosition) {
      explicitPosition = coords;
    } else if (inner) {
      expressionName = inner;
    }
    token = token.slice(0, parenMatch.index).trim();
  } else {
    const atIndex = token.indexOf('@');
    if (atIndex > 0) {
      const expr = token.slice(atIndex + 1).trim();
      if (expr) expressionName = expr;
      token = token.slice(0, atIndex).trim();
    }
  }

  if (!token) return null;
  return {
    index,
    name: token,
    ...(expressionName ? { expressionName } : {}),
    ...(explicitPosition ? { explicitPosition } : {}),
  };
}

function parsePropEntry(rawToken: string, index: number): ScenePropDraft | null {
  let token = rawToken.trim();
  if (!token) return null;

  let explicitPosition: SceneManualPoint | undefined;
  const coordParen = token.match(/[（([【]([^）)\]】]+)[）)\]】]$/u);
  if (coordParen) {
    const coords = parseExplicitCoords(coordParen[1]!);
    if (coords) {
      explicitPosition = coords;
      token = token.slice(0, coordParen.index).trim();
    }
  }

  if (!token) return null;
  return {
    index,
    name: token,
    ...(explicitPosition ? { explicitPosition } : {}),
  };
}

function parseDurationMs(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  const msMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:ms|毫秒)$/u);
  if (msMatch) {
    const value = Math.round(Number(msMatch[1]));
    return Number.isSafeInteger(value) && value >= SHOT_MIN_DURATION_MS ? value : null;
  }

  const secMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|秒)$/u);
  if (secMatch) {
    const value = Math.round(Number(secMatch[1]) * 1_000);
    return Number.isSafeInteger(value) && value >= SHOT_MIN_DURATION_MS ? value : null;
  }

  const plainMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/u);
  if (plainMatch) {
    const num = Number(plainMatch[1]);
    if (!Number.isFinite(num) || num <= 0) return null;
    // Values >= 100 are treated as milliseconds; smaller values as seconds.
    const value = num >= 100 ? Math.round(num) : Math.round(num * 1_000);
    return Number.isSafeInteger(value) && value >= SHOT_MIN_DURATION_MS ? value : null;
  }

  return null;
}

function parseRatioToken(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === '左' || trimmed === '左侧') return 0.34;
  if (trimmed === '中' || trimmed === '居中' || trimmed === '中间') return 0.5;
  if (trimmed === '右' || trimmed === '右侧') return 0.66;
  const pctMatch = trimmed.match(/^(\d+(?:\.\d+)?)%$/u);
  if (pctMatch) {
    const val = Number(pctMatch[1]) / 100;
    return Number.isFinite(val) && val > 0 && val < 1 ? val : null;
  }
  const num = Number(trimmed);
  if (Number.isFinite(num) && num > 0 && num < 1) return num;
  return null;
}

export function parseSceneStance(raw: string | undefined): SceneStanceSpec {
  const text = (raw ?? '').trim();
  if (!text || text === '默认' || text === '站位' || text === '默认站位') {
    return { raw: text || '默认', preset: 'default' };
  }
  if (text === '双人对话' || text === '对话' || text === '双人站位') {
    return { raw: text, preset: 'two-person-dialogue' };
  }
  if (text === '居中' || text === '单人居中' || text === '中间') {
    return { raw: text, preset: 'center', xRatios: [0.5] };
  }
  if (text === '左' || text === '左侧' || text === '偏左') {
    return { raw: text, preset: 'left', xRatios: [0.34] };
  }
  if (text === '右' || text === '右侧' || text === '偏右') {
    return { raw: text, preset: 'right', xRatios: [0.66] };
  }
  if (text === '并排' || text === '均分' || text === '左中右' || text === '多人并排') {
    return { raw: text, preset: 'spread', leftXRatio: 0.22, rightXRatio: 0.78 };
  }
  if (text === '等高' || text === '等高站位') {
    return { raw: text, preset: 'match-height', matchHeight: true };
  }

  let groundYRatio: number | undefined;
  let leftXRatio: number | undefined;
  let rightXRatio: number | undefined;
  let matchHeight: boolean | undefined;
  const xRatios: number[] = [];
  const namedXRatios: Record<string, number> = {};
  const explicitPositions: (SceneManualPoint | undefined)[] = [];

  if (text.includes('等高')) {
    matchHeight = true;
  }

  // Check explicit semicolon-separated x=...,y=... coordinate list
  if (/x\s*=/iu.test(text) && /y\s*=/iu.test(text)) {
    const segments = text.split(/[;；]+/u);
    let anyCoord = false;
    for (const seg of segments) {
      const point = parseExplicitCoords(seg);
      if (point) {
        anyCoord = true;
        explicitPositions.push(point);
      }
    }
    if (anyCoord) {
      return {
        raw: text,
        preset: 'default',
        explicitPositions,
        ...(matchHeight ? { matchHeight } : {}),
      };
    }
  }

  // Parse key=value or ratio list (e.g. "左=30% 右=70% 地线=90%", "师兄=左, 小师妹=右", "25%, 50%, 75%")
  const tokens = text
    .split(/[、,，；;\s]+/u)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (token === '等高') continue;
    const eqIndex = token.indexOf('=');
    if (eqIndex > 0) {
      const key = token.slice(0, eqIndex).trim();
      const val = token.slice(eqIndex + 1).trim();
      const ratio = parseRatioToken(val);
      if (ratio !== null) {
        if (key === '地线' || key === 'ground') {
          groundYRatio = ratio;
        } else if (key === '左' || key === 'left') {
          leftXRatio = ratio;
        } else if (key === '右' || key === 'right') {
          rightXRatio = ratio;
        } else {
          namedXRatios[key] = ratio;
        }
      }
      continue;
    }
    const ratio = parseRatioToken(token);
    if (ratio !== null) {
      xRatios.push(ratio);
    }
  }

  return {
    raw: text,
    preset: 'default',
    ...(groundYRatio !== undefined ? { groundYRatio } : {}),
    ...(leftXRatio !== undefined ? { leftXRatio } : {}),
    ...(rightXRatio !== undefined ? { rightXRatio } : {}),
    ...(xRatios.length > 0 ? { xRatios } : {}),
    ...(Object.keys(namedXRatios).length > 0 ? { namedXRatios } : {}),
    ...(matchHeight ? { matchHeight } : {}),
  };
}

/**
 * Parse single-shot or multi-shot (`---` separated) Chinese structured scene text.
 * Single shot is returned as a length-1 array on the exact same pipeline.
 */
export function parseStructuredSceneBlocks(
  rawInput: string,
  options: ParseStructuredSceneOptions = {},
): ParseStructuredSceneResult {
  if (typeof rawInput !== 'string') {
    return {
      ok: false,
      blocks: [],
      issues: [{ code: 'INVALID_INPUT', message: '输入必须是文本。' }],
    };
  }

  if (!rawInput.trim()) {
    return {
      ok: false,
      blocks: [],
      issues: [{ code: 'EMPTY_INPUT', message: '请输入至少一个镜头的结构化描述。' }],
    };
  }

  const defaultDurationMs = options.defaultDurationMs ?? DEFAULT_AUTO_SCENE_DURATION_MS;
  const extraSectionNames = new Set(options.allowExtraSections ?? []);
  const rawBlocks = splitBlocks(rawInput);
  const blocks: SceneDraftBlock[] = [];
  const issues: SceneParseIssue[] = [];

  for (const [idx, lines] of rawBlocks.entries()) {
    const blockIndex = idx + 1;
    if (lines.length === 0) {
      issues.push({
        code: 'EMPTY_BLOCK',
        message: `第 ${blockIndex} 段内容为空，请移除多余的「---」分隔线或补充镜头信息。`,
        blockIndex,
      });
      continue;
    }

    const fields = new Map<AutoSceneField, { value: string; lineNumber: number }>();
    const extraSections: Record<string, { lineNumber: number; text: string }[]> = {};
    let activeExtraSection: string | null = null;
    let blockHasFatalIssue = false;

    for (const line of lines) {
      const parsed = splitFieldLine(line.text);
      if (parsed && extraSectionNames.has(parsed.label)) {
        activeExtraSection = parsed.label;
        if (!extraSections[activeExtraSection]) {
          extraSections[activeExtraSection] = [];
        }
        if (parsed.value) {
          extraSections[activeExtraSection]!.push({
            lineNumber: line.lineNumber,
            text: parsed.value,
          });
        }
        continue;
      }

      if (activeExtraSection) {
        // Stay inside active extra section unless another known core/extra section starts.
        if (parsed && CORE_SCENE_FIELDS.includes(parsed.label as AutoSceneField)) {
          activeExtraSection = null;
        } else {
          extraSections[activeExtraSection]!.push({
            lineNumber: line.lineNumber,
            text: line.text,
          });
          continue;
        }
      }

      if (!parsed) {
        issues.push({
          code: 'INVALID_INPUT',
          message: `镜头 ${blockIndex} 第 ${line.lineNumber} 行无法识别「${line.text}」，请使用「字段：值」格式。`,
          blockIndex,
          lineNumber: line.lineNumber,
        });
        blockHasFatalIssue = true;
        continue;
      }

      const field = CORE_SCENE_FIELDS.find((candidate) => candidate === parsed.label);
      if (!field) {
        issues.push({
          code: 'UNKNOWN_FIELD',
          message: `镜头 ${blockIndex} 第 ${line.lineNumber} 行不支持「${parsed.label || line.text}」字段。`,
          blockIndex,
          lineNumber: line.lineNumber,
          field: parsed.label,
        });
        blockHasFatalIssue = true;
        continue;
      }

      if (fields.has(field)) {
        issues.push({
          code: 'DUPLICATE_FIELD',
          message: `镜头 ${blockIndex} 第 ${line.lineNumber} 行重复出现「${field}」字段。`,
          blockIndex,
          lineNumber: line.lineNumber,
          field,
        });
        blockHasFatalIssue = true;
        continue;
      }

      fields.set(field, { value: parsed.value, lineNumber: line.lineNumber });
    }

    const shotField = fields.get('镜头');
    if (!shotField || !shotField.value) {
      issues.push({
        code: shotField ? 'EMPTY_FIELD' : 'MISSING_FIELD',
        message: `镜头 ${blockIndex} 缺少有效的「镜头」名称。`,
        blockIndex,
        lineNumber: shotField?.lineNumber,
        field: '镜头',
      });
      blockHasFatalIssue = true;
    }

    let durationMs = defaultDurationMs;
    let durationExplicit = false;
    const durationField = fields.get('时长');
    if (durationField && durationField.value) {
      const parsedDuration = parseDurationMs(durationField.value);
      if (parsedDuration === null) {
        issues.push({
          code: 'INVALID_DURATION',
          message: `镜头 ${blockIndex} 的「时长」无效（需 ≥ ${SHOT_MIN_DURATION_MS}ms，例如 3s 或 3000ms）。`,
          blockIndex,
          lineNumber: durationField.lineNumber,
          field: '时长',
        });
        blockHasFatalIssue = true;
      } else {
        durationMs = parsedDuration;
        durationExplicit = true;
      }
    }

    if (blockHasFatalIssue || !shotField?.value) {
      continue;
    }

    const bgRaw = fields.get('背景')?.value ?? '';
    const backgroundName =
      !bgRaw || NONE_TOKENS.has(bgRaw.toLowerCase()) ? null : bgRaw;

    const castRaw = fields.get('出场')?.value ?? '';
    const cast: SceneCastDraft[] = [];
    if (castRaw && !NONE_TOKENS.has(castRaw.toLowerCase())) {
      const rawTokens = castRaw.split(ITEM_SEPARATORS);
      for (const rawToken of rawTokens) {
        const parsedCast = parseCastEntry(rawToken, cast.length);
        if (parsedCast) cast.push(parsedCast);
      }
    }

    const propRaw = fields.get('道具')?.value ?? '';
    const props: ScenePropDraft[] = [];
    if (propRaw && !NONE_TOKENS.has(propRaw.toLowerCase())) {
      const rawTokens = propRaw.split(ITEM_SEPARATORS);
      for (const rawToken of rawTokens) {
        const parsedProp = parsePropEntry(rawToken, props.length);
        if (parsedProp) props.push(parsedProp);
      }
    }

    const stance = parseSceneStance(fields.get('站位')?.value);

    blocks.push({
      index: blockIndex,
      shotName: shotField.value,
      durationMs,
      durationExplicit,
      backgroundName,
      cast,
      props,
      stance,
      ...(Object.keys(extraSections).length > 0 ? { extraSections } : {}),
    });
  }

  return {
    ok: issues.length === 0 && blocks.length > 0,
    blocks,
    issues,
  };
}
