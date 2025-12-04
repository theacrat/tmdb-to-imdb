import { PrismaClient, MediaType, TmdbImdb } from "./generated/prisma/client";
import { ImdbId } from "./imdb";
import { TmdbId } from "./tmdb";
import { PrismaD1 } from "@prisma/adapter-d1";

export { MediaType };

const batchSize = 24;
let prisma: PrismaClient;
let isDev: boolean;

export function instantiatePrisma(db: D1Database, env: string) {
	isDev = env === "local";
	if (!prisma) {
		const adapter = new PrismaD1(db);
		prisma = new PrismaClient({ adapter });
	}
}

export function getPrisma(): PrismaClient {
	return prisma;
}

export type DbResult = {
	tmdb: string;
	imdb: string;
};

function dbRecordToResult(record: TmdbImdb): DbResult {
	const tmdb = buildId([
		record.mediaType.toLowerCase(),
		record.title,
		...(record.mediaType === "E" ? [record.season, record.episode] : []),
	]);

	return {
		tmdb,
		imdb: record.imdb,
	};
}

export async function getIdFromDatabase(
	mediaType: MediaType,
	...segments: TmdbId
): Promise<DbResult | undefined> {
	const [title, season, episode] = segments;

	const result = await prisma.$queryRawUnsafe<
		{
			mediaType: string;
			title: number;
			season: number;
			episode: number;
			imdb: string;
			updatedAt: Date;
		}[]
	>(
		`SELECT * FROM "TmdbImdb" WHERE "mediaType" = ? AND "title" = ? AND "season" = ? AND "episode" = ? LIMIT 1`,
		mediaType,
		title,
		season,
		episode,
	);

	const dbMatch = result[0];

	if (isDev && !dbMatch?.imdb) {
		return;
	}

	return dbMatch
		? dbRecordToResult({ ...dbMatch, mediaType: mediaType as MediaType })
		: undefined;
}

export function buildId(segments: (string | number | undefined)[]) {
	return segments.filter((s) => s !== undefined).join(":");
}

export async function getIdsFromDatabase(
	mediaType: MediaType,
	idSegments: TmdbId[],
): Promise<(DbResult | undefined)[]> {
	const queries = idSegments.map(([title, season, episode]) => ({
		mediaType,
		title,
		season: season ?? 0,
		episode: episode ?? 0,
	}));
	// D1 has 100 param limit, 4 params per query = 24 max
	const allMatches: {
		mediaType: MediaType;
		title: number;
		season: number;
		episode: number;
		imdb: string;
		updatedAt: Date;
	}[] = [];

	const batches = Array.from(
		{ length: Math.ceil(queries.length / batchSize) },
		(_, i) => queries.slice(i * batchSize, (i + 1) * batchSize),
	);

	await Promise.all(
		batches.map(async (batch) => {
			const batchMatches = await prisma.tmdbImdb.findMany({
				where: { OR: batch },
			});
			allMatches.push(...batchMatches);
		}),
	);

	return queries.map((query) => {
		const match = allMatches.find(
			(d) =>
				d.mediaType === query.mediaType &&
				d.title === query.title &&
				d.season === query.season &&
				d.episode === query.episode,
		);
		return match ? dbRecordToResult(match) : undefined;
	});
}

export type DbUpsert = {
	tmdb: TmdbId;
	imdb: ImdbId;
};

function buildUpsert(mediaType: MediaType, data: DbUpsert) {
	const [title, season, episode] = data.tmdb;
	const imdb = buildId(data.imdb);

	return prisma.tmdbImdb.upsert({
		where: {
			mediaType_title_season_episode: {
				mediaType,
				title,
				season: season ?? 0,
				episode: episode ?? 0,
			},
		},
		create: {
			mediaType,
			title,
			season: season ?? 0,
			episode: episode ?? 0,
			imdb,
		},
		update: {
			imdb,
		},
	});
}

export async function addIdToDatabase(
	mediaType: MediaType,
	data: DbUpsert,
): Promise<DbResult> {
	const result = await buildUpsert(mediaType, data);
	return dbRecordToResult(result);
}

export async function addIdsToDatabase(
	mediaType: MediaType,
	data: DbUpsert[],
): Promise<(DbResult | undefined)[]> {
	if (!data.length) {
		return [];
	}

	const records = data.map((d) => {
		const [title, season, episode] = d.tmdb;
		return {
			mediaType,
			title,
			season: season ?? 0,
			episode: episode ?? 0,
			imdb: buildId(d.imdb) || "",
		};
	});

	const values = records
		.map(
			(r) =>
				`('${r.mediaType}', ${r.title}, ${r.season}, ${r.episode}, '${r.imdb.replace(/'/g, "''")}', datetime('now'))`,
		)
		.join(", ");

	await prisma.$executeRawUnsafe(
		`INSERT OR REPLACE INTO "TmdbImdb" ("mediaType", "title", "season", "episode", "imdb", "updatedAt") VALUES ${values}`,
	);

	const queries = records.map((r) => ({
		mediaType: r.mediaType,
		title: r.title,
		season: r.season,
		episode: r.episode,
	}));

	const allMatches: {
		mediaType: MediaType;
		title: number;
		season: number;
		episode: number;
		imdb: string;
		updatedAt: Date;
	}[] = [];

	const batches = Array.from(
		{ length: Math.ceil(queries.length / batchSize) },
		(_, i) => queries.slice(i * batchSize, (i + 1) * batchSize),
	);

	await Promise.all(
		batches.map(async (batch) => {
			const batchMatches = await prisma.tmdbImdb.findMany({
				where: { OR: batch },
			});
			allMatches.push(...batchMatches);
		}),
	);

	return queries.map((query) => {
		const match = allMatches.find(
			(d) =>
				d.mediaType === query.mediaType &&
				d.title === query.title &&
				d.season === query.season &&
				d.episode === query.episode,
		);
		return match ? dbRecordToResult(match) : undefined;
	});
}
