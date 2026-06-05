export const PAGE_SIZE = 25;

export const PRODUCT_LABELS: Record<string, string> = {
    wine: "Wine",
    distilledSpirits: "Distilled Spirits",
    maltBeverages: "Malt Beverages",
};

export type Summary = {
    id: string; serialNumber: string; productType: string;
    overall: string; brandName: string | null; createdAt: string;
};

export type Page = { rows: Summary[]; total: number; limit: number; offset: number };

export type Filters = {
    serial: string; brand: string; overall: string; productType: string; fromDate: string; toDate: string;
};

export const EMPTY_FILTERS: Filters = {
    serial: "", brand: "", overall: "", productType: "", fromDate: "", toDate: "",
};

export function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleString(undefined, {
            year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        });
    } catch { return iso; }
}
