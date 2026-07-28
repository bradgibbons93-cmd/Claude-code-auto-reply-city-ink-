import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Zap, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function AutoReplyRules() {
  const [isOpen, setIsOpen] = useState(false);
  const [keywords, setKeywords] = useState("");
  const [response, setResponse] = useState("");
  const [sendBookingLink, setSendBookingLink] = useState(false);

  const { data: rules, refetch } = trpc.autoReply.getRules.useQuery();

  const createRule = trpc.autoReply.createRule.useMutation({
    onSuccess: () => {
      toast.success("Rule created");
      setKeywords("");
      setResponse("");
      setSendBookingLink(false);
      setIsOpen(false);
      refetch();
    },
    onError: () => toast.error("Couldn't create the rule. Check the fields and try again."),
  });

  const deleteRule = trpc.autoReply.deleteRule.useMutation({
    onSuccess: () => {
      toast.success("Rule deleted");
      refetch();
    },
    onError: () => toast.error("Couldn't delete that rule."),
  });

  const handleCreate = () => {
    const keywordArray = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    if (!keywordArray.length || !response.trim()) {
      toast.error("Add at least one keyword and a response.");
      return;
    }

    createRule.mutate({ triggerKeywords: keywordArray, responseText: response, sendBookingLink });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-display text-2xl text-charcoal">
            <Zap className="h-5 w-5" />
            Auto-replies
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fixed answers for questions you always get. These override the agent.
          </p>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New rule
            </Button>
          </DialogTrigger>
          <DialogContent className="border-border bg-card">
            <DialogHeader>
              <DialogTitle className="text-charcoal">Create a rule</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm">Trigger words, comma separated</label>
                <Input
                  placeholder="deposit, holding fee, do I pay upfront"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  className="mt-2 border-border"
                />
              </div>

              <div>
                <label className="text-sm">Reply</label>
                <Textarea
                  placeholder="What should we send back?"
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  className="mt-2 min-h-24 border-border"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="booking"
                  checked={sendBookingLink}
                  onChange={(e) => setSendBookingLink(e.target.checked)}
                  className="rounded border-border"
                />
                <label htmlFor="booking" className="cursor-pointer text-sm">
                  Also start the booking hand-off (collect name/phone/dates, alert the studio)
                </label>
              </div>

              <Button onClick={handleCreate} disabled={createRule.isPending} className="w-full">
                {createRule.isPending ? "Creating…" : "Create rule"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {rules?.length ? (
          rules.map((rule) => (
            <Card key={rule.id} className="border-border">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge className="border-sepia/45 bg-beige/30 text-charcoal">
                        {rule.triggerKeywords?.length ?? 0} keywords
                      </Badge>
                      {rule.sendBookingLink && (
                        <Badge className="border-success/40 bg-success/10 text-success">
                          Starts booking hand-off
                        </Badge>
                      )}
                    </div>
                    <p className="mb-2 text-sm text-muted-foreground">
                      {rule.triggerKeywords?.join(", ")}
                    </p>
                    <p className="text-sm">{rule.responseText}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteRule.mutate({ id: rule.id })}
                    disabled={deleteRule.isPending}
                    aria-label="Delete rule"
                    className="text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="border-border">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No rules yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Start with the question you answer most — deposits, or parking.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
