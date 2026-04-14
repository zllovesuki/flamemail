import { ShieldAlert } from "lucide-react";
import { Card, EmptyState } from "@/client/components/ui";

export function MissingInboxSessionState() {
  return (
    <main className="animate-slide-up">
      <Card className="flex min-h-[320px] items-center justify-center">
        <EmptyState
          icon={<ShieldAlert className="h-7 w-7 text-zinc-500" />}
          caption="Missing Session"
          heading="No access token for this inbox"
          description="The access token lives on the device that created it. Open that browser before the inbox expires, or sign in as admin to inspect permanent inboxes."
        />
      </Card>
    </main>
  );
}
