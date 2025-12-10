import { StremioMeta, StremioType } from "../classes/StremioMeta";
import {
	DisplayableEpisodeNumber,
	EpisodeConnection,
	Title,
} from "../generated/graphql/graphql";
import {
	addIdsToDatabase,
	addIdToDatabase,
	DbResult,
	getIdFromDatabase,
	getIdsFromDatabase,
	MediaType,
} from "./firestore";
import {
	getSeasonAndEpisode,
	getSeriesFromTmdbImdbId,
	getTitleFromId,
	getTitleFromTmdbData,
	ImdbId,
} from "./imdb";
import pLimit from "p-limit";
import {
	AppendToResponse,
	AppendToResponseTvSeasonKey,
	Episode,
	MovieDetails,
	SeasonDetails,
	TMDB,
	TvShowDetails,
} from "tmdb-ts";

let tmdb: TMDB;
const limit = pLimit(100);

export type TmdbId = [number, number, number];

export type TmdbMovie = AppendToResponse<
	MovieDetails,
	("credits" | "images" | "external_ids")[],
	"movie"
>;

export type TmdbSeries = AppendToResponse<
	TvShowDetails,
	("credits" | "images" | "external_ids")[],
	"tvShow"
>;
export type TmdbSeason = AppendToResponse<
	SeasonDetails,
	AppendToResponseTvSeasonKey[] | undefined,
	"tvSeason"
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
			tmdbSeries = await tmdb.tvShows.details(series, [
				"external_ids",
				"credits",
				"images",
			]);
		} catch (e) {
			console.error(e);
			return [];
		}
	}

	const imdbSeries = await getSeriesFromTmdbImdbId(
		tmdbSeries?.external_ids?.imdb_id,
	);

	return [tmdbSeries, imdbSeries];
}

export async function getMovieFromTmdb(movie: number, tmdbMovie?: TmdbMovie) {
	const dbMatch = await getIdFromDatabase(MediaType.M, movie, 0, 0);
	if (dbMatch) {
		return dbMatch;
	}

	if (!tmdbMovie) {
		try {
			tmdbMovie = await tmdb.movies.details(movie, [
				"external_ids",
				"credits",
				"images",
			]);
		} catch (e) {
			console.error(e);
			return;
		}
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

	const result = await addIdToDatabase(MediaType.M, {
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
	tmdbSeason?: TmdbSeason,
) {
	if (!tmdbSeason) {
		try {
			tmdbSeason = await tmdb.tvSeasons.details({
				tvShowID: series,
				seasonNumber: season,
			});
		} catch (e) {
			console.error(e);
			return;
		}
	}

	if (!tmdbSeason) {
		return;
	}

	const dbMatch = await getIdsFromDatabase(
		MediaType.E,
		tmdbSeason.episodes.map((e) => [series, season, e.episode_number]),
		tmdbSeason.episodes,
	);

	if (!tmdbSeries && !imdbSeries) {
		[tmdbSeries, imdbSeries] = await getSeriesTitle(series);
	}

	const imdbSeason = await Promise.all(
		tmdbSeason.episodes.map((e, idx) => {
			return (
				dbMatch[idx] ||
				limit(() =>
					getEpisodeFromTmdb(
						series,
						season,
						e.episode_number,
						tmdbSeries,
						imdbSeries,
					),
				)
			);
		}),
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
		MediaType.E,
		newEntries.map(({ tmdb, imdb }) => ({ tmdb, imdb })),
	);

	return imdbSeason.map((e, i) => {
		if (!Array.isArray(e)) return e;
		const entryIndex = newEntries.findIndex((n) => n.idx === i);
		return entryIndex !== -1 ? newEntryIds[entryIndex] : undefined;
	});
}

export async function getSeriesFromTmdb(
	series: number,
	tmdbSeries?: TmdbSeries,
	tmdbSeasons?: TmdbSeason[],
): Promise<DbResult[][] | undefined> {
	const seriesTitle = await getSeriesTitle(series, tmdbSeries);
	[tmdbSeries] = seriesTitle;
	const [, fullSeries] = seriesTitle;
	if (!tmdbSeries) {
		return;
	}

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

	const dbResults = await getIdsFromDatabase(MediaType.E, allEpisodeIds);
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
				tmdbSeasons?.[i],
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

	const newEntryIds = await addIdsToDatabase(MediaType.E, newEntries);
	newEntries.forEach((e, i) => {
		const season = imdbSeries[e.seasonIdx];
		if (!season || !Array.isArray(season[e.episodeIdx])) {
			return;
		}
		season[e.episodeIdx] = newEntryIds[i];
	});

	return imdbSeries;
}

export async function getMeta(tmdbId: number, type: StremioType) {
	let m;
	try {
		m = await (type === "movie"
			? tmdb.movies.details(tmdbId, ["images", "credits", "external_ids"])
			: tmdb.tvShows.details(tmdbId, ["images", "credits", "external_ids"]));
	} catch {
		return;
	}

	if (!m.id) {
		return;
	}

	let videos, imdbMovie;
	if ("seasons" in m) {
		const seasons = await Promise.all(
			m.seasons.map((season) =>
				tmdb.tvSeasons.details({
					tvShowID: tmdbId,
					seasonNumber: season.season_number,
				}),
			),
		);

		const imdbSeries = await getSeriesFromTmdb(tmdbId, m, seasons);
		const episodes = seasons.flatMap((s) => s.episodes || []);

		videos = episodes.map((e) => {
			const season = seasons.find((s) => s.season_number === e.season_number)!;
			const episode = season.episodes.indexOf(e);
			return {
				id:
					imdbSeries?.[seasons.indexOf(season)][episode]?.imdb ||
					`tmdb:${tmdbId}:${e.season_number}:${e.episode_number}`,
				title: e.name,
				released: new Date(Date.parse(e.air_date)),
				thumbnail: e.still_path,
				episode: e.episode_number,
				season: e.season_number,
				overview: e.overview,
			};
		});
	} else {
		imdbMovie = await getMovieFromTmdb(tmdbId, m);
	}

	const meta = new StremioMeta({
		id: `tmdb:${tmdbId}`,
		type: type,
		name: "name" in m ? m.name : m.title,
		imdb_id:
			m.external_ids.imdb_id ||
			(videos?.find((v) => v.season === 1)?.id || imdbMovie?.imdb)?.split(
				":",
			)?.[0],
		genres: m.genres?.map((g) => g.name),
		poster: m.images.posters.find((i) => i)?.file_path,
		background: m.images.backdrops.find((i) => i)?.file_path,
		logo: m.images.logos.find((i) => i)?.file_path,
		description: m.overview,
		releaseInfo: (() => {
			if ("release_date" in m) {
				return m.release_date.split("-")[0];
			}
			const first = m.first_air_date.split("-")[0];
			const last = m.last_air_date.split("-")[0];

			if (first === last) {
				return first;
			}

			return `${first}-${!m.in_production ? last : ""}`;
		})(),
		director: m.credits.crew?.flatMap((p) =>
			p?.job === "Director" ? p.name : [],
		),
		cast: m.credits.cast?.map((p) => p.name).slice(0, 5),
		imdbRating: (Math.round(m.vote_average * 10) / 10).toString(),
		released: new Date(
			Date.parse("release_date" in m ? m.release_date : m.first_air_date),
		),
		runtime: `${("episode_run_time" in m ? m.episode_run_time : m.runtime) || "?"} min`,
		language: m.spoken_languages.map((l) => l.english_name).join(", "),
		country: m.production_countries?.map((c) => c.name).join(", "),
		videos: videos,
		website: m.homepage,
		behaviorHints: imdbMovie
			? { defaultVideoId: imdbMovie.imdb || m.external_ids.imdb_id }
			: undefined,
	});

	return meta;
}

export async function getSearch(query: string, type: StremioType) {
	let m;
	try {
		m = await (type === "movie"
			? (m = tmdb.search.movies({ query }))
			: tmdb.search.tvShows({ query }));
	} catch {
		return;
	}

	const results = m.results.map((m) => {
		return new StremioMeta({
			id: `tmdb:${m.id}`,
			type,
			name: "name" in m ? m.name : m.title,
			poster: m.poster_path,
		});
	});

	return results;
}
