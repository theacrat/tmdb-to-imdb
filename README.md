# tmdb-to-imdb

This is an attempt to create an API to find IMDb episode numbers from a TMDB ID, primarily for use with Stremio plugins.

There may be false positives and missed items as there is a lot of guess work involved. If you want to help fix this, consider adding IMDb episode links to TMDB episodes - just adding the main IMDb series link to the show page is often not enough for shows that are handled differently across the platforms (e.g. Total Drama and Monogatari).

Currently, matches are stored in a Cloudflare D1 DB forever. I intend to add endpoints to delete the caches, and have them expire after a certain period.

It was built for Cloudflare Workers, though it likely isn't too hard to adapt to other platforms. If you want to host this, you will have to set up your own and place your TMDB API key in `.dev.vars`.

## Routes

All routes use standard GET requests.

### Movies

Get the IMDb ID of a movie:

`/movies/{tmdbMovieId}`

### TV shows

Get the IMDb ID of an episode:

`/series/{tmdbTvShowId}`

Get the IMDb IDs of all episodes in a season:

`/series/{tmdbTvShowId}/{tmdbSeasonNumber}`

Get the IMDb IDs of all episodes in a show:

`/series/{tmdbTvShowId}/{tmdbSeasonNumber}/{tmdbEpisodeNumber}`
