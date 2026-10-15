import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  login: text("login").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  timezone: text("timezone").notNull().default("Europe/Moscow"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("refresh_tokens_user_idx").on(t.userId)],
);

export const userSettings = pgTable("user_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("system"),
  baseCurrency: text("base_currency").notNull().default("USD"),
  displayCurrency: text("display_currency").notNull().default("USD"),
  dailyReportTime: text("daily_report_time").notNull().default("21:00"),
  weeklyReportDay: integer("weekly_report_day").notNull().default(7),
  monthlyReportDay: integer("monthly_report_day").notNull().default(1),
  pomodoroWork: integer("pomodoro_work").notNull().default(25),
  pomodoroShortBreak: integer("pomodoro_short_break").notNull().default(5),
  pomodoroLongBreak: integer("pomodoro_long_break").notNull().default(15),
  pomodoroCycles: integer("pomodoro_cycles").notNull().default(4),
  notifyTask: boolean("notify_task").notNull().default(true),
  notifyEvent: boolean("notify_event").notNull().default(true),
  notifyPomodoro: boolean("notify_pomodoro").notNull().default(true),
  notifyReport: boolean("notify_report").notNull().default(true),
  notifySession: boolean("notify_session").notNull().default(true),
  leadTimeMinutes: integer("lead_time_minutes").notNull().default(10),
});

export const sections = pgTable(
  "sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    icon: text("icon"),
    color: text("color"),
    order: integer("order").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    kind: text("kind").notNull().default("table"), // table | container
    slug: text("slug"),
    depositCurrency: text("deposit_currency"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sections_user_parent_idx").on(t.userId, t.parentId)],
);

export const tableSchemas = pgTable("table_schemas", {
  id: uuid("id").defaultRandom().primaryKey(),
  sectionId: uuid("section_id")
    .notNull()
    .unique()
    .references(() => sections.id, { onDelete: "cascade" }),
  columns: jsonb("columns").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tableRecords = pgTable(
  "table_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull(),
    amountBase: numeric("amount_base", { precision: 20, scale: 8 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("table_records_section_created_idx").on(t.sectionId, t.createdAt)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"), // active | completed | cancelled
    priority: integer("priority").notNull().default(2), // 1..3
    dueAt: timestamp("due_at", { withTimezone: true }),
    recurrence: jsonb("recurrence"),
    tags: jsonb("tags"),
    parentTaskId: uuid("parent_task_id"),
    cancelReason: text("cancel_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_user_due_idx").on(t.userId, t.dueAt),
    index("tasks_user_status_idx").on(t.userId, t.status),
  ],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_user_start_idx").on(t.userId, t.startAt)],
);

export const pomodoroSessions = pgTable(
  "pomodoro_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
    taskId: uuid("task_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    remainingSec: integer("remaining_sec"),
    duration: integer("duration").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull().default("active"),
    completed: boolean("completed").notNull().default(false),
  },
  (t) => [index("pomodoro_user_started_idx").on(t.userId, t.startedAt)],
);

export const studySessions = pgTable("study_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  course: integer("course").notNull(),
  sessionType: text("session_type").notNull(), // winter | summer
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    baseCode: text("base_code").notNull(),
    quoteCode: text("quote_code").notNull(),
    rate: numeric("rate", { precision: 20, scale: 8 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("exchange_rates_pair_idx").on(t.baseCode, t.quoteCode)],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // daily | weekly | monthly | manual
    periodFrom: timestamp("period_from", { withTimezone: true }).notNull(),
    periodTo: timestamp("period_to", { withTimezone: true }).notNull(),
    fileUrl: text("file_url").notNull(),
    fileSize: integer("file_size"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reports_user_type_idx").on(t.userId, t.type, t.createdAt)],
);

export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    platform: text("platform").notNull().default("web"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_tokens_user_idx").on(t.userId)],
);

export type User = typeof users.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type AppEvent = typeof events.$inferSelect;
