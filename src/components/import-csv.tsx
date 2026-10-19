"use client";

import { useState, useRef } from "react";
import { UploadCloud, FileSpreadsheet, X, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import { Button, cn } from "@/components/ui";

type CsvRow = {
  type: "task" | "event";
  title: string;
  date: string;
  time: string | null;
  duration_min: number;
  section: string | null;
  description: string | null;
};

export function ImportCsvWidget() {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function parseCsv(text: string): CsvRow[] {
    // Убираем BOM, если он есть (частая проблема Windows-блокнота)
    const cleanText = text.replace(/^\uFEFF/, "");
    const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const rows: CsvRow[] = [];
    // Пропускаем заголовок (i = 1)
    for (let i = 1; i < lines.length; i++) {
      // Простой парсер: разбиваем по запятой
      const cols = lines[i].split(",").map((c) => c.trim());
      if (cols.length < 3) continue;

      const [type, title, date, time, duration, section, description] = cols;
      if (type !== "task" && type !== "event") continue;

      rows.push({
        type: type as "task" | "event",
        title: title || "Без названия",
        date: date || new Date().toISOString().split("T")[0],
        time: time && time.length > 0 ? time : null,           // null вместо ""
        duration_min: parseInt(duration, 10) || 0,
        section: section && section.length > 0 ? section : null, // null вместо ""
        description: description && description.length > 0 ? description : null, // null вместо ""
      });
    }
    return rows;
  }

  async function handleFile(file: File) {
    if (!file.name.endsWith(".csv")) {
      toast.error("Неверный формат", "Пожалуйста, загрузите файл .csv");
      return;
    }
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseCsv(text);
    
    if (parsed.length === 0) {
      toast.error("Ошибка парсинга", "Файл пуст или имеет неверный формат");
      setFileName(null);
      return;
    }
    setPreview(parsed);
  }

  async function submitImport() {
    if (preview.length === 0) return;
    setIsLoading(true);
    try {
      await api("/import", {
        method: "POST",
        body: { items: preview },
      });
      toast.success("Импорт завершён", `Успешно добавлено ${preview.length} записей`);
      setPreview([]);
      setFileName(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось сохранить данные";
      toast.error("Ошибка импорта", msg);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Зона Drag & Drop */}
      {!fileName && (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors",
            isDragging ? "border-cyan-400 bg-cyan-400/10" : "border-slate-700 hover:border-slate-500 hover:bg-white/5"
          )}
        >
          <UploadCloud size={32} className={cn("mb-3", isDragging ? "text-cyan-400" : "text-slate-400")} />
          <p className="text-sm font-semibold text-slate-200">
            {isDragging ? "Отпустите файл для загрузки" : "Нажмите или перетащите CSV файл"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Формат: type, title, date, time, duration_min, section, description
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {/* Превью данных */}
      {preview.length > 0 && (
        <div className="glass flex flex-col rounded-xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <FileSpreadsheet size={16} className="text-cyan-400" />
              {fileName} — найдено {preview.length} записей
            </div>
            <button onClick={() => { setPreview([]); setFileName(null); }} className="btn btn-ghost btn-icon">
              <X size={16} />
            </button>
          </div>

          <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-black/20">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-900 text-slate-400">
                <tr>
                  <th className="p-2">Тип</th>
                  <th className="p-2">Название</th>
                  <th className="p-2">Дата</th>
                  <th className="p-2">Время</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 text-slate-300">
                {preview.slice(0, 5).map((row, i) => (
                  <tr key={i}>
                    <td className="p-2">
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", row.type === "task" ? "bg-cyan-500/20 text-cyan-400" : "bg-indigo-500/20 text-indigo-400")}>
                        {row.type}
                      </span>
                    </td>
                    <td className="p-2 truncate max-w-[150px]">{row.title}</td>
                    <td className="p-2">{row.date}</td>
                    <td className="p-2">{row.time || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 5 && (
              <p className="p-2 text-center text-[10px] text-slate-500">...и ещё {preview.length - 5} записей</p>
            )}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setPreview([]); setFileName(null); }}>Отмена</Button>
            <Button onClick={submitImport} disabled={isLoading}>
              {isLoading ? "Загрузка..." : <><CheckCircle2 size={15} className="mr-1"/> Импортировать</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}