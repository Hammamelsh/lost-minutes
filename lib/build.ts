/**
 * Which build this is, stamped at build time from the commit (see `pnpm build`).
 *
 * A beta tester's report is worth much more with it: "the 256 said nothing at 8am" is a
 * different report against yesterday's build. It is a short commit hash and the minute the
 * site was built, never anything about the person reading it.
 */
export const BUILD=process.env.NEXT_PUBLIC_BUILD||'development';
