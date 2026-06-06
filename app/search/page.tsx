import { Suspense } from "react";
import SearchView from "@/components/SearchView";

export const metadata = { title: "Search reviews — TTB Label Verification" };

export default function SearchPage() {
    // SearchView reads useSearchParams(); the App Router needs a Suspense boundary.
    return (
        <Suspense>
            <SearchView />
        </Suspense>
    );
}
