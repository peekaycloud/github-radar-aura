import Link from "next/link";
import type { ComponentProps } from "react";

type AppLinkProps = ComponentProps<typeof Link>;

/** Internal link that prefetches full route data so tab/repo clicks are ready. */
export function AppLink({ prefetch = true, ...props }: AppLinkProps) {
  return <Link prefetch={prefetch} {...props} />;
}
