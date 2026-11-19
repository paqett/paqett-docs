import { error } from '@sveltejs/kit';
import { LISTED, SECTIONS } from '$lib/content';
import type { EntryGenerator, PageLoad } from './$types';

export const entries: EntryGenerator = () => SECTIONS.map((s) => ({ section: s.id }));

export const load: PageLoad = ({ params }) => {
	const section = SECTIONS.find((s) => s.id === params.section);
	if (!section) error(404, 'No such page');
	return { section, docs: LISTED.filter((d) => d.section === section.id) };
};
