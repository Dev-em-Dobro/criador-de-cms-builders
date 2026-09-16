import PageSkeleton from "@/components/ui/PageSkeleton";

// Own boundary so switching BETWEEN collections (/cases -> /solutions) also
// shows feedback — a param change inside one dynamic segment does not
// re-trigger a boundary above it.
export default function CollectionLoading() {
  return <PageSkeleton variant="list" />;
}
