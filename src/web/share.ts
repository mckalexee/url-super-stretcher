// The tags that tell a social platform or a message app how to show a link to the site: a
// title, a line of text, and a large image. The images are static files in `public/share`, and
// docs/design.md says how they're made.
import type { MetaDescriptor } from "react-router";

const SITE_NAME = "URL Super Stretcher";

/** The share images, by the path that serves each. Both are 1200 by 630 pixels. */
export const SHARE_IMAGES = {
  home: {
    path: "/share/home.jpg",
    alt: "A gold bar engraved with a long link, on black marble, under the words Your link is too short.",
  },
  link: {
    path: "/share/link.jpg",
    alt: "A gold bar engraved with a long link, on black marble.",
  },
} as const;

const IMAGE_WIDTH = "1200";
const IMAGE_HEIGHT = "630";

/** What one page says about itself when someone shares its address. */
export interface ShareCard {
  /** The site's origin, such as `https://example.com`. A platform needs the image's full URL. */
  origin: string;
  title: string;
  description: string;
  image: (typeof SHARE_IMAGES)[keyof typeof SHARE_IMAGES];
  /**
   * The page's path, for a page with one short address. Leave it out for a stretched link,
   * whose address is as long as the rest of the page.
   */
  path?: string;
}

/**
 * Returns the Open Graph tags for a page, plus the one tag that asks X for a large image.
 * Every other platform reads the Open Graph tags.
 */
export function shareMeta({
  origin,
  title,
  description,
  image,
  path,
}: ShareCard): MetaDescriptor[] {
  const tags: MetaDescriptor[] = [
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: origin + image.path },
    { property: "og:image:type", content: "image/jpeg" },
    { property: "og:image:width", content: IMAGE_WIDTH },
    { property: "og:image:height", content: IMAGE_HEIGHT },
    { property: "og:image:alt", content: image.alt },
    { name: "twitter:card", content: "summary_large_image" },
  ];
  if (path !== undefined) {
    tags.push({ property: "og:url", content: origin + path });
  }
  return tags;
}
