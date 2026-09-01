import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { Toaster } from "sonner";
import { trpc } from "@/lib/trpc";
import App from "./App";
import "./index.css";

function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({ links: [httpBatchLink({ url: "/api/trpc" })] })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {/* Follows the page rather than being pinned dark — on the light
            palette a black toast was the only black rectangle on screen. */}
        <Toaster theme="system" position="bottom-right" richColors />
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

/*
 * Keep the notification worker current.
 *
 * Registering here rather than only when the switch is flipped matters after
 * a deploy: a device that turned notifications on last week keeps its
 * subscription, but the code that draws the notification is whatever version
 * of sw.js the browser last saw. Re-registering on load lets it update.
 *
 * Failure is silent on purpose — an old browser that can't do this must not
 * take the dashboard down with it.
 */
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
