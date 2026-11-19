<script lang="ts">
	import Seo, { SITE, ogImageFor } from '$lib/Seo.svelte';
	import { neighbours, sectionLabel } from '$lib/content';

	let { data } = $props();
	const doc = $derived(data.doc);
	const Body = $derived(data.component);
	const near = $derived(neighbours(doc));

	const updatedLabel = $derived(
		new Date(doc.updated + 'T12:00:00Z').toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		})
	);

	const article = $derived({
		'@context': 'https://schema.org',
		'@type': 'TechArticle',
		headline: doc.title,
		description: doc.description,
		url: SITE + doc.path,
		image: ogImageFor(doc.path),
		dateModified: doc.updated,
		datePublished: doc.updated,
		inLanguage: 'en-GB',
		wordCount: doc.wordCount || undefined,
		keywords: doc.keywords.join(', ') || undefined,
		proficiencyLevel: 'Expert',
		articleSection: sectionLabel(doc.section),
		author: { '@type': 'Organization', name: 'Paqett', url: 'https://www.paqett.com/' },
		publisher: {
			'@type': 'Organization',
			name: 'Paqett',
			url: 'https://www.paqett.com/',
			logo: { '@type': 'ImageObject', url: `${SITE}/logo.png` }
		},
		mainEntityOfPage: SITE + doc.path
	});
</script>

<Seo
	title="{doc.title} | Paqett docs"
	description={doc.description}
	path={doc.path}
	type="article"
	modified={doc.updated}
	keywords={doc.keywords}
	noindex={doc.draft}
	crumbs={[{ name: sectionLabel(doc.section), path: `/${doc.section}` }, { name: doc.nav }]}
	jsonLd={article}
/>

<div class="page">
	<article class="doc">
		<header class="doc-head">
			<p class="tag crumb"><a href="/{doc.section}">{sectionLabel(doc.section)}</a></p>
			<h1>{doc.title}</h1>
			<p class="lede">{doc.description}</p>
			<p class="meta tag">Updated {updatedLabel}</p>
		</header>
		<div class="prose">
			<Body />
		</div>
		<nav class="pager" aria-label="Next and previous">
			{#if near.prev}
				<a href={near.prev.path} class="prev"><span class="tag">Previous</span>{near.prev.nav}</a>
			{:else}<span></span>{/if}
			{#if near.next}
				<a href={near.next.path} class="next"><span class="tag">Next</span>{near.next.nav}</a>
			{/if}
		</nav>
	</article>
	{#if doc.headings.length > 2}
		<aside class="toc" aria-label="On this page">
			<p class="tag">On this page</p>
			<ul>
				{#each doc.headings as h (h.id)}
					<li class="d{h.depth}"><a href="#{h.id}">{h.text}</a></li>
				{/each}
			</ul>
		</aside>
	{/if}
</div>
