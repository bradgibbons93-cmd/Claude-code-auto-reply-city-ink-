import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Trash2,
  BrainCircuit,
  Upload,
  MessageSquareQuote,
  PencilLine,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import { parseMessengerExport, type ExchangePair } from "@/lib/parseMessengerExport";
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

/**
 * A suggestion whose answer is still a bracketed instruction is a prompt to
 * you, not a fact. Saving one verbatim means the agent will cheerfully tell a
 * customer the studio is at "(Add the studio address here…)", so these load
 * into the form to be written rather than saving on tap.
 */
function isPlaceholder(answer: string): boolean {
  return /^\s*\(.*\)\s*$/.test(answer);
}

export default function Training() {
  const utils = trpc.useUtils();
  const { data: knowledge } = trpc.knowledge.list.useQuery();
  const { data: exampleCount } = trpc.history.count.useQuery();
  const { data: edits } = trpc.history.edits.useQuery();

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");

  const importHistory = trpc.history.import.useMutation();

  /**
   * Parses each exported thread in the browser and sends only the extracted
   * pairs, so a folder of large JSON files never has to be uploaded whole.
   */
  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setImporting(true);
    let imported = 0;
    let skipped = 0;
    let unreadable = 0;

    try {
      for (const file of Array.from(files)) {
        let pairs: ExchangePair[] = [];
        try {
          pairs = parseMessengerExport(JSON.parse(await file.text()), "City Ink");
        } catch {
          unreadable++;
          continue;
        }
        if (!pairs.length) continue;

        // Chunked so one enormous thread can't blow the request limit.
        for (let i = 0; i < pairs.length; i += 500) {
          const result = await importHistory.mutateAsync({
            pairs: pairs.slice(i, i + 500),
            source: file.name,
          });
          imported += result.imported;
          skipped += result.skipped;
        }
      }

      utils.history.count.invalidate();
      if (!imported && !skipped) {
        toast.error(
          unreadable
            ? "Couldn't read those files — they need to be the message_1.json files from a Facebook export."
            : "No usable exchanges found in those files."
        );
      } else {
        toast.success(
          `Learned ${imported} exchange${imported === 1 ? "" : "s"}` +
            (skipped ? ` — ${skipped} already known or unusable` : "")
        );
      }
    } catch (error) {
      toast.error((error as Error).message || "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const addKnowledge = trpc.knowledge.create.useMutation({
    onSuccess: () => {
      setQuestion("");
      setAnswer("");
      utils.knowledge.list.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't save that."),
  });

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

  const startEditing = (entry: { id: number; question: string; answer: string }) => {
    setEditingId(entry.id);
    setEditQuestion(entry.question);
    setEditAnswer(entry.answer);
  };

  const addStarter = (starter: { question: string; answer: string }) => {
    // Placeholders go to the form so you write the real answer first.
    if (isPlaceholder(starter.answer)) {
      setQuestion(starter.question);
      setAnswer("");
      toast.info(`Write the answer for "${starter.question}", then hit Add.`);
      document.getElementById("add-a-fact")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    addKnowledge.mutate(starter, {
      onSuccess: () => toast.success(`Added "${starter.question}"`),
    });
  };

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
          <CardTitle className="flex items-center gap-2 font-display text-lg text-charcoal">
            <MessageSquareQuote className="h-4 w-4 text-sepia" />
            Learn from past chats
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {exampleCount
              ? `${exampleCount} real exchanges learned. Before every draft, the closest few are looked up and used as the example to follow.`
              : "Upload your exported Messenger history and the agent will answer new enquiries the way you already answered similar ones."}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-4 py-8 text-center transition-colors hover:border-sepia">
            <Upload className="mb-2 h-5 w-5 text-sepia" />
            <span className="text-sm text-charcoal">
              {importing ? "Reading…" : "Choose your message_1.json files"}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              Select them all at once — duplicates are ignored
            </span>
            <input
              type="file"
              accept=".json,application/json"
              multiple
              disabled={importing}
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            From Facebook: Settings &amp; privacy → Your information → Download your information →
            select Messages → JSON. The files are read in your browser; only the
            message-and-reply pairs are sent.
          </p>
        </CardContent>
      </Card>

      {!!edits?.length && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg text-charcoal">
              <PencilLine className="h-4 w-4 text-sepia" />
              Your corrections ({edits.length})
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Every time you rewrite a draft before sending, it's kept here and shown to the agent
              as a correction. These carry the most weight of anything on this page.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {edits.slice(0, 5).map((edit) => (
              <div key={edit.id} className="rounded-xl border border-border p-3 text-sm">
                <p className="text-xs text-muted-foreground">It drafted</p>
                <p className="mt-1 line-clamp-2 text-muted-foreground">{edit.draftText}</p>
                <p className="mt-2 text-xs text-sepia">You sent</p>
                <p className="mt-1 line-clamp-2 text-charcoal">{edit.sentText}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="border-border" id="add-a-fact">
        <CardHeader>
          <CardTitle className="font-display text-lg text-charcoal">Add a fact</CardTitle>
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
            knowledge.map((k) =>
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
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {k.answer}
                    </p>
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
                      onClick={() => startEditing(k)}
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
            )
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
