/**
 * `<link rel="manifest">` を引換券付きの manifest URL に差し替える（経路 B1）。
 * ホーム画面に追加するときに読まれる manifest の `start_url` に、引換券が入る。
 * 戻す関数を返す。
 */
export function overrideManifest(manifestUrl: string): () => void {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (existing) {
    const previous = existing.getAttribute('href');
    existing.setAttribute('href', manifestUrl);
    return () => {
      if (previous === null) existing.removeAttribute('href');
      else existing.setAttribute('href', previous);
    };
  }

  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = manifestUrl;
  document.head.appendChild(link);
  return () => link.remove();
}
