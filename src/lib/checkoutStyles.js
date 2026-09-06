// Shared between routes/pay.js and routes/ghlProvider.js — both render an
// identical region selector, so its styling lives in one place to keep the
// two checkout surfaces from drifting apart.
//
// Sized and contrasted for an older customer base (AMWELL's own words: "not
// very visible for most seniors"): a plain white box with a 1px pale-gray
// border reads as blank space, not a button, at low vision or on a washed-
// out screen. Fixed here with a filled background distinct from the card,
// a heavier border, larger text/touch targets (64px min height — well past
// the 44px minimum accessibility guidelines call for), and an enlarged
// native radio input rather than the browser default (~13px, hard to
// see or tap precisely).
const REGION_SELECTOR_STYLES = `
    :root {
      --region-border: #9ca3af;
      --region-border-selected: #6d28d9;
      --region-bg: #f3f4f6;
      --region-bg-selected: #ede9fe;
      --region-text: #1f2937;
      --region-radio-size: 24px;
    }
    .region-label{display:block;font-size:16px;font-weight:700;color:#111827;margin-top:16px}
    .region-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px}
    @media (max-width:420px){.region-row{grid-template-columns:1fr}}
    .region-option{display:flex;align-items:center;gap:12px;padding:18px 16px;min-height:64px;border:2px solid var(--region-border);border-radius:12px;cursor:pointer;font-size:18px;font-weight:600;color:var(--region-text);background:var(--region-bg);transition:border-color .15s ease,background-color .15s ease}
    .region-option:has(input:checked){border-color:var(--region-border-selected);background:var(--region-bg-selected);color:#1a1a2e}
    .region-option input{width:var(--region-radio-size);height:var(--region-radio-size);margin:0;accent-color:var(--region-border-selected);cursor:pointer;flex-shrink:0}
    .region-option span{line-height:1.3}
`;

module.exports = { REGION_SELECTOR_STYLES };
