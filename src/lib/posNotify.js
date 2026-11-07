const MAX_TRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const TIMEOUT_MS = 10000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tells Admin how a staff charge ended. The money has already moved or been declined, so this never
 * throws. Never carries card details.
 * @returns {Promise<boolean>} whether Admin accepted it
 */
async function notifyPosResult(result, options) {
  const url = process.env.AMWELLINC_CARD_RESULT_URL;
  if (!url) {
    console.error(`[POS] No result address set; charge ${result.ref} ended ${result.status}`);
    return false;
  }
  return postToAdmin(url, result, result.ref, options);
}

async function postToAdmin(url, result, label, { retryDelayMs = DEFAULT_RETRY_DELAY_MS } = {}) {
  for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GATEWAY_API_KEY}` },
        body: JSON.stringify(result),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (res.ok) return true;
      console.error(`[POS] Admin answered ${res.status} for ${label}, try ${attempt}`);
    } catch (error) {
      console.error(`[POS] Couldn't reach Admin for ${label}, try ${attempt}: ${error.message}`);
    }
    if (attempt < MAX_TRIES) await wait(retryDelayMs);
  }
  return false;
}

/** The website's order number, carried in its thank-you address. */
function orderNumberFrom(successUrl) {
  try {
    return new URL(successUrl).searchParams.get('order') || '';
  } catch {
    return '';
  }
}

/**
 * Tells Admin a website order was paid. The website saves the order itself, and Admin uses this
 * to notice when a paid order never arrives (AK, 7 Nov). Never throws.
 */
async function notifyWebsitePayment(payment, options) {
  const url = process.env.AMWELLINC_WEBSITE_PAID_URL;
  if (!url || !payment.orderNumber) return false;
  return postToAdmin(url, payment, payment.orderNumber, options);
}

module.exports = { notifyPosResult, notifyWebsitePayment, orderNumberFrom };
