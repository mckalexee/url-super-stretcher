# Design

How the site looks, and how to keep it that way. The words have their own guide,
[copy.md](copy.md), and the same man is behind both.

## The identity

The site presents itself the way a maker of expensive cars or watches does. The man in
[copy.md](copy.md) commissioned it, and he wanted it to look serious and costly. The design never
jokes. It has no rulers, no stretched shapes, and no illustrations of length, because a picture of
the joke explains the joke.

One thing on each page is loud: the headline, set at the widest width that the typeface has. Wide
type is how a marque writes its name, and it's the only reference to length that the design makes.
Everything else is quiet and has room around it.

## Type

- **Archivo**, a variable font with a width axis, sets everything except literal values. Headings
  and the site name use the widest width, `--wide`. The names of finishes and the buttons use
  `--semi-wide`. Body text uses the normal width.
- **IBM Plex Mono** sets literal values only: the field for a URL, the long link, and a
  destination. Its look-alike characters differ, which matters when a visitor checks a hostname.
- The site name is the only text in capitals.

Both fonts come from Fontsource packages and ship with the app, so a page calls no third-party
origin.

## Color

`src/web/app.css` defines every color as a custom property on `:root`, with a second set for the
dark scheme.

- **Green** is the color of the marque. In the light scheme, it's the accent on a near-white page:
  the primary button, the chosen finish, and the focus ring. In the dark scheme, it's the page.
- **Brass** frames the finished link in the light scheme, and nothing else. In the dark scheme,
  brass is also the accent, because green can't stand out against green.
- **Red** marks an error and has no other use.

## Layout

- One column, aligned left, 44rem wide at most.
- Controls and boxes have a 6px radius and a 1px border. Nothing has a shadow or a gradient.
- The finishes are tiles in two columns, in the manner of trim levels, and in one column on a
  phone.
- The headline's change of width on the home page is the only motion that the site starts by
  itself. It doesn't run for a visitor who prefers reduced motion.

## Check a change

Look at the home page, a result, and a link page at 320px and at 1280px wide, in the light scheme
and in the dark scheme. No page scrolls sideways at any width.
