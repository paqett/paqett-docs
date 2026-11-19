<script lang="ts">
	import Seo, { SITE } from '$lib/Seo.svelte';

	let { data } = $props();
	const path = $derived(`/${data.section.id}`);
	const titles: Record<string, string> = {
		guides: 'Guides: ESP32 MQTT, mutual TLS and OTA',
		devices: 'Device reference: provisioning, MQTT topics and OTA',
		learn: 'Concepts: MQTT mutual TLS, device certificates and provisioning'
	};
	const title = $derived(titles[data.section.id] ?? data.section.label);
	const list = $derived({
		'@context': 'https://schema.org',
		'@type': 'ItemList',
		itemListElement: data.docs.map((d, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			url: SITE + d.path,
			name: d.title
		}))
	});
</script>

<Seo
	title="{title} | Paqett docs"
	description="{data.section.blurb} {data.docs.map((d) => d.nav).join(', ')}."
	{path}
	crumbs={[{ name: data.section.label }]}
	jsonLd={list}
/>

<div class="page">
	<div class="doc">
		<header class="doc-head">
			<p class="tag crumb">Paqett docs</p>
			<h1>{data.section.label}</h1>
			<p class="lede">{data.section.blurb}</p>
		</header>
		<ul class="cards">
			{#each data.docs as d (d.path)}
				<li>
					<a href={d.path} class="card">
						<strong>{d.title}</strong>
						<span>{d.description}</span>
					</a>
				</li>
			{/each}
		</ul>
	</div>
</div>
