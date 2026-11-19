# Copy

How to write the words that visitors read: the pages, the finishes, and the text inside the
stretched links. This guide covers visitor-facing copy only. Comments, docs, and commit messages
follow [conventions.md](conventions.md).

## Who writes it

Write and review visitor-facing copy with Claude Fable, the most capable model, in the main
session. Don't hand copy to a subagent that runs a smaller model, and don't let a subagent write
copy as a side effect of other work. A subagent that changes a page keeps the existing strings and
reports where new copy is needed.

Show new copy to the owner in the conversation before you apply it. Copy is a matter of taste, and
tests quote it, so a rewrite that misses costs two rounds of changes.

## The voice

The site is deadpan. The content is absurd and the delivery is completely straight. Both halves
are required: copy that winks at the reader isn't deadpan, and copy with nothing absurd in it
isn't funny.

The site was built by a man who believes that a longer link is more powerful and more
respectable. He is the kind of person who owns a large watch and a larger car, and he has brought
the same judgment to URLs. He isn't joking, and he doesn't know that anyone else is.

That belief is the background, never the text. He doesn't explain why length matters, he doesn't
mention cars or watches, and he doesn't say that he wants respect. His values show in what he
chooses to build, name, and measure:

- He thinks about how a link looks to the person who receives it.
- He names options the way a manufacturer names trim levels.
- He presents measurements as a specification sheet.
- He values seniority, standing, authority, and being answered promptly.

The intro line sets the register: "Make your links appear longer and more intimidating."

## Rules

- **Never explain the joke.** The site doesn't say that it's satire, doesn't say that the links
  work, and doesn't remark on how long anything is. A line that comments on the product is cut.
- **One beat.** Write one statement and stop. Don't follow it with a short second sentence for
  effect, as in "Same destination. Considerably more link." That rhythm reads as machine-written.
- **Say the absurd thing as a plain fact.** "Discourages casual clicking." is a feature
  description. "Time to type by hand: 3 min 47 s" is a measurement. Neither has a remark attached.
- **Earn every subtitle.** Add a description, a hint, or a tagline only when the visitor needs it
  to act, or when it carries the voice in one clause. Most headings and fields need none.
- **No periods on headings**, and no exclamation marks anywhere.
- **Stay in his vocabulary.** Words such as "finish", "specifications", "recipient", and
  "sender" fit. Internet slang, puns, and zany images, such as a contract clause about household
  pets, don't.
- **Keep it family-friendly**, and name no real company, product, or person.

## Where the voice stops

Some copy is there to inform or protect a visitor, and it's plain:

- **Error messages** say what's wrong and how to fix it, and nothing else. For example: "Only
  http and https URLs are supported."
- **The link page** tells the recipient where the link goes and warns them to check it. The one
  line in voice is a plain statistic: "This link is 957 characters long."
- **The removed page, the blocked page, and the 404 note** are plain.

Plain copy can still be funny by itself. A link lengthener that answers "URLs longer than 2,048
characters aren't supported." needs no help.

## Before and after

| Rejected                                                                                        | Why                           | Accepted                                             |
| ----------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------- |
| URL Super Stretcher is satire. The links work anyway.                                           | Explains the joke             | No line at all                                       |
| Same destination. Considerably more link.                                                       | Two beats, comments on itself | No line at all                                       |
| That URL is longer than 2,048 characters. It doesn't need our help.                             | A joke attached to an error   | URLs longer than 2,048 characters aren't supported.  |
| Make a link longer                                                                              | Straight, with nothing absurd | Your link is too short                               |
| Enter a URL to get a much longer one that leads to the same page.                               | A bland utility               | Make your links appear longer and more intimidating. |
| Whereas you wanted a link, now therefore you get a contract. Nobody reads it. Everybody agrees. | A quip, then two more         | Discourages casual clicking.                         |
| You traveled 957 characters to get here. None of them were strictly necessary.                  | Comments on itself            | This link is 957 characters long.                    |

## The text inside the links

`src/stretch/flavors.ts` holds the word lists. The same man chose what the links say, and each
finish has a job:

- **Executive** is his own voice: real corporate jargon, closed by a phrase that pulls rank, such
  as `as-approved-at-the-executive-level`.
- **Legal** is written to intimidate, in the register of a formal notice from a sender who
  expects to be obeyed. Real contract language is applied faithfully to the act of clicking a
  link: `the-recipient-hereby-waives-any-and-all-rights-to-a-shorter-link`.
- **Fully loaded** tells the recipient that they are being assessed: `recipient_tier=under-review`,
  `response_expected=before-close-of-business`.
- **Extended** is length and nothing else.

The rules for the pages apply here too. A phrase can be absurd, but it can't be a gag, and the
link never remarks on its own length. `no-amendment-hereto-shall-be-valid-unless-it-makes-the-link-longer`
stays, because it's a clause that he would want. `so-ordered-so-agreed-and-so-very-long` goes,
because it's the link nudging the reader.

Every entry in a list has the same grammatical shape, so that any combination reads as a
sentence.

Each finish writes about 1,900 characters, so that a whole link comes to about 2,000. Executive
adds clauses and Legal adds provisos until one more would pass the limit, so an entry longer than
about 130 characters can leave a link short. The tests in `test/stretch/flavors.test.ts` check
the length of every finish.
