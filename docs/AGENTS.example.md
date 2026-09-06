# AGENTS.md — a worked example

A complete `AGENTS.md` for a fictional site: **Northline Studio** (`northline.example`), a small
architecture practice. Hand-written static HTML on Netlify — no framework, no build step — because
that is the case where an agent has the least structure to infer and the guidance file carries the
most weight.

Copy the _shape_, not the contents. What makes it work is that every instruction is specific enough
to be checkable: "exactly one `<h1>` per page" is guidance an agent can follow, "keep it on brand"
is not. Replace the stack, the site map, the components and the facts with your own, and keep the
procedure.

If your site is right-to-left, bilingual, or uses a framework, say so in the same concrete way —
the `<html lang>` and `dir` attributes that must never change, which strings get wrapped, which
directory a route actually lives in.

Two things to remember about this file wherever you put it:

- **It is advisory.** It never widens `.webagent/policy.yml`. If it tells the agent to edit
  `sitemap.xml` and the policy does not allow `sitemap.xml`, the change is refused.
- **The agent cannot edit it.** `AGENTS.md` is denied at any depth, whatever the policy says.

The policy this example assumes — everything the "add a page" recipe touches is allowed, and
`maxFilesChanged` is large enough for a navigation edit that lands on every page:

```yaml
# .webagent/policy.yml
allow:
  - 'index.html'
  - '404.html'
  - 'pages/**'
  - 'images/**'
  - 'style.css'
  - 'sitemap.xml'
  - 'llms.txt'
deny:
  - 'script.js'
  - 'analytics-init.js'
maxFilesChanged: 15
maxDiffLines: 900
forbidNewDependencies: true
forbidExternalCode: true
```

---

Everything below the line is the file itself.

---

# AGENTS.md — northline.example

Northline Studio is a two-person architecture practice. This site is its portfolio and its first
point of contact: people arrive from search or a referral, look at three or four projects, and
send a message.

## The stack, in one paragraph

Hand-written static HTML. One `style.css`, one `script.js`, no framework, no build step, no package
manager. Netlify serves it and strips `.html`, so the file `pages/services.html` is the URL
`/pages/services` — always link to the extensionless form. `index.html` is the finished home page
and the canonical example of every pattern here: **read it before writing anything.**

## Site map

```
/                      index.html
/pages/work            pages/work.html
/pages/services        pages/services.html
/pages/studio          pages/studio.html
/pages/journal         pages/journal.html
/pages/contact         pages/contact.html
/pages/thank-you       pages/thank-you.html   (noindex, form target)
                       404.html
```

Navigation order, identical in the header of every page:
Home · Work · Services · Studio · Journal · [Contact — button]

## Language and voice

- Every page opens `<html lang="en">`. Never change it.
- Plain, specific, unhurried. Name materials, places and constraints; no superlatives, no
  "passionate", no exclamation marks.
- Read the page you are writing next to before you write. Matching the register of the page above
  matters more than any rule here.

## Design system — compose, do not invent

Pages are a vertical stack of edge-to-edge **bands**. Nothing floats in a rounded card with a drop
shadow.

```html
<section class="band band--paper">…</section>
<!-- white, for reading -->
<section class="band band--paper-2">…</section>
<!-- off-white, for alternation -->
<section class="band band--ink">…</section>
<!-- dark, for pull quotes and CTAs -->
<section class="band band--photo band--smoke" style="--img: url('/images/atrium.webp')">…</section>
```

Inside a band, `.wrap` is the wide container and `.wrap-prose` the reading measure. `--tight`
halves the vertical rhythm.

**Never place two photographic bands back to back.** Alternate photo → paper → photo. Long prose
always sits on `band--paper` or `band--paper-2`.

Three type roles, all self-hosted, and there is never a fourth: `--f-display` for headings,
`--f-body` for all running text, `--f-accent` for uppercase eyebrows and labels. Do not add a
webfont, and do not load one from a font CDN — the policy gate refuses off-site code, and the
change is rejected whole.

The signature device is the hairline rule — `<span class="rule" aria-hidden="true"></span>` — which
goes **under every `<h1>` and under a band's `<h2>`, and nowhere else.** Do not scatter it.

Components that already exist in `style.css`: `.page-hero` · `.breadcrumbs` · `.eyebrow` ·
`.band-head` · `.split` · `.grid--2` `.grid--3` · `.project-card` · `.feature-list` · `.steps` ·
`.faq` · `.quote` · `.embed-facade` · `.contact-row` · `.form` · `.btn` (`--primary`, `--ghost`,
`--outline`) · `.prose` · `.lead` · `.social-list` · `.reveal`.

**No inline `<style>` blocks and no new CSS files.** If something genuinely has no component,
append it to `style.css` in the existing token vocabulary and say so in your summary.

---

## How to add a new page

The one procedure worth writing down, because a page added halfway is worse than no page: it gets
indexed, it gets linked, and it is wrong. Work through all nine steps in one change.

### 1. Pick the slug and the file

Lowercase, hyphenated, describing the topic — `pages/planning-permission.html` serving
`/pages/planning-permission`. Never change the slug of an existing page: that is a dead URL and a
lost ranking. If a page really must move, say so in your summary instead of moving it.

### 2. Start from an existing page, not from scratch

Copy `pages/services.html`. Take its `<head>`, `.skip-link`, `<header class="site-header">`,
`<footer class="site-footer">` and the closing `<script src="/script.js" defer>` **verbatim**. Then
change only what step 3 lists.

One exception to "verbatim": the analytics loader. A line like
`<script async src="https://cdn.analytics.example/tag.js">` loads code from another origin, and
adding it to a new file is refused by the policy gate — the whole change is rejected, not just that
line. New pages carry `<script src="/analytics-init.js" defer></script>` only; that same-origin
script loads the tag itself.

### 3. Rewrite exactly these `<head>` values

| Element                                 | Rule                                                               |
| --------------------------------------- | ------------------------------------------------------------------ |
| `<title>`                               | unique, ≤ 60 characters, most specific words first                 |
| `<meta name="description">`             | unique, 70–155 characters, a real sentence, not a list of keywords |
| `<link rel="canonical">`                | absolute and extensionless: `https://northline.example/pages/<slug>` |
| `og:title` / `og:description`           | may differ from the `<title>`; written for a shared link           |
| `og:url`                                | the same absolute URL as the canonical                             |
| `twitter:title` / `twitter:description` | mirror the OG pair                                                 |
| hero `<link rel="preload" as="image">`  | point at this page's hero image, with its `imagesrcset`            |

Leave alone: `charset`, `viewport`, `robots`, `author`, `theme-color`, `og:type`, `og:locale`,
`og:site_name`, `og:image` and its dimensions, `twitter:card`, the icons, the font preloads, and
the stylesheet link. They are site-wide constants.

### 4. Write the JSON-LD

One `<script type="application/ld+json">` holding a `@graph` with **`WebPage` and
`BreadcrumbList`**, following `pages/services.html` exactly:

- `@id` is the page URL plus `#webpage` / `#breadcrumb`.
- `inLanguage` matches the `<html lang>`.
- `isPartOf` references `https://northline.example/#website`; `about` and `author` reference
  `https://northline.example/#organization`. Reference them by `@id` — **never re-declare the
  Organization or the LocalBusiness on an inner page.** Two competing definitions of the same
  entity is worse than one.
- The `BreadcrumbList` items must match the visible breadcrumbs from step 6, in the same order.

Add no other schema type unless the page genuinely is that thing. In particular, no `FAQPage`:
Google retired FAQ rich results, and it is now maintenance with no benefit. FAQs are plain
`<details>` markup.

### 5. Add the page to the header and footer navigation — on every page

The header and footer are duplicated in each file; there is no template. Adding a link means
editing `index.html`, every `pages/*.html`, and `404.html`. Add it in the same position in every
one, matching the site-wide order.

On the new page itself, and only there, the new link carries `aria-current="page"`. Remove that
attribute from the link it was copied from — a page claiming to be two places at once is a real bug
that ships quietly.

If the navigation is getting long, do not silently drop an item to make room. Add the page, and say
in your summary that the nav now has seven items and may need a decision.

### 6. Write the page body

```html
<main id="main">
  <section class="page-hero" style="--img: url('/images/atrium.webp')">
    <div class="wrap">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <ol>
          <li><a href="/">Home</a></li>
          <li aria-current="page">Planning permission</li>
        </ol>
      </nav>
      <p class="eyebrow">PLANNING</p>
      <h1>…</h1>
      <span class="rule" aria-hidden="true"></span>
      <p class="page-hero__lead">…</p>
    </div>
  </section>

  <section class="band band--paper">
    <div class="wrap-prose prose">…</div>
  </section>
  …
  <!-- closing CTA, always a photographic band -->
</main>
```

Rules that hold on every page:

- **Exactly one `<h1>`.** Then `<h2>` → `<h3>` with no skipped levels.
- Every page links to `/pages/contact` **and to at least two sibling pages**, from the body text and
  not only from the navigation.
- Tap targets at least 48px. Every `target="_blank"` carries `rel="noopener"`.
- Embeds use the click-to-load `.embed-facade` pattern, never a raw `<iframe>`. A literal
  `<iframe>` in the markup is refused by the policy gate; the facade's `data-src` is not.

### 7. Images

Use an image that is already in `/images/`. If the page needs one that does not exist, say so in
your summary — do not stretch an unrelated photo across it.

- `.webp`, served from `/images/`, with an `-800.webp` variant in the `srcset` for the hero.
- Real `alt` text describing what is in the frame — not the page title, and never empty on a
  content image.
- Explicit `width` and `height` on every `<img>`. Without them the page reflows as images arrive,
  which is a Cumulative Layout Shift regression and shows up in Core Web Vitals.
- `loading="lazy" decoding="async"` on everything **except** the hero image, which takes
  `fetchpriority="high"` and the `<head>` preload from step 3.

### 8. Add the page to `sitemap.xml` and `llms.txt`

A page in neither is a page nothing finds.

```xml
<url>
  <loc>https://northline.example/pages/planning-permission</loc>
  <lastmod>2026-09-06</lastmod>
  <changefreq>monthly</changefreq>
  <priority>0.8</priority>
</url>
```

`lastmod` is today's date, `YYYY-MM-DD`. Service pages take priority `0.9`, supporting pages
`0.7`–`0.8`; the home page keeps `1.0` and nothing else may claim it. Update the `lastmod` of any
other page whose content you actually changed — a navigation-only edit does not count.

Then add one line to the `## Pages` list in `/llms.txt`, in the same one-sentence style as the
others.

Leave `robots.txt` alone unless the new page must be hidden from search, which for a normal page it
must not be.

### 9. Check before reporting done

Read your own diff and confirm:

- [ ] exactly one `<h1>` in the new file
- [ ] `<title>` ≤ 60 chars, description 70–155 chars, both unique across the site
- [ ] canonical, `og:url` and the sitemap `<loc>` are the same absolute extensionless URL
- [ ] `aria-current="page"` appears once in the new page's nav, and was removed from the copied one
- [ ] the new link is in the header and footer of _every_ page, in the same position
- [ ] every `<img>` has `alt`, `width`, `height`; every non-hero image has `loading="lazy"`
- [ ] the visible breadcrumbs match the `BreadcrumbList` in the JSON-LD
- [ ] no inline `<style>`, no new CSS file, no new font
- [ ] no `<iframe>`, no off-site `<script src>`, no `http://` URL
- [ ] no two photographic bands adjacent

---

## Facts you may state, and nothing beyond them

- The practice name, the two partners' names and titles, and the studio address: copy them from
  `index.html`. They are also in the `Organization` JSON-LD, which is the version to trust.
- Contact details — phone, email, the contact form — exist in exactly one place, the footer and
  `/pages/contact`. Copy them; never retype a number from memory.
- Project names, locations and completion years: only the ones already published on `/pages/work`.

**No fees are published anywhere on this site.** Write a pricing _policy_ ("scoped and quoted after
a first conversation"), never a number.

**Never invent a client, a project, a testimonial, an award, a year or a statistic.** If a page
needs one, leave a clearly marked HTML comment saying what the owner must supply, and say so in
your summary. A fabricated credit in a portfolio is worse than an empty section.

## What not to touch

Beyond what the policy already refuses:

- `script.js` and `analytics-init.js` — the analytics wiring, the embed facades and the navigation
  behaviour live there. A content change never needs them.
- The `:root` design tokens at the top of `style.css`. Append new rules at the bottom; do not
  retune the palette or the type scale to make one section look better.
- The `Organization` and `LocalBusiness` JSON-LD blocks in `index.html`. Inner pages reference them
  by `@id`; they are not copied and not edited.
- Any existing URL. Renaming a file renames a live URL.

## If you cannot do it

Say so plainly in your summary and change nothing rather than something adjacent. The likely cases:
a page that needs a photograph the site does not have, a request for a fee, a change that needs a
third-party embed or a new font, or anything in the build or hosting configuration. All of these
are someone's decision to make, not something to approximate.
