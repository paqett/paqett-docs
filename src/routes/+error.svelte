<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status === 404 ? 'Page not found' : 'Something went wrong'} | Paqett docs</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<div class="doc">
		<header class="doc-head">
			<p class="tag crumb">{page.status}</p>
			<h1>{page.status === 404 ? 'Page not found' : 'Something went wrong'}</h1>
			<p class="lede">
				{page.status === 404 ? 'That page is not in the docs.' : page.error?.message}
				<a href="/">Back to the docs home</a>.
			</p>
		</header>
	</div>
</div>
