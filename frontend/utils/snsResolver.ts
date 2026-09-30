import { logger } from './logger';

const SNS_API_ENDPOINT = process.env.NEXT_PUBLIC_SNS_API || 'https://api.stellarnameservice.org/resolve';

export async function resolveSNSDomain(domain: string): Promise<string | null> {
  if (!domain || !domain.endsWith('.xlm')) {
    return null;
  }

  const cleanDomain = domain.trim().toLowerCase();
  
  try {
    const response = await fetch(`${SNS_API_ENDPOINT}?domain=${encodeURIComponent(cleanDomain)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`SNS resolution failed with status ${response.status}`);
    }

    const data = await response.json();
    return data.address || data.stellarAddress || null;
  } catch (error) {
    logger.error({ err: error, domain: cleanDomain }, 'Error resolving SNS domain');
    throw error;
  }
}