import "./globals.css";
import NavBar from "@/components/NavBar";
import Providers from "@/components/Providers";
import { ProcessingProvider } from "@/components/ProcessingGuard";
import { ClientConfigProvider } from "@/components/ClientConfigProvider";
import { clientConfig } from "@/lib/clientConfig";

export const metadata = {
    title: "TTB Label Verification",
    description: "AI-assisted alcohol label application review",
};

// Render per request, not at build time: clientConfig() reads runtime env (the
// container's, set on Render/Docker) and seeds the client config context. A
// static prerender would bake build-time defaults, so overrides wouldn't reach
// the browser. (These pages are interactive client apps; SSG buys little here.)
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
        <body>
        <Providers>
            <ClientConfigProvider value={clientConfig()}>
                <ProcessingProvider>
                    <NavBar />
                    {children}
                </ProcessingProvider>
            </ClientConfigProvider>
        </Providers>
        </body>
        </html>
    );
}
