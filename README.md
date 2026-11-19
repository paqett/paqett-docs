# paqett-docs

[docs.paqett.com](https://docs.paqett.com): developer documentation for the Paqett platform. SvelteKit + mdsvex, every
page prerendered, deployed by Vercel from `main`.

## Pages

Every page is a Markdown file at `src/content/<section>/<slug>.md`, served at `/<section>/<slug>`. Sections are listed
in `src/lib/content.ts` (`guides`, `devices`); the sidebar, section pages, sitemap and llms.txt are built from the
files, so adding a page is adding a file.

```md
---
title: "ESP32 OTA updates over MQTT, with automatic rollback"
nav: "ESP32: OTA updates over MQTT"   # optional, shorter sidebar label
description: "One sentence, 140 to 160 characters: the meta description and the lede."
order: 2                               # position within the section
updated: 2026-11-19
keywords: [esp32 ota update, esp32 ota rollback]
draft: true                            # optional: built, noindex, left out of nav and sitemap
---

Body. ## and ### headings only (the layout renders the title as the h1).
```

- Quote `title`, `nav` and `description`: an unquoted `: ` breaks the YAML and the page loses its metadata.
- mdsvex reads `{`, `}` and `<` in prose as Svelte. Keep them inside code spans or fenced blocks.
- Fenced blocks need a language (`c`, `cpp`, `sh`, `json`, `ini`, `text`) for highlighting.
- Callouts are blockquotes that start with `**Note:**` or `**Warning:**`.
- British English. The device contract is `docs/devices.md` in paqett-platform; keep the reference pages in step with it.

## SEO

Each page gets a canonical URL, Open Graph and Twitter tags, `TechArticle` + `BreadcrumbList` JSON-LD
(`src/lib/Seo.svelte`), and a share image at `static/og/<section>--<slug>.png`. After adding or retitling a page:

```sh
pnpm og     # renders static/og/*.png with headless Chrome; commit them
```

`/sitemap.xml` and `/llms.txt` are generated at build time. `docs.paqett.com` is covered by the `sc-domain:paqett.com`
Search Console property.

## Analytics

Cookieless PostHog, the same project as www.paqett.com (`src/hooks.client.ts`), proxied through `/ph` (`vercel.json`).
It reports only from `docs.paqett.com`; open any page with `?internal=1` to tag your own visits.

## Develop

```sh
pnpm install
pnpm dev
pnpm check && pnpm build
```
