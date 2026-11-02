"use client";

import { useState } from "react";
import { PageLoading } from "@/components/page-loading";
import { RepoHeading } from "@/components/repo-heading";
import { readRepoPreview } from "@/components/repo-link";

export function RepoPreviewLoading() {
  const [preview] = useState(() => readRepoPreview());

  if (!preview?.owner || !preview.repo_name) {
    return <PageLoading />;
  }

  return (
    <div className="space-y-12">
      <RepoHeading
        repository={preview}
        owner={preview.owner}
        repo={preview.repo_name}
      />
      <p className="border border-dashed border-[var(--rule)] px-4 py-8 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
        Loading discovery details…
      </p>
    </div>
  );
}
