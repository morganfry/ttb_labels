import "./globals.css";
import NavBar from "@/components/NavBar";
import { ProcessingProvider } from "@/components/ProcessingGuard";

export const metadata = {
    title: "TTB Label Verification",
    description: "AI-assisted alcohol label application review",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
        <body>
        <ProcessingProvider>
            <NavBar />
            {children}
        </ProcessingProvider>
        </body>
        </html>
    );
}
