import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex, code_highlighter } from 'mdsvex';
import GithubSlugger from 'github-slugger';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

/** Plain text of an mdast node: text and inline code, nothing else. */
function textOf(node) {
	if (node.type === 'text' || node.type === 'inlineCode') return node.value;
	return (node.children ?? []).map(textOf).join('');
}

/** Readable text of a block: paragraphs and list items joined, code blocks left out. */
function blockText(nodes) {
	return nodes
		.filter((n) => n.type !== 'code' && n.type !== 'html')
		.map((n) => textOf(n).replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join(' ');
}

/** First link (url + text) in a node, for Sources list items. */
function firstLink(node) {
	if (node.type === 'link') return { url: node.url, name: textOf(node) };
	for (const c of node.children ?? []) {
		const l = firstLink(c);
		if (l) return l;
	}
	return null;
}

/**
 * Remark plugin. Adds to each page's frontmatter metadata, for the table of contents and the
 * structured data (src/lib/schema.ts):
 * - headings: h2 and h3 with the ids rehype-slug gives them
 * - wordCount: prose only
 * - faq: `### Question` + answer under `## FAQ` (FAQPage)
 * - steps: `## Step N: name` + its first paragraph (HowTo)
 * - terms: every `### Term` + its first paragraph on a `kind: glossary` page (DefinedTermSet)
 * - sources: the links listed under `## Sources` (citation)
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

		// Sections: walk the top-level nodes, tracking the current h2 and h3.
		const faq = [];
		const steps = [];
		const terms = [];
		const sources = [];
		const top = tree.children;
		const ids = new GithubSlugger();
		let h2 = '';
		for (let i = 0; i < top.length; i++) {
			const n = top[i];
			if (n.type !== 'heading') continue;
			const text = textOf(n).trim();
			const id = ids.slug(text);
			// The body until the next heading of the same or a higher level.
			const body = [];
			for (let j = i + 1; j < top.length; j++) {
				const m = top[j];
				if (m.type === 'heading' && m.depth <= n.depth) break;
				if (m.type === 'heading') break;
				body.push(m);
			}
			if (n.depth === 2) {
				h2 = text.toLowerCase();
				const step = text.match(/^Step\s+\d+\s*[:.]\s*(.+)$/i);
				if (step) {
					const first = body.find((b) => b.type === 'paragraph');
					steps.push({ name: step[1], text: first ? blockText([first]) : step[1], id });
				}
				if (h2 === 'sources') {
					for (const list of body.filter((b) => b.type === 'list')) {
						for (const item of list.children) {
							const l = firstLink(item);
							if (l && /^https?:/.test(l.url)) sources.push(l);
						}
					}
				}
			}
			if (n.depth === 3 && (h2 === 'faq' || h2.startsWith('frequently asked'))) {
				const answer = blockText(body);
				if (answer) faq.push({ q: text, a: answer });
			}
			if (n.depth === 3 && fm.kind === 'glossary') {
				const first = body.find((b) => b.type === 'paragraph');
				if (first) terms.push({ name: text, text: blockText([first]), id });
			}
		}
		fm.faq = faq;
		fm.steps = steps;
		fm.terms = terms;
		fm.sources = sources;
	};
}

/**
 * mdsvex's highlighter puts each block inside {@html `...`}, a JavaScript template literal, and
 * escapes only \t, \r and \n there: every other backslash in code was eaten, so
 * "{\"ok\":true}" rendered as "{"ok":true}". Highlight without that wrapper, turn every
 * backslash into an entity, then wrap it the same way.
 */
async function highlighter(code, lang, meta, filename) {
	const html = await code_highlighter(code, lang, meta, filename, false);
	const m = html.match(/^(<pre[^>]*>)([\s\S]*)(<\/pre>)$/);
	if (!m) return html;
	return `${m[1]}{@html \`${m[2].replace(/\\/g, '&#92;')}\`}${m[3]}`;
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
			highlight: { highlighter },
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
