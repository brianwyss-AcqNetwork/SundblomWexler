/**
 * HSW Partners Deal Scout — Cloudflare Worker Proxy
 *
 * Purpose: Forward authenticated Anthropic API requests from the
 * HSW Deal Scout web app (GitHub Pages) without exposing the API key
 * in the browser.
 *
 * Buyer:     Sarah Wexler / HSW Partners, LLC
 * Operator:  Brian Wyss / Avila Phoenix Ventures, LLC
 *
 * Setup:
 *   1. Create a new Worker named `hsw-scout` in the Cloudflare dashboard
 *   2. Paste this code into the Worker
 *   3. Settings → Variables and Secrets → Add `ANTHROPIC_API_KEY` as Secret (encrypted)
 *   4. Deploy
 *
 * Endpoint: https://hsw-scout.brian-wyss.workers.dev
 */

// =============================================================
// CORS — allow the HSW GitHub Pages origin (and common variants)
// =============================================================
const ALLOWED_ORIGINS = [
  'https://brianwyss-hswpartners.github.io',
  'https://brianwyss-acqnetwork.github.io',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:5500'
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

// =============================================================
// Main handler
// =============================================================
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Health check (GET)
    if (request.method === 'GET') {
      return new Response(
        JSON.stringify({
          service: 'HSW Partners Deal Scout Worker',
          status: 'online',
          buyer: 'Sarah Wexler / HSW Partners, LLC',
          operator: 'Brian Wyss / Avila Phoenix Ventures, LLC'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...cors }
        }
      );
    }

    // Only POST allowed for proxying
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    // Verify API key is configured
    if (!env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({
          error: 'Worker misconfigured — ANTHROPIC_API_KEY secret not set',
          fix: 'Cloudflare dashboard → Workers → hsw-scout → Settings → Variables and Secrets → Add Secret'
        }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    // Parse incoming body (must be Anthropic-format payload from the Scout)
    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

    // Sane defaults
    if (!payload.model) payload.model = 'claude-sonnet-4-5';
    if (!payload.max_tokens) payload.max_tokens = 4500;

    // Detect if the request uses the web_search tool; if so, include the
    // appropriate beta header to enable Anthropic's hosted web search.
    const usesWebSearch = Array.isArray(payload.tools) &&
      payload.tools.some(t => t && (t.type === 'web_search_20250305' || t.name === 'web_search'));

    // Forward to Anthropic
    try {
      const upstreamHeaders = {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      };
      if (usesWebSearch) {
        upstreamHeaders['anthropic-beta'] = 'web-search-2025-03-05';
      }

      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(payload)
      });

      const responseBody = await upstream.text();

      return new Response(responseBody, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json',
          ...cors
        }
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: 'Upstream Anthropic API request failed',
          message: err.message
        }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }
  }
};
