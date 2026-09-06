import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  BrainCircuit,
  Pencil,
  Trash2,
  Upload,
  MessageSquareQuote,
  PencilLine,
  ThumbsUp,
  Send,
  FlaskConical,
} from "lucide-react";
import KnowledgeList, { isPlaceholder } from "@/components/KnowledgeList";
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

/** Things customers actually open with, to save typing while rehearsing. */
const PRACTICE_PROMPTS = [
  "hey how much for a small tattoo on the wrist?",
  "do you have anything available this weekend?",
  "whats your address?",
  "do you do payment plans?",
  "how much is a half sleeve",
];

export default function Training() {
  const utils = trpc.useUtils();
  const { data: knowledge } = trpc.knowledge.list.useQuery();
  const { data: exampleCount } = trpc.history.count.useQuery();
  const { data: edits } = trpc.history.edits.useQuery();

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [importing, setImporting] = useState(false);
  // Practice panel: what you asked, what it drafted, and your version of it.
  const [practiceMessage, setPracticeMessage] = useState("");
  const [asked, setAsked] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [originalDraft, setOriginalDraft] = useState("");
  const [wasSensitive, setWasSensitive] = useState(false);
  // Repairing a stored correction — a slip while editing a draft gets saved
  // as deliberate phrasing, and these outweigh everything else the agent reads.
  const [editingEditId, setEditingEditId] = useState<number | null>(null);
  const [editSentText, setEditSentText] = useState("");

  const practiceDraft = trpc.practice.draft.useMutation({
    onSuccess: (result) => {
      setDraft(result.reply);
      setOriginalDraft(result.reply);
      setWasSensitive(result.sensitive);
      if (!result.ok) toast.error("The AI didn't answer — check Settings → Test connection.");
    },
    onError: (error) => toast.error(error.message || "Couldn't draft that."),
  });

  const keepPractice = trpc.practice.keep.useMutation({
    onSuccess: (result) => {
      toast.success(result.imported ? "Saved — it'll follow this next time" : "Already knew that one");
      setDraft(null);
      setAsked("");
      setPracticeMessage("");
      utils.history.count.invalidate();
      utils.history.edits.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't save that."),
  });

  const updateEdit = trpc.history.updateEdit.useMutation({
    onSuccess: () => {
      toast.success("Correction fixed");
      setEditingEditId(null);
      utils.history.edits.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't save that."),
  });

  const removeEdit = trpc.history.removeEdit.useMutation({
    onSuccess: () => {
      toast.success("Forgotten");
      utils.history.edits.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't remove that."),
  });

  const runPractice = (message: string) => {
    const text = message.trim();
    if (!text) return;
    setAsked(text);
    setDraft(null);
    practiceDraft.mutate({ message: text, priorTurns: [] });
  };

  const importHistory = trpc.history.import.useMutation();

  // Learn from the threads the app already holds, rather than only from a
  // file someone remembered to export.
  const learnFromInbox = trpc.history.learnFromInbox.useMutation({
    onSuccess: (r) => {
      if (r.imported > 0) {
        toast.success(
          `Learned ${r.imported} more exchange${r.imported === 1 ? "" : "s"} from the inbox`,
          { duration: 8000 }
        );
      } else if (r.found > 0) {
        toast(`Already learned all ${r.found} of them`, { duration: 6000 });
      } else {
        toast("No question-and-answer pairs in the inbox yet", { duration: 6000 });
      }
      utils.history.count.invalidate();
    },
    onError: (e) => toast.error(e.message || "Couldn't read the inbox."),
  });

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
            <FlaskConical className="h-4 w-4 text-sepia" />
            Practice
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask something a customer would ask. It drafts a reply using everything it knows —
            same as it would for real. Approve it or rewrite it, and it learns from that. Nothing
            here reaches a customer.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="hey how much for a small tattoo?"
              value={practiceMessage}
              onChange={(e) => setPracticeMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runPractice(practiceMessage);
              }}
            />
            <Button
              onClick={() => runPractice(practiceMessage)}
              disabled={practiceDraft.isPending || !practiceMessage.trim()}
            >
              {practiceDraft.isPending ? "…" : <Send className="h-4 w-4" />}
            </Button>
          </div>

          {!draft && !practiceDraft.isPending && (
            <div className="flex flex-wrap gap-2">
              {PRACTICE_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPracticeMessage(p);
                    runPractice(p);
                  }}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-sepia/50 hover:text-charcoal"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {asked && (
            <div className="space-y-2">
              <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-beige/40 px-3 py-2 text-sm text-charcoal">
                {asked}
              </div>

              {practiceDraft.isPending && (
                <p className="text-sm text-muted-foreground">Drafting…</p>
              )}

              {draft !== null && (
                <>
                  {wasSensitive && (
                    <p className="text-xs text-sepia">
                      Flagged sensitive — for a real message it would hand over to you rather than
                      answer.
                    </p>
                  )}
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="min-h-24"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        keepPractice.mutate({
                          customerMessage: asked,
                          reply: draft,
                          originalDraft,
                        })
                      }
                      disabled={keepPractice.isPending || !draft.trim()}
                    >
                      <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />
                      {draft === originalDraft ? "Good — keep it" : "Save my version"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => runPractice(asked)}
                      disabled={practiceDraft.isPending}
                    >
                      Try again
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setDraft(null);
                        setAsked("");
                      }}
                    >
                      Discard
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
          {/* The inbox this app already holds is a bigger and better teacher
              than anything anyone remembers to upload, and it was going
              unused. One button, safe to press twice — duplicates are dropped
              on the fingerprint. */}
          <div className="rounded-lg border border-border bg-beige/20 p-3">
            <p className="text-xs text-muted-foreground">
              Every thread already in the inbox is a lesson: a customer's question and the
              answer the studio actually typed. This reads all of them. It only learns from
              replies a person wrote — never from the agent's own drafts, which would just
              teach it its own habits.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => learnFromInbox.mutate()}
              disabled={learnFromInbox.isPending}
            >
              {learnFromInbox.isPending ? "Reading the inbox…" : "Learn from every chat we already have"}
            </Button>
          </div>

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
              as a correction. These carry the most weight of anything on this page — so if you
              clipped a word by accident, fix it here or the agent will copy the mistake.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {edits.map((edit) =>
              editingEditId === edit.id ? (
                <div key={edit.id} className="space-y-2 rounded-xl border border-sepia/40 p-3">
                  <p className="text-xs text-muted-foreground">It drafted</p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {edit.draftText}
                  </p>
                  <p className="pt-1 text-xs text-sepia">You sent — fix it here</p>
                  <Textarea
                    value={editSentText}
                    onChange={(e) => setEditSentText(e.target.value)}
                    className="min-h-24"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (!editSentText.trim()) {
                          toast.error("Can't be blank — delete it instead.");
                          return;
                        }
                        updateEdit.mutate({ id: edit.id, sentText: editSentText });
                      }}
                      disabled={updateEdit.isPending}
                    >
                      {updateEdit.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingEditId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div key={edit.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">It drafted</p>
                      <p className="mt-1 line-clamp-2 text-muted-foreground">{edit.draftText}</p>
                      <p className="mt-2 text-xs text-sepia">You sent</p>
                      <p className="mt-1 line-clamp-2 text-charcoal">{edit.sentText}</p>
                    </div>
                    <div className="flex shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Fix this correction"
                        onClick={() => {
                          setEditingEditId(edit.id);
                          setEditSentText(edit.sentText);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Forget this correction"
                        className="text-destructive"
                        onClick={() => removeEdit.mutate({ id: edit.id })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            )}
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
        <CardContent>
          <KnowledgeList />
        </CardContent>
      </Card>
    </div>
  );
}
