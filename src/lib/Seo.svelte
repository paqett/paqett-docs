<script lang="ts" module>
	export const SITE = 'https://docs.paqett.com';

	/** Share image for a path: static/og/<slug>.png, made by scripts/og-images.mjs. */
	export function ogImageFor(path: string): string {
		const slug = path === '/' ? 'home' : path.replace(/^\//, '').replace(/\//g, '--');
		return `${SITE}/og/${slug}.png`;
	}
</script>

<script lang="ts">
	// Head tags for one docs page: title, description, canonical, Open Graph, Twitter
	// card, a BreadcrumbList and any page-specific JSON-LD.
	let {
		title,
		description,
		path,
		type = 'website',
		jsonLd,
		crumbs = [],
		modified,
		keywords = [],
		noindex = false
	}: {
		title: string;
		description: string;
		path: string;
		type?: 'website' | 'article';
		/** One schema.org object or several; each is emitted as its own script tag. */
		jsonLd?: Record<string, unknown> | Record<string, unknown>[];
		/** Breadcrumb trail after "Docs", ending with this page. */
		crumbs?: { name: string; path?: string }[];
		modified?: string;
		keywords?: string[];
		noindex?: boolean;
	} = $props();

	const url = $derived(SITE + (path === '/' ? '/' : path));
	const img = $derived(ogImageFor(path));

	const breadcrumbs = $derived.by(() => {
		if (path === '/') return null;
		const items = [{ name: 'Paqett docs', item: `${SITE}/` }, ...crumbs.map((c) => ({ name: c.name, item: SITE + (c.path ?? path) }))];
		return {
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			itemListElement: items.map((it, i) => ({
				'@type': 'ListItem',
				position: i + 1,
				name: it.name,
				item: it.item
			}))
		};
	});

	const blocks = $derived(
		[...(Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : []), breadcrumbs]
			.filter(Boolean)
			.map((b) => JSON.stringify(b).replace(/</g, '\\u003c'))
	);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	{#if keywords.length}<meta name="keywords" content={keywords.join(', ')} />{/if}
	<link rel="canonical" href={url} />
	<meta
		name="robots"
		content={noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1'}
	/>
	<meta name="theme-color" content="#8800ff" />

	<meta property="og:type" content={type} />
	<meta property="og:site_name" content="Paqett docs" />
	<meta property="og:locale" content="en_GB" />
	<meta property="og:url" content={url} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:image" content={img} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	{#if type === 'article' && modified}
		<meta property="article:modified_time" content={modified} />
	{/if}

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={img} />

	{#each blocks as ld, i (i)}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html '<script type="application/ld+json">' + ld + '</' + 'script>'}
	{/each}
</svelte:head>
