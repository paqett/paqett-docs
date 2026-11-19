import { error } from '@sveltejs/kit';
import type { Component } from 'svelte';
import { DOCS, docFor } from '$lib/content';
import type { EntryGenerator, PageLoad } from './$types';

const pages = import.meta.glob<{ default: Component }>('/src/content/*/*.md');

export const entries: EntryGenerator = () => DOCS.map((d) => ({ section: d.section, slug: d.slug }));

export const load: PageLoad = async ({ params }) => {
	const doc = docFor(params.section, params.slug);
	const importer = pages[`/src/content/${params.section}/${params.slug}.md`];
	if (!doc || !importer) error(404, 'No such page');
	const mod = await importer();
	return { doc, component: mod.default };
};
