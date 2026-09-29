import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Router, type BaseLocationHook } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { trpc } from "@/lib/trpc";
import { SessionProvider } from "@/lib/session";
import App from "../App";
import { mockLink } from "./mock";
import "../index.css";

/**
 * The test drive: the real app, every real screen, on pretend data.
 *
 * Built by `vite.demo.config.ts` into a folder that can be opened anywhere
 * (it was made so Brad could try the new Home on his phone before it went
 * near the live studio). The only differences from the real thing are here:
 * the server is `mock.ts`, and the address bar is kept in memory, because a
 * page hosted inside something else can't own the address.
 */

// Some hosts refuse storage outright. The app only uses it to remember the
// look between visits, so a page-lifetime stand-in is enough.
try {
  window.localStorage.getItem("probe");
} catch {
  const store = new Map<string, string>();
  try {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  } catch {
    /* the app copes without it */
  }
}

const memory = memoryLocation({ path: "/", record: true });
// "/settings#ai" is a link to a section; in memory the "#…" would make it a
// different page. Drop it, as a browser would before routing.
const useDemoLocation: BaseLocationHook = () => {
  const [path, navigate] = memory.hook();
  return [path, (to: string, options?: { replace?: boolean }) => navigate(String(to).replace(/#.*$/, ""), options)];
};
// The inbox closes a conversation with the browser's Back. Here, Back is ours.
window.history.back = () => {
  const history = memory.history ?? [];
  if (history.length > 1) {
    history.pop();
    memory.navigate(history[history.length - 1], { replace: true });
  } else {
    memory.navigate("/", { replace: true });
  }
};
// Logging out reloads onto the log-in page in the real app; here it starts
// the test drive over (see the path rewrite in vite.demo.config.ts).
(window as unknown as { __runnitDemo: { reset: () => void } }).__runnitDemo = {
  reset: () => window.location.reload(),
};

document.body.className = "bg-background font-sans text-foreground antialiased";

function DemoBar() {
  return (
    <div className="relative z-40 flex items-center justify-center gap-3 bg-primary px-4 py-1.5 text-center text-[0.72rem] font-medium text-primary-foreground">
      <span>Test drive · pretend customers · nothing is sent</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full border border-current px-2.5 py-0.5 text-[0.68rem] font-semibold"
      >
        Start over
      </button>
    </div>
  );
}

function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() => trpc.createClient({ links: [mockLink] }));
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Toaster theme="system" position="bottom-right" richColors offset={{ bottom: 92, right: 24 }} mobileOffset={{ bottom: 92 }} />
        <Router hook={useDemoLocation} searchHook={memory.searchHook}>
          <DemoBar />
          <SessionProvider>
            <App />
          </SessionProvider>
        </Router>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
