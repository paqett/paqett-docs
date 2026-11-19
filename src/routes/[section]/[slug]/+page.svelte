<script lang="ts">
	import Seo, { ogImageFor } from '$lib/Seo.svelte';
	import { neighbours, related, sectionLabel } from '$lib/content';
	import { docSchema } from '$lib/schema';

	let { data } = $props();
	const doc = $derived(data.doc);
	const Body = $derived(data.component);
	const near = $derived(neighbours(doc));
	// The body's own "Related" or "Next" section replaces the automatic one.
	const ownRelated = $derived(doc.headings.some((h) => h.depth === 2 && /^(related|next)\b/i.test(h.text)));
	const more = $derived(ownRelated ? [] : related(doc));
	const minutes = $derived(Math.max(1, Math.round(doc.wordCount / 220)));

	const updatedLabel = $derived(
		new Date(doc.updated + 'T12:00:00Z').toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		})
	);
</script>

<Seo
	title="{doc.title} | Paqett docs"
	description={doc.description}
	path={doc.path}
	type="article"
	modified={doc.updated}
	keywords={doc.keywords}
	noindex={doc.draft}
	markdown="{doc.path}.md"
	crumbs={[{ name: sectionLabel(doc.section), path: `/${doc.section}` }, { name: doc.nav }]}
	jsonLd={docSchema(doc, ogImageFor(doc.path))}
/>

<div class="page">
	<article class="doc">
		<header class="doc-head">
			<p class="tag crumb"><a href="/{doc.section}">{sectionLabel(doc.section)}</a></p>
			<h1>{doc.title}</h1>
			{#if doc.tldr}
				<div class="tldr" role="note" aria-label="In short">
					<p class="tag">In short</p>
					<p>{doc.tldr}</p>
				</div>
			{:else}
				<p class="lede">{doc.description}</p>
			{/if}
			<p class="meta tag">
				Updated <time datetime={doc.updated}>{updatedLabel}</time> · By
				<a href="https://www.alessio.london/" rel="author">Alessio Grespi</a> · {minutes} min read ·
				<a href="{doc.path}.md" type="text/markdown">Markdown</a>
			</p>
		</header>
		<div class="prose">
			<Body />
		</div>
		{#if more.length}
			<section class="related" aria-labelledby="related-auto">
				<h2 id="related-auto">Related</h2>
				<ul class="cards">
					{#each more as d (d.path)}
						<li>
							<a href={d.path} class="card"><strong>{d.title}</strong><span>{d.description}</span></a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
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
