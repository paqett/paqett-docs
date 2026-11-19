<script lang="ts">
	import Seo, { SITE } from '$lib/Seo.svelte';
	import { LISTED, SECTIONS } from '$lib/content';

	const site = {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: 'Paqett docs',
		url: `${SITE}/`,
		inLanguage: 'en-GB',
		publisher: { '@type': 'Organization', name: 'Paqett', url: 'https://www.paqett.com/' }
	};
</script>

<Seo
	title="Paqett docs: connect ESP32 devices over MQTT with X.509 certificates"
	description="Developer docs for Paqett: provision ESP32 devices with their own X.509 client certificates, talk MQTT over mutual TLS, and ship OTA updates with rollback."
	path="/"
	jsonLd={site}
/>

<div class="page">
	<div class="doc home">
		<header class="doc-head">
			<p class="tag crumb">Paqett docs</p>
			<h1>Connect a device. Keep it updated.</h1>
			<p class="lede">
				A Paqett device makes its own key, enrols itself for an X.509 client certificate, talks MQTT over mutual TLS
				and takes firmware updates over the same session. These docs cover the device side, starting with the ESP32.
			</p>
			<div class="actions">
				<a class="btn pri" href="/guides/esp32-mqtt-mutual-tls-x509">Start with the ESP32 guide</a>
				<a class="btn sec" href="/devices/overview">How devices connect</a>
			</div>
		</header>

		<pre class="flow" aria-label="The device flow"><code
				>device                     api.paqett.com              mqtt.paqett.com:8883
  │ EC P-256 key + CSR          │                            │
  ├─ POST /v1/devices/provision ▶ cert, CN = device id       │
  ├─ TLS: verify broker, present own cert ─────────────────▶ │
  ├─ status (retained), hello ─────────────────────────────▶ │
  ◀─ ota offer (retained) ── signed HTTPS image ── confirm or roll back</code
			></pre>

		{#each SECTIONS as s (s.id)}
			<section class="home-sec">
				<h2>{s.label}</h2>
				<p>{s.blurb}</p>
				<ul class="cards">
					{#each LISTED.filter((d) => d.section === s.id) as d (d.path)}
						<li>
							<a href={d.path} class="card">
								<strong>{d.title}</strong>
								<span>{d.description}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
</div>
