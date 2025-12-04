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
} from "./imdb";
import {
	addIdsToDatabase,
	addIdToDatabase,
	getIdFromDatabase,
	getIdsFromDatabase,
} from "./prisma";
import { AppendToResponse, Episode, TMDB, TvShowDetails } from "tmdb-ts";

let tmdb: TMDB;

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
	const dbMatch = await getIdFromDatabase("m", movie);
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

	const result = await addIdToDatabase("m", { tmdb: [movie], imdb: imdbMovie });
	return { tmdb: result.tmdb, imdb: result.imdb };
}

export async function getEpisodeFromTmdb(
	series: number,
	season: number,
	episode: number,
	updateDb: boolean = true,
	tmdbSeries?: TmdbSeries,
	imdbSeries?: Awaited<ReturnType<typeof getSeriesFromTmdbImdbId>>,
) {
	const dbMatch = await getIdFromDatabase("e", series, season, episode);
	if (dbMatch) {
		return dbMatch;
	}

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

	let imdbEpisode: [string, number?, number?] | undefined;

	const imdbEpisodes = imdbSeries?.episodes?.episodes?.edges;

	const tmdbAirDate = new Date(Date.parse(tmdbEpisode.air_date));
	let absoluteEpisodeNumber = episode;
	tmdbSeries?.seasons.forEach((s) => {
		if (!s.season_number) {
			return;
		}

		if (s.season_number < season) {
			absoluteEpisodeNumber += s.episode_count;
		}
	});
	const episodeMatch = (season ? imdbEpisodes : [])?.find((n, i) => {
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

	if (updateDb) {
		return addIdToDatabase("e", {
			tmdb: [series, season, episode],
			imdb: imdbEpisode,
		});
	}
	return imdbEpisode;
}

export async function getSeasonFromTmdb(
	series: number,
	season: number,
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
		"e",
		tmdbSeason.episodes.map((e) => [series, season, e.episode_number]),
	);

	if (!tmdbSeries && !imdbSeries) {
		[tmdbSeries, imdbSeries] = await getSeriesTitle(series);
	}

	const imdbSeason = await Promise.all(
		tmdbSeason.episodes.map(
			(e, idx) =>
				dbMatch[idx] ||
				getEpisodeFromTmdb(
					series,
					season,
					e.episode_number,
					false,
					tmdbSeries,
					imdbSeries,
				),
		),
	);

	// TODO crawl backwards if there are multiple seasons so you can figure out where one ends and fill in undefineds correctly

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

	const newEntries = tmdbSeason.episodes.flatMap((e, i) => {
		const imdbEpisode = imdbSeason[i];
		if (!Array.isArray(imdbEpisode)) {
			return [];
		}
		return {
			tmdb: [series, season, e.episode_number] as [number, number, number],
			imdb: imdbEpisode,
			idx: i,
		};
	});

	const newEntryIds = await addIdsToDatabase("e", newEntries);

	return imdbSeason.map((e, i) => {
		if (Array.isArray(e)) {
			const entryIndex = newEntries?.findIndex((n) => n.idx === i);
			return entryIndex !== undefined ? newEntryIds[entryIndex] : undefined;
		}
		return e ? { tmdb: e.tmdb, imdb: e.imdb } : undefined;
	});
}

export async function getSeriesFromTmdb(series: number) {
	const [tmdbSeries, fullSeries] = await getSeriesTitle(series);

	if (!tmdbSeries) {
		return;
	}

	const imdbSeries = [];
	for (const s of tmdbSeries.seasons) {
		const season = await getSeasonFromTmdb(
			series,
			s.season_number,
			tmdbSeries,
			fullSeries,
		);
		imdbSeries.push(season);
	}

	return imdbSeries;
}
