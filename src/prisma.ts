import { PrismaClient } from "./generated/prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

type MediaType = "e" | "m";

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

export async function getIdFromDatabase(
	mediaType: MediaType,
	...segments: [number, number?, number?]
) {
	const dbMatch = await prisma.tmdbImdb.findFirst({
		where: { tmdb: { equals: [mediaType, ...segments].join(":") } },
	});
	if (isDev && !dbMatch?.imdb) {
		return;
	}
	return dbMatch;
}

export function buildId(segments: (string | number | undefined)[]) {
	return segments.filter((s) => s !== undefined).join(":");
}

export async function getIdsFromDatabase(
	mediaType: MediaType,
	idSegments: [number, number?, number?][],
) {
	const typedIds = idSegments.map((id) => buildId([mediaType, ...id]));
	const dbMatch = await prisma.tmdbImdb.findMany({
		where: { tmdb: { in: typedIds } },
	});

	return typedIds.map((id) =>
		dbMatch.find((d) => {
			if (isDev && !d.imdb) {
				return;
			}
			return d.tmdb === id;
		}),
	);
}

export type DbUpsert = {
	tmdb: [number, number?, number?];
	imdb: [string, number?, number?];
};

function buildUpsert(mediaType: MediaType, data: DbUpsert) {
	const tmdb = buildId([mediaType, ...data.tmdb]);
	const imdb = buildId(data.imdb);

	const request = prisma.tmdbImdb.upsert({
		where: {
			tmdb: tmdb,
		},
		create: {
			tmdb,
			imdb,
		},
		update: {
			imdb,
		},
	});

	return request;
}

export async function addIdToDatabase(
	mediaType: MediaType,
	data: { tmdb: [number, number?, number?]; imdb: [string, number?, number?] },
) {
	return await buildUpsert(mediaType, data);
}

export async function addIdsToDatabase(
	mediaType: MediaType,
	data: {
		tmdb: [number, number?, number?];
		imdb: [string, number?, number?];
	}[],
) {
	const requests = data.map((d) => buildUpsert(mediaType, d));
	return await prisma.$transaction(requests);
}
