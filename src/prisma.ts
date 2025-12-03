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

export async function getIdsFromDatabase(
	mediaType: MediaType,
	idSegments: [number, number?, number?][],
) {
	const typedIds = idSegments.map((id) => [mediaType, ...id].join(":"));
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

export async function addIdToDatabase(
	mediaType: MediaType,
	data: { tmdb: [number, number?, number?]; imdb: [string, number?, number?] },
) {
	const tmdb = [mediaType, ...data.tmdb].join(":");
	const imdb = data.imdb.join(":");
	return await prisma.tmdbImdb.create({
		data: { tmdb, imdb },
	});
}

export async function addIdsToDatabase(
	mediaType: MediaType,
	data: {
		tmdb: [number, number?, number?];
		imdb: [string, number?, number?];
	}[],
) {
	const typedData = data.map((d) => ({
		tmdb: [mediaType, ...d.tmdb].join(":"),
		imdb: d.imdb.join(":"),
	}));

	await prisma.tmdbImdb.createMany({ data: typedData });

	return typedData;
}
