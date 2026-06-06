"use client";

/**
 * A tiny global signal for "a verification run is in progress," shared between
 * the run components (PDF and CSV) and the NavBar. Navigating away during a run
 * unmounts the component, which abandons the NDJSON stream and aborts the batch
 * server-side — so we guard the two ways out: in-app links (confirm) and a
 * browser unload (native prompt). Completed rows are already persisted; this
 * only protects the unprocessed remainder of an active batch.
 *
 * It's a count, not a boolean, so concurrent/overlapping runs (and React strict
 * double-effects) compose correctly.
 */
import { createContext, useContext, useState, useCallback, useEffect } from "react";

type ProcessingContextValue = { active: boolean; setActive: (on: boolean) => void };

const ProcessingContext = createContext<ProcessingContextValue>({ active: false, setActive: () => {} });

export function ProcessingProvider({ children }: { children: React.ReactNode }) {
    const [count, setCount] = useState(0);
    const setActive = useCallback((on: boolean) => {
        setCount((c) => Math.max(0, c + (on ? 1 : -1)));
    }, []);
    const active = count > 0;

    // Native guard for refresh / tab-close / browser back during a run.
    useEffect(() => {
        if (!active) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [active]);

    return <ProcessingContext.Provider value={{ active, setActive }}>{children}</ProcessingContext.Provider>;
}

/** Read the global run state (for NavBar's leave-confirmation). */
export function useProcessing(): ProcessingContextValue {
    return useContext(ProcessingContext);
}

/** Register a component's `processing` flag with the global guard while it runs. */
export function useRegisterProcessing(processing: boolean): void {
    const { setActive } = useProcessing();
    useEffect(() => {
        if (!processing) return;
        setActive(true);
        return () => setActive(false);
    }, [processing, setActive]);
}
