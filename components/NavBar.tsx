"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, History } from "lucide-react";

const LINKS = [
    { href: "/", label: "Verify", Icon: ClipboardCheck },
    { href: "/search", label: "Review History", Icon: History },
];

export default function NavBar() {
    const pathname = usePathname();
    return (
        <nav className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-5xl items-center gap-1 px-4">
                <span className="mr-4 py-3.5 text-sm font-bold text-slate-900">TTB Label Verification</span>
                {LINKS.map(({ href, label, Icon }) => {
                    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                    return (
                        <Link key={href} href={href}
                              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-3.5 text-sm font-medium transition-colors ${
                                  active ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                            <Icon size={16} /> {label}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
