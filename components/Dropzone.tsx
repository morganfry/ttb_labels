import { useRef, useState, useCallback } from "react";
import { Upload } from "lucide-react";

export function Dropzone({ onFiles }: { onFiles: (files: FileList) => void }) {
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); setDragging(false);
        if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files);
    }, [onFiles]);

    return (
        <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`mb-5 cursor-pointer rounded-2xl border-2 border-dashed bg-white px-6 py-11 text-center transition-colors ${
                dragging ? "border-blue-600 bg-blue-50" : "border-slate-300"}`}
        >
            <Upload size={40} strokeWidth={1.5} className={`mx-auto mb-3 ${dragging ? "text-blue-600" : "text-slate-500"}`} />
            <div className="text-lg font-semibold">{dragging ? "Drop files to add them" : "Drag files here, or click to browse"}</div>
            <div className="text-sm text-slate-400">PDF applications, or a ZIP folder of them</div>
            <input ref={inputRef} type="file" multiple accept=".pdf,.zip,.7z,.rar,.tar,.gz" className="hidden"
                   onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }} />
        </div>
    );
}
