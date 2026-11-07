const MAX_TRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const TIMEOUT_MS = 10000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tells Admin how a staff charge ended. The money has already moved or been declined, so this never
 * throws. Never carries card details.
 * @returns {Promise<boolean>} whether Admin accepted it
 */
async function notifyPosResult(result, { retryDelayMs = DEFAULT_RETRY_DELAY_MS } = {}) {
  const url = process.env.AMWELLINC_CARD_RESULT_URL;
  if (!url) {
    console.error(`[POS] No result address set; charge ${result.ref} ended ${result.status}`);
    return false;
  }
  for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GATEWAY_API_KEY}` },
        body: JSON.stringify(result),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (res.ok) return true;
      console.error(`[POS] Admin answered ${res.status} for charge ${result.ref}, try ${attempt}`);
    } catch (error) {
      console.error(`[POS] Couldn't reach Admin for charge ${result.ref}, try ${attempt}: ${error.message}`);
    }
    if (attempt < MAX_TRIES) await wait(retryDelayMs);
  }
  return false;
}

module.exports = { notifyPosResult };
