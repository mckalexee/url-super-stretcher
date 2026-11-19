// The path prefix of stretched links, alone in its own module. The error page in the browser
// bundle needs the prefix, and importing it from here keeps the link store and its dependencies
// out of that bundle. Don't add code to this file.

/** The path prefix that every stretched link starts with. */
export const LINK_PREFIX = "/to/";
