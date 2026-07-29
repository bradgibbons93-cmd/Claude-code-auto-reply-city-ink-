import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Pencil, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

/**
 * A suggestion whose answer is still a bracketed instruction is a prompt to
 * the reader, not a fact. Saved verbatim, the agent will tell a customer the
 * studio is at "(Add the studio address here…)".
 */
export function isPlaceholder(answer: string): boolean {
  return /^\s*\(.*\)\s*$/.test(answer);
}

/**
 * The studio's facts, editable in place. Training and Settings both show this
 * list — they used to render their own copies, which is how one of them ended
 * up editable and the other didn't.
 */
export default function KnowledgeList() {
  const utils = trpc.useUtils();
  const { data: knowledge } = trpc.knowledge.list.useQuery();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");

  const updateKnowledge = trpc.knowledge.update.useMutation({
    onSuccess: () => {
      toast.success("Saved");
      setEditingId(null);
      utils.knowledge.list.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't save that."),
  });

  const removeKnowledge = trpc.knowledge.remove.useMutation({
    onSuccess: () => utils.knowledge.list.invalidate(),
  });

  if (!knowledge?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing yet — until you add prices and policies here, the agent won't quote anything and
        will say the studio will confirm.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {knowledge.map((k) =>
        editingId === k.id ? (
          <div key={k.id} className="space-y-2 rounded-lg border border-sepia/40 p-3">
            <Input
              value={editQuestion}
              onChange={(e) => setEditQuestion(e.target.value)}
              placeholder="What is it?"
            />
            <Textarea
              value={editAnswer}
              onChange={(e) => setEditAnswer(e.target.value)}
              className="min-h-24"
              placeholder="The answer, in your words."
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  if (!editQuestion.trim() || !editAnswer.trim()) {
                    toast.error("Fill in both boxes.");
                    return;
                  }
                  updateKnowledge.mutate({
                    id: k.id,
                    question: editQuestion,
                    answer: editAnswer,
                  });
                }}
                disabled={updateKnowledge.isPending}
              >
                {updateKnowledge.isPending ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div
            key={k.id}
            className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${
              isPlaceholder(k.answer) ? "border-destructive/40" : "border-border"
            }`}
          >
            <div className="min-w-0">
              <p className="text-sm text-charcoal">{k.question}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{k.answer}</p>
              {isPlaceholder(k.answer) && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  The agent will say this word for word. Edit it before a customer asks.
                </p>
              )}
            </div>
            <div className="flex shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingId(k.id);
                  setEditQuestion(k.question);
                  setEditAnswer(k.answer);
                }}
                aria-label="Edit"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeKnowledge.mutate({ id: k.id })}
                aria-label="Remove"
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
