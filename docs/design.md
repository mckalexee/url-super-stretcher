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

A choice of finish swaps the bar at once, and nothing transitions on hover.

The marble is `src/web/marble.svg`, which draws gold veins with turbulence filters. Once motion is
allowed, the water covers it and the shine crosses the bar. [Motion](#motion) describes both.

## Motion

The site moves in three layers: light on the marble, a shine on the gold, and the arrival of a
result. Every layer is behind one switch, and every layer degrades to the still page that a
visitor without script sees. The subject is tacky, and the execution is clean:

- Between movements, nothing runs except the water. The shine requests frames only while its
  band moves, and the arrival ends when the link lands.
- Nothing leaves an inline style behind. An effect that ends returns its elements to what the
  stylesheet draws.
- Nothing moves outside the switch.

### The switch

`src/web/motion.ts` decides whether the page may move. Motion is allowed only after hydration,
while the visitor's system doesn't ask for reduced motion, and while the visitor hasn't paused
it. While it's allowed, the switch sets `data-motion="on"` on `<html>`.

- Put motion CSS under `:root[data-motion="on"]` inside
  `@media (prefers-reduced-motion: no-preference)`.
- In a component, read the switch with `useMotionAllowed()`. In a module that isn't a component,
  follow it with `watchMotion()`.
- The footer control in `src/web/root.tsx`, **Pause motion** and **Resume motion**, sets the
  pause, and the browser's storage keeps it for later pages and visits. The control renders only
  after hydration, and not at all when the system asks for reduced motion.
- Without script, the page is still and whole: the server sends no canvas, no `data-motion`, and
  no control.

### Light on the marble

A WebGL2 canvas over the still marble draws caustics, the net of light on the floor of a pool,
in gold on black. `src/web/water.ts` draws it, and `Marble` in `src/web/marble.tsx` mounts it
after hydration on every page that shows marble.

- The look is `SPEED`, `SCALE`, and `STRENGTH` at the top of `water.ts`, at 0.25, 0.85, and 0.65,
  with the wave and net tables under them. The owner chose them in the lab,
  `design/motion/water.html`, where the preset `chosen` loads them.
- The water takes no pointer input. Don't add ripples that follow the pointer: the owner chose the
  look without them.
- It aims for 60 frames a second. A device that can't keep up drops to 30, and then to a lower
  resolution. It doesn't step back up.
- The page pays for WebGL only once motion is allowed. Every failure, such as a context that
  can't be created or a shader that doesn't compile, leaves the still marble, `src/web/marble.svg`,
  which is also what a visitor sees without script or with reduced motion. A pause holds the
  frame that's showing.

### The shine

One slanted band of light crosses the window about every 8 to 12 seconds, and each gold element
shows its own slice of it, so the page reads as one polished surface under one light. A moving
mouse or pen carries the band, and a resting pointer holds it. A touch screen gets the timed
crossings only. `src/web/shine.ts` runs it, and the section "The shine" in `src/web/app.css`
paints it.

- The timing numbers are constants at the top of `shine.ts`. The look's numbers, such as
  `--shine-lean`, `--shine-band`, and `--shine-band-strength`, are custom properties in the
  stylesheet's section, and `shine.ts` reads the ones that its geometry needs.
- The gold is found by selector, so the markup carries nothing for the shine. To add a gold
  element, add it to a selector in `shine.ts`.
- On the gold bar, the band is worked out in the bar's perspective, so its slice lines up with
  the flat gold around it.
- A browser that lacks a feature that the shine needs keeps the still gold.

### A result's arrival

After a stretch without a page load, the long link arrives in one of two ways.
`src/web/routes/home.tsx` decides which.

- **The coil.** From the home page's form, on a window at least 900px wide that holds the whole
  home page without scrolling, the long link types
  over the visitor's link in the field, runs out of the field, and coils around the inside of the
  page's gold frame. The result then takes the home page's place, and the link flies into the
  result's box row by row. `src/web/coil.ts` draws it, `src/web/coil-geometry.ts` holds its
  arithmetic, and the section "The coil" in `app.css` styles it. The owner approved the
  prototype, `design/motion/coil.html`.
- **The typing.** When the coil doesn't play, for example on a narrow window, from the form under
  a result, or when the link doesn't fit the coil, the result fades in and the long link types over
  the visitor's link in the result's box. `useTyping` in `home.tsx` runs it.

Both type on the curve in `src/web/typing.ts`, which starts slow and speeds up. The whole link is
laid out from the first frame and breaks lines at any character, so nothing shifts while it
types, and one clock drives the link and the figures, so they agree in every frame. The coil's
timing and sizes are constants at the top of `coil.ts`, and the fades are custom properties in
"The coil". A pause in the middle sends the link to rest for good. The coil also drops to the
result at rest on a hidden tab, a resize, or a failure.

### Change the motion

- **Show options first.** The owner judges motion by eye. Before you build a new look or motion
  into the app, put a live lab page with a few variants in `design/motion/` and let the owner
  pick. A description doesn't predict how a look reads: the first water look was built into the
  app from one, and the owner rejected it on sight.
- **No view transitions.** Don't use browser view transitions or a shared-element morph. A morph
  crops the boxes it moves into half-boxes, and the owner rejected it.
- **Keep it behind the switch.** A new effect follows `src/web/motion.ts`, stops when the switch
  turns off, and leaves the still page whole when it fails.
- **Capture the whole duration.** To change an animation, capture frames across its whole
  duration and look at them. A screenshot of the last frame doesn't show motion. The labs take a
  query parameter that draws one frozen frame: `time=` in `water.html`, and `t=` and `f=` in
  `coil.html`.
- **Check on a real display.** Headless Chrome reports 60 Hz, and the owner's display runs at
  120 Hz, so frame pacing and smoothness need a look on real hardware.

### Animation skills

Five animation skills are vendored in `.claude/skills/`. This document wins where a skill
disagrees with it.

- `animate`: deciding whether something should move, and choosing its properties, curve, and
  duration.
- `choreograph`: several elements that move together, such as the coil's finale.
- `animation-performance`: a dropped frame, or a choice of property or of CSS against script.
- `review-animations`: a critique of motion that you've built, before you show it to the owner.
- `vercel-react-view-transitions`: reference only. The site doesn't use view transitions.

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
- `hero-enter` and `moment-none` ask for the kit's entrance and its moment. The site's motion is
  its own, in [Motion](#motion).
- `copy-fact` and the other copy checks don't apply. [copy.md](copy.md) decides the copy.
