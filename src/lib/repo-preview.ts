/** Fields already on list cards — enough to paint a repo page instantly. */
export type RepoPreview = {
  owner: string | null;
  repo_name: string | null;
  full_name: string | null;
  description: string | null;
  github_url: string | null;
  stars: number | null;
  forks: number | null;
  language: string | null;
  license: string | null;
  created_at_github: string | null;
  pushed_at_github: string | null;
  days_to_discovery: number | null;
};

export function toRepoPreview(repo: {
  owner?: string | null;
  repo_name?: string | null;
  full_name?: string | null;
  description?: string | null;
  github_url?: string | null;
  stars?: number | null;
  forks?: number | null;
  language?: string | null;
  license?: string | null;
  created_at_github?: string | null;
  pushed_at_github?: string | null;
  days_to_discovery?: number | null;
}): RepoPreview {
  return {
    owner: repo.owner ?? null,
    repo_name: repo.repo_name ?? null,
    full_name: repo.full_name ?? null,
    description: repo.description ?? null,
    github_url: repo.github_url ?? null,
    stars: repo.stars ?? null,
    forks: repo.forks ?? null,
    language: repo.language ?? null,
    license: repo.license ?? null,
    created_at_github: repo.created_at_github ?? null,
    pushed_at_github: repo.pushed_at_github ?? null,
    days_to_discovery: repo.days_to_discovery ?? null,
  };
}
