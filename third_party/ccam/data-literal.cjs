/** Adapted from Son Nguyen, CCAM task-progress.js lines 98-207; MIT. Commit 3cb22ae4a4e2ca31145351e1d73e05d0ff41f2dc. Added depth/input bounds. */
function parseDataLiteral(source, startIndex) {
  if (source.length > 1048576) throw new Error('input limit');
  let index = startIndex, depth = 0;

  function skipWhitespace() {
    while (index < source.length && /\s/.test(source[index])) index++;
  }

  function parseString() {
    const quote = source[index++];
    let value = "";
    while (index < source.length) {
      const character = source[index++];
      if (character === quote) return value;
      if (character !== "\\") {
        value += character;
        continue;
      }
      if (index >= source.length) throw new Error("unterminated escape");
      const escaped = source[index++];
      const escapes = {
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
        0: "\0",
      };
      if (escaped === "u") {
        const hex = source.slice(index, index + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("invalid unicode escape");
        value += String.fromCharCode(parseInt(hex, 16));
        index += 4;
      } else {
        value += escapes[escaped] ?? escaped;
      }
    }
    throw new Error("unterminated string");
  }

  function parseIdentifier() {
    const match = source.slice(index).match(/^[A-Za-z_$][\w$]*/);
    if (!match) throw new Error("expected identifier");
    index += match[0].length;
    return match[0];
  }

  function parseValue() {
    if (++depth > 32) throw new Error('depth limit');
    try {
    skipWhitespace();
    const character = source[index];
    if (character === '"' || character === "'") return parseString();
    if (character === "{") return parseObject();
    if (character === "[") return parseArray();
    const numberMatch = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (numberMatch) {
      index += numberMatch[0].length;
      return Number(numberMatch[0]);
    }
    const identifier = parseIdentifier();
    if (identifier === "true") return true;
    if (identifier === "false") return false;
    if (identifier === "null") return null;
    throw new Error("unsupported literal");
    } finally { depth--; }
  }

  function parseObject() {
    const object = Object.create(null);
    index++;
    skipWhitespace();
    while (source[index] !== "}") {
      const key =
        source[index] === '"' || source[index] === "'" ? parseString() : parseIdentifier();
      skipWhitespace();
      if (source[index++] !== ":") throw new Error("expected colon");
      object[key] = parseValue();
      skipWhitespace();
      if (source[index] === ",") {
        index++;
        skipWhitespace();
        if (source[index] === "}") break;
        continue;
      }
      if (source[index] !== "}") throw new Error("expected object separator");
    }
    if (source[index++] !== "}") throw new Error("unterminated object");
    return object;
  }

  function parseArray() {
    const array = [];
    index++;
    skipWhitespace();
    while (source[index] !== "]") {
      array.push(parseValue());
      skipWhitespace();
      if (source[index] === ",") {
        index++;
        skipWhitespace();
        if (source[index] === "]") break;
        continue;
      }
      if (source[index] !== "]") throw new Error("expected array separator");
    }
    if (source[index++] !== "]") throw new Error("unterminated array");
    return array;
  }

  const value = parseValue();
  return { value, endIndex: index };
}

module.exports = { parseDataLiteral };
