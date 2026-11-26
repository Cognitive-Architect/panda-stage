/**
 * Pure static analyzer for deterministic MovieClip frame-entry `stop()` scripts.
 *
 * Security & scope invariants:
 *  - Never executes or evaluates ActionScript.
 *  - Only recognizes simple, unconditional frame-entry `stop()` / `this.stop()`
 *    and clearly harmless statements (empty, comments, literal `trace(...)`).
 *  - Comments, string literals, uncalled function/callback bodies, other-object
 *    calls (`other.stop()`), conditional branches, jumps (`gotoAndStop`, etc.),
 *    and mixed/unknown scripts never produce a deterministic stop-frame match
 *    and instead trigger conservative local fallback.
 */

export type MovieClipFrameScriptClassification = 'harmless' | 'stop' | 'unsupported';

export type MovieClipSymbolScriptAnalysis =
  | { readonly kind: 'none' }
  | { readonly kind: 'stop-frames'; readonly stopFrames: readonly number[] }
  | { readonly kind: 'unsupported' };

interface ScriptToken {
  readonly kind: 'ident' | 'string' | 'number' | 'punct';
  readonly value: string;
  readonly line: number;
}

const MAX_SCRIPT_LENGTH = 65_536;

function isIdentStart(code: number): boolean {
  return (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 || // _
    code === 36; // $
}

function isIdentPart(code: number): boolean {
  return isIdentStart(code) || (code >= 48 && code <= 57);
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isHexDigit(code: number): boolean {
  return isDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

function tokenizeFrameScript(source: string): readonly ScriptToken[] | null {
  if (source.length > MAX_SCRIPT_LENGTH) return null;
  const tokens: ScriptToken[] = [];
  let i = 0;
  let line = 1;

  while (i < source.length) {
    const ch = source[i]!;
    const code = source.charCodeAt(i);

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v' || ch === '\uFEFF') {
      i += 1;
      continue;
    }
    if (ch === '\r') {
      line += 1;
      i += source[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      line += 1;
      i += 1;
      continue;
    }

    // Comments
    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      let closed = false;
      while (i + 1 < source.length) {
        if (source[i] === '*' && source[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        if (source[i] === '\n') line += 1;
        else if (source[i] === '\r') {
          line += 1;
          if (source[i + 1] === '\n') i += 1;
        }
        i += 1;
      }
      if (!closed) return null;
      continue;
    }

    // String literals
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      const startLine = line;
      i += 1;
      let closed = false;
      while (i < source.length) {
        const cur = source[i]!;
        if (cur === '\\') {
          if (i + 1 >= source.length) return null;
          if (source[i + 1] === '\n') line += 1;
          else if (source[i + 1] === '\r') {
            line += 1;
            if (source[i + 2] === '\n') i += 1;
          }
          i += 2;
          continue;
        }
        if (cur === quote) {
          i += 1;
          closed = true;
          break;
        }
        if (cur === '\n' || cur === '\r') return null;
        i += 1;
      }
      if (!closed) return null;
      tokens.push({ kind: 'string', value: source.slice(start, i), line: startLine });
      continue;
    }

    // Number literals (decimal, float, hex)
    if (isDigit(code) || (ch === '.' && i + 1 < source.length && isDigit(source.charCodeAt(i + 1)))) {
      const start = i;
      if (ch === '0' && (source[i + 1] === 'x' || source[i + 1] === 'X')) {
        i += 2;
        if (i >= source.length || !isHexDigit(source.charCodeAt(i))) return null;
        while (i < source.length && isHexDigit(source.charCodeAt(i))) i += 1;
      } else {
        while (i < source.length && isDigit(source.charCodeAt(i))) i += 1;
        if (source[i] === '.') {
          i += 1;
          while (i < source.length && isDigit(source.charCodeAt(i))) i += 1;
        }
        if (source[i] === 'e' || source[i] === 'E') {
          i += 1;
          if (source[i] === '+' || source[i] === '-') i += 1;
          if (i >= source.length || !isDigit(source.charCodeAt(i))) return null;
          while (i < source.length && isDigit(source.charCodeAt(i))) i += 1;
        }
      }
      // Reject malformed number-ident adjacency such as `123abc`
      if (i < source.length && isIdentStart(source.charCodeAt(i))) return null;
      tokens.push({ kind: 'number', value: source.slice(start, i), line });
      continue;
    }

    // Identifiers and keywords
    if (isIdentStart(code)) {
      const start = i;
      i += 1;
      while (i < source.length && isIdentPart(source.charCodeAt(i))) i += 1;
      tokens.push({ kind: 'ident', value: source.slice(start, i), line });
      continue;
    }

    // Allowed punctuation for the static allowlist grammar
    if (
      ch === ';' ||
      ch === '(' ||
      ch === ')' ||
      ch === '.' ||
      ch === ',' ||
      ch === '+' ||
      ch === '-'
    ) {
      tokens.push({ kind: 'punct', value: ch, line });
      i += 1;
      continue;
    }

    // Any other token (`{`, `}`, `[`, `]`, `=`, `?`, `&`, `|`, `!`, etc.)
    // cannot appear in our strictly allowlisted unconditional-stop / literal-trace grammar.
    return null;
  }

  return tokens;
}

const LITERAL_KEYWORDS = new Set(['true', 'false', 'null', 'undefined']);

function consumeLiteralAtom(tokens: readonly ScriptToken[], start: number): number | null {
  const token = tokens[start];
  if (!token) return null;
  if (token.kind === 'string' || token.kind === 'number') return start + 1;
  if (token.kind === 'ident' && LITERAL_KEYWORDS.has(token.value)) return start + 1;
  if (token.kind === 'punct' && (token.value === '+' || token.value === '-')) {
    const next = tokens[start + 1];
    if (next && next.kind === 'number') return start + 2;
  }
  return null;
}

function consumeLiteralExpression(tokens: readonly ScriptToken[], start: number): number | null {
  let cursor = consumeLiteralAtom(tokens, start);
  if (cursor === null) return null;
  while (cursor < tokens.length) {
    const op = tokens[cursor];
    if (!op || op.kind !== 'punct' || op.value !== '+') break;
    const next = consumeLiteralAtom(tokens, cursor + 1);
    if (next === null) return null;
    cursor = next;
  }
  return cursor;
}

function hasStatementBoundary(tokens: readonly ScriptToken[], afterCallIndex: number, callEndLine: number): number | null {
  const next = tokens[afterCallIndex];
  if (!next) return afterCallIndex;
  if (next.kind === 'punct' && next.value === ';') return afterCallIndex + 1;
  // Automatic semicolon insertion across a line break only when the next token
  // cannot continue the previous call expression (not `.`, `(`, `+`, `-`, `,`).
  if (next.line > callEndLine && next.kind === 'ident') {
    return afterCallIndex;
  }
  return null;
}

/**
 * Classifies a single frame's ActionScript text without executing it.
 */
export function analyzeMovieClipFrameScript(source: string): MovieClipFrameScriptClassification {
  const tokens = tokenizeFrameScript(source);
  if (!tokens) return 'unsupported';
  if (tokens.length === 0) return 'harmless';

  let cursor = 0;
  let sawSelfStop = false;

  while (cursor < tokens.length) {
    const token = tokens[cursor]!;

    // Empty statement `;`
    if (token.kind === 'punct' && token.value === ';') {
      cursor += 1;
      continue;
    }

    // Unconditional `stop()`
    if (
      token.kind === 'ident' &&
      token.value === 'stop' &&
      tokens[cursor + 1]?.kind === 'punct' &&
      tokens[cursor + 1]?.value === '(' &&
      tokens[cursor + 2]?.kind === 'punct' &&
      tokens[cursor + 2]?.value === ')'
    ) {
      const next = hasStatementBoundary(tokens, cursor + 3, tokens[cursor + 2]!.line);
      if (next === null) return 'unsupported';
      sawSelfStop = true;
      cursor = next;
      continue;
    }

    // Unconditional `this.stop()`
    if (
      token.kind === 'ident' &&
      token.value === 'this' &&
      tokens[cursor + 1]?.kind === 'punct' &&
      tokens[cursor + 1]?.value === '.' &&
      tokens[cursor + 2]?.kind === 'ident' &&
      tokens[cursor + 2]?.value === 'stop' &&
      tokens[cursor + 3]?.kind === 'punct' &&
      tokens[cursor + 3]?.value === '(' &&
      tokens[cursor + 4]?.kind === 'punct' &&
      tokens[cursor + 4]?.value === ')'
    ) {
      const next = hasStatementBoundary(tokens, cursor + 5, tokens[cursor + 4]!.line);
      if (next === null) return 'unsupported';
      sawSelfStop = true;
      cursor = next;
      continue;
    }

    // Harmless literal `trace(...)`
    if (
      token.kind === 'ident' &&
      token.value === 'trace' &&
      tokens[cursor + 1]?.kind === 'punct' &&
      tokens[cursor + 1]?.value === '('
    ) {
      let argCursor = cursor + 2;
      if (!(tokens[argCursor]?.kind === 'punct' && tokens[argCursor]?.value === ')')) {
        for (;;) {
          const afterExpr = consumeLiteralExpression(tokens, argCursor);
          if (afterExpr === null) return 'unsupported';
          argCursor = afterExpr;
          const sep = tokens[argCursor];
          if (sep?.kind === 'punct' && sep.value === ',') {
            argCursor += 1;
            continue;
          }
          break;
        }
      }
      const closeParen = tokens[argCursor];
      if (!closeParen || closeParen.kind !== 'punct' || closeParen.value !== ')') {
        return 'unsupported';
      }
      const next = hasStatementBoundary(tokens, argCursor + 1, closeParen.line);
      if (next === null) return 'unsupported';
      cursor = next;
      continue;
    }

    return 'unsupported';
  }

  return sawSelfStop ? 'stop' : 'harmless';
}

function decodeXmlText(value: string): string {
  return value.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|quot|apos|amp));/giu, (match, hex?: string, decimal?: string, named?: string) => {
    if (hex !== undefined) {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    if (decimal !== undefined) {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    switch (named?.toLowerCase()) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      case 'amp': return '&';
      default: return match;
    }
  });
}

/**
 * Extracts raw script source text from a `<script>...</script>` XFL element block.
 * Returns `null` if the block is malformed (e.g. unclosed CDATA or unexpected nested tags).
 */
export function extractFlaXflScriptText(scriptElementXml: string): string | null {
  const openEnd = scriptElementXml.indexOf('>');
  if (openEnd < 0) return null;
  if (scriptElementXml[openEnd - 1] === '/') return '';
  const closeStart = scriptElementXml.lastIndexOf('</');
  if (closeStart < openEnd) return null;
  const inner = scriptElementXml.slice(openEnd + 1, closeStart);

  let out = '';
  let cursor = 0;
  while (cursor < inner.length) {
    const nextLt = inner.indexOf('<', cursor);
    if (nextLt < 0) {
      out += decodeXmlText(inner.slice(cursor));
      break;
    }
    if (nextLt > cursor) {
      out += decodeXmlText(inner.slice(cursor, nextLt));
    }
    if (inner.startsWith('<![CDATA[', nextLt)) {
      const cdataEnd = inner.indexOf(']]>', nextLt + 9);
      if (cdataEnd < 0) return null;
      out += inner.slice(nextLt + 9, cdataEnd);
      cursor = cdataEnd + 3;
      continue;
    }
    if (inner.startsWith('<!--', nextLt)) {
      const commentEnd = inner.indexOf('-->', nextLt + 4);
      if (commentEnd < 0) return null;
      cursor = commentEnd + 3;
      continue;
    }
    return null;
  }
  return out;
}

/**
 * Computes the MovieClip frame index for a given non-negative instance `age`,
 * honoring deterministic stop frames when present.
 */
export function resolveMovieClipPlayheadFrame(
  age: number,
  frameCount: number,
  stopFrames?: readonly number[],
): number {
  const safeFrameCount = Math.max(1, frameCount);
  const safeAge = Math.max(0, age);
  const firstStop = stopFrames?.[0];
  if (firstStop !== undefined && firstStop >= 0 && firstStop < safeFrameCount) {
    return Math.min(safeAge, firstStop);
  }
  return safeAge % safeFrameCount;
}
