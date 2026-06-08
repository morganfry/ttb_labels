import { useRef, useState, useEffect, useCallback } from "react";
import { Upload } from "lucide-react";

export function Dropzone({ onFiles }: { onFiles: (files: FileList) => void }) {
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    // dragenter/dragleave fire for every child element crossed, so a naive
    // boolean flickers. Count enters vs. leaves and only clear at zero.
    const depth = useRef(0);

    // Without this, a file dropped even slightly outside the zone hits the
    // window default and the browser navigates away to open it — which looks
    // like drag-and-drop is broken. Swallow the default everywhere; the zone's
    // own onDrop still handles real drops on it.
    useEffect(() => {
        const swallow = (e: DragEvent) => e.preventDefault();
        window.addEventListener("dragover", swallow);
        window.addEventListener("drop", swallow);
        return () => {
            window.removeEventListener("dragover", swallow);
            window.removeEventListener("drop", swallow);
        };
    }, []);

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); depth.current = 0; setDragging(false);
        if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files);
    }, [onFiles]);

    return (
        <div
            role="button"
            tabIndex={0}
            aria-label="Add application files: drag and drop here, or activate to browse"
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
            onDragEnter={(e) => { e.preventDefault(); depth.current += 1; setDragging(true); }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => { depth.current -= 1; if (depth.current <= 0) setDragging(false); }}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`mb-5 cursor-pointer rounded-2xl border-2 border-dashed bg-white px-6 py-11 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                dragging ? "border-blue-600 bg-blue-50" : "border-slate-300"}`}
        >
            <Upload size={40} strokeWidth={1.5} className={`mx-auto mb-3 ${dragging ? "text-blue-600" : "text-slate-500"}`} />
            <div className="text-lg font-semibold">{dragging ? "Drop files to add them" : "Drag files here, or click to browse"}</div>
            <div className="text-sm text-slate-400">Combined application PDFs or images (TTB Form 5100.31, OMB No. 1513-0020), or a ZIP folder of them</div>
            <input ref={inputRef} type="file" multiple accept=".pdf,.zip,.png,.jpg,.jpeg,.webp,.gif" className="hidden"
                   onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }} />
        </div>
    );
}
