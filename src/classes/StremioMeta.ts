import { StremioStream } from "./StremioStream";

export enum PosterShape {
	SQUARE = "square",
	LANDSCAPE = "landscape",
	POSTER = "poster",
}

export enum StremioType {
	MOVIE = "movie",
	SERIES = "series",
	CHANNEL = "channel",
	TV = "tv",
	OTHER = "other",
}

export interface Trailer {
	source: string;
	type: string;
}

export interface Link {
	name: string;
	category: string;
	url: string;
}

export interface BehaviorHints {
	defaultVideoId?: string;
}

export interface Video {
	id: string;
	title: string;
	released: Date;
	thumbnail?: string;
	streams?: StremioStream[];
	available?: boolean;
	episode?: number;
	season?: number;
	trailers?: StremioStream[];
	overview?: string;
}

export class StremioMeta {
	id: string;
	type: string;
	name: string;
	imdb_id?: string;
	genres?: string[];
	poster?: string;
	posterShape?: string = PosterShape.POSTER;
	background?: string;
	logo?: string;
	description?: string;
	releaseInfo?: string;
	director?: string[];
	cast?: string[];
	imdbRating?: string;
	released?: Date;
	trailers?: Trailer[];
	links?: Link[];
	videos?: Video[];
	runtime?: string;
	language?: string;
	country?: string;
	awards?: string;
	website?: string;
	behaviorHints?: BehaviorHints;

	constructor(data: {
		id: string;
		type: string;
		name: string;
		imdb_id?: string;
		genres?: string[];
		poster?: string;
		posterShape?: string;
		background?: string;
		logo?: string;
		description?: string;
		releaseInfo?: string;
		director?: string[];
		cast?: string[];
		imdbRating?: string;
		released?: Date;
		trailers?: Trailer[];
		links?: Link[];
		videos?: Video[];
		runtime?: string;
		language?: string;
		country?: string;
		awards?: string;
		website?: string;
		behaviorHints?: BehaviorHints;
	}) {
		this.id = data.id;
		this.type = data.type;
		this.name = data.name;
		this.imdb_id = data.imdb_id;
		this.genres = data.genres;
		this.poster = data.poster;
		this.posterShape = data.posterShape;
		this.background = data.background;
		this.logo = data.logo;
		this.description = data.description;
		this.releaseInfo = data.releaseInfo;
		this.director = data.director;
		this.cast = data.cast;
		this.imdbRating = data.imdbRating;
		this.released = data.released;
		this.trailers = data.trailers;
		this.links = data.links;
		this.videos = data.videos;
		this.runtime = data.runtime;
		this.language = data.language;
		this.country = data.country;
		this.awards = data.awards;
		this.website = data.website;
		this.behaviorHints = data.behaviorHints;

		// Initialize after setting properties
		this._postInit();
	}

	private _consolidateLinks(
		linkCategory: string,
		legacyField?: string[],
	): void {
		try {
			if (!legacyField || legacyField.length === 0) {
				return;
			}

			const newLinks = legacyField
				.filter(
					(li) =>
						!this.links?.some(
							(i) => i.name === li && i.category === linkCategory,
						),
				)
				.map((li) => ({
					name: li,
					category: linkCategory,
					url: "",
				}));

			this.links?.push(...newLinks);
		} catch (e) {
			console.error(e);
			return;
		}
	}

	private _postInit(): void {
		const legacyFields: [string, string[]?][] = [
			["Genres", this.genres],
			["Cast", this.cast],
			["Directors", this.director],
		];

		for (const [category, legacyField] of legacyFields) {
			this._consolidateLinks(category, legacyField);
		}

		if (this.poster) {
			this.poster = `https://image.tmdb.org/t/p/original${this.poster}`;
		}
		if (this.background) {
			this.background = `https://image.tmdb.org/t/p/original${this.background}`;
		}
		if (this.logo) {
			this.logo = `https://image.tmdb.org/t/p/original${this.logo}`;
		}
		this.videos?.forEach((v) => {
			if (v.thumbnail) {
				v.thumbnail = `https://image.tmdb.org/t/p/original${v.thumbnail}`;
			}
		});
	}
}
