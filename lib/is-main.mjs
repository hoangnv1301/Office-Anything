// ⛔ WAS THIS FILE RUN, OR IMPORTED? Never compare the two strings yourself.
//
// The obvious version is wrong, and it fails SILENTLY, which is the worst way to fail:
//
//     if (import.meta.url === `file://${process.argv[1]}`) { ... }
//
// `import.meta.url` is a URL, so a space in the path is percent-encoded. `process.argv[1]`
// is a raw filesystem path, so it is not. On a disk called "Extreme SSD" the two are:
//
//     file:///Volumes/Extreme%20SSD/.../run.mjs      <- import.meta.url
//     /Volumes/Extreme SSD/.../run.mjs               <- process.argv[1]
//
// They never match. The CLI block never runs. The script prints nothing and EXITS 0, which
// every caller reads as success. This is not hypothetical: it is how the runner in this
// repo shipped, and it was caught only because running it by hand produced no output at all.
//
// ⛔ A SPACE IN A PATH IS NOT AN EDGE CASE. "Application Support", "My Documents", any
// external drive a person named themselves. Assume your users have one.
import { pathToFileURL } from 'node:url'

export const isMain = (metaUrl, argv1 = process.argv[1]) =>
  Boolean(argv1) && metaUrl === pathToFileURL(argv1).href
