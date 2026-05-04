import {
	type InferInsertModel,
	type InferSelectModel,
	pgTable,
	text,
	timestamp,
} from "@example/vendor-db";

export const exampleProbeEvents = pgTable("example_probe_events", {
	id: text("id").primaryKey(),
	source: text("source").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExampleProbeEvent = InferSelectModel<typeof exampleProbeEvents>;
export type InsertExampleProbeEvent = InferInsertModel<typeof exampleProbeEvents>;
