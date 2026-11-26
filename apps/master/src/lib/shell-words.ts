/**
 * Splits a command line into arguments like a shell would for the simple cases: whitespace separates, single or
 * double quotes keep spaces together, a backslash inside double quotes escapes `"` and `\`. No variables, no pipes
 * (the container starts the program itself, nothing is interpreted by a shell). `null` for an unclosed quote.
 */
export function splitCommand(line: string): string[] | null {
  const args: string[] = [];
  let cur = "";
  let has = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote === "'") {
      if (c === "'") quote = null; else cur += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "\\" && (line[i + 1] === '"' || line[i + 1] === "\\")) cur += line[++i]!;
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur !== "") args.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (quote) return null;
  if (has || cur !== "") args.push(cur);
  return args;
}
