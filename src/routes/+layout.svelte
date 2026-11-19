<script lang="ts">
	import '$lib/docs.css';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import wordmark from '$lib/assets/paqett-wordmark.svg';
	import { LISTED, SECTIONS } from '$lib/content';

	let { children } = $props();
	let menuOpen = $state(false);

	// Copy buttons on code blocks: added after each navigation, since the Markdown
	// renders plain <pre> elements.
	afterNavigate(() => {
		menuOpen = false;
		for (const pre of document.querySelectorAll<HTMLPreElement>('.prose pre')) {
			if (pre.parentElement?.classList.contains('code')) continue;
			const wrap = document.createElement('div');
			wrap.className = 'code';
			pre.replaceWith(wrap);
			wrap.append(pre);
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'copy';
			btn.textContent = 'Copy';
			btn.addEventListener('click', async () => {
				try {
					await navigator.clipboard.writeText(pre.innerText);
					btn.textContent = 'Copied';
				} catch {
					btn.textContent = 'Press ⌘C';
				}
				setTimeout(() => (btn.textContent = 'Copy'), 1500);
			});
			wrap.append(btn);
		}
	});

	const current = $derived(page.url.pathname);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)} />

<div class="shell">
	<header class="top">
		<div class="top-in">
			<a href="/" class="brand" aria-label="Paqett docs home">
				<img src={wordmark} alt="Paqett" width="66" height="22" />
				<span class="tag">Docs</span>
			</a>
			<nav class="top-links" aria-label="Site">
				<a href="/guides/esp32-mqtt-mutual-tls-x509" class:on={current.startsWith('/guides')}>Guides</a>
				<a href="/devices/overview" class:on={current.startsWith('/devices')}>Reference</a>
				<a href="https://www.paqett.com/">paqett.com</a>
				<a href="https://console.paqett.com/" class="cta">Console</a>
			</nav>
			<button
				type="button"
				class="menu-btn"
				aria-expanded={menuOpen}
				aria-controls="side"
				onclick={() => (menuOpen = !menuOpen)}>{menuOpen ? 'Close' : 'Menu'}</button
			>
		</div>
	</header>

	<div class="body">
		<aside id="side" class="side" class:open={menuOpen}>
			<nav aria-label="Docs">
				{#each SECTIONS as s (s.id)}
					<p class="side-h tag">{s.label}</p>
					<ul>
						{#each LISTED.filter((d) => d.section === s.id) as d (d.path)}
							<li>
								<a href={d.path} aria-current={current === d.path ? 'page' : undefined}>{d.nav}</a>
							</li>
						{/each}
					</ul>
				{/each}
				<p class="side-h tag">Elsewhere</p>
				<ul>
					<li><a href="https://console.paqett.com/">Paqett Console</a></li>
					<li><a href="https://www.paqett.com/writing">Field notes</a></li>
				</ul>
			</nav>
		</aside>
		<div class="main">
			{@render children()}
			<footer class="foot">
				<span>© {new Date().getFullYear()} Paqett</span>
				<a href="https://www.paqett.com/">www.paqett.com</a>
				<a href="/llms.txt">llms.txt</a>
				<a href="/sitemap.xml">Sitemap</a>
			</footer>
		</div>
	</div>
</div>
