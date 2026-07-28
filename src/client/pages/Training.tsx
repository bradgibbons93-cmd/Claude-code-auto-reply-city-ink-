import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, BrainCircuit } from "lucide-react";
import { toast } from "sonner";

/**
 * Everything the agent is allowed to state as fact lives here. It reads
 * these on every reply, so changing a price is just editing the entry —
 * no redeploy, no code change.
 */
const STARTERS: Array<{ question: string; answer: string }> = [
  {
    question: "Opening hours",
    answer:
      "Monday - Saturday 10:30am - 5pm. These times may vary so it's always best to contact us or book in advance to avoid any disappointment.",
  },
  {
    question: "Deposit",
    answer:
      "$50 deposit to lock in the booking, which comes off the total on the day.",
  },
  {
    question: "Small tattoo pricing",
    answer:
      "Small pieces start around $100 - $150. Always quote a range of about $100, and say the final price depends on the size on the day.",
  },
  {
    question: "Payment options",
    answer:
      "We have Afterpay available. Offer it when someone says the price is a stretch, rather than discounting.",
  },
  {
    question: "Studio address",
    answer: "(Add the studio address here so the agent can send it on confirmation.)",
  },
];

export default function Training() {
  const utils = trpc.useUtils();
  const { data: knowledge } = trpc.knowledge.list.useQuery();

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  const addKnowledge = trpc.knowledge.create.useMutation({
    onSuccess: () => {
      setQuestion("");
      setAnswer("");
      utils.knowledge.list.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't save that."),
  });

  const removeKnowledge = trpc.knowledge.remove.useMutation({
    onSuccess: () => utils.knowledge.list.invalidate(),
  });

  const addStarter = (starter: { question: string; answer: string }) =>
    addKnowledge.mutate(starter, {
      onSuccess: () => toast.success(`Added "${starter.question}"`),
    });

  const existing = new Set((knowledge ?? []).map((k) => k.question.toLowerCase()));
  const unusedStarters = STARTERS.filter((s) => !existing.has(s.question.toLowerCase()));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 font-display text-2xl text-charcoal">
          <BrainCircuit className="h-5 w-5" />
          Training
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What the agent is allowed to say. Change a price here and it uses the new one on the
          very next reply — nothing to redeploy. Anything not in this list, it won't claim to
          know.
        </p>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg text-charcoal">Add something</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="What is it? e.g. Half sleeve pricing"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Textarea
            placeholder="The answer, in your words. e.g. Half sleeves run $800 a day, usually 1-2 days."
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            className="min-h-24"
          />
          <Button
            onClick={() => {
              if (!question.trim() || !answer.trim()) {
                toast.error("Fill in both boxes.");
                return;
              }
              addKnowledge.mutate({ question, answer });
            }}
            disabled={addKnowledge.isPending}
          >
            {addKnowledge.isPending ? "Saving…" : "Add"}
          </Button>
        </CardContent>
      </Card>

      {!!unusedStarters.length && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="font-display text-lg text-charcoal">Suggested</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Pulled from how you already answer these on Messenger. Tap to add, then edit the
              wording to suit.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {unusedStarters.map((s) => (
              <button
                key={s.question}
                onClick={() => addStarter(s)}
                disabled={addKnowledge.isPending}
                className="w-full rounded-lg border border-border p-3 text-left transition-colors hover:border-sepia/40 disabled:opacity-50"
              >
                <p className="text-sm text-charcoal">{s.question}</p>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{s.answer}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-lg text-charcoal">
            What it knows ({knowledge?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {knowledge?.length ? (
            knowledge.map((k) => (
              <div
                key={k.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div>
                  <p className="text-sm text-charcoal">{k.question}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {k.answer}
                  </p>
                </div>
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
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing yet — until you add prices and policies here, the agent won't quote
              anything and will say the studio will confirm.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
