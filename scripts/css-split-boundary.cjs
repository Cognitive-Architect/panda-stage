'use strict';

function scanCss(value) {
  const normalized = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const sourceLines = normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n')
    : normalized.split('\n');
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let inComment = false;
  let quote = null;
  let escaped = false;
  let topLevelStatementPending = false;
  const states = [{
    braceDepth: 0,
    parenDepth: 0,
    bracketDepth: 0,
    inComment: false,
    quote: null,
    topLevelStatementPending: false,
  }];
  const errors = [];

  for (let lineNumber = 1; lineNumber <= sourceLines.length; lineNumber += 1) {
    const line = sourceLines[lineNumber - 1];
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      const next = line[index + 1];

      if (inComment) {
        if (character === '*' && next === '/') {
          inComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }
      if (character === '/' && next === '*') {
        inComment = true;
        index += 1;
        continue;
      }
      if (character === '"' || character === "'") {
        if (braceDepth === 0) topLevelStatementPending = true;
        quote = character;
        continue;
      }
      if (character === '{') {
        if (braceDepth === 0) topLevelStatementPending = true;
        braceDepth += 1;
        continue;
      }
      if (character === '}') {
        braceDepth -= 1;
        if (braceDepth < 0) errors.push(`unexpected } at line ${lineNumber}`);
        if (braceDepth === 0) topLevelStatementPending = false;
        continue;
      }
      if (character === '(') {
        parenDepth += 1;
        if (braceDepth === 0) topLevelStatementPending = true;
        continue;
      }
      if (character === ')') {
        parenDepth -= 1;
        if (parenDepth < 0) errors.push(`unexpected ) at line ${lineNumber}`);
        continue;
      }
      if (character === '[') {
        bracketDepth += 1;
        if (braceDepth === 0) topLevelStatementPending = true;
        continue;
      }
      if (character === ']') {
        bracketDepth -= 1;
        if (bracketDepth < 0) errors.push(`unexpected ] at line ${lineNumber}`);
        continue;
      }
      if (
        braceDepth === 0 &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        character === ';'
      ) {
        topLevelStatementPending = false;
        continue;
      }
      if (braceDepth === 0 && !/\s/u.test(character)) {
        topLevelStatementPending = true;
      }
    }
    states[lineNumber] = {
      braceDepth,
      parenDepth,
      bracketDepth,
      inComment,
      quote,
      topLevelStatementPending,
    };
  }

  if (inComment) errors.push('unterminated comment');
  if (quote) errors.push('unterminated string');
  if (braceDepth !== 0) errors.push(`unclosed brace depth ${braceDepth}`);
  if (parenDepth !== 0) errors.push(`unclosed parenthesis depth ${parenDepth}`);
  if (bracketDepth !== 0) errors.push(`unclosed bracket depth ${bracketDepth}`);

  return { lines: sourceLines, states, errors };
}

function isCompleteBoundary(state) {
  return Boolean(
    state &&
      state.braceDepth === 0 &&
      state.parenDepth === 0 &&
      state.bracketDepth === 0 &&
      !state.inComment &&
      !state.quote &&
      !state.topLevelStatementPending,
  );
}

module.exports = { isCompleteBoundary, scanCss };
