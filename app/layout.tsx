import "./globals.css";
import NavBar from "@/components/NavBar";
import Providers from "@/components/Providers";
import { ProcessingProvider } from "@/components/ProcessingGuard";

export const metadata = {
    title: "TTB Label Verification",
    description: "AI-assisted alcohol label application review",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
        <body>
        <Providers>
            <ProcessingProvider>
                <NavBar />
                {children}
            </ProcessingProvider>
        </Providers>
        </body>
        </html>
    );
}
