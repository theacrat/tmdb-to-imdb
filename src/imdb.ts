import { graphql } from "./generated/graphql/gql";
import {
	DisplayableEpisodeNumber,
	EpisodeConnection,
	MainSearchOptions,
	MainSearchTitleType,
	MainSearchType,
	Title,
} from "./generated/graphql/graphql";
import { Client, cacheExchange, fetchExchange } from "@urql/core";

const client = new Client({
	url: "https://api.graphql.imdb.com/",
	exchanges: [cacheExchange, fetchExchange],
	preferGetMethod: false,
	fetchOptions: () => {
		return {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.3",
				"Content-Type": "application/json",
			},
		};
	},
});

export function getSeasonAndEpisode(
	episodeData: Title,
	episodeList: EpisodeConnection,
	seasonData: DisplayableEpisodeNumber,
): [number, number] | undefined {
	let season = seasonData.displayableSeason.text;
	let episode = seasonData.episodeNumber.text;

	if (season === "unknown") {
		season = "0";
		const episodeIdx = (episodeList.edges || []).findIndex(
			(e) => e?.node.id === episodeData.id,
		);
		if (episodeIdx === -1) {
			return undefined;
		}
		episode = (episodeIdx + 1).toString();
	}
	return [parseInt(season), parseInt(episode)];
}

const GetMoreEpisodesQuery = graphql(`
	query GetMoreEpisodes($id: ID!, $episodeFilter: EpisodesFilter, $after: ID!) {
		title(id: $id) {
			series {
				series {
					episodes {
						episodes(
							filter: $episodeFilter
							sort: { by: EPISODE_THEN_RELEASE, order: ASC }
							first: 500
							after: $after
						) {
							edges {
								node {
									id
									series {
										displayableEpisodeNumber {
											displayableSeason {
												text
											}
											episodeNumber {
												text
											}
										}
									}
								}
							}
							pageInfo {
								endCursor
								hasNextPage
							}
						}
					}
				}
			}
		}
	}
`);

const TitleQuery = graphql(`
	query Title($id: ID!, $episodeFilter: EpisodesFilter) {
		title(id: $id) {
			id
			episodes {
				episodes(
					filter: $episodeFilter
					sort: { by: EPISODE_THEN_RELEASE, order: ASC }
					first: 500
				) {
					edges {
						node {
							id
							titleText {
								text
							}
							series {
								displayableEpisodeNumber {
									displayableSeason {
										text
									}
									episodeNumber {
										text
									}
								}
							}
							releaseDate {
								day
								month
								year
							}
							runtime {
								seconds
							}
						}
					}
					pageInfo {
						endCursor
						hasNextPage
					}
				}
			}
			series {
				series {
					id
					episodes {
						episodes(
							filter: $episodeFilter
							sort: { by: EPISODE_THEN_RELEASE, order: ASC }
							first: 500
						) {
							edges {
								node {
									id
									titleText {
										text
									}
									series {
										displayableEpisodeNumber {
											displayableSeason {
												text
											}
											episodeNumber {
												text
											}
										}
									}
									releaseDate {
										day
										month
										year
									}
									runtime {
										seconds
									}
								}
							}
							pageInfo {
								endCursor
								hasNextPage
							}
						}
					}
				}
				displayableEpisodeNumber {
					displayableSeason {
						text
					}
					episodeNumber {
						text
					}
				}
			}
		}
	}
`);

export async function getSeriesFromTmdbImdbId(imdbId: string) {
	const r = await client.query(TitleQuery, {
		id: imdbId,
	});

	const t = r.data?.title;
	if (!t) {
		return;
	}

	const e = t.episodes?.episodes;

	let next = e?.pageInfo?.hasNextPage ? e.pageInfo.endCursor : undefined;
	while (next) {
		const nextEpisodes = await client.query(GetMoreEpisodesQuery, {
			id: t.id,
			after: next,
		});
		const n = nextEpisodes?.data?.title?.series?.series.episodes?.episodes;
		e?.edges.push(...(n?.edges || []));
		next = n?.pageInfo.hasNextPage ? n.pageInfo.endCursor : undefined;
	}

	return t;
}

export async function getTitleFromId(
	titleId: string,
): Promise<[string, number?, number?] | undefined> {
	const r = await client.query(TitleQuery, {
		id: titleId,
		episodeFilter: { includeSeasons: ["unknown"] },
	});

	const t = r.data?.title;
	if (!t) {
		return;
	}

	const s = t?.series;
	if (!s) {
		return [t.id];
	}

	const e = s.series.episodes?.episodes;

	let next = e?.pageInfo?.hasNextPage ? e.pageInfo.endCursor : undefined;
	while (next) {
		const nextEpisodes = await client.query(GetMoreEpisodesQuery, {
			id: s.series.id,
			after: next,
			episodeFilter: { includeSeasons: ["unknown"] },
		});
		const n = nextEpisodes?.data?.title?.series?.series.episodes?.episodes;
		e?.edges.push(...(n?.edges || []));
		next = n?.pageInfo.hasNextPage ? n.pageInfo.endCursor : undefined;
	}

	const seasonAndEpisode = getSeasonAndEpisode(
		t as Title,
		e as EpisodeConnection,
		s.displayableEpisodeNumber as DisplayableEpisodeNumber,
	);
	if (!seasonAndEpisode) {
		return;
	}

	return [s.series.id, ...seasonAndEpisode];
}

const TitleDataSearchQuery = graphql(`
	query TitleSearch(
		$search: MainSearchOptions!
		$episodeFilter: EpisodesFilter
	) {
		mainSearch(first: 20, options: $search) {
			edges {
				node {
					entity {
						... on Title {
							id
							runtime {
								seconds
							}
							titleText {
								text
							}
							originalTitleText {
								text
							}
							akas(first: 100) {
								edges {
									node {
										text
									}
								}
							}
							ratingsSummary {
								voteCount
							}
							series {
								series {
									id
									episodes {
										episodes(
											filter: $episodeFilter
											sort: { by: EPISODE_THEN_RELEASE, order: ASC }
											first: 500
										) {
											edges {
												node {
													id
												}
											}
											pageInfo {
												endCursor
												hasNextPage
											}
										}
									}
								}
								displayableEpisodeNumber {
									displayableSeason {
										text
									}
									episodeNumber {
										text
									}
								}
							}
						}
					}
				}
			}
		}
	}
`);

export async function getTitleFromTmdbData(title: {
	air_date: string;
	name: string;
	overview: string | null;
	runtime: number;
}): Promise<[string, number?, number?] | undefined> {
	const tmdbAirDate = title.air_date
		? new Date(Date.parse(title.air_date))
		: new Date(0, 0, 0);
	const search: MainSearchOptions = {
		type: [MainSearchType.Title],
		searchTerm: title.name,
		titleSearchOptions: {
			type: [MainSearchTitleType.Movie, MainSearchTitleType.TvEpisode],
			releaseDateRange: {
				start: tmdbAirDate.toISOString().slice(0, 10),
				end: tmdbAirDate.toISOString().slice(0, 10),
			},
		},
	};

	const r = await client.query(TitleDataSearchQuery, {
		search,
		filter: { includeSeasons: ["unknown"] },
	});
	if (!r.data?.mainSearch?.edges.length) {
		return;
	}

	const cleanRegex = /[^{\p{L}}\d]/gu;

	const filteredResults = r.data.mainSearch.edges.flatMap((t) =>
		t?.node.entity.__typename === "Title" ? [t.node.entity] : [],
	);

	const tmdbTitle = title.name
		.replace(
			/ \((\d)\)$/,
			title.overview?.includes("The crossover") ? "" : ", Part $1",
		)
		.replace(cleanRegex, "")
		.toLowerCase();

	const confidences = filteredResults.map((t) => {
		let confidence = 0;
		if (!t.titleText?.text) {
			return confidence;
		}

		const titleSet = new Set([
			t.titleText.text,
			t.originalTitleText?.text || "",
			...(t.akas?.edges.flatMap((a) => a?.node.text || []) || []),
		]);

		if (
			t.series?.displayableEpisodeNumber.displayableSeason.text === "unknown"
		) {
			const [, ...segments] = t.titleText.text.split(": ");
			titleSet.add(segments.join(": "));
		}

		const allTitles = [...titleSet].map((title) =>
			title.replace(cleanRegex, "").toLowerCase(),
		);

		if (allTitles.includes(tmdbTitle)) {
			confidence += 10;
		} else {
			allTitles.some((t) => {
				const cleanTitle = t.replace(cleanRegex, "");
				if (cleanTitle.includes(tmdbTitle) || tmdbTitle.includes(cleanTitle)) {
					confidence += 5;
					return true;
				}
			});
		}

		const runtime = Math.round((t.runtime?.seconds || 0) / 60);
		const runtimeDifference = Math.abs(title.runtime - runtime);
		if (runtimeDifference < 2) {
			confidence += 10;
		} else if (runtimeDifference < 5) {
			confidence += 5;
		}

		return confidence;
	});

	const highestConfidence = Math.max(...confidences);

	if (highestConfidence === 0) {
		return;
	}

	const results = filteredResults.filter(
		(_, i) => confidences[i] === highestConfidence,
	);

	results.sort(
		(a, b) =>
			(b.ratingsSummary?.voteCount || 0) - (a.ratingsSummary?.voteCount || 0),
	);
	const result = results.find((t) => t);

	if (!result) {
		return undefined;
	}

	const s = result.series;

	if (!s) {
		return [result.id];
	}

	const e = s.series.episodes?.episodes;

	let next = e?.pageInfo?.hasNextPage ? e.pageInfo.endCursor : undefined;
	while (next) {
		const nextEpisodes = await client.query(GetMoreEpisodesQuery, {
			id: s.series.id,
			after: next,
			episodeFilter: { includeSeasons: ["unknown"] },
		});
		const n = nextEpisodes?.data?.title?.series?.series.episodes?.episodes;
		e?.edges.push(...(n?.edges || []));
		next = n?.pageInfo.hasNextPage ? n.pageInfo.endCursor : undefined;
	}

	const seasonAndEpisode = getSeasonAndEpisode(
		result as Title,
		e as EpisodeConnection,
		s.displayableEpisodeNumber as DisplayableEpisodeNumber,
	);
	if (!seasonAndEpisode) {
		return undefined;
	}

	return [s.series.id, ...seasonAndEpisode];
}
