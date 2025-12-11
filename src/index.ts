import { buildId, MediaType, removeEntriesByTmdbTitle } from "./api/firestore";
import { instantiateFirestore } from "./api/firestore";
import {
	getMovieFromTmdb,
	getSeasonFromTmdb,
	getMeta,
	getSeriesFromTmdb,
	instantiateTmdb,
	getSearch,
} from "./api/tmdb";
import { Manifest } from "./classes/StremioAddon";
import { StremioType } from "./classes/StremioMeta";
import { Context, Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
	Bindings: {
		TMDB_API: string;
		GCP_PROJECT_ID: string;
	};
};

function getRequiredEnv(key: string): string {
	const value = Bun.env[key];
	if (!value) {
		throw new Error(`${key} environment variable is required`);
	}
	return value;
}

// Initialize services once at startup with validated env vars
const TMDB_API = getRequiredEnv("TMDB_API");
const GCP_PROJECT_ID = getRequiredEnv("GCP_PROJECT_ID");

instantiateTmdb(TMDB_API);
instantiateFirestore(GCP_PROJECT_ID);

const app = new Hono<Env>();

function buildResponse(context: Context, response?: object) {
	return context.json({
		response,
		error: response
			? null
			: `Query for ${buildId(Object.values(context.req.param()))} failed`,
	});
}

function daysToCacheTime(days: number) {
	return days * 24 * 60 * 60;
}

async function withCache(
	_request: Request,
	fetchFn: () => Promise<{
		response: Response;
		shouldCache: boolean;
		ttlDays: number;
	}>,
): Promise<Response> {
	const { response: data, shouldCache, ttlDays } = await fetchFn();

	if (shouldCache) {
		// Set Cache-Control header for GCP Cloud CDN/Load Balancer caching
		// s-maxage is used by CDN, max-age is for browser caching
		data.headers.set(
			"Cache-Control",
			`public, s-maxage=${daysToCacheTime(ttlDays)}, max-age=${daysToCacheTime(ttlDays)}`,
		);
	} else {
		// Explicitly prevent caching of failed requests
		data.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
	}

	return data;
}

app.use("*", cors({ origin: "*" }));

app.get("/series/:series{\\d+}/:season{\\d+}/:episode{\\d+}", async (c) => {
	const { series, season, episode } = c.req.param();

	return withCache(c.req.raw, async () => {
		const result = await getSeasonFromTmdb(parseInt(series), parseInt(season));
		const episodeResult = result ? result[parseInt(episode) - 1] : result;
		return {
			response: buildResponse(c, episodeResult),
			shouldCache: !!episodeResult,
			ttlDays: 1,
		};
	});
});

app.get("/series/:series{\\d+}/:season{\\d+}", async (c) => {
	const { series, season } = c.req.param();

	return withCache(c.req.raw, async () => {
		const result = await getSeasonFromTmdb(parseInt(series), parseInt(season));
		return {
			response: buildResponse(c, result),
			shouldCache: !!result,
			ttlDays: 1,
		};
	});
});

app.get("/series/:series{\\d+}", async (c) => {
	const { series } = c.req.param();

	return withCache(c.req.raw, async () => {
		const result = await getSeriesFromTmdb(parseInt(series));
		return {
			response: buildResponse(c, result),
			shouldCache: !!result,
			ttlDays: 1,
		};
	});
});

app.get("/movie/:movie{\\d+}", async (c) => {
	const { movie } = c.req.param();

	return withCache(c.req.raw, async () => {
		const result = await getMovieFromTmdb(parseInt(movie));
		return {
			response: buildResponse(c, result),
			shouldCache: !!result,
			ttlDays: 1,
		};
	});
});

app.delete("/series/:series{\\d+}", async (c) => {
	const { series } = c.req.param();

	const result = await removeEntriesByTmdbTitle(MediaType.E, parseInt(series));
	return c.text(`Removed ${result} entries.`);
});

app.delete("/movie/:movie{\\d+}", async (c) => {
	const { movie } = c.req.param();

	const result = await removeEntriesByTmdbTitle(MediaType.M, parseInt(movie));
	return c.text(`Removed ${result} entries.`);
});

app.get("/manifest.json", (c) => {
	return c.json({
		id: "pet.thea.stremtmdb",
		version: "1.0.0",
		name: "StremTMDB",
		description: "Yet another TMDB meta source",
		logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Tmdb.new.logo.svg/330px-Tmdb.new.logo.svg.png",
		background:
			"https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Tmdb.new.logo.svg/330px-Tmdb.new.logo.svg.png",
		catalogs: [
			{
				type: "movie",
				id: "search",
				name: "Search",
				extra: [
					{
						name: "search",
						isRequired: true,
					},
				],
			},
			{
				type: "series",
				id: "search",
				name: "Search",
				extra: [
					{
						name: "search",
						isRequired: true,
					},
				],
			},
		],
		resources: ["catalog", "meta"],
		types: ["movie", "series"],
		idPrefixes: ["tmdb:"],
		behaviorHints: {
			configurable: false,
			configurationRequired: false,
		},
	} as Manifest);
});

app.get("/meta/:type{(movie|series)}/:id", async (c) => {
	const { type, id } = c.req.param();
	const cleanId = id.split("tmdb:")?.[1].split(".json")?.[0];

	return withCache(c.req.raw, async () => {
		const result = await getMeta(parseInt(cleanId), type as StremioType);

		const isContinuing = result?.releaseInfo?.endsWith("-");
		const ttlDays = isContinuing ? 1 : 7;

		return {
			response: await (result ? c.json({ meta: result }) : c.notFound()),
			shouldCache: !!result,
			ttlDays,
		};
	});
});

app.get("/catalog/:type{(movie|series)}/search/:query", async (c) => {
	const { type, query } = c.req.param();
	const cleanQuery = query.replace("search=", "").replace(".json", "");

	return withCache(c.req.raw, async () => {
		const result = await getSearch(cleanQuery, type as StremioType);
		return {
			response: c.json({ metas: result }),
			shouldCache: !!result,
			ttlDays: 7,
		};
	});
});

export default {
	port: parseInt(Bun.env.PORT || "3000"),
	fetch: app.fetch,
};
