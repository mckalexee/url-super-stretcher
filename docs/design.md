# Design

How the site looks, and how to keep it that way. The words have their own guide,
[copy.md](copy.md), and the same man is behind both.

## The identity

The site is charcoal and silver, with names in wide spaced capitals, the way a maker's name is
engraved on the back of a watch case or stamped on a metal card. The man in [copy.md](copy.md)
commissioned it, and he wanted it to look heavy and costly. The design never jokes. It has no
rulers, no stretched shapes, and no illustrations of length, because a picture of the joke
explains the joke.

## Type

- **Archivo**, a variable font with a width axis, sets everything except literal values.
- **Engraved text** is Archivo at its widest width, `--wide`, in capitals with open letter
  spacing. It sets names, headings, labels, and controls. It never sets a sentence.
- **Sentences** are Archivo at normal width, in sentence case.
- **IBM Plex Mono** sets literal values only: the field for a URL, the long link, and a
  destination. Its look-alike characters differ, which matters when a visitor checks a hostname.
  A literal value is never in capitals, because a link is case-sensitive.

Both fonts come from Fontsource packages and ship with the app, so a page calls no third-party
origin.

## Color

`src/web/app.css` defines every color as a custom property on `:root`. The site has one look,
which is dark, and it doesn't follow the visitor's color scheme.

- **Charcoal and silver** are the page and the text. A lighter charcoal makes a panel.
- **The accent** is one blue, and it marks only what belongs to the visitor: the chosen finish,
  the field in use, and the finished link. A page with nothing of the visitor's on it has no
  accent. Don't use the accent to decorate.
- **Red** marks an error and has no other use.

## Layout

- One wide column, aligned left, 78rem at most.
- Nothing has a radius, a shadow, or a gradient. Rules are 1px.
- The finishes sit side by side between two rules, in four columns, then two, then one.
- On a result, the figures are on the left and the whole link is on the right. On a narrow
  screen, they stack.

## Motion

The site has one animation. When a result arrives, the finished link lights from the length of
the visitor's own link to its full length, and every figure counts with it. `useLighting` in
`src/web/routes/home.tsx` runs it.

- The whole link is laid out from the first frame, so nothing moves while it lights.
- One clock drives the link and the figures, so they agree in every frame.
- It doesn't run for a visitor who prefers reduced motion, or without the script.

Don't add a second animation. To change this one, capture frames across its whole duration and
look at them. A screenshot of the last frame doesn't show motion.

## Check a change

Look at the home page, a result, and a link page at 320px and at 1280px wide. No page scrolls
sideways at any width.
