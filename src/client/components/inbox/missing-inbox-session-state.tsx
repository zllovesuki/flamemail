import { ShieldAlert } from "lucide-react";
import { Card, EmptyState } from "@/client/components/ui";

export function MissingInboxSessionState() {
  return (
    <main className="animate-slide-up">
      <Card className="flex min-h-[320px] items-center justify-center">
        <EmptyState
          icon={<ShieldAlert className="h-7 w-7 text-zinc-600" />}
          caption="Missing Session"
          heading="This inbox is not stored locally"
          description="Open it from the device that created it before the inbox expires, or sign in as an admin for permanent inboxes."
        />
      </Card>
    </main>
  );
}
