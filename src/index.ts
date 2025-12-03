import { instantiatePrisma } from "./prisma";
import {
	getMovieFromTmdb,
	getSeasonFromTmdb,
	getSeriesFromTmdb,
	instantiateTmdb,
} from "./tmdb";
import { Context, Hono } from "hono";
import { env } from "hono/adapter";
import { cors } from "hono/cors";

const app = new Hono<{ Bindings: CloudflareBindings }>();

function buildResponse(response: object | undefined, context: Context) {
	return context.json({
		response,
		error: response
			? null
			: `Query for ${Object.values(context.req.param()).reverse().join(":")} failed`,
	});
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
	const result = await getSeasonFromTmdb(parseInt(series), parseInt(season));
	return buildResponse(result ? result[parseInt(episode) - 1] : result, c);
});

app.get("/series/:series{\\d+}/:season{\\d+}", async (c) => {
	const { series, season } = c.req.param();
	const result = await getSeasonFromTmdb(parseInt(series), parseInt(season));
	return buildResponse(result, c);
});

app.get("/series/:series{\\d+}", async (c) => {
	const { series } = c.req.param();
	const result = await getSeriesFromTmdb(parseInt(series));
	return buildResponse(result, c);
});

app.get("/movie/:movie{\\d+}", async (c) => {
	const { movie } = c.req.param();
	const result = await getMovieFromTmdb(parseInt(movie));
	return buildResponse(result, c);
});

export default app;
