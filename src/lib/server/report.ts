import { and, eq, gte, lte, inArray, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  events,
  pomodoroSessions,
  reports,
  sections,
  studySessions,
  tableRecords,
  tableSchemas,
  tasks,
  userSettings,
  users,
} from "@/db/schema";
import { DEFAULT_TZ, toZonedDateStr, type Column, sortColumns } from "./core";
import { getRates, convertWith } from "./currency";
import { emit } from "./bus";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(n: number, currency?: string): string {
  const str = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
    Math.round(n * 100) / 100,
  );
  return currency ? `${str} ${currency}` : str;
}

export function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function fmtDateRu(d: Date, tz: string): string {
  const key = toZonedDateStr(tz, d);
  const [y, m, day] = key.split("-").map(Number);
  return `${day} ${MONTHS_RU[m - 1]} ${y}`;
}

function svgBarChart(
  data: { label: string; value: number }[],
  color: string,
  width = 520,
  height = 140,
): string {
  if (!data.length) return "";
  const max = Math.max(...data.map((d) => d.value), 1);
  const bw = Math.floor((width - data.length * 6) / data.length);
  const bars = data
    .map((d, i) => {
      const h = Math.max(2, Math.round((d.value / max) * (height - 30)));
      const x = i * (bw + 6);
      const y = height - 20 - h;
      return `<g><rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="3" fill="${color}"></rect><text x="${
        x + bw / 2
      }" y="${height - 6}" font-size="9" text-anchor="middle" fill="#64748b">${esc(d.label)}</text><text x="${
        x + bw / 2
      }" y="${y - 4}" font-size="9" text-anchor="middle" fill="#334155">${esc(
        new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(d.value),
      )}</text></g>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

function svgLineChart(
  points: { x: string; y: number }[],
  color: string,
  width = 520,
  height = 120,
): string {
  if (points.length < 2) return "";
  const maxY = Math.max(...points.map((p) => p.y), 1);
  const minY = Math.min(...points.map((p) => p.y), 0);
  const span = Math.max(maxY - minY, 1e-9);
  const stepX = (width - 40) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = 20 + i * stepX;
    const y = 10 + (1 - (p.y - minY) / span) * (height - 34);
    return { x, y, p };
  });
  const poly = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const dots = coords
    .map(
      (c) =>
        `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" fill="${color}"><title>${esc(
          c.p.x,
        )}: ${esc(String(Math.round(c.p.y * 100) / 100))}</title></circle>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg"><polyline fill="none" stroke="${color}" stroke-width="2" points="${poly}"/>${dots}</svg>`;
}

type ReportParams = {
  type: string; // daily | weekly | monthly | manual
  from: Date;
  to: Date;
  sectionIds?: string[];
};

export async function generateReport(userId: string, params: ReportParams) {
  const tz = DEFAULT_TZ;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const baseCurrency = settings?.baseCurrency ?? "USD";
  const { rates } = await getRates();

  const fromKey = toZonedDateStr(tz, params.from);
  const toKey = toZonedDateStr(tz, params.to);

  const allSections = await db.select().from(sections).where(eq(sections.userId, userId));
  const bySlug = new Map(allSections.map((s) => [s.slug, s]));
  const byId = new Map(allSections.map((s) => [s.id, s]));

  // Задачи
  const completedTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), gte(tasks.completedAt, params.from), lte(tasks.completedAt, params.to)));
  const allUserTasks = await db.select().from(tasks).where(eq(tasks.userId, userId));
  const cancelledTasks = allUserTasks.filter(
    (t) => t.status === "cancelled" && t.updatedAt >= params.from && t.updatedAt <= params.to,
  );
  const overdueTasks = allUserTasks.filter(
    (t) => t.status === "active" && t.dueAt && t.dueAt < new Date(),
  );

  // Pomodoro
  const poms = await db
    .select()
    .from(pomodoroSessions)
    .where(
      and(
        eq(pomodoroSessions.userId, userId),
        eq(pomodoroSessions.completed, true),
        eq(pomodoroSessions.type, "work"),
        gte(pomodoroSessions.startedAt, params.from),
        lte(pomodoroSessions.startedAt, params.to),
      ),
    );
  const focusMinutes = poms.reduce((acc, p) => acc + p.duration, 0);

  // События
  const evs = await db
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), gte(events.startAt, params.from), lte(events.startAt, params.to)));

  // Сессия обучения
  const [study] = await db.select().from(studySessions).where(eq(studySessions.userId, userId)).limit(1);

  // Табличные данные
  const sectionIds = [
    ...new Set(
      [
        bySlug.get("sport")?.id,
        bySlug.get("education")?.id,
        ...allSections.filter((s) => s.parentId === bySlug.get("finance")?.id).map((s) => s.id),
        ...(params.sectionIds ?? []),
      ].filter(Boolean) as string[],
    ),
  ];
  const recordRows = sectionIds.length
    ? await db.select().from(tableRecords).where(inArray(tableRecords.sectionId, sectionIds))
    : [];
  const schemaRows = sectionIds.length
    ? await db.select().from(tableSchemas).where(inArray(tableSchemas.sectionId, sectionIds))
    : [];
  const schemaBySection = new Map(schemaRows.map((s) => [s.sectionId, s.columns as unknown as Column[]]));

  const inPeriod = (dateKey: string | null, createdAt: Date) => {
    const key = dateKey ?? toZonedDateStr(tz, createdAt);
    return key >= fromKey && key <= toKey;
  };

  const secRecords = (sid: string) =>
    recordRows.filter((r) => r.sectionId === sid && inPeriod((r.data as Record<string, string>).date ?? null, r.createdAt));

  // ── Блоки HTML ──
  const blocks: string[] = [];

  // Спорт
  const sport = bySlug.get("sport");
  if (sport) {
    const recs = secRecords(sport.id);
    const byExercise = new Map<string, number>();
    const weightByDay = new Map<string, number[]>();
    const volumeByDay = new Map<string, number>();
    for (const r of recs) {
      const d = r.data as Record<string, unknown>;
      const ex = String(d.exercise ?? "—");
      const vol = Number(d.volume) || 0;
      byExercise.set(ex, (byExercise.get(ex) ?? 0) + vol);
      const day = String(d.date ?? toZonedDateStr(tz, r.createdAt)).slice(5);
      volumeByDay.set(day, (volumeByDay.get(day) ?? 0) + vol);
      if (Number(d.weight)) {
        const arr = weightByDay.get(day) ?? [];
        arr.push(Number(d.weight));
        weightByDay.set(day, arr);
      }
    }
    const weightLine = [...weightByDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([x, arr]) => ({ x, y: arr.reduce((s, v) => s + v, 0) / arr.length }));
    blocks.push(`
      <h2>Спорт</h2>
      <p class="muted">Тренировок: <b>${recs.length}</b> · Общий объём: <b>${fmtMoney(
        [...byExercise.values()].reduce((s, v) => s + v, 0),
      )} кг</b></p>
      ${recs.length ? `<h3>Объём по упражнениям (кг)</h3>${svgBarChart(
        [...byExercise.entries()].map(([label, value]) => ({ label, value })),
        "#0ea5e9",
      )}` : '<p class="muted">Записей за период нет.</p>'}
      ${volumeByDay.size ? `<h3>Объём по дням (кг)</h3>${svgBarChart(
        [...volumeByDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value })),
        "#22d3ee",
      )}` : ""}
      ${weightLine.length >= 2 ? `<h3>Динамика веса (кг)</h3>${svgLineChart(weightLine, "#a78bfa")}` : ""}
    `);
  }

  // Образование
  const edu = bySlug.get("education");
  if (edu) {
    const recs = secRecords(edu.id);
    const count = (type: string, status: string) =>
      recs.filter((r) => {
        const d = r.data as Record<string, unknown>;
        return d.type === type && d.status === status;
      }).length;
    const doneTasks = count("Задание", "Выполнено");
    const passedTests = count("Зачёт", "Сдано");
    const passedExams = count("Экзамен", "Сдано");
    let sessionHtml = '<p class="muted">Учебная сессия не настроена.</p>';
    if (study) {
      const now = new Date();
      const status = now < study.startsAt ? "не началась" : now > study.endsAt ? "закончилась" : "идёт";
      sessionHtml = `<p>Сессия: <b>${study.course} курс, ${study.sessionType === "winter" ? "зимняя" : "летняя"}</b> — статус «${status}» (${fmtDateRu(study.startsAt, tz)} — ${fmtDateRu(study.endsAt, tz)})</p>`;
    }
    blocks.push(`
      <h2>Образование</h2>
      <div class="cards">
        <div class="card"><div class="num">${doneTasks}</div><div class="lbl">выполнено заданий</div></div>
        <div class="card"><div class="num">${passedTests}</div><div class="lbl">сдано зачётов</div></div>
        <div class="card"><div class="num">${passedExams}</div><div class="lbl">сдано экзаменов</div></div>
      </div>
      ${sessionHtml}
    `);
  }

  // Финансы
  const finance = bySlug.get("finance");
  if (finance) {
    const children = allSections.filter((s) => s.parentId === finance.id);
    let totalIncome = 0;
    let totalExpense = 0;
    const childBlocks: string[] = [];
    const dayNet = new Map<string, number>();
    for (const child of children) {
      const recs = secRecords(child.id);
      if (!recs.length) continue;
      const dep = child.depositCurrency ?? "RUB";
      let income = 0;
      let expense = 0;
      for (const r of recs) {
        const d = r.data as Record<string, unknown>;
        const amount = Number(d.amount) || 0;
        const base = d.amountBase != null ? Number(d.amountBase) : convertWith(rates, amount, dep, baseCurrency) ?? 0;
        const day = String(d.date ?? toZonedDateStr(tz, r.createdAt)).slice(5);
        if (d.operation === "Доход") {
          income += base;
          dayNet.set(day, (dayNet.get(day) ?? 0) + base);
        } else if (d.operation === "Расход") {
          expense += base;
          dayNet.set(day, (dayNet.get(day) ?? 0) - base);
        }
      }
      totalIncome += income;
      totalExpense += expense;
      childBlocks.push(`
        <h3>${esc(child.name)} <span class="muted">(депозит: ${dep})</span></h3>
        <table><thead><tr><th>Дата</th><th>Операция</th><th>Категория</th><th class="r">Сумма</th><th class="r">${esc(baseCurrency)}</th><th>Комментарий</th></tr></thead><tbody>
        ${recs
          .map((r) => {
            const d = r.data as Record<string, unknown>;
            const base = d.amountBase != null ? Number(d.amountBase) : convertWith(rates, Number(d.amount) || 0, dep, baseCurrency) ?? 0;
            return `<tr><td>${esc(d.date)}</td><td>${esc(d.operation)}</td><td>${esc(d.category ?? "—")}</td><td class="r">${fmtMoney(Number(d.amount) || 0, dep)}</td><td class="r">${fmtMoney(base)}</td><td>${esc(d.notes ?? "")}</td></tr>`;
          })
          .join("")}
        </tbody></table>
        <p class="muted">Доход: <b>${fmtMoney(income, baseCurrency)}</b> · Расход: <b>${fmtMoney(expense, baseCurrency)}</b> · Итог: <b>${fmtMoney(
          income - expense,
          baseCurrency,
        )}</b></p>
      `);
    }
    blocks.push(`
      <h2>Финансы</h2>
      <div class="cards">
        <div class="card"><div class="num green">+${fmtMoney(totalIncome)}</div><div class="lbl">доход, ${esc(baseCurrency)}</div></div>
        <div class="card"><div class="num red">−${fmtMoney(totalExpense)}</div><div class="lbl">расход, ${esc(baseCurrency)}</div></div>
        <div class="card"><div class="num">${fmtMoney(totalIncome - totalExpense)}</div><div class="lbl">итог, ${esc(baseCurrency)}</div></div>
      </div>
      ${dayNet.size ? `<h3>Денежный поток по дням (${esc(baseCurrency)})</h3>${svgBarChart(
        [...dayNet.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value: Math.abs(value) })),
        "#34d399",
      )}` : ""}
      ${childBlocks.join("")}
    `);
  }

  // Пользовательские разделы
  const autoIds = new Set([
    sport?.id,
    edu?.id,
    ...(finance ? allSections.filter((s) => s.parentId === finance.id).map((s) => s.id) : []),
  ]);
  for (const sid of params.sectionIds ?? []) {
    if (autoIds.has(sid)) continue;
    const sec = byId.get(sid);
    if (!sec) continue;
    const schema = schemaBySection.get(sid) ?? [];
    const recs = secRecords(sid);
    const numericCols = sortColumns(schema).filter((c) =>
      ["number", "money", "formula"].includes(c.type),
    );
    if (!recs.length) {
      blocks.push(`<h2>${esc(sec.name)}</h2><p class="muted">Записей за период нет.</p>`);
      continue;
    }
    blocks.push(`
      <h2>${esc(sec.name)}</h2>
      <p class="muted">Записей: <b>${recs.length}</b></p>
      ${numericCols
        .map((c) => {
          const sum = recs.reduce((s, r) => s + (Number((r.data as Record<string, unknown>)[c.key]) || 0), 0);
          return `<p>${esc(c.name)} — сумма: <b>${fmtMoney(sum, c.type === "money" ? sec.depositCurrency ?? "" : undefined)}</b></p>`;
        })
        .join("")}
    `);
  }

  // Задачи + Pomodoro
  const doneByDay = new Map<string, number>();
  for (const t of completedTasks) {
    const day = toZonedDateStr(tz, t.completedAt!).slice(5);
    doneByDay.set(day, (doneByDay.get(day) ?? 0) + 1);
  }
  const cancelReasons = cancelledTasks
    .map((t) => ({ title: t.title, reason: t.cancelReason ?? "—" }))
    .slice(0, 30);
  blocks.push(`
    <h2>Задачи</h2>
    <div class="cards">
      <div class="card"><div class="num green">${completedTasks.length}</div><div class="lbl">выполнено</div></div>
      <div class="card"><div class="num amber">${cancelledTasks.length}</div><div class="lbl">отменено</div></div>
      <div class="card"><div class="num red">${overdueTasks.length}</div><div class="lbl">просрочено сейчас</div></div>
    </div>
    ${doneByDay.size ? `<h3>Выполнение по дням</h3>${svgBarChart(
      [...doneByDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value })),
      "#818cf8",
    )}` : ""}
    ${
      cancelReasons.length
        ? `<h3>Причины отмен</h3><ul>${cancelReasons.map((c) => `<li><b>${esc(c.title)}</b> — ${esc(c.reason)}</li>`).join("")}</ul>`
        : ""
    }
    <h2>Pomodoro</h2>
    <p>Завершено рабочих сессий: <b>${poms.length}</b> · В фокусе: <b>${focusMinutes}</b> ${ruPlural(
      focusMinutes,
      "минута",
      "минуты",
      "минут",
    )} · Событий в календаре: <b>${evs.length}</b></p>
  `);

  const typeName: Record<string, string> = {
    daily: "Ежедневный отчёт",
    weekly: "Еженедельный отчёт",
    monthly: "Ежемесячный отчёт",
    manual: "Отчёт вручную",
  };

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"/><title>${typeName[params.type] ?? "Отчёт"} — Моя система</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; background: #f1f5f9; color: #0f172a; margin: 0; padding: 24px; }
  .page { max-width: 820px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 40px 44px; box-shadow: 0 10px 40px rgba(15,23,42,.08); }
  header.hero { background: linear-gradient(135deg, #0f172a, #1e293b 60%, #0c4a6e); color: #e2e8f0; border-radius: 12px; padding: 28px 32px; margin-bottom: 28px; }
  header.hero h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: .5px; }
  header.hero p { margin: 2px 0; color: #94a3b8; font-size: 13px; }
  h2 { font-size: 18px; margin: 32px 0 10px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
  h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin: 18px 0 8px; }
  p { font-size: 14px; line-height: 1.55; }
  ul { font-size: 13px; }
  .muted { color: #64748b; font-size: 13px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0; }
  .card { flex: 1; min-width: 140px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; }
  .num { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .num.green { color: #059669; } .num.red { color: #dc2626; } .num.amber { color: #d97706; }
  .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #64748b; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
  th { text-transform: uppercase; font-size: 10px; letter-spacing: .06em; color: #64748b; background: #f8fafc; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  .print-btn { position: fixed; right: 20px; bottom: 20px; background: #0f172a; color: #fff; border: 0; border-radius: 999px; padding: 12px 22px; font-size: 14px; cursor: pointer; box-shadow: 0 8px 24px rgba(15,23,42,.3); }
  @media print { body { background: #fff; padding: 0; } .page { box-shadow: none; max-width: none; padding: 0; } .print-btn { display: none; } header.hero { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="page">
  <header class="hero">
    <h1>${typeName[params.type] ?? "Отчёт"}</h1>
    <p>Период: ${fmtDateRu(params.from, tz)} — ${fmtDateRu(params.to, tz)}</p>
    <p>Сформирован: ${fmtDateRu(new Date(), tz)} · Пользователь: ${esc(user?.login ?? "")} · Базовая валюта: ${esc(baseCurrency)}</p>
  </header>
  <h2>Общая сводка</h2>
  <div class="cards">
    <div class="card"><div class="num">${completedTasks.length}</div><div class="lbl">задач выполнено</div></div>
    <div class="card"><div class="num">${poms.length}</div><div class="lbl">pomodoro-сессий</div></div>
    <div class="card"><div class="num">${focusMinutes}</div><div class="lbl">минут фокуса</div></div>
    <div class="card"><div class="num">${evs.length}</div><div class="lbl">событий</div></div>
  </div>
  ${blocks.join("\n")}
</div>
<button class="print-btn" onclick="window.print()">Сохранить как PDF</button>
</body></html>`;

  const [row] = await db
    .insert(reports)
    .values({
      userId,
      type: params.type,
      periodFrom: params.from,
      periodTo: params.to,
      fileUrl: "",
      fileSize: Buffer.byteLength(html, "utf8"),
      meta: {
        html,
        summary: {
          tasksCompleted: completedTasks.length,
          tasksCancelled: cancelledTasks.length,
          tasksOverdue: overdueTasks.length,
          pomodoroSessions: poms.length,
          focusMinutes,
        },
      },
    })
    .returning();
  await db.update(reports).set({ fileUrl: `/api/v1/reports/${row.id}/file` }).where(eq(reports.id, row.id));
  emit(userId, "report.ready", { reportId: row.id, type: params.type });
  return { ...row, fileUrl: `/api/v1/reports/${row.id}/file` };
}
