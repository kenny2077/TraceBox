/**
 * Extract file paths from Codex apply_patch command strings.
 *
 * Supports these patch header patterns:
 *   *** Update File: path
 *   *** Add File: path
 *   *** Delete File: path
 *   --- a/path
 *   +++ b/path
 *   diff --git a/path b/path
 *
 * Handles deduplication and strips leading/trailing whitespace.
 */
export function extractPatchPaths(command: string): string[] {
  const seen = new Set<string>();

  // Pattern 1: *** Update File: / *** Add File: / *** Delete File:
  const updateFileRe = /\*{3}\s*(?:Update|Add|Delete)\s+File:\s*(\S+)/gi;
  collectMatches(command, updateFileRe, 1, seen);

  // Pattern 2: --- a/path and +++ b/path (unified diff headers)
  const diffHeaderRe = /^[+-]{3}\s+[ab]\/(\S+)/gm;
  collectMatches(command, diffHeaderRe, 1, seen);

  // Pattern 3: diff --git a/path b/path
  const diffGitRe = /^diff\s+--git\s+a\/(\S+)\s+b\/(\S+)/gm;
  for (const m of command.matchAll(diffGitRe)) {
    if (m[1]) seen.add(m[1]);
    if (m[2]) seen.add(m[2]);
  }

  return [...seen];
}

function collectMatches(
  text: string,
  regex: RegExp,
  group: number,
  seen: Set<string>,
): void {
  for (const m of text.matchAll(regex)) {
    const path = m[group]?.trim();
    if (path && path.length > 0) {
      seen.add(path);
    }
  }
}
