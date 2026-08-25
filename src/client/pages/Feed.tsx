import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LiveFeed from "@/components/LiveFeed";

/** Everything the studio has posted, laid out wide. */
export default function Feed() {
  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="font-display text-xl text-charcoal">Live feed</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything City Ink has posted on Facebook and Instagram, newest first. It keeps itself
          up to date every hour.
        </p>
      </CardHeader>
      <CardContent>
        <LiveFeed variant="grid" />
      </CardContent>
    </Card>
  );
}
