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
  When narrow, the stage is a strip at the top and everything else stacks under it.
- Every other page is one column on marble that fades to black.
- On a result, the figures are on the left and the whole link is on the right. When narrow, they
  stack.

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

## Check a change

Look at the home page with each finish chosen, a result, and a link page at 320px and at 1280px
wide. No page scrolls sideways at any width.
