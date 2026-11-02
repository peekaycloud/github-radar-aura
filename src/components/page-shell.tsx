import type { ReactNode } from "react";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";

/** Cache Components require a Suspense boundary around awaited searchParams/params. */
export function PageShell({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}
