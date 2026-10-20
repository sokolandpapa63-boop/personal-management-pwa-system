"use client";

import { type ReactNode, useEffect, useMemo, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell, Briefcase, CalendarDays, ChevronDown, Dumbbell, FileText, Folder, FolderPlus,
  GraduationCap, Landmark, LayoutDashboard, ListTodo, LogOut, Menu, RefreshCw,
  Settings as SettingsIcon, SlidersHorizontal, Sparkles, TrendingUp, Wallet, X,
} from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuthStore, useOnlineStore, useUiStore, toast } from "@/lib/client/stores";
import { useSections, type Section } from "@/lib/client/hooks";
import { Button, cn, Dialog, Field, Input, Select, Spinner } from "@/components/ui";

const ICONS: Record<string, typeof Dumbbell> = {
  dumbbell: Dumbbell,
  "graduation-cap": GraduationCap,
  wallet: Wallet,
  "candlestick-chart": TrendingUp,
  landmark: Landmark,
  sparkles: Sparkles,
  briefcase: Briefcase,
  "sliders-horizontal": SlidersHorizontal,
  "file-text": FileText,
};

function SectionIcon({ icon, size = 16 }: { icon: string | null; size?: number }) {
  const Cmp = (icon && ICONS[icon]) || Folder;
  return <Cmp size={size} />;
}

function NavTree({ sections, pathname, onNavigate }: { sections: Section[]; pathname: string; onNavigate?: () => void }) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ finance: true, control: true });
  const roots = sections.filter((s) => !s.parentId).sort((a, b) => a.order - b.order);
  const childrenOf = (id: string) => sections.filter((s) => s.parentId === id).sort((a, b) => a.order - b.order);

  const link = (href: string, label: ReactNode, icon?: ReactNode, depth = 0) => (
    <Link
      key={href}
      href={href}
      onClick={onNavigate}
      className={cn("nav-item", pathname === href && "active", depth > 0 && "ml-5 text-[13px]")}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );

  return (
    <nav className="space-y-0.5 px-3">
      {link("/", "Дашборд", <LayoutDashboard size={16} />)}
      {roots.map((sec) => {
        if (sec.slug === "control") {
          return (
            <div key={sec.id} className="pt-2">
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">{sec.name}</p>
              {link("/tasks", "Таск-менеджер", <ListTodo size={16} />)}
              {link("/planner", "Планер событий месяца", <CalendarDays size={16} />)}
              {childrenOf(sec.id).map((c) => renderSection(c, 1))}
            </div>
          );
        }
        if (sec.slug === "reports") {
          return (
            <div key={sec.id} className="pt-2">
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">{sec.name}</p>
              {link("/reports", "Все отчёты", <FileText size={16} />)}
            </div>
          );
        }
        return renderSection(sec, 0);
      })}
    </nav>
  );

  function renderSection(sec: Section, depth: number): ReactNode {
  // «Бюджет» — это страница с вкладками, а не контейнер с подразделами.
  // Рендерим его как простую ссылку, без ChevronDown.
  if (sec.slug === "budget") {
    return (
      <div key={sec.id} className="pt-0.5">
        {link(`/sections/${sec.id}`, sec.name, <SectionIcon icon={sec.icon} />, depth)}
      </div>
    );
  }

  if (sec.kind === "container") {
    const kids = childrenOf(sec.id);
    const open = openGroups[sec.slug ?? sec.id] ?? false;
    return (
      <div key={sec.id} className="pt-1.5">
        <button
          onClick={() => setOpenGroups((g) => ({ ...g, [sec.slug ?? sec.id]: !open }))}
          className={cn("nav-item w-full", depth > 0 && "ml-5")}
        >
          <SectionIcon icon={sec.icon} />
          <span className="flex-1 truncate text-left">{sec.name}</span>
          <ChevronDown size={14} className={cn("transition-transform duration-200", open && "rotate-180")} />
        </button>
        <div className={cn("grid transition-all duration-200", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
          <div className="overflow-hidden">
            {kids.map((c) => renderSection(c, depth + 1))}
            {!kids.length && <p className="ml-9 py-1 text-xs text-slate-600">пусто</p>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div key={sec.id} className="pt-0.5">
      {link(`/sections/${sec.id}`, sec.name, <SectionIcon icon={sec.icon} />, depth)}
    </div>
  );
  }
 }

function NewSectionDialog({ open, onClose, sections }: { open: boolean; onClose: () => void; sections: Section[] }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [kind, setKind] = useState<"table" | "container">("table");
  const [loading, setLoading] = useState(false);
  const containers = sections.filter((s) => s.kind === "container");

  async function submit() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api("/sections", { method: "POST", body: { name: name.trim(), parentId: parentId || null, kind } });
      queryClient.invalidateQueries({ queryKey: ["sections"] });
      toast.success("Раздел создан", name.trim());
      setName("");
      onClose();
    } catch (e) {
      toast.error("Ошибка", e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Новый раздел">
      <div className="space-y-4">
        <Field label="Название">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Книги" autoFocus />
        </Field>
        <Field label="Родительский раздел">
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— корень —</option>
            {containers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Тип">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "table" | "container")}>
            <option value="table">Таблица (записи)</option>
            <option value="container">Контейнер (группа)</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} loading={loading} disabled={!name.trim()}>Создать</Button>
        </div>
      </div>
    </Dialog>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { user, status, clear } = useAuthStore();
  const online = useOnlineStore((s) => s.online);
  const triggerWipe = useUiStore((s) => s.triggerWipe);
  const sectionsQuery = useSections();
  const [drawer, setDrawer] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [newSection, setNewSection] = useState(false);
  const [notifPermission, setNotifPermission] = useState<string>("default");

  const sections = useMemo(() => sectionsQuery.data ?? [], [sectionsQuery.data]);

  useEffect(() => {
    if (status === "guest") router.replace("/login");
  }, [status, router]);

  useEffect(() => {
    if (typeof Notification !== "undefined") setNotifPermission(Notification.permission);
  }, []);

  if (status === "boot") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Загрузка системы…" />
      </div>
    );
  }
  if (status !== "authed") return null;

  const refreshAll = (e: MouseEvent) => {
    triggerWipe(e.clientX, e.clientY);
    queryClient.invalidateQueries();
    setTimeout(() => queryClient.refetchQueries(), 60);
  };

  const enableNotifications = async () => {
    try {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
      if (perm === "granted") {
        const token = `web-${crypto.randomUUID()}`;
        await api("/push/subscribe", { method: "POST", body: { token, platform: "web" } });
        toast.success("Уведомления включены", "Push приходят при событиях системы");
      }
    } catch {
      toast.error("Браузер не поддерживает уведомления");
    }
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    clear();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-800/70 bg-slate-950/70 backdrop-blur-xl lg:flex">
        <div className="flex items-center gap-3 px-5 pb-5 pt-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="logo" className="h-9 w-9 rounded-xl shadow-[0_0_24px_rgba(34,211,238,0.35)]" />
          <div>
            <p className="font-display text-[13px] font-semibold tracking-wide text-slate-100">Моя система</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600">personal os</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto pb-3">
          <NavTree sections={sections} pathname={pathname} />
        </div>
        <div className="border-t border-slate-800/70 p-3">
          <button onClick={() => setNewSection(true)} className="nav-item w-full">
            <FolderPlus size={16} />
            Новый раздел
          </button>
          <Link href="/settings" className={cn("nav-item", pathname === "/settings" && "active")}>
            <SettingsIcon size={16} />
            Настройки
          </Link>
        </div>
      </aside>

      {/* Мобильный drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="glass-strong absolute inset-y-0 left-0 flex w-72 flex-col overflow-y-auto">
            <div className="flex items-center justify-between px-5 pb-2 pt-5">
              <p className="font-display text-sm font-semibold">Моя система</p>
              <button onClick={() => setDrawer(false)} className="rounded-lg p-1.5 text-slate-500 hover:text-slate-200"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto pb-4">
              <NavTree sections={sections} pathname={pathname} onNavigate={() => setDrawer(false)} />
            </div>
            <div className="border-t border-slate-800/70 p-3">
              <button onClick={() => { setDrawer(false); setNewSection(true); }} className="nav-item w-full">
                <FolderPlus size={16} /> Новый раздел
              </button>
              <Link href="/settings" onClick={() => setDrawer(false)} className="nav-item">
                <SettingsIcon size={16} /> Настройки
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex min-h-screen flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-800/60 bg-slate-950/60 px-4 backdrop-blur-xl">
          <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800/60 lg:hidden">
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2 text-xs">
            <span className={cn("relative flex h-2.5 w-2.5")}>
              <span className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
                online ? "bg-emerald-400" : "bg-rose-400",
              )} />
              <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", online ? "bg-emerald-400" : "bg-rose-500")} />
            </span>
            <span className="hidden text-slate-500 sm:inline">{online ? "онлайн" : "оффлайн / поллинг"}</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={refreshAll}
            className="btn btn-outline btn-sm"
            title="Обновить все данные"
          >
            <RefreshCw size={14} />
            <span className="hidden sm:inline">Обновить всё</span>
          </button>
          <button
            onClick={enableNotifications}
            className={cn("btn btn-icon", notifPermission === "granted" ? "text-emerald-400" : "text-slate-400 hover:bg-slate-800/60")}
            title={notifPermission === "granted" ? "Уведомления включены" : "Включить уведомления"}
          >
            <Bell size={16} />
          </button>
          <div className="relative">
            <button
              onClick={() => setUserMenu((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/40 to-indigo-500/40 text-xs font-bold text-cyan-100 ring-1 ring-cyan-400/30"
            >
              {user?.login.slice(0, 2).toUpperCase()}
            </button>
            {userMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUserMenu(false)} />
                <div className="glass-strong absolute right-0 z-50 mt-2 w-56 rounded-xl p-2">
                  <div className="px-3 py-2">
                    <p className="text-sm font-semibold text-slate-200">{user?.login}</p>
                    <p className="truncate text-xs text-slate-500">{user?.email}</p>
                  </div>
                  <Link href="/settings" onClick={() => setUserMenu(false)} className="nav-item"><SettingsIcon size={15} /> Настройки</Link>
                  <button onClick={logout} className="nav-item w-full text-rose-300 hover:bg-rose-500/10">
                    <LogOut size={15} /> Выйти
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>

      <NewSectionDialog open={newSection} onClose={() => setNewSection(false)} sections={sections} />
    </div>
  );
}
