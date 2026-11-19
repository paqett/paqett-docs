import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import GithubSlugger from 'github-slugger';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

/** Plain text of an mdast node: text and inline code, nothing else. */
function textOf(node) {
	if (node.type === 'text' || node.type === 'inlineCode') return node.value;
	return (node.children ?? []).map(textOf).join('');
}

/**
 * Remark plugin: adds `headings` (h2 and h3, with the ids rehype-slug gives them, for the
 * page's table of contents) and `wordCount` (prose only, for the TechArticle JSON-LD) to
 * each page's frontmatter metadata.
 */
function pageOutline() {
	return (tree, file) => {
		const fm = file.data.fm;
		if (!fm) return;
		const slugger = new GithubSlugger();
		const headings = [];
		const words = [];
		const walk = (node) => {
			if (node.type === 'heading') {
				const text = textOf(node);
				const id = slugger.slug(text);
				if (node.depth === 2 || node.depth === 3) headings.push({ depth: node.depth, text, id });
			}
			if (node.type === 'code') return;
			if (node.type === 'text' || node.type === 'inlineCode') words.push(node.value);
			node.children?.forEach(walk);
		};
		walk(tree);
		fm.headings = headings;
		fm.wordCount = words
			.join(' ')
			.split(/\s+/)
			.filter((w) => /\w/.test(w)).length;
	};
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte', '.md'],
	preprocess: [
		vitePreprocess(),
		// Pages in src/content/<section>/<slug>.md. smartypants off: code-ish prose keeps its
		// straight quotes.
		mdsvex({
			extensions: ['.md'],
			smartypants: false,
			remarkPlugins: [pageOutline],
			rehypePlugins: [
				rehypeSlug,
				[
					rehypeAutolinkHeadings,
					{ behavior: 'append', properties: { class: 'anchor', ariaHidden: 'true', tabIndex: -1 } }
				]
			]
		})
	],
	kit: {
		// Plain files in build/, served from the Paqett box (deploy/). 404.html is the
		// not-found page: the client router renders +error.svelte for any unknown path.
		adapter: adapter({ pages: 'build', assets: 'build', fallback: '404.html', strict: true }),
		prerender: {
			handleHttpError: 'fail',
			handleMissingId: 'fail'
		}
	}
};

export default config;
