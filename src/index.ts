import { buildId, instantiatePrisma } from "./api/prisma";
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
import { env } from "hono/adapter";
import { cors } from "hono/cors";

const app = new Hono<{ Bindings: CloudflareBindings }>();
const cache = caches.default;

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
	request: Request,
	fetchFn: () => Promise<{
		response: Response;
		shouldCache: boolean;
		ttlDays: number;
	}>,
): Promise<Response> {
	// const cachedResponse = await cache.match(request);
	// if (cachedResponse) {
	// 	return cachedResponse;
	// }

	const { response: data, shouldCache, ttlDays } = await fetchFn();

	if (shouldCache) {
		data.headers.append(
			"Cache-Control",
			`public, max-age=${daysToCacheTime(ttlDays)}`,
		);
		cache.put(request, data.clone());
	}

	return data;
}

app.use("*", cors({ origin: "*" }));
app.use("*", async (c, next) => {
	const { TMDB_API, TMDB_IMDB_DB, WORKER_ENV } = env(c);
	const apiKey = await c.text(TMDB_API).text();
	instantiateTmdb(apiKey);
	instantiatePrisma(TMDB_IMDB_DB, WORKER_ENV);
	return await next();
});

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

export default app;
