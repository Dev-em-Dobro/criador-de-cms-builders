import PageSkeleton from "@/components/ui/PageSkeleton";

/**
 * Group-level loading boundary: any admin navigation that has no closer
 * loading.tsx shows this immediately while the target page's server
 * component resolves.
 */
export default function AdminLoading() {
  return <PageSkeleton variant="list" />;
}
