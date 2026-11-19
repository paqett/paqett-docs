import { error } from '@sveltejs/kit';
import { DOCS, docFor, markdownFor } from '$lib/content';
import { SITE } from '$lib/schema';
import type { EntryGenerator, RequestHandler } from './$types';

// The page as plain Markdown: what LLM crawlers and agents read best. Linked from each page's
// <head> (rel=alternate type=text/markdown) and from llms.txt.
export const prerender = true;

export const entries: EntryGenerator = () => DOCS.map((d) => ({ section: d.section, slug: d.slug }));

export const GET: RequestHandler = ({ params }) => {
	const doc = docFor(params.section, params.slug);
	if (!doc) error(404, 'No such page');
	return new Response(markdownFor(doc, SITE), {
		headers: { 'content-type': 'text/markdown; charset=utf-8' }
	});
};
