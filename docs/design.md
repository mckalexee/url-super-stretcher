# Design

How the site looks, and how to keep it that way. The words have their own guide,
[copy.md](copy.md), and the same man is behind both.

## The identity

The site is black marble and gold. The man in [copy.md](copy.md) commissioned it, and he wanted
it to look expensive: gold foil headings, a double gold rule around every page, and a polished
gold bar engraved with a stretched link. The design presents the product as a luxury and never
comments on itself.

## Type

- **Besley**, a heavy slab serif, sets everything except literal values. Headings are weight 900
  with a tight line height. Labels are weight 700, and names and buttons are weight 800.
- **JetBrains Mono** sets literal values only: the field for a URL, the long link, a
  destination, and the engraving on the gold bar. Its look-alike characters differ, which
  matters when a visitor checks a hostname.
- The stylesheet never changes the case of a string. A link is case-sensitive, and the copy is
  written in the case it's shown in.

Both fonts are variable fonts from Fontsource packages and ship with the app, so a page calls no
third-party origin.

## Color

`src/web/app.css` defines every color as a custom property on `:root`. The site has one look,
which is dark, and it doesn't follow the visitor's color scheme.

- **Black** is the page, and a deeper black is the well of a field.
- **Cream** is body text.
- **Gold** is labels, names, rules, and borders. A deep gold draws the fine line inside a
  border.
- **Foil** is a gradient that shows through the letters of a heading, the site name, the big
  figure on a result, and the name of the chosen finish.
- **Polished gold** is a gradient that fills the main button on a page.
- **A warm red** marks an error and has no other use.

## Layout

- A 2px gold rule sits inside the page edge with a 1px rule inside it. It frames the whole page,
  not the window.
- There is one breakpoint, at 900px.
- The home page, when wide, is a stage that fills the window over a band. The heading is at the
  left of the stage, the finishes are at the right, and the band holds the field and the button.
  The stage shrinks to 440px, so the field and the button show without a scroll in a window
  640px tall.
- When narrow, the stage is a strip at the top and everything else stacks under it. The strip
  takes the height that a tall window leaves over, so the page ends at the bottom of the window.
- Every other page is one column on marble that fades to black.
- On a result, the figures are on the left and the whole link is on the right. When narrow, they
  stack.
- A link or a button that stands alone is at least 44px tall to a finger. Padding adds the
  height, and a negative margin keeps the text where it was.

## The gold bar

The stage on the home page is a picture of the product: a stretched link as a gold bar that lies
on black marble, seen at an angle. It runs off the left edge and goes out of focus to the right.

- It's built in CSS. The angle comes from `perspective` on the stage and a rotation on the bar's
  wrapper. The focus comes from two copies of the bar, a sharp one masked to the near part and a
  blurred one masked to the far part.
- There is one bar for each finish, and `:has()` shows the bar of the checked radio button, with
  no script. A browser without `:has()` shows the first bar.
- The text on each bar is real output. The home route's loader runs each finish's generator on a
  fixed sequence of bytes, so the bar never needs copy of its own.
- When wide, the bar lies at the bottom of the stage and never rises to the line under the
  heading. Text over the bar is cream on gold, which nobody can read.
- The stage is hidden from assistive technology.

The marble is `src/web/marble.svg`, which draws gold veins with turbulence filters.

## Motion

The home page has no motion. A choice of finish swaps the gold bar at once, and nothing
transitions on hover.

The site has one animation, on a result. When a result arrives, the finished link lights from
the length of the visitor's own link to its full length, and every figure counts with it.
`useLighting` in `src/web/routes/home.tsx` runs it.

- The whole link is laid out from the first frame, so nothing moves while it lights.
- One clock drives the link and the figures, so they agree in every frame.
- It doesn't run for a visitor who prefers reduced motion, or without the script.

Don't add a second animation. To change this one, capture frames across its whole duration and
look at them. A screenshot of the last frame doesn't show motion.

## Share images

A social platform or a message app shows a card beside a shared link. `src/web/share.ts` writes
the tags for the card, and the card's image is one of two files in `public/share`:

- `home.jpg` goes with the home page.
- `link.jpg` goes with every stretched link. The card's title names the destination's hostname,
  and a blocked or removed link names nothing.

Each image is a page in `design/share`, 1200 by 630 pixels, in the site's look. The text on each
gold bar is real output of a finish. To change an image, edit its page, then render the page
with Chrome and convert the result to JPEG. On macOS, from the repository root:

```sh
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$chrome" --headless=new --hide-scrollbars --allow-file-access-from-files \
  --window-size=1200,630 --virtual-time-budget=5000 \
  --screenshot=home.png "file://$PWD/design/share/home.html"
sips -s format jpeg -s formatOptions 80 home.png --out public/share/home.jpg
```

Platforms keep an image for a long time. To make them fetch a changed image, give the file a
new name and update `SHARE_IMAGES` in `src/web/share.ts`.

`public/robots.txt` keeps crawlers out of `/to/` and lets the preview fetchers of the large
platforms in. Without that group, a shared stretched link shows no card.

## Check a change

Look at the home page with each finish chosen, a result, and a link page at 320px and at 1280px
wide. No page scrolls sideways at any width.

Look at the home page in a short window and a tall one too: 1366 by 640, 1024 by 768, and 820 by 1180. A common laptop shows about 640px of height. The line under the heading stays clear of
the gold bar, and the button shows without a scroll.

## The taste skill

`.claude/settings.json` enables the `taste-skill` plugin for Claude Code in this repository.
The skill builds a company site from its own kit: a dealt palette, dealt fonts, a navigation
bar, sections one screen tall, photographs, and motion. This site has its own identity, so use
the skill's checker and leave its kit alone.

- This document wins over the skill. Don't deal a palette, fonts, a hero, or a moment, and don't
  copy the skill's `assets` folder into `public`.
- Don't arm the finish gate with `gate.mjs --start` or `start.mjs deal`. An armed gate writes
  `.taste-skill/` and then holds the end of a session until its checks pass, and most of its
  checks can't pass here.
- To check a page, start `pnpm dev` and run the checker from the plugin's `skills/taste-skill`
  folder. It needs Node.js 22 or later and Chrome.

```sh
node scripts/consistency.mjs http://localhost:5173/ --widths 1440,1024,820,768,390 --page software
```

The checker prints many failures for this site. Act on a finding from this list:

- `contrast` and `text-contrast`: text that's hard to read on what's behind it.
- `tap-size`, `collide`, and `off-viewport`: a control that's too small, covered, or off the
  screen on a phone.
- `fold-action`: the button isn't on the first screen.
- `links`, `forms`, `a11y-name`, `field-label`, `heading-order`, and `focus-hidden`.

The other failures describe the skill's kit and not a defect:

- `nav`, `cta`, `hero-screen`, `hero-fill`, `section-height`, `one-section`, `one-heading`,
  `container-edges`, `row-lines`, `row-gap`, and `section-gaps` expect the kit's navigation bar
  and its sections.
- `tilt`, `spill`, `cut-text`, and `flush` report the gold bar, which is turned and cut off on
  purpose.
- `focus-ring` and `focus-visible` look for a ring on the radio button. The ring is on the whole
  finish.
- `hero-enter` and `moment-none` ask for motion that the home page doesn't have.
- `copy-fact` and the other copy checks don't apply. [copy.md](copy.md) decides the copy.
