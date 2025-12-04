import {
	DisplayableEpisodeNumber,
	EpisodeConnection,
	Title,
} from "./generated/graphql/graphql";
import {
	getSeasonAndEpisode,
	getSeriesFromTmdbImdbId,
	getTitleFromId,
	getTitleFromTmdbData,
	ImdbId,
} from "./imdb";
import {
	addIdsToDatabase,
	addIdToDatabase,
	getIdFromDatabase,
	getIdsFromDatabase,
} from "./prisma";
import pLimit from "p-limit";
import { AppendToResponse, Episode, TMDB, TvShowDetails } from "tmdb-ts";

let tmdb: TMDB;
const limit = pLimit(100);

export type TmdbId = [number, number, number];

export type TmdbSeries = AppendToResponse<
	TvShowDetails,
	"external_ids"[],
	"tvShow"
>;
export type TmdbEpisode = AppendToResponse<
	Omit<Episode, "show_id">,
	"external_ids"[],
	"tvEpisode"
>;

export function instantiateTmdb(token: string) {
	if (!tmdb) {
		tmdb = new TMDB(token);
	}
}

async function getSeriesTitle(
	series: number,
	tmdbSeries?: TmdbSeries,
): Promise<
	[TmdbSeries?, Awaited<ReturnType<typeof getSeriesFromTmdbImdbId>>?]
> {
	if (!tmdbSeries) {
		try {
			tmdbSeries = await tmdb.tvShows.details(series, ["external_ids"]);
		} catch {
			return [];
		}
	}

	const imdbSeries = await getSeriesFromTmdbImdbId(
		tmdbSeries?.external_ids?.imdb_id,
	);

	return [tmdbSeries, imdbSeries];
}

export async function getMovieFromTmdb(movie: number) {
	const dbMatch = await getIdFromDatabase("M", movie, 0, 0);
	if (dbMatch) {
		return dbMatch;
	}

	let tmdbMovie;
	try {
		tmdbMovie = await tmdb.movies.details(movie, ["external_ids"]);
	} catch {
		return undefined;
	}

	let imdbMovie;
	if (tmdbMovie.external_ids.imdb_id) {
		imdbMovie = await getTitleFromId(tmdbMovie.external_ids.imdb_id);
	}

	if (!imdbMovie) {
		imdbMovie = await getTitleFromTmdbData({
			...tmdbMovie,
			name: tmdbMovie.title,
			air_date: tmdbMovie.release_date,
		});
	}

	if (!imdbMovie) {
		return undefined;
	}

	const result = await addIdToDatabase("M", {
		tmdb: [movie, 0, 0],
		imdb: imdbMovie,
	});
	return result;
}

export async function getEpisodeFromTmdb(
	series: number,
	season: number,
	episode: number,
	tmdbSeries?: TmdbSeries,
	imdbSeries?: Awaited<ReturnType<typeof getSeriesFromTmdbImdbId>>,
) {
	let tmdbEpisode;
	try {
		tmdbEpisode = await tmdb.tvEpisode.details(
			{ tvShowID: series, seasonNumber: season, episodeNumber: episode },
			["external_ids"],
		);
	} catch {
		return;
	}

	if (!tmdbSeries && !imdbSeries) {
		[tmdbSeries, imdbSeries] = await getSeriesTitle(series, tmdbSeries);
	}

	let imdbEpisode: ImdbId | undefined;

	const imdbEpisodes = imdbSeries?.episodes?.episodes?.edges;

	const tmdbAirDate = new Date(Date.parse(tmdbEpisode.air_date));
	if (tmdbAirDate > new Date()) {
		return;
	}
	let absoluteEpisodeNumber = episode;
	tmdbSeries?.seasons.forEach((s) => {
		if (!s.season_number) {
			return;
		}

		if (s.season_number < season) {
			absoluteEpisodeNumber += s.episode_count;
		}
	});
	const episodeMatch = (season ? imdbEpisodes : [])
		?.filter(
			(n) =>
				n?.node.series?.displayableEpisodeNumber.displayableSeason.text !== "0",
		)
		?.find((n, i) => {
			const e = n?.node;
			if (!e) {
				return;
			}

			if (e.id === tmdbEpisode.external_ids.imdb_id) {
				return true;
			}

			const imdbAirDate = new Date(
				Date.UTC(
					e.releaseDate?.year || 0,
					(e.releaseDate?.month || 1) - 1,
					e.releaseDate?.day || 0,
				),
			);
			if (
				imdbAirDate.getTime() === tmdbAirDate.getTime() &&
				i === absoluteEpisodeNumber - 1
			) {
				return true;
			}
		});

	if (imdbSeries && episodeMatch) {
		const seasonAndEpisode = getSeasonAndEpisode(
			episodeMatch.node as Title,
			imdbSeries?.episodes as EpisodeConnection,
			episodeMatch.node.series
				?.displayableEpisodeNumber as DisplayableEpisodeNumber,
		);
		if (seasonAndEpisode) {
			imdbEpisode = [imdbSeries.id, ...seasonAndEpisode];
		}
	}

	if (!imdbEpisode && tmdbEpisode.external_ids.imdb_id) {
		imdbEpisode = await getTitleFromId(tmdbEpisode.external_ids.imdb_id);
	}

	if (!imdbEpisode) {
		imdbEpisode = await getTitleFromTmdbData(tmdbEpisode);
	}

	if (!imdbEpisode) {
		return;
	}

	return imdbEpisode;
}

export async function getSeasonFromTmdb(
	series: number,
	season: number,
	addToDb: boolean = true,
	tmdbSeries?: TmdbSeries,
	imdbSeries?: Awaited<ReturnType<typeof getSeriesFromTmdbImdbId>>,
) {
	let tmdbSeason;
	try {
		tmdbSeason = await tmdb.tvSeasons.details({
			tvShowID: series,
			seasonNumber: season,
		});
	} catch {
		return;
	}

	const dbMatch = await getIdsFromDatabase(
		"E",
		tmdbSeason.episodes.map((e) => [series, season, e.episode_number]),
	);

	if (!tmdbSeries && !imdbSeries) {
		[tmdbSeries, imdbSeries] = await getSeriesTitle(series);
	}

	const imdbSeason = await Promise.all(
		tmdbSeason.episodes.map(
			(e, idx) =>
				dbMatch[idx] ||
				limit(() =>
					getEpisodeFromTmdb(
						series,
						season,
						e.episode_number,
						tmdbSeries,
						imdbSeries,
					),
				),
		),
	);

	const firstMatch = imdbSeason.find((e) => Array.isArray(e));
	const lastMatch = imdbSeason.findLast((e) => Array.isArray(e));
	const fIdx = imdbSeason.indexOf(firstMatch);
	const lIdx = imdbSeason.indexOf(lastMatch);

	if (
		Array.isArray(firstMatch) &&
		Array.isArray(lastMatch) &&
		firstMatch[2] !== undefined &&
		lastMatch[2] !== undefined &&
		lIdx - fIdx === lastMatch[2] - firstMatch[2]
	) {
		const seriesStrings = imdbSeason.flatMap((e) =>
			Array.isArray(e) && typeof e?.[0] === "string" ? e[0] : [],
		);
		const commonSeries = seriesStrings
			.sort(
				(a, b) =>
					seriesStrings.filter((v) => v === a).length -
					seriesStrings.filter((v) => v === b).length,
			)
			.pop();
		const commonSeason = imdbSeason.find(
			(e) => Array.isArray(e) && e?.[0] === commonSeries,
		);

		if (commonSeries && Array.isArray(commonSeason)) {
			const firstEpisodeNum = firstMatch[2];
			imdbSeason.forEach((_, i) => {
				imdbSeason[i] = [
					commonSeries,
					commonSeason[1],
					firstEpisodeNum + (i - fIdx),
				];
			});
		}
	}

	if (!addToDb) return imdbSeason;

	const newEntries = tmdbSeason.episodes.map((e, i) => ({
		tmdb: [series, season, e.episode_number] as TmdbId,
		imdb: (Array.isArray(imdbSeason[i]) ? imdbSeason[i] : [""]) as [
			string,
			number?,
			number?,
		],
		idx: i,
	}));

	const newEntryIds = await addIdsToDatabase(
		"E",
		newEntries.map(({ tmdb, imdb }) => ({ tmdb, imdb })),
	);

	return imdbSeason.map((e, i) => {
		if (!Array.isArray(e)) return e;
		const entryIndex = newEntries.findIndex((n) => n.idx === i);
		return entryIndex !== -1 ? newEntryIds[entryIndex] : undefined;
	});
}

export async function getSeriesFromTmdb(series: number) {
	const tmdbSeries = await tmdb.tvShows.details(series, ["external_ids"]);
	if (!tmdbSeries) return;

	const [, fullSeries] = await getSeriesTitle(series, tmdbSeries);

	const allEpisodeIds: TmdbId[] = [];
	const episodeToSeasonMap = new Map<
		number,
		{ seasonIdx: number; episodeIdx: number }
	>();

	tmdbSeries.seasons.forEach((s, seasonIdx) => {
		Array.from({ length: s.episode_count }, (_, ep) => {
			const globalIdx = allEpisodeIds.length;
			allEpisodeIds.push([series, s.season_number, ep + 1]);
			episodeToSeasonMap.set(globalIdx, { seasonIdx, episodeIdx: ep });
		});
	});

	const dbResults = await getIdsFromDatabase("E", allEpisodeIds);
	const imdbSeries = tmdbSeries.seasons.map((s) =>
		Array(s.episode_count).fill(undefined),
	);

	dbResults.forEach((result, globalIdx) => {
		const mapping = episodeToSeasonMap.get(globalIdx);
		if (!mapping || !result) return;
		imdbSeries[mapping.seasonIdx]![mapping.episodeIdx] = result;
	});

	const newEntries: {
		tmdb: TmdbId;
		imdb: ImdbId;
		seasonIdx: number;
		episodeIdx: number;
	}[] = [];

	const seasonCalls = tmdbSeries.seasons.map(async (s, i) => {
		const seasonData = imdbSeries[i];

		if (
			seasonData?.length === s.episode_count &&
			seasonData.every((ep) => ep !== undefined)
		) {
			return;
		}

		return {
			index: i,
			seasonNumber: s.season_number,
			season: await getSeasonFromTmdb(
				series,
				s.season_number,
				false,
				tmdbSeries,
				fullSeries,
			),
		};
	});

	const seasonResults = await Promise.all(seasonCalls);

	seasonResults.forEach((result) => {
		if (!result?.season) return;

		imdbSeries[result.index] = result.season;
		result.season.forEach((episode, episodeIdx) => {
			newEntries.push({
				tmdb: [series, result.seasonNumber, episodeIdx + 1],
				imdb: (Array.isArray(episode) ? episode : [""]) as ImdbId,
				seasonIdx: result.index,
				episodeIdx,
			});
		});
	});

	const newEntryIds = await addIdsToDatabase("E", newEntries);
	newEntries.forEach((e, i) => {
		const season = imdbSeries[e.seasonIdx];
		if (!season || !Array.isArray(season[e.episodeIdx])) {
			return;
		}
		season[e.episodeIdx] = newEntryIds[i];
	});

	return imdbSeries;
}
