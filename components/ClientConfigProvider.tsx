"use client";

import { createContext, useContext } from "react";
import type { ClientConfig } from "@/lib/clientConfig";

/**
 * Carries the server-read {@link ClientConfig} to client components, so the
 * browser enforces the SAME caps the server does (rather than config.ts's
 * compiled defaults). Seeded once in the root layout from clientConfig().
 */
const ClientConfigContext = createContext<ClientConfig | null>(null);

export function ClientConfigProvider({ value, children }: { value: ClientConfig; children: React.ReactNode }) {
    return <ClientConfigContext.Provider value={value}>{children}</ClientConfigContext.Provider>;
}

export function useClientConfig(): ClientConfig {
    const cfg = useContext(ClientConfigContext);
    if (!cfg) throw new Error("useClientConfig must be used within ClientConfigProvider");
    return cfg;
}
