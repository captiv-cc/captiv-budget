// CORS headers partagés entre Edge Functions
// On autorise tout pour le dev. En prod, restreindre à l'origine de l'app.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
