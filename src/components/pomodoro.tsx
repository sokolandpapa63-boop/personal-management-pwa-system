"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link2, Pause, Play, RotateCcw } from "lucide-react";
import { api } from "@/lib/client/api";
import { browserNotify } from "@/lib/client/realtime";
import { toast } from "@/lib/client/stores";
import { useSections, useSettings, useTasks } from "@/lib/client/hooks";
import { Button, cn, Select } from "@/components/ui";

type Mode = "work" | "short_break" | "long_break";
type Status = "idle" | "active" | "paused";

type ServerSession = {
  id: string;
  status: "active" | "paused" | "completed" | "cancelled";
  type: Mode;
  startedAt: string;
  endAt: string | null;
  remainingSec: number | null;
  duration: number;
  sectionId: string | null;
  taskId: string | null;
};

const MODE_LABEL: Record<Mode, string> = {
  work: "Фокус",
  short_break: "Короткий перерыв",
  long_break: "Длинный перерыв",
};

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  } catch {}
}

export function PomodoroWidget() {
  const queryClient = useQueryClient();
  const settings = useSettings().data;
  const sections = useSections().data ?? [];
  const tasks = useTasks({ status: "active" }).data ?? [];

  const workMin = settings?.pomodoroWork ?? 25;
  const shortMin = settings?.pomodoroShortBreak ?? 5;
  const longMin = settings?.pomodoroLongBreak ?? 15;
  const cycleLen = settings?.pomodoroCycles ?? 4;

  const durationFor = (m: Mode) =>
    (m === "work" ? workMin : m === "short_break" ? shortMin : longMin) * 60;

  const [mode, setMode] = useState<Mode>("work");
  const [cycle, setCycle] = useState(0);
  const [sectionId, setSectionId] = useState<string>("");
  const [taskId, setTaskId] = useState<string>("");

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [endAt, setEndAt] = useState<number | null>(null);
  const [pausedRemaining, setPausedRemaining] = useState<number>(0);
  const [total, setTotal] = useState<number>(durationFor("work"));
  const [remaining, setRemaining] = useState<number>(durationFor("work"));

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tableSections = useMemo(() => sections.filter((s) => s.kind === "table"), [sections]);

  function applyServerSession(s: ServerSession) {
    setSessionId(s.id);
    setMode(s.type);
    setTotal(s.duration * 60);
    if (s.sectionId) setSectionId(s.sectionId);
    if (s.taskId) setTaskId(s.taskId);

    if (s.status === "active" && s.endAt) {
      setStatus("active");
      setEndAt(new Date(s.endAt).getTime());
      setPausedRemaining(0);
    } else if (s.status === "paused") {
      setStatus("paused");
      setEndAt(null);
      setPausedRemaining(s.remainingSec ?? 0);
      setRemaining(s.remainingSec ?? 0);
    } else {
      setStatus("idle");
      setEndAt(null);
      setSessionId(null);
      setPausedRemaining(0);
      setRemaining(durationFor(s.type));
    }
  }

  // Восстановление при монтировании + polling каждые 3 секунды
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await api<{ session: ServerSession | null }>("/pomodoro/current");
        if (cancelled) return;
        if (res.session) applyServerSession(res.session);
      } catch {}
    }

    void load();
    pollRef.current = setInterval(load, 3000);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Локальный тик каждые 250 мс
  useEffect(() => {
    if (status !== "active" || !endAt) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) void finish(true);
    };
    tick();
    intervalRef.current = setInterval(tick, 250);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, endAt]);

  // Обновление длительности, когда таймер не идёт
  useEffect(() => {
    if (status === "idle") {
      const d = durationFor(mode);
      setRemaining(d);
      setTotal(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, workMin, shortMin, longMin, status]);

  async function start() {
    if (status === "active") return;

    if (status === "paused" && sessionId) {
      try {
        const res = await api<{ session: ServerSession }>(`/pomodoro/${sessionId}/resume`, {
          method: "POST",
          body: { remainingSec: pausedRemaining },
        });
        applyServerSession(res.session);
      } catch {
        toast.error("Не удалось продолжить");
      }
      return;
    }

    const d = durationFor(mode);
    try {
      const res = await api<{ session: ServerSession }>("/pomodoro/start", {
        method: "POST",
        body: {
          duration: Math.round(d / 60),
          type: mode,
          sectionId: mode === "work" && sectionId ? sectionId : null,
          taskId: mode === "work" && taskId ? taskId : null,
        },
      });
      applyServerSession(res.session);
    } catch {
      toast.error("Не удалось запустить");
    }
  }

  async function pause() {
    if (status !== "active" || !sessionId || !endAt) return;
    const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    try {
      const res = await api<{ session: ServerSession }>(`/pomodoro/${sessionId}/pause`, {
        method: "POST",
        body: { remainingSec: left },
      });
      applyServerSession(res.session);
    } catch {
      toast.error("Не удалось поставить на паузу");
    }
  }

  async function finish(fromTimer = false) {
    if (!sessionId) return;
    try {
      await api(`/pomodoro/${sessionId}/finish`, { method: "POST" });
    } catch {}
    const finishedMode = mode;
    setStatus("idle");
    setEndAt(null);
    setSessionId(null);
    setPausedRemaining(0);
    queryClient.invalidateQueries({ queryKey: ["pomodoro"] });

    if (fromTimer) {
      beep();
      if (finishedMode === "work") {
        browserNotify("Pomodoro: фокус завершён", "Время перерыва");
        toast.success("Фокус завершён", "Отдохните немного");
        const nextCycle = cycle + 1;
        setCycle(nextCycle);
        setMode(nextCycle % cycleLen === 0 ? "long_break" : "short_break");
      } else {
        browserNotify("Перерыв окончен", "Возвращаемся к работе");
        setMode("work");
      }
    } else {
      setRemaining(durationFor(finishedMode));
    }
  }

  async function reset() {
    if (sessionId) {
      try {
        await api(`/pomodoro/${sessionId}/cancel`, { method: "POST" });
      } catch {}
    }
    setStatus("idle");
    setEndAt(null);
    setSessionId(null);
    setPausedRemaining(0);
    const d = durationFor(mode);
    setRemaining(d);
    setTotal(d);
  }

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const R = 84;
  const CIRC = 2 * Math.PI * R;
  const progress = total > 0 ? 1 - remaining / total : 0;
  const color = mode === "work" ? "#22d3ee" : mode === "short_break" ? "#34d399" : "#818cf8";

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Pomodoro</p>
          <p className="text-sm font-semibold" style={{ color }}>{MODE_LABEL[mode]}</p>
        </div>
        <div className="flex items-center gap-1">
          {Array.from({ length: cycleLen }).map((_, i) => (
            <span key={i} className={cn("h-1.5 w-4 rounded-full transition-colors", i < cycle % cycleLen ? "bg-cyan-400" : "bg-slate-700")} />
          ))}
        </div>
      </div>

      <div className="relative mx-auto my-1">
        <svg width="190" height="190" viewBox="0 0 190 190">
          <circle cx="95" cy="95" r={R} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="9" />
          <circle
            className="pomo-ring"
            cx="95" cy="95" r={R} fill="none"
            stroke={color} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - progress)}
            transform="rotate(-90 95 95)"
            style={{ filter: `drop-shadow(0 0 10px ${color}66)` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display num text-4xl font-semibold tracking-wider text-slate-50">
            {mm}<span className={cn("transition-opacity", status === "active" && "tick-digit")}>:</span>{ss}
          </span>
          <span className="mt-1 text-[10px] uppercase tracking-[0.22em] text-slate-500">
            цикл {Math.min(cycle + 1, cycleLen)}/{cycleLen}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        {status !== "active" ? (
          <Button onClick={start} className="min-w-[104px]">
            <Play size={15} /> {status === "paused" ? "Продолжить" : "Старт"}
          </Button>
        ) : (
          <Button onClick={pause} variant="outline" className="min-w-[104px]">
            <Pause size={15} /> Пауза
          </Button>
        )}
        <Button onClick={reset} variant="ghost" size="icon" title="Сброс"><RotateCcw size={15} /></Button>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-2">
          <Link2 size={13} className="shrink-0 text-slate-500" />
          <Select value={taskId} onChange={(e) => setTaskId(e.target.value)} className="py-1.5 text-xs">
            <option value="">Без задачи</option>
            {tasks.slice(0, 40).map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Link2 size={13} className="shrink-0 text-slate-500" />
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="py-1.5 text-xs">
            <option value="">Без раздела</option>
            {tableSections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}
