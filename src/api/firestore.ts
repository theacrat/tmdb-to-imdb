import { ImdbId } from "./imdb";
import { TmdbId } from "./tmdb";
import { Firestore } from "@google-cloud/firestore";

export enum MediaType {
	E = "E", // episode
	M = "M", // movie
}

const batchSize = 24;
let firestore: Firestore;

export function instantiateFirestore(projectId: string) {
	if (!firestore) {
		const config: { projectId: string } = { projectId };
		firestore = new Firestore(config);
	}
}

export function getFirestore(): Firestore {
	return firestore;
}

export type DbResult = {
	tmdb: string;
	imdb: string;
};

interface TmdbImdbDocument {
	mediaType: MediaType;
	title: number;
	season: number;
	episode: number;
	imdb: string;
	updatedAt: Date;
}

function buildDocumentId(
	mediaType: MediaType,
	title: number,
	season: number,
	episode: number,
): string {
	return `${mediaType}_${title}_${season}_${episode}`;
}

function dbRecordToResult(record: TmdbImdbDocument): DbResult {
	const tmdb = buildId([
		record.mediaType.toLowerCase(),
		record.title,
		...(record.mediaType === MediaType.E
			? [record.season, record.episode]
			: []),
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
	const [title, season = 0, episode = 0] = segments;

	const docId = buildDocumentId(mediaType, title, season, episode);
	const docRef = firestore.collection("tmdb_imdb").doc(docId);
	const doc = await docRef.get();

	if (!doc.exists) {
		return undefined;
	}

	const data = doc.data() as TmdbImdbDocument;

	return dbRecordToResult(data);
}

export function buildId(segments: (string | number | undefined)[]) {
	return segments.filter((s) => s !== undefined).join(":");
}

export async function getIdsFromDatabase(
	mediaType: MediaType,
	idSegments: TmdbId[],
	episodesData?: { air_date: string }[],
): Promise<(DbResult | undefined)[]> {
	const queries = idSegments.map(([title, season = 0, episode = 0]) => ({
		mediaType,
		title,
		season,
		episode,
		docId: buildDocumentId(mediaType, title, season, episode),
	}));

	const allMatches: Map<string, TmdbImdbDocument> = new Map();

	// Split into batches and fetch
	const batches = Array.from(
		{ length: Math.ceil(queries.length / batchSize) },
		(_, i) => queries.slice(i * batchSize, (i + 1) * batchSize),
	);

	await Promise.all(
		batches.map(async (batch) => {
			const docs = await Promise.all(
				batch.map((q) => firestore.collection("tmdb_imdb").doc(q.docId).get()),
			);

			docs.forEach((doc, idx) => {
				if (doc.exists) {
					allMatches.set(batch[idx].docId, doc.data() as TmdbImdbDocument);
				}
			});
		}),
	);

	return queries.map((query, idx) => {
		const match = allMatches.get(query.docId);

		if (!match) {
			return undefined;
		}

		if (episodesData?.[idx]?.air_date) {
			const airDate = new Date(episodesData[idx].air_date);
			const updatedAt = new Date(match.updatedAt);
			if (airDate >= updatedAt) {
				return undefined;
			}
		}

		return dbRecordToResult(match);
	});
}

export type DbUpsert = {
	tmdb: TmdbId;
	imdb: ImdbId;
};

async function buildUpsert(
	mediaType: MediaType,
	data: DbUpsert,
): Promise<TmdbImdbDocument> {
	const [title, season = 0, episode = 0] = data.tmdb;
	const imdb = buildId(data.imdb);

	const docId = buildDocumentId(mediaType, title, season, episode);
	const docRef = firestore.collection("tmdb_imdb").doc(docId);

	const document: TmdbImdbDocument = {
		mediaType,
		title,
		season,
		episode,
		imdb,
		updatedAt: new Date(),
	};

	await docRef.set(document, { merge: true });

	return document;
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

	// Use Firestore batch writes (max 500 operations per batch)
	const firestoreBatchSize = 500;
	const batches = Array.from(
		{ length: Math.ceil(data.length / firestoreBatchSize) },
		(_, i) => data.slice(i * firestoreBatchSize, (i + 1) * firestoreBatchSize),
	);

	await Promise.all(
		batches.map(async (batch) => {
			const firestoreBatch = firestore.batch();

			batch.forEach((d) => {
				const [title, season = 0, episode = 0] = d.tmdb;
				const docId = buildDocumentId(mediaType, title, season, episode);
				const docRef = firestore.collection("tmdb_imdb").doc(docId);

				const document: TmdbImdbDocument = {
					mediaType,
					title,
					season,
					episode,
					imdb: buildId(d.imdb) || "",
					updatedAt: new Date(),
				};

				firestoreBatch.set(docRef, document, { merge: true });
			});

			await firestoreBatch.commit();
		}),
	);

	// Fetch the written documents to return
	const docIds = data.map((d) => {
		const [title, season = 0, episode = 0] = d.tmdb;
		return buildDocumentId(mediaType, title, season, episode);
	});

	const fetchBatches = Array.from(
		{ length: Math.ceil(docIds.length / batchSize) },
		(_, i) => docIds.slice(i * batchSize, (i + 1) * batchSize),
	);

	const allMatches: Map<string, TmdbImdbDocument> = new Map();

	await Promise.all(
		fetchBatches.map(async (batch) => {
			const docs = await Promise.all(
				batch.map((docId) =>
					firestore.collection("tmdb_imdb").doc(docId).get(),
				),
			);

			docs.forEach((doc, idx) => {
				if (doc.exists) {
					allMatches.set(batch[idx], doc.data() as TmdbImdbDocument);
				}
			});
		}),
	);

	return docIds.map((docId) => {
		const match = allMatches.get(docId);
		return match ? dbRecordToResult(match) : undefined;
	});
}

export async function removeEntriesByTmdbTitle(
	mediaType: MediaType,
	titleId: number,
): Promise<number> {
	const query = firestore
		.collection("tmdb_imdb")
		.where("mediaType", "==", mediaType)
		.where("title", "==", titleId);

	const snapshot = await query.get();

	if (snapshot.empty) {
		return 0;
	}

	const firestoreBatchSize = 500;
	const docs = snapshot.docs;
	const batches = Array.from(
		{ length: Math.ceil(docs.length / firestoreBatchSize) },
		(_, i) => docs.slice(i * firestoreBatchSize, (i + 1) * firestoreBatchSize),
	);

	await Promise.all(
		batches.map(async (batch) => {
			const firestoreBatch = firestore.batch();
			batch.forEach((doc) => {
				firestoreBatch.delete(doc.ref);
			});
			await firestoreBatch.commit();
		}),
	);

	return docs.length;
}
