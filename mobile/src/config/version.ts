export const CURRENT_APP_VERSION = '1.3.0';

export interface AppReleaseInfo {
  version: string;
  name: string;
  notes: string;
  downloadUrl: string;
  publishedAt: string;
}

/**
 * Compara duas versões semânticas (ex: '1.3.0' vs '1.2.0')
 * Retorna true se a versão remota for superior à instalada.
 */
export function isNewerVersion(remote: string, current: string): boolean {
  const cleanRemote = remote.replace(/^v/i, '').trim();
  const cleanCurrent = current.replace(/^v/i, '').trim();

  const rParts = cleanRemote.split('.').map((p) => parseInt(p, 10) || 0);
  const cParts = cleanCurrent.split('.').map((p) => parseInt(p, 10) || 0);

  const maxLen = Math.max(rParts.length, cParts.length);
  for (let i = 0; i < maxLen; i++) {
    const r = rParts[i] || 0;
    const c = cParts[i] || 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

/**
 * Consulta a versão mais recente diretamente do backend ou do GitHub Releases
 */
export async function checkAppUpdate(backendWsUrl: string): Promise<AppReleaseInfo | null> {
  // Extrai o host HTTP a partir do WebSocket URL
  let httpBaseUrl = 'https://claudia-ingles-backend.onrender.com';
  try {
    if (backendWsUrl.startsWith('ws://')) {
      httpBaseUrl = backendWsUrl.replace(/^ws:\/\//, 'http://').split('/ws')[0];
    } else if (backendWsUrl.startsWith('wss://')) {
      httpBaseUrl = backendWsUrl.replace(/^wss:\/\//, 'https://').split('/ws')[0];
    }
  } catch {
    httpBaseUrl = 'https://claudia-ingles-backend.onrender.com';
  }

  // 1. Tenta pelo endpoint do backend
  try {
    const res = await fetch(`${httpBaseUrl}/api/app-version`);
    if (res.ok) {
      const data = (await res.json()) as AppReleaseInfo;
      if (data && data.version) {
        return data;
      }
    }
  } catch {
    // Falha silenciosa, tenta fallback direto do GitHub
  }

  // 2. Fallback direto no GitHub Releases
  try {
    const ghRes = await fetch(
      'https://api.github.com/repos/m4rcus-vinicius/appingles-claudia/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'AppIngles-Mobile-App',
        },
      }
    );
    if (ghRes.ok) {
      const ghData = (await ghRes.json()) as any;
      const tag = String(ghData.tag_name || '').replace(/^v/i, '');
      const asset = (ghData.assets || []).find((a: any) =>
        String(a.name).endsWith('.apk')
      );
      return {
        version: tag || '1.3.0',
        name: ghData.name || `Versão ${tag}`,
        notes: ghData.body || 'Nova atualização disponível!',
        downloadUrl:
          asset?.browser_download_url ||
          'https://github.com/m4rcus-vinicius/appingles-claudia/releases/latest/download/Claudia-Ingles-Sem-Filtro.apk',
        publishedAt: ghData.published_at || new Date().toISOString(),
      };
    }
  } catch {
    // ignore
  }

  return null;
}
