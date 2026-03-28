import { useOutletContext } from "react-router-dom";
import { InboxView } from "@/client/components/inbox-view";
import type { AppShellContext } from "@/client/components/app-shell";

export function InboxPage() {
  const { onDeleted } = useOutletContext<AppShellContext>();
  return <InboxView onDeleted={onDeleted} />;
}
