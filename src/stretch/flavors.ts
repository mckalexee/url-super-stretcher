// The flavors of stretched link, and the generator that writes one. Each flavor is a different joke
// about what makes a URL long. The generator turns random bytes into the part of a link that
// follows the `/to/` prefix, and it has no storage and no knowledge of HTTP, so the same bytes
// always give the same text.

/**
 * Fills the given array with random bytes. `generateStretch` calls it once per link. Tests pass a
 * fixed source to get the same link every time.
 */
export type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => void;

/**
 * The flavors that a visitor can pick, in the order that the picker shows them. The page calls
 * them finishes. `name` and `description` are the copy for the picker, and docs/copy.md says how
 * to write them.
 */
export const FLAVORS = [
  { id: "jargon", name: "Executive", description: "Language that signals seniority." },
  { id: "legalese", name: "Legal", description: "Discourages casual clicking." },
  { id: "ooo", name: "Extended", description: "A single word that fills the address bar." },
  {
    id: "tracking",
    name: "Fully loaded",
    description: "Lets the recipient know they are being measured.",
  },
] as const satisfies readonly { id: string; name: string; description: string }[];

/** The ID of a flavor in `FLAVORS`. */
export type FlavorId = (typeof FLAVORS)[number]["id"];

/** Reports whether a string, such as a form field, names a flavor. */
export function isFlavorId(value: string): value is FlavorId {
  return FLAVORS.some((flavor) => flavor.id === value);
}

// Every link carries these bytes in full, so two links collide only if their IDs do. At 128 bits,
// that doesn't happen in practice.
const ID_BYTES = 16;

// The bytes after the ID choose the words and the characters of the click IDs. Each choice reads
// one byte, and no flavor makes more choices than this.
const CHOICE_BYTES = 1_400;

// No flavor writes more than this, and each comes within about 150 characters of it. With the
// site's address and the `/to/` prefix in front, the whole link comes to about 2,000 characters,
// which is as long as a link can be and still work everywhere.
const MAX_LENGTH = 1_960;

const defaultRandom: RandomSource = (bytes) => {
  // `getRandomValues` fails when it's called without `crypto` as its receiver, so the default
  // can't be the bare method.
  crypto.getRandomValues(bytes);
};

/** Hands out the choice bytes one at a time. */
interface Choices {
  /** Picks one entry of a list. */
  pick(list: readonly string[]): string;
  /** Picks a position below `limit`. */
  below(limit: number): number;
}

function choicesFrom(bytes: Uint8Array): Choices {
  let cursor = 0;
  // The modulo favors the early entries of a list slightly. That's fine for choosing words, and
  // the ID is what keeps links apart.
  const below = (limit: number): number => {
    const byte = bytes[cursor];
    if (byte === undefined || limit < 1) {
      throw new Error("A flavor made more choices than there are random bytes.");
    }
    cursor += 1;
    return byte % limit;
  };
  return {
    below,
    pick: (list) => list[below(list.length)] ?? "",
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Jargon. A chain of clauses in the shape "<doing> <adjective> <things> to <verb> <adjective>
// <outcomes>", joined by connectors that each lead into the next "<doing>". The chain grows until
// one more clause would pass the length limit. The two adjective lists and the two noun lists
// don't overlap, so a clause never repeats a word.

const JARGON_DOING = [
  "leveraging",
  "socializing",
  "operationalizing",
  "right-sizing",
  "double-clicking-on",
  "future-proofing",
  "whiteboarding",
  "stress-testing",
  "cross-pollinating",
  "workshopping",
  "evangelizing",
  "productizing",
  "incentivizing",
  "ideating-around",
  "benchmarking",
  "onboarding",
  "strategizing-around",
  "pressure-testing",
  "blue-skying",
  "greenlighting",
  "sunsetting",
  "deep-diving-into",
  "upleveling",
  "institutionalizing",
];

const JARGON_ADJECTIVES = [
  "synergistic",
  "mission-critical",
  "cross-functional",
  "customer-centric",
  "next-generation",
  "enterprise-grade",
  "results-driven",
  "bleeding-edge",
  "value-added",
  "client-facing",
  "outside-the-box",
  "high-impact",
  "data-driven",
  "frictionless",
  "holistic",
  "scalable",
  "best-practice",
  "turnkey",
  "board-level",
  "high-visibility",
  "market-leading",
  "fit-for-purpose",
  "performance-based",
  "agile",
];

const JARGON_THINGS = [
  "paradigm-shifts",
  "core-competencies",
  "low-hanging-fruit",
  "key-learnings",
  "thought-leadership",
  "stakeholder-touchpoints",
  "action-items",
  "deliverables",
  "value-streams",
  "growth-levers",
  "swim-lanes",
  "strategic-pillars",
  "north-star-metrics",
  "quick-wins",
  "moving-parts",
  "mindshare",
  "key-performance-indicators",
  "strategic-imperatives",
  "market-opportunities",
  "core-capabilities",
  "operating-models",
  "decision-frameworks",
  "success-criteria",
  "leadership-priorities",
];

const JARGON_VERBS = [
  "operationalize",
  "incentivize",
  "streamline",
  "monetize",
  "empower",
  "disintermediate",
  "recontextualize",
  "move-the-needle-on",
  "drill-down-into",
  "circle-back-on",
  "accelerate",
  "reimagine",
  "level-set",
  "unlock",
  "champion",
  "synergize",
  "optimize",
  "maximize",
  "drive",
  "deliver-on",
  "capitalize-on",
  "elevate",
  "galvanize",
  "transform",
];

const JARGON_OUTCOME_ADJECTIVES = [
  "best-in-class",
  "best-of-breed",
  "world-class",
  "game-changing",
  "forward-looking",
  "end-to-end",
  "blue-sky",
  "win-win",
  "top-down",
  "bottom-line",
  "seamless",
  "disruptive",
  "impactful",
  "granular",
  "actionable",
  "organic",
  "measurable",
  "sustainable",
  "category-defining",
  "premium",
  "strategic",
  "transformational",
  "high-margin",
  "market-ready",
];

const JARGON_OUTCOMES = [
  "synergies",
  "outcomes",
  "efficiencies",
  "alignment",
  "bandwidth",
  "stakeholder-buy-in",
  "shareholder-value",
  "verticals",
  "ecosystems",
  "roadmaps",
  "engagement",
  "value-propositions",
  "mission-statements",
  "pain-points",
  "takeaways",
  "headwinds",
  "growth",
  "market-share",
  "competitive-advantage",
  "returns",
  "momentum",
  "positioning",
  "leadership",
  "results",
];

const JARGON_CONNECTORS = [
  "while",
  "thereby",
  "while-simultaneously",
  "with-a-view-to",
  "as-a-first-step-toward",
  "in-the-interest-of",
  "all-without",
  "before-circling-back-and",
  "and-at-the-end-of-the-day",
  "and-going-forward",
  "which-in-turn-means",
  "by-way-of",
  "on-the-critical-path-to",
  "in-lieu-of",
  "and-as-a-matter-of-priority",
  "and-from-thirty-thousand-feet",
  "and-per-my-last-email",
  "and-as-i-said-on-the-call",
  "with-the-board-watching-closely",
];

// The opening names who is speaking, because the start of a link is the part that a recipient
// sees. Each one ends in a word that a clause can follow.
const JARGON_OPENERS = [
  "from-the-desk-of-the-chief-executive-regarding",
  "priority-briefing-from-the-executive-committee-on",
  "as-raised-by-the-chairman-at-the-leadership-offsite-regarding",
  "a-directive-from-the-office-of-the-managing-partner-concerning",
  "memorandum-to-all-staff-from-senior-leadership-regarding",
  "board-level-guidance-from-the-founder-on",
  "remarks-of-the-managing-director-to-the-senior-leadership-team-on",
  "an-update-from-the-executive-floor-regarding",
];

const JARGON_CLOSERS = [
  "as-approved-at-the-executive-level",
  "pending-sign-off-from-the-board",
  "subject-to-alignment-with-leadership",
  "per-the-office-of-the-chief-executive",
  "as-presented-to-the-senior-leadership-team",
  "with-full-visibility-at-the-highest-level",
  "for-the-immediate-attention-of-all-direct-reports",
  "as-mandated-by-the-executive-committee",
];

function jargon(id: Uint8Array, choices: Choices): string {
  const opener = choices.pick(JARGON_OPENERS);
  const ending = [choices.pick(JARGON_CLOSERS), "tracked-as-action-item", toHex(id)].join("-");
  let text = "";
  for (;;) {
    const clause = [
      choices.pick(JARGON_DOING),
      choices.pick(JARGON_ADJECTIVES),
      choices.pick(JARGON_THINGS),
      "to",
      choices.pick(JARGON_VERBS),
      choices.pick(JARGON_OUTCOME_ADJECTIVES),
      choices.pick(JARGON_OUTCOMES),
    ];
    if (text !== "") {
      clause.unshift(text, choices.pick(JARGON_CONNECTORS));
    }
    const longer = clause.join("-");
    if (opener.length + 1 + longer.length + 1 + ending.length > MAX_LENGTH) {
      break;
    }
    text = longer;
  }
  return `${opener}-${text}-${ending}`;
}

// Legalese. One notice with a fixed skeleton: two recitals that define "the recipient" and "the
// link", the basis, a run of covenants, a run of provisos, and an attestation. It reads as a
// document from a sender who expects to be obeyed. Every entry in a list has the same
// grammatical shape, so any combination reads as a sentence. The covenants and the provisos are
// drawn without repeats, and the provisos run until one more would pass the length limit.

const LEGAL_CLICKERS = [
  "the-party-of-the-first-part",
  "the-recipient-of-this-link-howsoever-received",
  "the-individual-presently-in-possession-of-this-link",
  "the-natural-or-legal-person-to-whom-this-link-has-been-directed",
  "the-addressee-together-with-all-agents-employees-and-assigns-thereof",
  "any-person-who-has-opened-viewed-or-otherwise-accessed-this-link",
  "the-above-referenced-party-in-receipt-of-this-communication",
  "the-user-of-the-device-upon-which-this-link-is-displayed",
];

const LEGAL_CLICKER_RECITALS = [
  "has-received-this-link-from-a-party-of-considerable-standing",
  "is-hereby-placed-on-formal-notice-of-the-contents-hereof",
  "is-deemed-to-have-read-understood-and-accepted-this-link-in-full",
  "has-been-selected-to-receive-this-link-at-the-sole-discretion-of-the-sender",
  "is-required-to-give-this-link-prompt-and-undivided-attention",
  "acknowledges-the-seniority-of-the-party-from-whom-this-link-originates",
  "has-no-authority-to-alter-abbreviate-or-otherwise-diminish-this-link",
  "is-advised-that-this-link-has-been-prepared-with-the-benefit-of-counsel",
];

const LEGAL_LINKS = [
  "the-party-of-the-second-part",
  "this-uniform-resource-locator-together-with-its-successors-and-assigns",
  "the-within-address-in-its-entirety-and-no-lesser-portion-thereof",
  "the-instrument-now-before-the-recipient",
  "the-hyperlink-including-all-schedules-exhibits-and-annexes-hereto",
  "this-proprietary-and-confidential-web-address",
  "the-communication-of-which-this-link-forms-the-whole",
  "the-address-set-forth-herein-and-each-and-every-character-thereof",
];

const LEGAL_LINK_RECITALS = [
  "is-the-sole-and-exclusive-property-of-the-sender",
  "is-protected-under-all-applicable-laws-treaties-and-conventions",
  "has-been-issued-under-the-full-authority-of-the-sender",
  "is-confidential-privileged-and-intended-solely-for-the-recipient",
  "carries-the-full-weight-and-standing-of-the-party-who-sent-it",
  "is-furnished-subject-to-the-terms-conditions-and-reservations-herein",
  "may-not-be-reproduced-forwarded-or-summarized-without-prior-written-consent",
  "constitutes-a-formal-communication-for-all-purposes-whatsoever",
];

const LEGAL_CONSIDERATIONS = [
  "in-consideration-of-one-click-and-other-good-and-valuable-consideration-the-receipt-and-sufficiency-of-which-are-hereby-acknowledged",
  "in-consideration-of-the-mutual-covenants-contained-herein",
  "upon-the-terms-and-subject-to-the-conditions-set-forth-herein",
  "the-sender-expressly-reserving-all-rights-remedies-and-privileges",
  "without-prejudice-to-any-right-of-the-sender-whether-at-law-or-in-equity",
  "time-being-of-the-essence-in-all-respects",
  "in-reliance-upon-the-representations-and-warranties-of-the-recipient",
  "the-parties-intending-to-be-legally-bound-hereby",
];

const LEGAL_COVENANTS = [
  "agrees-to-proceed-to-the-destination-without-delay",
  "waives-any-and-all-rights-to-a-shorter-link",
  "acknowledges-receipt-of-this-link-in-its-entirety",
  "undertakes-to-treat-this-link-with-the-deference-due-to-its-sender",
  "releases-the-sender-from-all-claims-demands-and-causes-of-action-whatsoever",
  "consents-to-the-exclusive-jurisdiction-of-the-courts-selected-by-the-sender",
  "represents-and-warrants-that-the-recipient-is-authorized-to-click",
  "accepts-these-terms-by-clicking-hovering-or-otherwise-interacting-herewith",
  "submits-to-the-authority-of-the-sender-in-all-matters-relating-to-this-link",
  "agrees-to-keep-the-existence-and-contents-of-this-link-strictly-confidential",
  "acknowledges-that-the-sender-has-relied-upon-the-recipient-clicking-promptly",
  "warrants-that-the-recipient-has-full-power-and-authority-to-open-this-link",
  "undertakes-to-notify-the-sender-forthwith-upon-arrival-at-the-destination",
  "agrees-to-bear-all-costs-and-expenses-incurred-in-connection-with-clicking",
  "waives-presentment-demand-protest-and-notice-of-every-kind",
  "appoints-the-sender-as-attorney-in-fact-for-all-purposes-hereunder",
];

const LEGAL_FURTHER_COVENANTS = [
  "covenants-not-to-contest-the-validity-or-enforceability-of-this-link",
  "agrees-not-to-shorten-truncate-or-abridge-this-link-by-any-means",
  "undertakes-to-indemnify-and-hold-harmless-the-sender-and-its-affiliates",
  "forgoes-the-right-to-trial-by-jury-in-any-dispute-arising-hereunder",
  "agrees-that-any-breach-hereof-would-cause-the-sender-irreparable-harm",
  "acknowledges-that-the-sender-may-seek-injunctive-relief-without-posting-bond",
  "stipulates-that-this-link-was-negotiated-at-arms-length",
  "confirms-that-no-reliance-has-been-placed-on-any-shorter-version-hereof",
  "acknowledges-having-had-the-opportunity-to-seek-independent-advice-before-clicking",
  "agrees-that-use-of-the-back-button-shall-not-constitute-rescission",
];

const LEGAL_PROVISOS = [
  "nothing-herein-shall-be-construed-as-a-waiver-of-any-right-of-the-sender",
  "this-link-constitutes-the-entire-agreement-and-supersedes-all-prior-and-shorter-links",
  "any-provision-held-unenforceable-shall-be-severed-and-the-remainder-shall-continue-in-full-force-and-effect",
  "no-failure-or-delay-in-clicking-shall-operate-as-a-waiver-hereof",
  "the-headings-hereof-are-for-convenience-only-and-shall-not-affect-interpretation",
  "the-destination-is-furnished-as-is-without-warranty-of-any-kind-express-or-implied",
  "this-link-shall-be-governed-by-the-laws-of-the-jurisdiction-of-the-sender",
  "no-event-of-force-majeure-shall-excuse-a-failure-to-click",
  "the-sender-shall-have-no-liability-howsoever-arising-in-connection-with-the-destination",
  "the-remedies-of-the-sender-shall-survive-the-closing-of-the-browser",
  "this-link-shall-inure-to-the-benefit-of-the-sender-and-its-successors",
  "no-third-party-shall-acquire-any-right-under-or-by-virtue-of-this-link",
  "the-recipient-may-not-assign-any-right-or-obligation-hereunder",
  "any-dispute-hereunder-shall-be-resolved-at-the-sole-election-of-the-sender",
  "the-terms-hereof-shall-be-construed-in-favor-of-the-sender-in-all-cases",
  "delivery-of-this-link-by-electronic-means-shall-be-deemed-effective-upon-sending",
];

const LEGAL_FURTHER_PROVISOS = [
  "no-amendment-hereto-shall-be-valid-unless-it-makes-the-link-longer",
  "this-clause-shall-survive-the-termination-of-the-redirect",
  "the-link-may-be-executed-in-any-number-of-browser-tabs-each-of-which-shall-be-deemed-an-original",
  "the-recipient-shall-be-entitled-to-no-remedy-other-than-arrival-at-the-destination",
  "all-notices-hereunder-shall-be-given-in-writing-to-the-sender",
  "the-rights-of-the-sender-hereunder-are-cumulative-and-not-exclusive",
  "the-obligations-of-the-recipient-shall-bind-all-successors-and-permitted-assigns",
  "the-sender-may-assign-this-link-without-the-consent-of-the-recipient",
  "time-spent-reading-this-link-shall-not-toll-the-obligation-to-click",
];

const LEGAL_ATTESTATIONS = [
  "in-witness-whereof-the-parties-have-executed-this-link-by-a-single-click",
  "in-witness-whereof-this-link-is-executed-as-of-the-date-first-clicked",
  "signed-sealed-and-delivered-by-the-sender",
  "given-under-the-hand-and-seal-of-the-sender",
  "all-rights-reserved-without-limitation",
  "executed-in-counterparts-each-of-which-shall-constitute-an-original",
  "so-ordered-and-so-agreed",
  "duly-authorized-and-issued-by-the-office-of-the-sender",
];

// The covenants run until the notice reaches this length, which leaves the provisos about the
// same room.
const LEGAL_COVENANTS_END = 1_050;

// Hands out the entries of a list in a random order, each one once, then `undefined`.
function drawWithoutRepeats(list: readonly string[], choices: Choices): () => string | undefined {
  const rest = [...list];
  return () => (rest.length === 0 ? undefined : rest.splice(choices.below(rest.length), 1)[0]);
}

function legalese(id: Uint8Array, choices: Choices): string {
  const opening = [
    "whereas",
    choices.pick(LEGAL_CLICKERS),
    "hereinafter-the-recipient",
    choices.pick(LEGAL_CLICKER_RECITALS),
    "and-whereas",
    choices.pick(LEGAL_LINKS),
    "hereinafter-the-link",
    choices.pick(LEGAL_LINK_RECITALS),
    "now-therefore",
    choices.pick(LEGAL_CONSIDERATIONS),
  ].join("-");
  const ending = [
    choices.pick(LEGAL_ATTESTATIONS),
    "and-recorded-as-instrument-number",
    toHex(id),
  ].join("-");
  const covenant = drawWithoutRepeats([...LEGAL_COVENANTS, ...LEGAL_FURTHER_COVENANTS], choices);
  const proviso = drawWithoutRepeats([...LEGAL_PROVISOS, ...LEGAL_FURTHER_PROVISOS], choices);

  let text = `${opening}-the-recipient-hereby-${covenant() ?? ""}`;
  while (text.length < LEGAL_COVENANTS_END) {
    const next = covenant();
    if (next === undefined) {
      break;
    }
    text += `-and-further-${next}`;
  }
  text += `-provided-however-that-${proviso() ?? ""}`;
  for (;;) {
    const next = proviso();
    if (next === undefined) {
      break;
    }
    const longer = `${text}-and-provided-further-that-${next}`;
    if (longer.length + 1 + ending.length > MAX_LENGTH) {
      break;
    }
    text = longer;
  }
  return `${text}-${ending}`;
}

// Ooo. The word "long" with the ID hidden in its o's. The ID is written in base 3, and each digit
// becomes a run of lowercase o's in which one letter is `o`, `O`, or `0`. From a distance, it's
// all o's.

const OOO_DIGITS = ["o", "O", "0"];

// 3^81 is the first power of 3 above 2^128, so 81 digits hold every ID.
const OOO_DIGIT_COUNT = 81;

const OOO_RUN_LENGTH = 23;

function ooo(id: Uint8Array, choices: Choices): string {
  let rest = BigInt(`0x${toHex(id)}`);
  let runs = "";
  for (let index = 0; index < OOO_DIGIT_COUNT; index += 1) {
    const digit = OOO_DIGITS[Number(rest % 3n)] ?? "o";
    rest /= 3n;
    // The digit's place in its run varies, so the capitals and zeros don't line up in a visible
    // rhythm. The runs keep a fixed length, so the digits stay readable in order.
    const place = choices.below(OOO_RUN_LENGTH);
    runs += "o".repeat(place) + digit + "o".repeat(OOO_RUN_LENGTH - 1 - place);
  }
  return `l${runs}ng`;
}

// Tracking. A landing page with every campaign parameter, then parameters that tell the recipient
// how they rank, what is expected of them, and that the sender is watching, then every ad
// platform's click ID. The assessment comes before the click IDs because the start of a link is
// the part that a recipient reads. The click IDs are random noise, as the real ones appear to be,
// and three marketing tokens take up whatever length is left.

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const TRACKING_SOURCES = [
  "executive-office",
  "direct-outreach",
  "priority-distribution-list",
  "senior-leadership-briefing",
  "private-client-desk",
  "board-communication",
  "office-of-the-principal",
  "confidential-memorandum",
];

const TRACKING_MEDIUMS = [
  "personal-correspondence",
  "secure-channel",
  "direct-message",
  "executive-briefing",
  "priority-email",
  "hand-delivered",
  "encrypted-transfer",
  "private-line",
];

const TRACKING_CAMPAIGNS = [
  "q4-strategic-outreach",
  "key-relationship-development",
  "high-value-recipient-program",
  "principal-level-engagement",
  "fy26-influence-initiative",
  "tier-one-contact-strategy",
  "executive-visibility-program",
  "preferred-recipient-review",
];

const TRACKING_TERMS = [
  "authority",
  "market-leadership",
  "decisive-action",
  "premium-positioning",
  "competitive-dominance",
  "executive-presence",
  "strategic-advantage",
  "industry-standing",
];

const TRACKING_CONTENTS = [
  "full-length-edition",
  "principal-signature-version",
  "unabridged",
  "executive-summary-omitted",
  "long-form-variant-a",
  "complete-and-unedited",
  "director-level-draft",
  "final-approved-copy",
];

const TRACKING_TIERS = [
  "under-review",
  "provisional",
  "tier-two-pending-upgrade",
  "standard",
  "unverified",
  "watchlist",
  "candidate",
  "probationary",
];

const TRACKING_PRIORITIES = [
  "executive",
  "urgent",
  "immediate",
  "critical",
  "highest",
  "time-sensitive",
  "escalated",
  "principal",
];

const TRACKING_CLEARANCES = [
  "restricted",
  "confidential",
  "need-to-know",
  "principals-only",
  "internal",
  "privileged",
  "eyes-only",
  "level-four",
];

const TRACKING_RESPONSES = [
  "within-the-hour",
  "same-day",
  "before-close-of-business",
  "immediately",
  "promptly",
  "without-delay",
  "by-return",
  "on-receipt",
];

const TRACKING_RECEIPTS = [
  "required",
  "requested",
  "logged",
  "enabled",
  "mandatory",
  "recorded",
  "confirmed-on-open",
  "active",
];

const TRACKING_ENGAGEMENTS = [
  "being-calculated",
  "below-expectation",
  "pending",
  "under-observation",
  "recorded",
  "benchmarked-against-peers",
  "to-be-discussed",
  "noted",
];

const TRACKING_RANKS = [
  "principal",
  "managing-director",
  "senior-partner",
  "chairman",
  "founder",
  "executive-vice-president",
  "chief-executive",
  "owner",
];

const TRACKING_FOLLOW_UPS = [
  "scheduled",
  "escalated-if-unopened",
  "automatic",
  "in-48-hours",
  "by-assistant",
  "pending-response",
  "guaranteed",
  "arranged",
];

const TRACKING_STANDINGS = [
  "under-assessment",
  "conditional",
  "satisfactory",
  "to-be-determined",
  "flagged-for-review",
  "acceptable",
  "pending-verification",
  "on-notice",
];

const TRACKING_SENIORITIES = [
  "director-and-above",
  "vice-president",
  "c-suite",
  "partner",
  "board-member",
  "managing-director",
  "senior-management",
  "principal",
];

const TRACKING_ATTENTIONS = [
  "undivided",
  "full",
  "immediate",
  "exclusive",
  "sustained",
  "priority",
  "complete",
  "uninterrupted",
];

const TRACKING_ESCALATIONS = [
  "direct-to-principal",
  "via-chief-of-staff",
  "executive-assistant",
  "office-of-the-chairman",
  "senior-partner-review",
  "board-secretary",
  "managing-director",
  "general-counsel",
];

const TRACKING_WINDOWS = [
  "four-hours",
  "end-of-day",
  "one-business-day",
  "until-noon",
  "thirty-minutes",
  "close-of-business",
  "two-hours",
  "immediate",
];

const TRACKING_FORWARDINGS = [
  "prohibited",
  "by-permission-only",
  "monitored",
  "restricted",
  "logged",
  "not-authorized",
  "subject-to-approval",
  "disabled",
];

const TRACKING_REPLY_TOS = [
  "the-office-of-the-sender",
  "executive-assistant",
  "chief-of-staff",
  "senior-counsel",
  "the-principal-directly",
  "private-secretary",
  "designated-representative",
  "the-managing-partner",
];

const TRACKING_REVIEWS = [
  "scheduled",
  "pending",
  "quarterly",
  "in-progress",
  "under-consideration",
  "to-be-arranged",
  "annual",
  "deferred",
];

const TRACKING_COPIED = [
  "human-resources",
  "direct-supervisor",
  "general-counsel",
  "the-board",
  "compliance",
];

const TRACKING_REMINDERS = ["first", "second", "third-and-final", "final-notice"];

const TRACKING_UNOPENED = ["none-on-record", "one", "two", "several", "noted"];

const TRACKING_PEERS = ["majority", "all-but-one", "all-senior-staff", "everyone-copied"];

const TRACKING_TIMINGS = ["being-recorded", "benchmarked-against-peers", "to-be-discussed"];

// The length of the whole text. The last three tokens are cut to fit, so this flavor always
// comes out at exactly this length.
const TRACKING_LENGTH = 1_900;

function tracking(id: Uint8Array, choices: Choices): string {
  const token = (length: number): string => {
    let text = "";
    for (let index = 0; index < length; index += 1) {
      text += TOKEN_ALPHABET.charAt(choices.below(TOKEN_ALPHABET.length));
    }
    return text;
  };
  const parameters = [
    ["utm_source", choices.pick(TRACKING_SOURCES)],
    ["utm_medium", choices.pick(TRACKING_MEDIUMS)],
    ["utm_campaign", choices.pick(TRACKING_CAMPAIGNS)],
    ["utm_term", choices.pick(TRACKING_TERMS)],
    ["utm_content", choices.pick(TRACKING_CONTENTS)],
    ["sender_rank", choices.pick(TRACKING_RANKS)],
    ["recipient_tier", choices.pick(TRACKING_TIERS)],
    ["account_standing", choices.pick(TRACKING_STANDINGS)],
    ["cc", choices.pick(TRACKING_COPIED)],
    ["reminder", choices.pick(TRACKING_REMINDERS)],
    ["prior_links_unopened", choices.pick(TRACKING_UNOPENED)],
    ["peers_already_opened", choices.pick(TRACKING_PEERS)],
    ["time_to_open", choices.pick(TRACKING_TIMINGS)],
    ["seniority_required", choices.pick(TRACKING_SENIORITIES)],
    ["priority", choices.pick(TRACKING_PRIORITIES)],
    ["clearance", choices.pick(TRACKING_CLEARANCES)],
    ["attention_level", choices.pick(TRACKING_ATTENTIONS)],
    ["response_expected", choices.pick(TRACKING_RESPONSES)],
    ["open_window", choices.pick(TRACKING_WINDOWS)],
    ["read_receipt", choices.pick(TRACKING_RECEIPTS)],
    ["forwarding", choices.pick(TRACKING_FORWARDINGS)],
    ["reply_to", choices.pick(TRACKING_REPLY_TOS)],
    ["escalation_path", choices.pick(TRACKING_ESCALATIONS)],
    ["engagement_score", choices.pick(TRACKING_ENGAGEMENTS)],
    ["performance_review", choices.pick(TRACKING_REVIEWS)],
    ["follow_up", choices.pick(TRACKING_FOLLOW_UPS)],
    ["fbclid", token(96)],
    ["gclid", token(88)],
    ["wbraid", token(60)],
    ["gbraid", token(60)],
    ["dclid", token(64)],
    ["msclkid", token(32)],
    ["ttclid", token(64)],
    ["twclid", token(40)],
    ["li_fat_id", token(36)],
    ["igshid", token(24)],
    ["mc_eid", token(16)],
    ["click_id", toHex(id)],
    ["session_id", token(40)],
    ["impression_id", token(32)],
  ];
  // Three marketing tokens share the remaining length, so no single value dwarfs the rest.
  const fillers = ["mkt_tok", "_gl", "_hsenc"];
  const fixed = `landing?${parameters.map(([key, value]) => `${key}=${value}`).join("&")}`;
  const keys = fillers.reduce((total, key) => total + key.length + 2, 0);
  const room = TRACKING_LENGTH - fixed.length - keys;
  const share = Math.floor(room / fillers.length);
  return fillers.reduce((text, key, index) => {
    const length = index === fillers.length - 1 ? room - share * index : share;
    return `${text}&${key}=${token(length)}`;
  }, fixed);
}

// Each writer takes the ID bytes, which it must put into its text in full, and the choices.
const WRITERS: Record<FlavorId, (id: Uint8Array, choices: Choices) => string> = {
  jargon,
  legalese,
  ooo,
  tracking,
};

/**
 * Writes the part of a stretched link that follows the `/to/` prefix: a path, plus a query string
 * for the `tracking` flavor. The text is about 1,800 to 1,960 characters long, and it uses only
 * characters that browsers and URL parsers leave alone, so the link that comes back in a request
 * is the link that went out. Each result carries a 128-bit random ID, and the same flavor and
 * random bytes always give the same text.
 */
export function generateStretch(flavor: FlavorId, random: RandomSource = defaultRandom): string {
  const bytes = new Uint8Array(ID_BYTES + CHOICE_BYTES);
  random(bytes);
  return WRITERS[flavor](bytes.subarray(0, ID_BYTES), choicesFrom(bytes.subarray(ID_BYTES)));
}
