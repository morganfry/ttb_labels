"use client";

/**
 * Client-side app providers. Holds the TanStack Query client used for server
 * state (Review History search + result detail) — caching, dedupe, and
 * loading/error handling instead of hand-rolled fetch + useState.
 *
 * The client is created once in state so it survives re-renders but isn't
 * shared across requests (the Next.js App Router pattern).
 */
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function Providers({ children }: { children: React.ReactNode }) {
    const [client] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
                },
            }),
    );
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
