import { listLocalDatabases } from "@prisma/adapter-d1";
import { defineConfig } from "prisma/config";

export default defineConfig({
	schema: "schemas/schema.prisma",
	migrations: {
		path: "prisma/migrations",
	},
	datasource: {
		url: `file:${listLocalDatabases().pop()}`,
	},
});
