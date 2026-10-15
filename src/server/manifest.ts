/** Web App Manifest。キットが触るのは `id` と `start_url` だけ。 */
export interface WebAppManifest {
  id?: string;
  start_url?: string;
  [key: string]: unknown;
}

/**
 * 元の manifest の `start_url` を引換券付きの URL に替えて返す（経路 B1）。
 *
 * `id` は変えない。元に `id` が無いと、ブラウザは `start_url` から id を決める。
 * そのままだと引換券ごとに別のアプリとみなされるので、元の `start_url`（無ければ "/"）を `id` に入れる。
 */
export function renderManifest(base: WebAppManifest, startUrl: string): WebAppManifest {
  return { ...base, id: base.id ?? base.start_url ?? '/', start_url: startUrl };
}
