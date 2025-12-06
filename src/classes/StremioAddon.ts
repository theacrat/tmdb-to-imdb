export enum ExtraType {
	SEARCH = "search",
	NOTIFICATION = "lastVideosIds",
	DISCOVER = "genre",
}

export enum AddonType {
	CATALOG = "catalog",
	META = "meta",
	STREAM = "stream",
	SUBTITLES = "subtitles",
}

export interface Extra {
	name: string;
	isRequired?: boolean;
	options?: string[];
	optionsLimit?: number | null;
}

export class Catalog {
	id: string;
	type: string;
	name: string;
	extra: Extra[];
	extraRequired: string[];
	extraSupported: string[];
	addon!: StremioAddon;

	constructor(data: {
		id: string;
		type: string;
		name?: string;
		extra?: Extra[];
		extraRequired?: string[];
		extraSupported?: string[];
	}) {
		this.id = data.id;
		this.type = data.type;
		this.name = data.name ?? "";
		this.extra = data.extra ?? [];
		this.extraRequired = data.extraRequired ?? [];
		this.extraSupported = data.extraSupported ?? [];
	}

	get title(): string {
		return `${this.name} - ${this.type.charAt(0).toUpperCase()}${this.type.slice(1)}`;
	}
}

export interface Resource {
	name: string;
	types?: string[];
	idPrefixes?: string[];
}

export interface BehaviorHints {
	adult?: boolean | null;
	p2p?: boolean | null;
	configurable?: boolean | null;
	configurationRequired?: boolean | null;
}

export interface Manifest {
	id: string;
	version: string;
	name: string;
	description: string;
	types: string[];
	catalogs: Catalog[];
	resources: (Resource | string)[];
	behaviorHints?: BehaviorHints;
	addonCatalogs?: Catalog[];
	contactEmail?: string | null;
	logo?: string | null;
	background?: string | null;
	idPrefixes?: string[];
}

export interface Flags {
	official?: boolean;
	protected?: boolean;
}

export class StremioAddon {
	transportUrl: string;
	transportName: string;
	manifest: Manifest;
	flags: Flags;

	constructor(data: {
		transportUrl: string;
		transportName: string;
		manifest: Manifest;
		flags: Flags;
	}) {
		this.transportUrl = data.transportUrl;
		this.transportName = data.transportName;
		this.manifest = data.manifest;
		this.flags = data.flags;

		// Initialize after setting properties
		this._postInit();
	}

	get legacy(): boolean {
		return !this.transportUrl.endsWith("manifest.json");
	}

	get base_url(): string {
		return this.transportUrl.split("/manifest.json")[0];
	}

	private _postInit(): void {
		for (const c of this.manifest.catalogs) {
			c.addon = this;
			if (!c.name && this.manifest) {
				c.name = this.manifest.name;
			}
		}
	}
}
