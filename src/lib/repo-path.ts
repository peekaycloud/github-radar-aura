/** Canonical in-app path for a repository detail page. */
export function repoPath(
  owner?: string | null,
  repo?: string | null
): string | null {
  if (!owner || !repo) return null;
  return `/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}
